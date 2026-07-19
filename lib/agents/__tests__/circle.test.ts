import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/client";
import { encryptField } from "@/lib/crypto";
import { grantConsent, circleNudgeScope } from "@/lib/db/consent";
import { nudgeCircleContact } from "@/lib/agents/circle";
import { proposeAction } from "@/lib/agents/guardian";

async function makeUserWithContact(label: string, opts?: { consented?: boolean }) {
  const user = await prisma.user.create({
    data: { name: `${label} Test`, email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local` },
  });
  const contact = await prisma.circleContact.create({
    data: {
      userId: user.id,
      name: "Ana",
      relationship: "Sister",
      role: "support",
      channelType: "sms",
      addressEnc: encryptField("+15555550199"),
      consentedToNudge: opts?.consented ?? true,
    },
  });
  return { user, contact };
}

describe("Circle Agent", () => {
  it("blocks when there is no consented support contact", async () => {
    const { user } = await makeUserWithContact("no-contact", { consented: false });
    const result = await nudgeCircleContact(user.id);
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("no_consented_circle_contact");
  });

  it("blocks when the user hasn't granted the per-contact consent scope", async () => {
    const { user } = await makeUserWithContact("no-scope-consent");
    const result = await nudgeCircleContact(user.id);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("no_active_consent_for_scope");
  });

  it("nudges the consented contact end-to-end once consent is granted", async () => {
    const { user, contact } = await makeUserWithContact("nudge-ok");
    await grantConsent(user.id, circleNudgeScope(contact.id), "test");

    const result = await nudgeCircleContact(user.id);
    expect(result.approved).toBe(true);
    expect(result.approvalState).toBe("sent");
    expect(result.contactName).toBe("Ana");

    const logs = await prisma.auditLog.findMany({ where: { userId: user.id, actionId: result.actionId } });
    expect(logs.some((l) => l.event === "action.sent")).toBe(true);
  });

  it("records agent=bridge when called as the escalation ladder's contact rung", async () => {
    const { user, contact } = await makeUserWithContact("bridge-rung");
    await grantConsent(user.id, circleNudgeScope(contact.id), "test");

    // The ladder requires rung (a) coping_strategies before rung (b) contact_person.
    await proposeAction({ userId: user.id, agent: "bridge", type: "surface_resources", bridgeRung: "coping_strategies" });

    const result = await nudgeCircleContact(user.id, { bridgeRung: "contact_person" });
    expect(result.approved).toBe(true);

    const action = await prisma.action.findUniqueOrThrow({ where: { id: result.actionId } });
    expect(action.agent).toBe("bridge");
  });
});
