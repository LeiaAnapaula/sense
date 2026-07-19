import { prisma } from "@/lib/db/client";

// Fixed scopes the app can grant, with the copy shown to the user in "what
// SENSE is allowed to do." Circle-contact nudge scopes are dynamic (one per
// contact) — see circleNudgeScope() below. Guardian only checks the scope
// string; the dashboard reads this list for display copy.
export const CONSENT_SCOPES: { scope: string; detail: string }[] = [
  {
    scope: "companion.sms.caring_contacts",
    detail: "Send me up to 3 short check-in texts during a risk window, at most one per day, from templates I approved.",
  },
  {
    scope: "companion.email.caring_contacts",
    detail: "Send me up to 3 short check-in emails during a risk window, at most one per day, from templates I approved.",
  },
  {
    scope: "bridge.schedule",
    detail: "Find open teletherapy slots and pre-fill a booking form for me to confirm myself.",
  },
];

export function circleNudgeScope(contactId: string): string {
  return `circle.notify.${contactId}`;
}

export async function grantConsent(userId: string, scope: string, detail: string) {
  return prisma.consent.create({
    data: { userId, scope, detail, granted: true },
  });
}

export async function listConsents(userId: string) {
  return prisma.consent.findMany({ where: { userId }, orderBy: { grantedAt: "desc" } });
}
