# SENSE

Anthropic x Abridge x Lightspeed Hackathon, July 2026

A consent-first crisis prevention agent system. People protect their future
selves during predictable high-risk windows (birthdays, anniversaries,
holidays) by building their own safety plan during a calm, stable moment —
agents only ever act on what was explicitly authorized then.

Full evidence citations (Caring Contacts RCT, Stanley-Brown Safety Planning)
and the complete build order land in this README as each phase ships. See
commit history for progress.

## Design principles

1. **Consent-first, always.** No action is taken on inferred mental state.
   Every automated action traces back to a `Consent` the user granted during
   onboarding, and can be revoked with one tap.
2. **Caring Contacts, not message floods.** Brief, warm, non-demanding,
   infrequent outreach (Motto & Bostrom). At most 1 message/day/channel,
   2-3 total per risk window.
3. **Human-in-the-loop escalation.** Agents draft, schedule, and recommend.
   A human (the user or their chosen contact/clinician) approves high-stakes
   actions.
4. **Stanley-Brown Safety Planning as the data model.** Agents operationalize
   the user's own plan; they do not invent interventions.
5. **Privacy by architecture.** Local SQLite, field-level encryption at rest,
   no third-party ad-tech, one-tap deletion.
6. **Crisis fallback is always visible.** 988 and Crisis Text Line (text
   HOME to 741741) appear in every view and every outreach message.

## Setup

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY and FIELD_ENCRYPTION_KEY
npx prisma migrate dev
npm run db:seed        # seeds the demo persona, Maria
npm run dev
```

Run the test suite (Guardian consent/tone/cadence/escalation-ladder checks):

```bash
npm test
```

## Architecture (in progress)

- `prisma/schema.prisma` — data model: `User`, `Channel`, `Consent`,
  `SafetyPlan`, `MessageTemplate`, `CircleContact`, `HardDate`,
  `MoodCheckIn`, `RiskWindow`, `Action`, `AuditLog` (append-only).
- `lib/crypto.ts` — AES-256-GCM field-level encryption for safety plan
  content, message templates, and contact details.
- `lib/agents/guardian.ts` — the safety governor. Every outbound action from
  every other agent passes through `proposeAction()` first: fails closed on
  missing/revoked consent, blocks tone-rule violations (no clinical
  language, no guilt, no urgency, no missing crisis footer), enforces
  cadence limits even under concurrent/adversarial retries, and enforces
  the Bridge Agent's escalation ladder (coping strategies → contact person →
  book session → crisis resources) unless the user directly initiated the
  request. Every decision — approved or blocked — is written to the
  append-only `AuditLog`.
- `lib/agents/toneRules.ts` — deterministic Caring Contacts tone gate.

More agents (Companion, Circle, Bridge, Forecast), the dashboard, and the
red-team eval suite are being built next — see task list / commit history.

## What we built vs what we used

- Built during hackathon: everything under `lib/`, `prisma/`, `app/` — see
  commit history.
- External libraries: Next.js, Prisma, `@anthropic-ai/sdk`, Playwright,
  Vitest, Tailwind CSS.
