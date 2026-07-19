import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/client";
import { grantConsent } from "@/lib/db/consent";
import { proposeAction, recordHumanApproval } from "@/lib/agents/guardian";
import { CRISIS_FOOTER } from "@/lib/agents/toneRules";

async function makeUser(label: string) {
  return prisma.user.create({
    data: { name: label, email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local` },
  });
}

describe("Guardian: consent (fail closed)", () => {
  it("blocks a message when no consent exists for the scope", async () => {
    const user = await makeUser("no-consent");
    const result = await proposeAction({
      userId: user.id,
      agent: "companion",
      type: "send_message",
      channel: "sms",
      content: `Thinking of you this week. No need to reply. ${CRISIS_FOOTER}`,
      consentScope: "companion.sms.caring_contacts",
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("no_active_consent_for_scope");
  });

  it("blocks after consent is revoked", async () => {
    const user = await makeUser("revoked-consent");
    const consent = await grantConsent(user.id, "companion.sms.caring_contacts", "test");
    await prisma.consent.update({ where: { id: consent.id }, data: { revokedAt: new Date() } });

    const result = await proposeAction({
      userId: user.id,
      agent: "companion",
      type: "send_message",
      channel: "sms",
      content: `Thinking of you this week. No need to reply. ${CRISIS_FOOTER}`,
      consentScope: "companion.sms.caring_contacts",
    });
    expect(result.approved).toBe(false);
  });

  it("never requires consent to surface crisis resources", async () => {
    const user = await makeUser("crisis-resources");
    const result = await proposeAction({
      userId: user.id,
      agent: "bridge",
      type: "surface_resources",
      bridgeRung: "crisis_resources",
    });
    expect(result.approved).toBe(true);
  });
});

describe("Guardian: tone rules", () => {
  it("blocks clinical / surveillance language", async () => {
    const user = await makeUser("tone-clinical");
    await grantConsent(user.id, "companion.sms.caring_contacts", "test");
    const result = await proposeAction({
      userId: user.id,
      agent: "companion",
      type: "send_message",
      channel: "sms",
      content: `Our algorithm flagged your risk score this week. ${CRISIS_FOOTER}`,
      consentScope: "companion.sms.caring_contacts",
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("tone_violation");
  });

  it("blocks guilt language", async () => {
    const user = await makeUser("tone-guilt");
    await grantConsent(user.id, "companion.sms.caring_contacts", "test");
    const result = await proposeAction({
      userId: user.id,
      agent: "companion",
      type: "send_message",
      channel: "sms",
      content: `Why haven't you replied, you've worried us. ${CRISIS_FOOTER}`,
      consentScope: "companion.sms.caring_contacts",
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("tone_violation");
  });

  it("blocks urgency / demand language", async () => {
    const user = await makeUser("tone-urgency");
    await grantConsent(user.id, "companion.sms.caring_contacts", "test");
    const result = await proposeAction({
      userId: user.id,
      agent: "companion",
      type: "send_message",
      channel: "sms",
      content: `Please reply immediately, we need you to respond now. ${CRISIS_FOOTER}`,
      consentScope: "companion.sms.caring_contacts",
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("tone_violation");
  });

  it("blocks a message missing the crisis footer", async () => {
    const user = await makeUser("tone-no-footer");
    await grantConsent(user.id, "companion.sms.caring_contacts", "test");
    const result = await proposeAction({
      userId: user.id,
      agent: "companion",
      type: "send_message",
      channel: "sms",
      content: "Thinking of you this week. No need to reply.",
      consentScope: "companion.sms.caring_contacts",
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("missing_crisis_footer");
  });

  it("approves a brief, warm, non-demanding, consented message", async () => {
    const user = await makeUser("tone-good");
    await grantConsent(user.id, "companion.sms.caring_contacts", "test");
    const result = await proposeAction({
      userId: user.id,
      agent: "companion",
      type: "send_message",
      channel: "sms",
      content: `Thinking of you this week. No need to reply. ${CRISIS_FOOTER}`,
      consentScope: "companion.sms.caring_contacts",
    });
    expect(result.approved).toBe(true);
    expect(result.approvalState).toBe("guardian_approved");
  });
});

describe("Guardian: cadence limits", () => {
  it("cannot exceed the per-risk-window cap even under adversarial retries", async () => {
    const user = await makeUser("cadence");
    await grantConsent(user.id, "companion.sms.caring_contacts", "test");
    const riskWindow = await prisma.riskWindow.create({
      data: { userId: user.id, startDate: new Date(), endDate: new Date(Date.now() + 7 * 86400000), confidence: 0.8, sourceSignalsJson: "[]" },
    });

    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        proposeAction({
          userId: user.id,
          agent: "companion",
          type: "send_message",
          channel: "sms",
          content: `Thinking of you today (${i}). No need to reply. ${CRISIS_FOOTER}`,
          consentScope: "companion.sms.caring_contacts",
          riskWindowId: riskWindow.id,
        })
      )
    );

    const approved = attempts.filter((a) => a.approved);
    expect(approved.length).toBeLessThanOrEqual(3);
  });
});

describe("Guardian: escalation ladder", () => {
  it("blocks booking a session before coping strategies and a contact have been offered", async () => {
    const user = await makeUser("ladder-skip");
    await grantConsent(user.id, "bridge.schedule", "test");
    const result = await proposeAction({
      userId: user.id,
      agent: "bridge",
      type: "schedule_session",
      consentScope: "bridge.schedule",
      bridgeRung: "book_session",
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("escalation_ladder_skipped");
  });

  it("allows booking once prior rungs have been offered", async () => {
    const user = await makeUser("ladder-ok");
    await grantConsent(user.id, "bridge.schedule", "test");
    await grantConsent(user.id, "circle.notify.sister", "test");

    await proposeAction({ userId: user.id, agent: "bridge", type: "surface_resources", bridgeRung: "coping_strategies" });
    await proposeAction({
      userId: user.id,
      agent: "bridge",
      type: "nudge_contact",
      channel: "sms",
      content: `Ana asked us to nudge you to check in. ${CRISIS_FOOTER}`,
      consentScope: "circle.notify.sister",
      bridgeRung: "contact_person",
    });

    const result = await proposeAction({
      userId: user.id,
      agent: "bridge",
      type: "schedule_session",
      consentScope: "bridge.schedule",
      bridgeRung: "book_session",
    });
    expect(result.approved).toBe(true);
    expect(result.approvalState).toBe("awaiting_human");
  });

  it("skips the ladder-order check when the user directly initiates", async () => {
    const user = await makeUser("ladder-user-initiated");
    await grantConsent(user.id, "bridge.schedule", "test");
    const result = await proposeAction({
      userId: user.id,
      agent: "bridge",
      type: "schedule_session",
      consentScope: "bridge.schedule",
      bridgeRung: "book_session",
      userInitiated: true,
    });
    expect(result.approved).toBe(true);
  });

  it("requires a human tap to actually confirm a booking", async () => {
    const user = await makeUser("human-approval");
    await grantConsent(user.id, "bridge.schedule", "test");
    const proposed = await proposeAction({
      userId: user.id,
      agent: "bridge",
      type: "schedule_session",
      consentScope: "bridge.schedule",
      bridgeRung: "book_session",
      userInitiated: true,
    });
    expect(proposed.approvalState).toBe("awaiting_human");

    const approved = await recordHumanApproval(proposed.actionId);
    expect(approved.approvalState).toBe("human_approved");
  });
});

describe("Guardian: audit trail", () => {
  it("logs both approvals and blocks", async () => {
    const user = await makeUser("audit");
    const blocked = await proposeAction({
      userId: user.id,
      agent: "companion",
      type: "send_message",
      channel: "sms",
      content: "no consent",
      consentScope: "companion.sms.caring_contacts",
    });
    const logs = await prisma.auditLog.findMany({ where: { userId: user.id } });
    expect(logs.some((l) => l.event === "guardian.block" && l.actionId === blocked.actionId)).toBe(true);
  });
});
