import { prisma } from "@/lib/db/client";
import { encryptField } from "@/lib/crypto";
import { checkTone, hasCrisisFooter } from "@/lib/agents/toneRules";

// Guardian: the safety governor. Every outbound action from every other
// agent passes through here before anything is sent or shown as
// awaiting-human. Guardian fails closed: if consent is missing or the
// action violates cadence/tone/escalation rules, it blocks and logs why.
// Nothing in this file talks to a messaging provider — it only decides.

export type AgentName = "forecast" | "companion" | "circle" | "bridge";
export type ActionType =
  | "send_message" // Companion Agent caring contact
  | "nudge_contact" // Circle Agent asks a support person to check in
  | "schedule_session" // Bridge Agent books teletherapy
  | "surface_resources"; // crisis resources (988 / 741741) — always allowed

export type BridgeRung = "coping_strategies" | "contact_person" | "book_session" | "crisis_resources";

const BRIDGE_LADDER: BridgeRung[] = ["coping_strategies", "contact_person", "book_session", "crisis_resources"];
const BRIDGE_RUNG_TO_ACTION_TYPE: Record<BridgeRung, ActionType> = {
  coping_strategies: "surface_resources",
  contact_person: "nudge_contact",
  book_session: "schedule_session",
  crisis_resources: "surface_resources",
};

export const CADENCE_LIMITS: Record<string, { maxPerDayPerChannel: number; maxPerRiskWindow: number }> = {
  companion: { maxPerDayPerChannel: 1, maxPerRiskWindow: 3 },
  circle: { maxPerDayPerChannel: 1, maxPerRiskWindow: 1 },
};

export type ProposedAction = {
  userId: string;
  agent: AgentName;
  type: ActionType;
  channel?: "sms" | "email" | "in_app";
  content?: string; // plaintext; encrypted on write
  consentScope?: string; // required unless type === "surface_resources"
  riskWindowId?: string;
  bridgeRung?: BridgeRung; // required when agent === "bridge" and type !== "surface_resources"
  userInitiated?: boolean; // true if the user directly tapped for this (e.g. "I want to talk to someone") — skips ladder-order check, not consent/tone/cadence
};

type EvaluationResult = {
  actionId: string;
  approvalState: string;
  approved: boolean;
  reason?: string;
};

async function log(userId: string, actionId: string | null, actor: string, event: string, detail: unknown) {
  await prisma.auditLog.create({
    data: {
      userId,
      actionId: actionId ?? undefined,
      actor,
      event,
      detail: JSON.stringify(detail),
    },
  });
}

// Exposed so other agents (e.g. Bridge's computer-use step) can add an
// audit trail entry for something that isn't itself a gated Action, without
// duplicating the append-only write logic.
export const writeAuditLog = log;

async function findActiveConsent(userId: string, scope: string) {
  return prisma.consent.findFirst({
    where: { userId, scope, granted: true, revokedAt: null },
    orderBy: { grantedAt: "desc" },
  });
}

async function checkCadence(userId: string, agent: AgentName, channel: string | undefined, riskWindowId: string | undefined) {
  const limits = CADENCE_LIMITS[agent];
  if (!limits) return { ok: true as const };

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dayCount = await prisma.action.count({
    where: {
      userId,
      agent,
      channel: channel ?? undefined,
      approvalState: { in: ["guardian_approved", "awaiting_human", "human_approved", "sent"] },
      createdAt: { gte: since24h },
    },
  });
  if (dayCount >= limits.maxPerDayPerChannel) {
    return { ok: false as const, reason: `cadence_exceeded_daily (${dayCount}/${limits.maxPerDayPerChannel} on ${channel ?? "any channel"} in last 24h)` };
  }

  if (riskWindowId) {
    const windowCount = await prisma.action.count({
      where: {
        userId,
        agent,
        riskWindowId,
        approvalState: { in: ["guardian_approved", "awaiting_human", "human_approved", "sent"] },
      },
    });
    if (windowCount >= limits.maxPerRiskWindow) {
      return { ok: false as const, reason: `cadence_exceeded_window (${windowCount}/${limits.maxPerRiskWindow} in this risk window)` };
    }
  }

  return { ok: true as const };
}

async function checkEscalationLadder(userId: string, rung: BridgeRung, userInitiated: boolean) {
  if (rung === "crisis_resources") return { ok: true as const }; // always allowed
  if (userInitiated) return { ok: true as const }; // user pulled directly, ladder order doesn't apply

  const rungIndex = BRIDGE_LADDER.indexOf(rung);
  const priorRungs = BRIDGE_LADDER.slice(0, rungIndex);

  for (const prior of priorRungs) {
    if (prior === "crisis_resources") continue;
    const priorType = BRIDGE_RUNG_TO_ACTION_TYPE[prior];
    const existing = await prisma.action.findFirst({
      where: {
        userId,
        agent: "bridge",
        type: priorType,
        approvalState: { in: ["guardian_approved", "awaiting_human", "human_approved", "sent"] },
      },
    });
    if (!existing) {
      return { ok: false as const, reason: `escalation_ladder_skipped (missing rung "${prior}" before "${rung}")` };
    }
  }
  return { ok: true as const };
}

