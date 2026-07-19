import { getAnthropicClient, AGENT_MODEL } from "@/lib/anthropic";
import { checkTone, hasCrisisFooter, CRISIS_FOOTER_BY_LANG } from "@/lib/agents/toneRules";

// The crisis-resources footer is a fixed, policy-mandated safety disclosure
// appended to every outreach message (design principle #6) — it is not
// agent-authored tone and shouldn't be graded as such. Strip it before
// handing the draft to the tone judge; hasCrisisFooter() below still checks
// the *original* content so a missing footer is caught separately.
function stripKnownFooter(content: string): string {
  const trimmed = content.trimEnd();
  for (const footer of Object.values(CRISIS_FOOTER_BY_LANG)) {
    if (trimmed.endsWith(footer)) {
      return trimmed.slice(0, trimmed.length - footer.length).trim();
    }
  }
  return content;
}

// LLM-as-judge scoring for Caring Contacts quality. This is a softer,
// advisory signal for the eval suite/README — it never gates a real send.
// Guardian's deterministic checkTone()/hasCrisisFooter() in toneRules.ts is
// the actual enforcement layer and is always run first.

export type ToneJudgeScore = {
  brevity: number; // 1-5
  warmth: number; // 1-5
  nonDemand: number; // 1-5
  rationale: string;
  judgedBy: "claude" | "heuristic-fallback";
};

export type ToneEvalResult = {
  content: string;
  deterministicViolations: ReturnType<typeof checkTone>;
  hasCrisisFooter: boolean;
  judge: ToneJudgeScore;
  pass: boolean; // deterministic gate clean AND judge scores all >= 4
};

const JUDGE_SYSTEM_PROMPT = `You are grading the body of a check-in text message against the Caring Contacts evidence base (Motto & Bostrom): messages should be brief, warm, and non-demanding, with no reference to risk, crisis, or a request for a reply. The mandatory crisis-hotline footer that is required on every message by policy has already been removed — you are only grading the personal check-in text itself, so do not penalize it for lacking crisis resources.

Score the message on three 1-5 scales:
- brevity: 5 = a couple of short sentences or less, 1 = long/rambling
- warmth: 5 = genuinely warm and personal, 1 = cold, generic, or clinical
- nonDemand: 5 = places zero pressure to respond and never mentions risk/crisis/monitoring, 1 = demanding, guilt-inducing, or clinical

Respond with ONLY a JSON object: {"brevity": <1-5>, "warmth": <1-5>, "nonDemand": <1-5>, "rationale": "<one sentence>"}`;

async function heuristicScore(content: string): Promise<ToneJudgeScore> {
  const violations = checkTone(content);
  const brevity = content.length <= 160 ? 5 : content.length <= 320 ? 3 : 1;
  const nonDemand = violations.length === 0 ? 5 : Math.max(1, 5 - violations.length);
  return {
    brevity,
    warmth: 3, // heuristic can't assess warmth; neutral score, flagged as fallback
    nonDemand,
    rationale: "ANTHROPIC_API_KEY not set — heuristic fallback (length + deterministic tone rules only, no warmth signal).",
    judgedBy: "heuristic-fallback",
  };
}

export async function judgeTone(content: string): Promise<ToneJudgeScore> {
  const client = getAnthropicClient();
  if (!client) return heuristicScore(content);

  try {
    const response = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: 200,
      system: JUDGE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Message: "${content}"` }],
    });
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return {
      brevity: Number(parsed.brevity),
      warmth: Number(parsed.warmth),
      nonDemand: Number(parsed.nonDemand),
      rationale: String(parsed.rationale ?? ""),
      judgedBy: "claude",
    };
  } catch {
    return heuristicScore(content);
  }
}

export async function evaluateCaringContact(content: string): Promise<ToneEvalResult> {
  const deterministicViolations = checkTone(content);
  const footer = hasCrisisFooter(content);
  const judge = await judgeTone(stripKnownFooter(content));
  const judgePass = judge.brevity >= 4 && judge.warmth >= 4 && judge.nonDemand >= 4;
  return {
    content,
    deterministicViolations,
    hasCrisisFooter: footer,
    judge,
    pass: deterministicViolations.length === 0 && footer && judgePass,
  };
}
