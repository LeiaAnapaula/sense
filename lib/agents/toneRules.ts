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

// Non-exhaustive translations of the highest-risk phrases so the gate isn't
// English-only. The Companion Agent supports es/fr/it; the red-team suite
// (lib/evals) is the place to grow this list, not this file.
const CLINICAL_OR_SURVEILLANCE_LANGUAGE_INTL = [
  /\bpuntuaci[oó]n de riesgo\b/i, // es: risk score
  /\bhemos detectado\b/i, // es: we detected
  /\bscore de risque\b/i, // fr: risk score
  /\bnous avons d[eé]tect[eé]\b/i, // fr: we detected
  /\bpunteggio di rischio\b/i, // it: risk score
  /\babbiamo rilevato\b/i, // it: we detected
];

const GUILT_LANGUAGE_INTL = [
  /\bnunca respondes\b/i, // es: you never reply
  /\bnos tienes preocupados\b/i, // es: you've worried us
  /\btu ne r[eé]ponds jamais\b/i, // fr: you never reply
  /\btu nous as inqui[eé]t[eé]s\b/i, // fr: you've worried us
  /\bnon rispondi mai\b/i, // it: you never reply
  /\bci hai preoccupat[oi]\b/i, // it: you've worried us
];

const URGENCY_OR_DEMAND_LANGUAGE_INTL = [
  /\burgente(?:mente)?\b/i, // es/it: urgent(ly)
  /\binmediatamente\b/i, // es: immediately
  /\bresponde ahora\b/i, // es: respond now
  /\burgent(?:e|s)?\b/i, // fr: urgent
  /\bimm[eé]diatement\b/i, // fr: immediately
  /\br[eé]ponds maintenant\b/i, // fr: respond now
  /\bimmediatamente\b/i, // it: immediately
  /\brispondi (?:subito|ora)\b/i, // it: respond now/immediately
];

const MAX_CARING_CONTACT_LENGTH = 320; // ~2 SMS segments; keeps messages brief

export function checkTone(content: string): ToneViolation[] {
  const violations: ToneViolation[] = [];

  const ruleSets: [string, RegExp[]][] = [
    ["no_clinical_or_surveillance_language", [...CLINICAL_OR_SURVEILLANCE_LANGUAGE, ...CLINICAL_OR_SURVEILLANCE_LANGUAGE_INTL]],
    ["no_guilt_language", [...GUILT_LANGUAGE, ...GUILT_LANGUAGE_INTL]],
    ["no_urgency_or_demand_language", [...URGENCY_OR_DEMAND_LANGUAGE, ...URGENCY_OR_DEMAND_LANGUAGE_INTL]],
  ];

  for (const [rule, patterns] of ruleSets) {
    for (const pattern of patterns) {
      const m = content.match(pattern);
      if (m) violations.push({ rule, matched: m[0] });
    }
  }
  if (content.length > MAX_CARING_CONTACT_LENGTH) {
    violations.push({ rule: "brief", matched: `${content.length} chars > ${MAX_CARING_CONTACT_LENGTH}` });
  }

  return violations;
}

export const CRISIS_FOOTER =
  "If you're in crisis, call or text 988 (Suicide & Crisis Lifeline), or text HOME to 741741 (Crisis Text Line).";

export const CRISIS_FOOTER_BY_LANG: Record<string, string> = {
  en: "If you're in crisis, call or text 988 (Suicide & Crisis Lifeline), or text HOME to 741741 (Crisis Text Line).",
  es: "Si está en crisis, llame o envíe un mensaje de texto al 988 (Línea de Crisis y Suicidio), o envíe HOME al 741741 (Crisis Text Line).",
  fr: "En cas de crise, appelez ou envoyez un SMS au 988 (ligne de crise et de prévention du suicide), ou envoyez HOME au 741741 (Crisis Text Line).",
  it: "In caso di crisi, chiama o invia un SMS al 988 (linea di crisi e prevenzione suicidio), oppure invia HOME al 741741 (Crisis Text Line).",
};

export function crisisFooterForLanguage(language: string): string {
  return CRISIS_FOOTER_BY_LANG[language] ?? CRISIS_FOOTER_BY_LANG.en;
}

export function hasCrisisFooter(content: string): boolean {
  return content.includes("988") && /741741/.test(content);
}
