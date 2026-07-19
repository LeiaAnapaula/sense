import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <p className="text-sm font-medium uppercase tracking-wide text-indigo-600">Consent-first crisis prevention</p>
      <h1 className="mt-2 text-3xl font-semibold text-zinc-900">
        Protect your future self, during a stable moment.
      </h1>
      <p className="mt-4 text-zinc-600">
        SENSE helps you build your own safety plan while you&apos;re steady, so that during a
        predictable hard week — a birthday, an anniversary, a holiday — the plan you already
        trusted is what quietly goes into motion. Nothing acts on a guess about how you&apos;re
        feeling. Everything traces back to something you approved yourself.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/plan"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          View my plan
        </Link>
        <Link
          href="/audit"
          className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          See agent activity &amp; audit trail
        </Link>
      </div>

      <dl className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-semibold text-zinc-900">Caring Contacts, not floods</dt>
          <dd className="mt-1 text-sm text-zinc-600">
            Brief, warm, non-demanding check-ins — at most one a day, a few across a hard week.
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-zinc-900">A human approves the big steps</dt>
          <dd className="mt-1 text-sm text-zinc-600">
            Agents draft and suggest. You, or someone you chose, click confirm on anything that matters.
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-zinc-900">Your plan, not an invention</dt>
          <dd className="mt-1 text-sm text-zinc-600">
            Built on the Stanley-Brown Safety Planning model. Agents operationalize what you wrote.
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-zinc-900">Guardian watches every action</dt>
          <dd className="mt-1 text-sm text-zinc-600">
            One governor sits in front of every send: consent, tone, and pace are enforced, and every decision is logged.
          </dd>
        </div>
      </dl>
    </div>
  );
}
