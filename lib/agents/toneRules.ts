// Deterministic Caring-Contacts tone rules. These are the hard gate Guardian
// enforces on every outbound message — separate from the softer LLM-as-judge
// eval used in lib/evals for scoring draft quality.
//
// Evidence base: Motto & Bostrom (2001) "A Randomized Controlled Trial of
// Postcrisis Suicide Prevention" — brief, warm, non-demanding, infrequent
// contact, with no reference to the crisis itself.

export type ToneViolation = {
  rule: string;
  matched: string;
};

const CLINICAL_OR_SURVEILLANCE_LANGUAGE = [
  /\brisk score\b/i,
  /\bwe detected\b/i,
  /\bwe noticed you(?:'re| are) (?:struggling|at risk)\b/i,
  /\bsuicidal\b/i,
  /\bself-harm risk\b/i,
  /\bcrisis (?:level|score|window)\b/i,
  /\balgorithm(?:s)? (?:flagged|detected|predicted)\b/i,
  /\bmonitoring your\b/i,
  /\byour mental health data\b/i,
  /\bmood (?:score|trend) (?:shows|indicates)\b/i,
];

const GUILT_LANGUAGE = [
  /\byou (?:always|never) reply\b/i,
  /\bwhy haven't you\b/i,
  /\byou('| ha)ve worried us\b/i,
  /\bwe('re| are) disappointed\b/i,
  /\byou made us\b/i,
  /\bif you (?:really )?cared\b/i,
];

const URGENCY_OR_DEMAND_LANGUAGE = [
  /\burgent(?:ly)?\b/i,
  /\bimmediately\b/i,
  /\bright now\b/i,
  /\bplease reply\b/i,
  /\breply asap\b/i,
  /\breply immediately\b/i,
  /\bneed you to reply\b/i,
  /\bneed you to respond\b/i,
  /\bmust reply\b/i,
  /\bmust respond\b/i,
  /\brespond now\b/i,
  /\brespond immediately\b/i,
  /\bwrite back (?:now|asap)\b/i,
  /\bact now\b/i,
  /\byou need to\b/i,
];

const MAX_CARING_CONTACT_LENGTH = 320; // ~2 SMS segments; keeps messages brief

export function checkTone(content: string): ToneViolation[] {
  const violations: ToneViolation[] = [];

  for (const pattern of CLINICAL_OR_SURVEILLANCE_LANGUAGE) {
    const m = content.match(pattern);
    if (m) violations.push({ rule: "no_clinical_or_surveillance_language", matched: m[0] });
  }
  for (const pattern of GUILT_LANGUAGE) {
    const m = content.match(pattern);
    if (m) violations.push({ rule: "no_guilt_language", matched: m[0] });
  }
  for (const pattern of URGENCY_OR_DEMAND_LANGUAGE) {
    const m = content.match(pattern);
    if (m) violations.push({ rule: "no_urgency_or_demand_language", matched: m[0] });
  }
  if (content.length > MAX_CARING_CONTACT_LENGTH) {
    violations.push({ rule: "brief", matched: `${content.length} chars > ${MAX_CARING_CONTACT_LENGTH}` });
  }

  return violations;
}

export const CRISIS_FOOTER =
  "If you're in crisis, call or text 988 (Suicide & Crisis Lifeline), or text HOME to 741741 (Crisis Text Line).";

export function hasCrisisFooter(content: string): boolean {
  return content.includes("988") && /741741/.test(content);
}
