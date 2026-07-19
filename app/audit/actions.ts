"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { getDemoUser } from "@/lib/demoUser";
import { sendCaringContact } from "@/lib/agents/companion";
import {
  surfaceCopingStrategies,
  suggestContactPerson,
  requestSessionViaBridge,
  confirmSessionBooking,
  cancelSessionDraft,
} from "@/lib/agents/bridge";

// Demo-only triggers: in the real product, RiskWindow rows come from the
// Forecast Agent and sends are scheduled automatically once a window opens.
// These let a demo walk through "risk window opens -> Companion sends one
// caring contact -> a 4th send in the same window is blocked by Guardian"
// without waiting for a calendar date.

export async function openDemoRiskWindowAction() {
  const user = await getDemoUser();
  const existing = await prisma.riskWindow.findFirst({ where: { userId: user.id, status: "active" } });
  if (!existing) {
    await prisma.riskWindow.create({
      data: {
        userId: user.id,
        startDate: new Date(Date.now() - 2 * 86400000),
        endDate: new Date(Date.now() + 4 * 86400000),
        confidence: 0.82,
        sourceSignalsJson: JSON.stringify([
          { signal: "hard_date", detail: "Marked birthday, 2 days into a 3-before/4-after window" },
          { signal: "mood_checkin_trend", detail: "Last 2 self-reported check-ins scored 2/5" },
        ]),
        status: "active",
      },
    });
  }
  revalidatePath("/audit");
  revalidatePath("/plan");
}

export async function sendCaringContactNowAction() {
  const user = await getDemoUser();
  const riskWindow = await prisma.riskWindow.findFirst({ where: { userId: user.id, status: "active" }, orderBy: { startDate: "desc" } });
  await sendCaringContact(user.id, riskWindow?.id);
  revalidatePath("/audit");
}

async function getBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${proto}://${host}`;
}

async function getActiveRiskWindowId(userId: string): Promise<string | undefined> {
  const w = await prisma.riskWindow.findFirst({ where: { userId, status: "active" }, orderBy: { startDate: "desc" } });
  return w?.id;
}

// Bridge Agent's escalation ladder, one rung per button. Rungs (a) and (b)
// exist mainly to demonstrate that Guardian requires them before rung (c)
// can fire autonomously; "I want to talk to someone" below is the
// user-initiated path that's allowed to skip straight to (c).

export async function surfaceCopingStrategiesAction() {
  const user = await getDemoUser();
  await surfaceCopingStrategies(user.id, await getActiveRiskWindowId(user.id));
  revalidatePath("/audit");
}

export async function suggestContactPersonAction() {
  const user = await getDemoUser();
  await suggestContactPerson(user.id, await getActiveRiskWindowId(user.id));
  revalidatePath("/audit");
}

export async function requestSessionAction() {
  const user = await getDemoUser();
  const baseUrl = await getBaseUrl();
  await requestSessionViaBridge(user.id, {
    riskWindowId: await getActiveRiskWindowId(user.id),
    userInitiated: true,
    baseUrl,
  });
  revalidatePath("/audit");
}

export async function confirmSessionAction(actionId: string) {
  await confirmSessionBooking(actionId);
  revalidatePath("/audit");
}

export async function cancelSessionAction(actionId: string) {
  const user = await getDemoUser();
  await cancelSessionDraft(user.id, actionId);
  revalidatePath("/audit");
}
