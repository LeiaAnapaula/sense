"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { getDemoUser } from "@/lib/demoUser";
import { sendCaringContact } from "@/lib/agents/companion";
import { openRiskWindowIfDue } from "@/lib/agents/forecast";
import {
  surfaceCopingStrategies,
  suggestContactPerson,
  requestSessionViaBridge,
  confirmSessionBooking,
  cancelSessionDraft,
} from "@/lib/agents/bridge";

// This button is the only "demo-only" trigger left on this page: in the
// real product a scheduled job would call openRiskWindowIfDue() daily so a
// window opens itself the moment a marked hard date (or a low mood trend)
// qualifies, instead of waiting for a click. Forecast Agent's own logic —
// which signals qualify, and why — is unchanged; this just fires it now.

export async function openDemoRiskWindowAction() {
  const user = await getDemoUser();
  await openRiskWindowIfDue(user.id);
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