// checkCadence() counts existing Actions and only later does proposeAction
// write the new one — under concurrent calls for the same user, multiple
// requests can all read the same count before any of them commit, letting
// more through than the cap allows (caught live by the red-team suite: 20
// concurrent sends let 4 through against a cap of 3). SQLite is effectively
// single-writer per process anyway, so the simplest correct fix is to
// serialize proposeAction per user with an in-process queue rather than
// fight transaction isolation semantics.
const userQueues = new Map<string, Promise<unknown>>();

function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const tail = userQueues.get(userId) ?? Promise.resolve();
  const result = tail.then(fn, fn);
  userQueues.set(userId, result.then(
    () => undefined,
    () => undefined
  ));
  return result;
}

/**
 * Evaluate and record a proposed action. Always creates an Action row (even
 * when blocked) so the audit trail shows what was attempted and why it
 * didn't go out — that visible "no" is the point of the demo.
 */
export async function proposeAction(proposed: ProposedAction): Promise<EvaluationResult> {
  return withUserLock(proposed.userId, () => proposeActionUnlocked(proposed));
}

async function proposeActionUnlocked(proposed: ProposedAction): Promise<EvaluationResult> {
  const { userId, agent, type, channel, content, consentScope, riskWindowId, bridgeRung, userInitiated } = proposed;

  const action = await prisma.action.create({
    data: {
      userId,
      agent,
      type,
      channel,
      contentEnc: content ? encryptField(content) : undefined,
      riskWindowId,
      approvalState: "pending",
    },
  });

  const block = async (reason: string) => {
    await prisma.action.update({ where: { id: action.id }, data: { approvalState: "guardian_blocked", blockReason: reason } });
    await log(userId, action.id, "guardian", "guardian.block", { reason, agent, type, channel });
    return { actionId: action.id, approvalState: "guardian_blocked", approved: false, reason };
  };

  // 1. Consent — fail closed. surface_resources (crisis line) needs no consent.
  if (type !== "surface_resources") {
    if (!consentScope) return block("no_consent_scope_provided");
    const consent = await findActiveConsent(userId, consentScope);
    if (!consent) return block(`no_active_consent_for_scope:${consentScope}`);
    await prisma.action.update({ where: { id: action.id }, data: { consentId: consent.id } });
  }

  // 2. Tone — only for content the system would send/show to a person.
  if (content && (type === "send_message" || type === "nudge_contact")) {
    const violations = checkTone(content);
    if (violations.length > 0) {
      return block(`tone_violation:${violations.map((v) => v.rule).join(",")}`);
    }
    if (type === "send_message" && !hasCrisisFooter(content)) {
      return block("missing_crisis_footer");
    }
  }

  // 3. Cadence — Companion/Circle rate limits.
  if (type === "send_message" || type === "nudge_contact") {
    const cadence = await checkCadence(userId, agent, channel, riskWindowId);
    if (!cadence.ok) return block(cadence.reason);
  }

  // 4. Escalation ladder — Bridge Agent may not skip rungs autonomously.
  if (agent === "bridge") {
    if (!bridgeRung) return block("bridge_action_missing_rung");
    const ladder = await checkEscalationLadder(userId, bridgeRung, Boolean(userInitiated));
    if (!ladder.ok) return block(ladder.reason);
  }

  // Approved. High-stakes actions (booking a session) still need a human click.
  const requiresHuman = type === "schedule_session";
  const approvalState = requiresHuman ? "awaiting_human" : "guardian_approved";
  await prisma.action.update({ where: { id: action.id }, data: { approvalState } });
  await log(userId, action.id, "guardian", requiresHuman ? "guardian.approve_pending_human" : "guardian.approve", {
    agent,
    type,
    channel,
    consentScope,
  });

  return { actionId: action.id, approvalState, approved: true };
}

export async function recordHumanApproval(actionId: string, approverNote?: string) {
  const action = await prisma.action.findUniqueOrThrow({ where: { id: actionId } });
  if (action.approvalState !== "awaiting_human") {
    throw new Error(`Action ${actionId} is not awaiting human approval (state: ${action.approvalState})`);
  }
  await prisma.action.update({ where: { id: actionId }, data: { approvalState: "human_approved" } });
  await log(action.userId, actionId, "human", "human.approve", { note: approverNote ?? null });
  return { actionId, approvalState: "human_approved" };
}

export async function markSent(actionId: string, deliveryDetail: unknown) {
  const action = await prisma.action.findUniqueOrThrow({ where: { id: actionId } });
  if (!["guardian_approved", "human_approved"].includes(action.approvalState)) {
    throw new Error(`Action ${actionId} cannot be marked sent from state ${action.approvalState}`);
  }
  await prisma.action.update({ where: { id: actionId }, data: { approvalState: "sent" } });
  await log(action.userId, actionId, action.agent, "action.sent", deliveryDetail);
  return { actionId, approvalState: "sent" };
}

export async function revokeConsent(consentId: string, userId: string) {
  const consent = await prisma.consent.findUniqueOrThrow({ where: { id: consentId } });
  if (consent.userId !== userId) throw new Error("Consent does not belong to this user");
  await prisma.consent.update({ where: { id: consentId }, data: { revokedAt: new Date() } });
  await log(userId, null, "user", "consent.revoked", { consentId, scope: consent.scope });
  return { consentId, revoked: true };
}

export async function getAuditTrail(userId: string) {
  return prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { action: true },
  });
}
