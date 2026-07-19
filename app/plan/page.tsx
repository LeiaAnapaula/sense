import { prisma } from "@/lib/db/client";
import { getSafetyPlan } from "@/lib/db/safetyPlan";
import { getDemoUser } from "@/lib/demoUser";
import { revokeConsentAction } from "./actions";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ListOf({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm text-zinc-400">Nothing added yet.</p>;
  return (
    <ul className="space-y-1.5 text-sm text-zinc-700">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-zinc-300">&bull;</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function PlanPage() {
  const user = await getDemoUser();
  const plan = await getSafetyPlan(user.id);
  const hardDates = await prisma.hardDate.findMany({ where: { userId: user.id } });
  const riskWindows = await prisma.riskWindow.findMany({ where: { userId: user.id }, orderBy: { startDate: "desc" } });
  const consents = await prisma.consent.findMany({ where: { userId: user.id }, orderBy: { grantedAt: "desc" } });
  const circleContacts = await prisma.circleContact.findMany({ where: { userId: user.id } });

  const circleNameByContactScope = new Map(circleContacts.map((c) => [`circle.notify.${c.id}`, c.name]));

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div>
        <p className="text-sm text-zinc-500">Signed in as</p>
        <h1 className="text-2xl font-semibold text-zinc-900">{user.name}&apos;s plan</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {`Written and approved by ${user.name.split(" ")[0]} during a calm moment. Agents only operationalize what's here.`}
        </p>
      </div>

      <Section title="My calendar — marked hard dates">
        {hardDates.length === 0 ? (
          <p className="text-sm text-zinc-400">No dates marked yet.</p>
        ) : (
          <ul className="space-y-2 text-sm text-zinc-700">
            {hardDates.map((d) => (
              <li key={d.id} className="flex items-center justify-between">
                <span>{d.label}</span>
                <span className="text-zinc-400">
                  {d.monthDay} &middot; window: {d.windowDaysBefore}d before &ndash; {d.windowDaysAfter}d after
                </span>
              </li>
            ))}
          </ul>
        )}
        {riskWindows.length > 0 && (
          <div className="mt-4 border-t border-zinc-100 pt-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Risk windows</p>
            <ul className="space-y-1.5 text-sm text-zinc-700">
              {riskWindows.map((w) => (
                <li key={w.id} className="flex items-center justify-between">
                  <span>
                    {w.startDate.toDateString()} &ndash; {w.endDate.toDateString()}
                  </span>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{w.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Warning signs I might notice">
        <ListOf items={plan?.warningSigns ?? []} />
      </Section>

      <Section title="Things that help me cope, on my own">
        <ListOf items={plan?.copingStrategies ?? []} />
      </Section>

      <Section title="People and places that help distract me">
        <ListOf items={plan?.socialDistractions ?? []} />
      </Section>

      <Section title="Reasons to keep going">
        <ListOf items={plan?.reasonsToLive ?? []} />
      </Section>

      <Section title="Means-safety steps">
        <ListOf items={plan?.meansSafety ?? []} />
      </Section>

      <Section title="Message templates I approved">
        {!plan || plan.messageTemplates.length === 0 ? (
          <p className="text-sm text-zinc-400">None yet.</p>
        ) : (
          <ul className="space-y-2">
            {plan.messageTemplates.map((t) => (
              <li key={t.id} className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-700">
                <span className="mr-2 rounded bg-zinc-200 px-1.5 py-0.5 text-xs uppercase text-zinc-600">{t.language}</span>
                &ldquo;{t.body}&rdquo;
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="People I've chosen">
        {circleContacts.length === 0 ? (
          <p className="text-sm text-zinc-400">No one added yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm text-zinc-700">
            {circleContacts.map((c) => (
              <li key={c.id} className="flex items-center justify-between">
                <span>
                  {c.name} &middot; {c.relationship}
                </span>
                <span className={c.consentedToNudge ? "text-emerald-600" : "text-zinc-400"}>
                  {c.consentedToNudge ? "may be nudged" : "not authorized"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="What SENSE is allowed to do">
        {consents.length === 0 ? (
          <p className="text-sm text-zinc-400">Nothing authorized yet.</p>
        ) : (
          <ul className="space-y-3">
            {consents.map((c) => {
              const revoked = Boolean(c.revokedAt);
              const label = circleNameByContactScope.get(c.scope);
              return (
                <li key={c.id} className="flex items-start justify-between gap-4 rounded-md border border-zinc-100 p-3">
                  <div>
                    <p className="text-sm text-zinc-800">
                      {c.detail}
                      {label && <span className="ml-1 text-zinc-400">({label})</span>}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-zinc-400">{c.scope}</p>
                  </div>
                  {revoked ? (
                    <span className="shrink-0 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-500">Revoked</span>
                  ) : (
                    <form action={revokeConsentAction.bind(null, c.id)}>
                      <button
                        type="submit"
                        className="shrink-0 rounded-full border border-rose-200 bg-white px-3 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                      >
                        Revoke
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
