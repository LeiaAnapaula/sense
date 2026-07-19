import { prisma } from "@/lib/db/client";
import { decryptField } from "@/lib/crypto";
import { getSafetyPlan } from "@/lib/db/safetyPlan";
import { getAnthropicClient, AGENT_MODEL } from "@/lib/anthropic";
import { checkTone, crisisFooterForLanguage } from "@/lib/agents/toneRules";
import { proposeAction, markSent, type ProposedAction } from "@/lib/agents/guardian";

// Companion Agent: Caring Contacts. It never invents outreach — it only
// personalizes (name, time of day, language) a template the user wrote and
// approved for themselves during onboarding. Guardian still re-checks tone
// and cadence on the result; this agent's own system prompt is a first
// pass, not the enforcement layer.

const SUPPORTED_LANGUAGES = ["en", "es", "fr", "it"] as const;
type Language = (typeof SUPPORTED_LANGUAGES)[number];

const PERSONALIZE_SYSTEM_PROMPT = `You lightly personalize a single pre-approved "Caring Contacts" check-in message for a mental health support product. Rules, no exceptions:
- The user already wrote and approved this exact template. You may only: translate it into the target language if needed, and optionally insert the recipient's first name naturally.
- Never add urgency, guilt, clinical language, questions demanding a reply, or any mention of risk, crisis, monitoring, or scores.
- Never mention that this is automated, AI-generated, or from a "system."
- Keep it brief — under 200 characters in the target language.
- Output ONLY the final message text. No preamble, no quotes, no explanation.`;

async function personalize(templateBody: string, targetLanguage: Language, firstName: string): Promise<string> {
  const client = getAnthropicClient();
  if (!client) return templateBody; // demo/offline fallback: the raw approved template is always safe to send

  try {
    const response = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: 200,
      system: PERSONALIZE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Template: "${templateBody}"\nTarget language: ${targetLanguage}\nRecipient first name (use only if it reads naturally): ${firstName}`,
        },
      ],
    });
    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return text || templateBody;
  } catch {
    return templateBody; // fail safe: fall back to the raw approved template
  }
}

export type CaringContactDraft = {
  channel: "sms" | "email";
  content: string;
  templateId: string;
  language: Language;
};

async function getConsentedCompanionChannels(userId: string) {
  const channels = await prisma.channel.findMany({ where: { userId, consented: true } });
  const consents = await prisma.consent.findMany({
    where: { userId, granted: true, revokedAt: null, scope: { startsWith: "companion." } },
  });
  return channels
    .filter((c) => consents.some((consent) => consent.scope === `companion.${c.type}.caring_contacts`))
    .map((c) => ({ type: c.type as "sms" | "email", address: decryptField(c.addressEnc) }));
}

async function pickTemplate(userId: string, riskWindowId: string | undefined, language: Language) {
  const plan = await getSafetyPlan(userId);
  if (!plan || plan.messageTemplates.length === 0) return null;
  const approved = plan.messageTemplates.filter((t) => t.approved);
  if (approved.length === 0) return null;

  const usedTemplateIds = riskWindowId
    ? new Set(
        (
          await prisma.action.findMany({
            where: { userId, agent: "companion", riskWindowId, type: "send_message" },
            select: { id: true },
          })
        ).map((a) => a.id)
      )
    : new Set<string>();

  const inLanguage = approved.filter((t) => t.language === language);
  const pool = inLanguage.length > 0 ? inLanguage : approved;
  const unused = pool.filter((t) => !usedTemplateIds.has(t.id));
  const chosen = (unused.length > 0 ? unused : pool)[Math.floor(Math.random() * (unused.length > 0 ? unused.length : pool.length))];
  return chosen;
}

export async function draftCaringContact(userId: string, riskWindowId?: string): Promise<CaringContactDraft | null> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const language = (SUPPORTED_LANGUAGES as readonly string[]).includes(user.preferredLanguage)
    ? (user.preferredLanguage as Language)
    : "en";

  const channels = await getConsentedCompanionChannels(userId);
  if (channels.length === 0) return null;
  const channel = channels[0];

  const template = await pickTemplate(userId, riskWindowId, language);
  if (!template) return null;

  const personalized = await personalize(template.body, language, user.name.split(" ")[0]);
  const content = `${personalized} ${crisisFooterForLanguage(language)}`;

  return { channel: channel.type, content, templateId: template.id, language };
}

export type SendCaringContactResult = {
  actionId: string;
  approvalState: string;
  approved: boolean;
  reason?: string;
  draft?: CaringContactDraft;
};

export async function sendCaringContact(userId: string, riskWindowId?: string): Promise<SendCaringContactResult> {
  const draft = await draftCaringContact(userId, riskWindowId);
  if (!draft) {
    return { actionId: "", approvalState: "guardian_blocked", approved: false, reason: "no_consented_channel_or_approved_template" };
  }

  const proposed: ProposedAction = {
    userId,
    agent: "companion",
    type: "send_message",
    channel: draft.channel,
    content: draft.content,
    consentScope: `companion.${draft.channel}.caring_contacts`,
    riskWindowId,
  };

  const result = await proposeAction(proposed);
  if (result.approved) {
    // Demo mode: never actually calls Twilio/SendGrid. The audit trail and
    // dashboard are the "delivery" for judging purposes.
    const sent = await markSent(result.actionId, { mode: "demo", channel: draft.channel, deliveredAt: new Date().toISOString() });
    return { ...result, approvalState: sent.approvalState, draft };
  }

  return { ...result, draft };
}

export function localCheckTone(content: string) {
  return checkTone(content);
}
