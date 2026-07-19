"use server";

import { revalidatePath } from "next/cache";
import { getDemoUser } from "@/lib/demoUser";
import { revokeConsent } from "@/lib/agents/guardian";

export async function revokeConsentAction(consentId: string) {
  const user = await getDemoUser();
  await revokeConsent(consentId, user.id);
  revalidatePath("/plan");
  revalidatePath("/audit");
}
