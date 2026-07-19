import { prisma } from "@/lib/db/client";

// Every scope the app can grant, with the copy shown to the user in "what
// SENSE is allowed to do." Keep this list authoritative — Guardian only
// checks the scope string, but the dashboard reads this for display.
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
    scope: "circle.notify.sister",
    detail: "Ask my sister to check in on me during a risk window (she does the outreach, not SENSE).",
  },
  {
    scope: "bridge.schedule",
    detail: "Find open teletherapy slots and pre-fill a booking form for me to confirm myself.",
  },
];

export async function grantConsent(userId: string, scope: string, detail: string) {
  return prisma.consent.create({
    data: { userId, scope, detail, granted: true },
  });
}

export async function listConsents(userId: string) {
  return prisma.consent.findMany({ where: { userId }, orderBy: { grantedAt: "desc" } });
}
