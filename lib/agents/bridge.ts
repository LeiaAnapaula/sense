import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db/client";
import { encryptField } from "@/lib/crypto";
import { getSafetyPlan } from "@/lib/db/safetyPlan";
import { proposeAction, recordHumanApproval, markSent, writeAuditLog } from "@/lib/agents/guardian";
import { nudgeCircleContact } from "@/lib/agents/circle";
import { findAndPrefillSession, confirmSession, discardSession, type BridgeDraft } from "@/lib/agents/bridgeComputerUse";

// Screenshots are demo artifacts for the dashboard to render, not sensitive
// safety-plan content — written to disk (not the DB) so the audit page can
// just <img src="/bridge/<id>.png"> them after Guardian's own encrypted
// summary is recorded.
const SCREENSHOT_DIR = path.join(process.cwd(), "public", "bridge");

async function saveScreenshot(actionId: string, suffix: string, base64: string): Promise<string> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const filename = `${actionId}-${suffix}.png`;
  await fs.writeFile(path.join(SCREENSHOT_DIR, filename), Buffer.from(base64, "base64"));
  return `/bridge/${filename}`;
}

// Bridge Agent: the clinical escalation ladder. (a) surface the user's own
// coping strategies, (b) suggest contacting a chosen person, (c) offer to
// book a session, (d) crisis resources — always visible, never gated. Each
// rung is a Guardian-checked Action; Guardian independently refuses to let
// rung (c) fire before (a) and (b) have happened, unless the user directly
// asked for it themselves (userInitiated), matching "I want to talk to
// someone" in the demo script.

export async function surfaceCopingStrategies(userId: string, riskWindowId?: string) {
  const plan = await getSafetyPlan(userId);
  const result = await proposeAction({ userId, agent: "bridge", type: "surface_resources", bridgeRung: "coping_strategies", riskWindowId });
  return { ...result, copingStrategies: plan?.copingStrategies ?? [], reasonsToLive: plan?.reasonsToLive ?? [] };
}

export async function suggestContactPerson(userId: string, riskWindowId?: string) {
  return nudgeCircleContact(userId, { riskWindowId, bridgeRung: "contact_person" });
}

export async function surfaceCrisisResources(userId: string, riskWindowId?: string) {
  return proposeAction({ userId, agent: "bridge", type: "surface_resources", bridgeRung: "crisis_resources", riskWindowId });
}

export type RequestSessionResult = {
  actionId: string;
  approvalState: string;
  approved: boolean;
  reason?: string;
  draft?: BridgeDraft;
};

/**
 * Rung (c): propose booking a session. If Guardian approves (consent held,
 * and either the ladder was followed or the user asked directly), launches
 * the live computer-use browser to find and pre-fill a slot. Guardian's
 * state stays "awaiting_human" the whole time — nothing is actually booked
 * until confirmSessionBooking() runs after a human clicks confirm.
 */
export async function requestSessionViaBridge(
  userId: string,
  opts: { riskWindowId?: string; userInitiated: boolean; baseUrl: string }
): Promise<RequestSessionResult> {
  const proposed = await proposeAction({
    userId,
    agent: "bridge",
    type: "schedule_session",
    consentScope: "bridge.schedule",
    bridgeRung: "book_session",
    riskWindowId: opts.riskWindowId,
    userInitiated: opts.userInitiated,
  });

  if (!proposed.approved) return proposed;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const draft = await findAndPrefillSession(proposed.actionId, user.name.split(" ")[0], opts.baseUrl);
  const screenshotUrl = await saveScreenshot(proposed.actionId, "draft", draft.screenshotBase64);

  await prisma.action.update({
    where: { id: proposed.actionId },
    data: {
      contentEnc: encryptField(
        JSON.stringify({
          selectedSlotLabel: draft.selectedSlotLabel,
          nameFilled: draft.nameFilled,
          usedLiveModel: draft.usedLiveModel,
          stepCount: draft.steps.length,
          screenshotUrl,
        })
      ),
    },
  });
  await writeAuditLog(userId, proposed.actionId, "bridge", "bridge.draft_ready", {
    selectedSlotLabel: draft.selectedSlotLabel,
    nameFilled: draft.nameFilled,
    usedLiveModel: draft.usedLiveModel,
    modelNote: draft.modelNote,
    steps: draft.steps,
  });

  return { ...proposed, draft };
}

/**
 * Only reachable by a real human click in the dashboard. Idempotent-ish: if
 * a prior attempt got as far as recording human approval but the browser
 * click itself failed (e.g. a transient page issue), a retry picks up from
 * "human_approved" instead of re-approving.
 */
export async function confirmSessionBooking(actionId: string) {
  const action = await prisma.action.findUniqueOrThrow({ where: { id: actionId } });
  const approval = action.approvalState === "awaiting_human" ? await recordHumanApproval(actionId) : action;
  if (action.approvalState !== "awaiting_human" && action.approvalState !== "human_approved") {
    throw new Error(`Action ${actionId} is not awaiting or already human-approved (state: ${action.approvalState})`);
  }

  try {
    const result = await confirmSession(actionId);
    const screenshotUrl = await saveScreenshot(actionId, "confirmed", result.screenshotBase64);
    await markSent(actionId, { mode: "computer_use_demo", confirmed: result.confirmed, screenshotUrl });
    return { approval, ...result, screenshotUrl };
  } catch (err) {
    await writeAuditLog(action.userId, actionId, "bridge", "bridge.confirm_failed", { error: (err as Error).message });
    throw err;
  }
}

export async function cancelSessionDraft(userId: string, actionId: string) {
  await discardSession(actionId);
  await prisma.action.update({ where: { id: actionId }, data: { approvalState: "declined" } });
  await writeAuditLog(userId, actionId, "user", "human.decline", { note: "user cancelled the pre-filled booking without confirming" });
}
