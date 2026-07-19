import { prisma } from "@/lib/db/client";
import { encryptField, encryptJson, decryptField, decryptJson } from "@/lib/crypto";

// Stanley-Brown Safety Planning Intervention fields, minus the "means safety"
// step being handled with extra care in the UI copy (it's for lethal-means
// counseling, e.g. "ask someone to hold my medication this week").

export type SafetyPlanInput = {
  warningSigns: string[];
  copingStrategies: string[];
  socialDistractions: string[];
  reasonsToLive: string[];
  meansSafety: string[];
  messageTemplates: { body: string; language: string }[];
};

export async function createOrReplaceSafetyPlan(userId: string, input: SafetyPlanInput) {
  const existing = await prisma.safetyPlan.findUnique({ where: { userId } });
  if (existing) {
    await prisma.messageTemplate.deleteMany({ where: { safetyPlanId: existing.id } });
    await prisma.safetyPlan.delete({ where: { userId } });
  }

  return prisma.safetyPlan.create({
    data: {
      userId,
      warningSignsEnc: encryptJson(input.warningSigns),
      copingStrategiesEnc: encryptJson(input.copingStrategies),
      socialDistractionsEnc: encryptJson(input.socialDistractions),
      reasonsToLiveEnc: encryptJson(input.reasonsToLive),
      meansSafetyEnc: encryptJson(input.meansSafety),
      messageTemplates: {
        create: input.messageTemplates.map((t) => ({
          bodyEnc: encryptField(t.body),
          language: t.language,
          approved: true,
        })),
      },
    },
    include: { messageTemplates: true },
  });
}

export type DecryptedSafetyPlan = {
  id: string;
  userId: string;
  warningSigns: string[];
  copingStrategies: string[];
  socialDistractions: string[];
  reasonsToLive: string[];
  meansSafety: string[];
  messageTemplates: { id: string; body: string; language: string; approved: boolean }[];
  updatedAt: Date;
};

export async function getSafetyPlan(userId: string): Promise<DecryptedSafetyPlan | null> {
  const plan = await prisma.safetyPlan.findUnique({
    where: { userId },
    include: { messageTemplates: true },
  });
  if (!plan) return null;

  return {
    id: plan.id,
    userId: plan.userId,
    warningSigns: decryptJson(plan.warningSignsEnc),
    copingStrategies: decryptJson(plan.copingStrategiesEnc),
    socialDistractions: decryptJson(plan.socialDistractionsEnc),
    reasonsToLive: decryptJson(plan.reasonsToLiveEnc),
    meansSafety: decryptJson(plan.meansSafetyEnc),
    messageTemplates: plan.messageTemplates.map((t) => ({
      id: t.id,
      body: decryptField(t.bodyEnc),
      language: t.language,
      approved: t.approved,
    })),
    updatedAt: plan.updatedAt,
  };
}
