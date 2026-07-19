import { prisma } from "@/lib/db/client";
import { proposeAction, markSent, type ProposedAction, type BridgeRung } from "@/lib/agents/guardian";
import { circleNudgeScope } from "@/lib/db/consent";
import { crisisFooterForLanguage } from "@/lib/agents/toneRules";

// Circle Agent: with the user's explicit consent, gently prompts a chosen
// support person to check in. SENSE never messages the at-risk person's
// circle on its own initiative — the user pre-authorized exactly this,
// naming exactly this person, during onboarding. The support person does
// the actual human outreach; SENSE's role ends at the nudge.
//
// bridgeRung is set only when the Bridge Agent's escalation ladder is
// calling this as its "contact person" rung — Guardian's ladder check keys
// off Action.agent === "bridge" for that case.

export type NudgeResult = {
  actionId: string;
  approvalState: string;
  approved: boolean;
  reason?: string;
  contactName?: string;
};

export async function nudgeCircleContact(
  userId: string,
  opts?: { riskWindowId?: string; bridgeRung?: BridgeRung }
): Promise<NudgeResult> {
  const contacts = await prisma.circleContact.findMany({
    where: { userId, consentedToNudge: true, role: "support" },
  });
  if (contacts.length === 0) {
    return { actionId: "", approvalState: "guardian_blocked", approved: false, reason: "no_consented_circle_contact" };
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const contact = contacts[0]; // demo scope: nudge the first consented support contact
  const firstName = user.name.split(" ")[0];
  const content = `${firstName} marked this week as a hard one and asked us to nudge you to check in. ${crisisFooterForLanguage(user.preferredLanguage)}`;

  const proposed: ProposedAction = {
    userId,
    agent: opts?.bridgeRung ? "bridge" : "circle",
    type: "nudge_contact",
    channel: contact.channelType as "sms" | "email",
    content,
    consentScope: circleNudgeScope(contact.id),
    riskWindowId: opts?.riskWindowId,
    bridgeRung: opts?.bridgeRung,
  };

  const result = await proposeAction(proposed);
  if (result.approved) {
    // Demo mode: never actually messages Ana. The audit trail is the
    // "delivery" for judging purposes, same as Companion Agent sends.
    const sent = await markSent(result.actionId, {
      mode: "demo",
      channel: contact.channelType,
      contactName: contact.name,
      deliveredAt: new Date().toISOString(),
    });
    return { ...result, approvalState: sent.approvalState, contactName: contact.name };
  }

  return { ...result, contactName: contact.name };
}
