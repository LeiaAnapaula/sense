"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { getDemoUser } from "@/lib/demoUser";
import { sendCaringContact } from "@/lib/agents/companion";

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
