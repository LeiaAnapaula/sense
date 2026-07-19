import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/client";
import { encryptField } from "@/lib/crypto";
import { createOrReplaceSafetyPlan } from "@/lib/db/safetyPlan";
import { grantConsent } from "@/lib/db/consent";
import { draftCaringContact, sendCaringContact } from "@/lib/agents/companion";
import { checkTone, hasCrisisFooter } from "@/lib/agents/toneRules";

async function makeUserWithPlan(label: string, opts?: { language?: string }) {
  const user = await prisma.user.create({
    data: {
      name: `${label} Test`,
      email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
      preferredLanguage: opts?.language ?? "en",
    },
  });
  await prisma.channel.create({
    data: { userId: user.id, type: "sms", addressEnc: encryptField("+15555550100"), consented: true, consentedAt: new Date() },
  });
  await createOrReplaceSafetyPlan(user.id, {
    warningSigns: ["skipping meals"],
    copingStrategies: ["go for a walk"],
    socialDistractions: ["the climbing gym"],
    reasonsToLive: ["my dog"],
    meansSafety: ["ask a friend to hold onto medication"],
    messageTemplates: [
      { body: "Thinking of you this week. No need to reply.", language: "en" },
      { body: "Hope today treats you gently.", language: "en" },
    ],
  });
  await grantConsent(user.id, "companion.sms.caring_contacts", "test");
  return user;
}

describe("Companion Agent: drafting", () => {
  it("drafts a message from an approved template with a crisis footer, and it passes Guardian's tone gate", async () => {
    const user = await makeUserWithPlan("draft");
    const draft = await draftCaringContact(user.id);
    expect(draft).not.toBeNull();
    expect(draft!.channel).toBe("sms");
    expect(hasCrisisFooter(draft!.content)).toBe(true);
    expect(checkTone(draft!.content)).toEqual([]);
  });

  it("returns null when the user has no consented channel", async () => {
    const user = await prisma.user.create({
      data: { name: "No Channel", email: `no-channel-${Date.now()}@test.local` },
    });
    await createOrReplaceSafetyPlan(user.id, {
      warningSigns: [],
      copingStrategies: [],
      socialDistractions: [],
      reasonsToLive: [],
      meansSafety: [],
      messageTemplates: [{ body: "Thinking of you.", language: "en" }],
    });
    const draft = await draftCaringContact(user.id);
    expect(draft).toBeNull();
  });
});

describe("Companion Agent: send flow (via Guardian)", () => {
  it("sends a caring contact end-to-end and it's reflected in the audit trail", async () => {
    const user = await makeUserWithPlan("send");
    const result = await sendCaringContact(user.id);
    expect(result.approved).toBe(true);
    expect(result.approvalState).toBe("sent");

    const logs = await prisma.auditLog.findMany({ where: { userId: user.id, actionId: result.actionId } });
    expect(logs.some((l) => l.event === "guardian.approve")).toBe(true);
    expect(logs.some((l) => l.event === "action.sent")).toBe(true);
  });

  it("Guardian blocks a 2nd same-day send even though Companion drafted it (max 1/day/channel)", async () => {
    const user = await makeUserWithPlan("cadence-companion-daily");
    const riskWindow = await prisma.riskWindow.create({
      data: { userId: user.id, startDate: new Date(), endDate: new Date(Date.now() + 7 * 86400000), confidence: 0.7, sourceSignalsJson: "[]" },
    });

    const first = await sendCaringContact(user.id, riskWindow.id);
    const second = await sendCaringContact(user.id, riskWindow.id);

    expect(first.approved).toBe(true);
    expect(second.approved).toBe(false);
    expect(second.reason).toContain("cadence_exceeded_daily");
  });

  it("Guardian still caps total sends per risk window at 3, spread across separate days", async () => {
    const user = await makeUserWithPlan("cadence-companion-window");
    const riskWindow = await prisma.riskWindow.create({
      data: { userId: user.id, startDate: new Date(), endDate: new Date(Date.now() + 7 * 86400000), confidence: 0.7, sourceSignalsJson: "[]" },
    });

    // Simulate one send per day across 4 distinct days by directly seeding
    // prior "sent" Actions outside the 24h daily-cap lookback window, then
    // exercising the real send flow for the 4th attempt.
    for (let day = 3; day >= 1; day--) {
      await prisma.action.create({
        data: {
          userId: user.id,
          agent: "companion",
          type: "send_message",
          channel: "sms",
          riskWindowId: riskWindow.id,
          approvalState: "sent",
          createdAt: new Date(Date.now() - day * 24 * 60 * 60 * 1000),
        },
      });
    }

    const fourth = await sendCaringContact(user.id, riskWindow.id);
    expect(fourth.approved).toBe(false);
    expect(fourth.reason).toContain("cadence_exceeded_window");
  });
});
