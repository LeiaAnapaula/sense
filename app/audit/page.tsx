import { prisma } from "@/lib/db/client";
import { decryptField } from "@/lib/crypto";
import { getDemoUser } from "@/lib/demoUser";
import {
  openDemoRiskWindowAction,
  sendCaringContactNowAction,
  surfaceCopingStrategiesAction,
  suggestContactPersonAction,
  requestSessionAction,
  confirmSessionAction,
  cancelSessionAction,
} from "./actions";

const STATE_STYLES: Record<string, string> = {
  sent: "bg-emerald-50 text-emerald-700",
  guardian_approved: "bg-emerald-50 text-emerald-700",
  human_approved: "bg-emerald-50 text-emerald-700",
  awaiting_human: "bg-amber-50 text-amber-700",
  guardian_blocked: "bg-rose-50 text-rose-700",
  pending: "bg-zinc-100 text-zinc-500",
  declined: "bg-zinc-100 text-zinc-500",
};

type BridgeDraftContent = {
  selectedSlotLabel: string | null;
  nameFilled: string | null;
  usedLiveModel: boolean;
  stepCount: number;
  screenshotUrl: string;
};

function describeAction(a: { type: string; contentEnc: string | null }): { text: string | null; bridgeDraft: BridgeDraftContent | null } {
  if (!a.contentEnc) return { text: null, bridgeDraft: null };
  const decrypted = decryptField(a.contentEnc);
  if (a.type === "schedule_session") {
    try {
      return { text: null, bridgeDraft: JSON.parse(decrypted) as BridgeDraftContent };
    } catch {
      return { text: decrypted, bridgeDraft: null };
    }
  }
  return { text: decrypted, bridgeDraft: null };
}

export default async function AuditPage() {
  const user = await getDemoUser();
  const activeWindow = await prisma.riskWindow.findFirst({ where: { userId: user.id, status: "active" }, orderBy: { startDate: "desc" } });

  const actions = await prisma.action.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { consent: true },
  });

  const logs = await prisma.auditLog.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const blockedCount = actions.filter((a) => a.approvalState === "guardian_blocked").length;
  const pendingBridgeAction = actions.find(
    (a) => a.agent === "bridge" && a.type === "schedule_session" && ["awaiting_human", "human_approved"].includes(a.approvalState)
  );
  const pendingDraft = pendingBridgeAction ? describeAction(pendingBridgeAction).bridgeDraft : null;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Agent activity &amp; Guardian audit trail</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every action any agent proposes passes through Guardian first. Approvals and blocks are both logged here —
          nothing is silent.
        </p>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-zinc-900">Demo controls</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {activeWindow
            ? `Active risk window: ${activeWindow.startDate.toDateString()} – ${activeWindow.endDate.toDateString()}`
            : "No active risk window yet."}
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <form action={openDemoRiskWindowAction}>
            <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              Open this week as a risk window
            </button>
          </form>
          <form action={sendCaringContactNowAction}>
            <button type="submit" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
              Companion Agent: send a caring contact
            </button>
          </form>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Send it more than once today, or more than 3 times in the window, to see Guardian block it below —
          cadence limits hold even under repeated taps.
        </p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-zinc-900">Bridge Agent: escalation ladder</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Coping strategies &rarr; contact a chosen person &rarr; offer to book a session &rarr; crisis resources.
          Guardian blocks booking a session if it&apos;s tried out of order — unless the user asks for it directly,
          like tapping &ldquo;I want to talk to someone&rdquo; below.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <form action={surfaceCopingStrategiesAction}>
            <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              (a) Surface my coping strategies
            </button>
          </form>
          <form action={suggestContactPersonAction}>
            <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              (b) Nudge my chosen contact
            </button>
          </form>
          <form action={requestSessionAction}>
            <button type="submit" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
              I want to talk to someone
            </button>
          </form>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          The last button launches a real browser and lets Claude (computer-use) find an open slot and fill in the
          booking form from screenshots — it stops before clicking &ldquo;Request booking.&rdquo; Only you can do that, below.
        </p>

        {pendingDraft && pendingBridgeAction && (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-900">
              {pendingBridgeAction.approvalState === "human_approved" ? "Confirmation failed — retry?" : "Draft ready — awaiting your confirmation"}
              {!pendingDraft.usedLiveModel && <span className="ml-2 text-xs font-normal text-amber-700">(scripted fallback, no live model)</span>}
            </p>
            <p className="mt-1 text-sm text-amber-800">
              {pendingDraft.selectedSlotLabel} &middot; name filled: {pendingDraft.nameFilled}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pendingDraft.screenshotUrl}
              alt="Pre-filled teletherapy booking form, awaiting human confirmation"
              className="mt-3 max-w-md rounded-md border border-amber-200"
            />
            <div className="mt-3 flex gap-3">
              <form action={confirmSessionAction.bind(null, pendingBridgeAction.id)}>
                <button type="submit" className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
                  {pendingBridgeAction.approvalState === "human_approved" ? "Retry confirmation" : "Confirm booking"}
                </button>
              </form>
              <form action={cancelSessionAction.bind(null, pendingBridgeAction.id)}>
                <button type="submit" className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                  Cancel
                </button>
              </form>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">Actions</h2>
          <span className="text-xs text-zinc-400">
            {actions.length} total &middot; <span className="text-rose-600">{blockedCount} blocked</span>
          </span>
        </div>
        {actions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">No actions yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {actions.map((a) => {
              const { text, bridgeDraft } = describeAction(a);
              return (
                <li key={a.id} className="rounded-md border border-zinc-100 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm text-zinc-800">
                      <span className="font-medium capitalize">{a.agent}</span> &middot; {a.type.replace(/_/g, " ")}
                      {a.channel && <span className="text-zinc-400"> via {a.channel}</span>}
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATE_STYLES[a.approvalState] ?? "bg-zinc-100 text-zinc-500"}`}>
                      {a.approvalState.replace(/_/g, " ")}
                    </span>
                  </div>
                  {text && <p className="mt-1.5 text-sm italic text-zinc-600">&ldquo;{text}&rdquo;</p>}
                  {bridgeDraft && (
                    <p className="mt-1.5 text-sm text-zinc-600">
                      {bridgeDraft.selectedSlotLabel} &middot; name: {bridgeDraft.nameFilled}
                      {!bridgeDraft.usedLiveModel && " (scripted fallback)"}
                    </p>
                  )}
                  {a.blockReason && <p className="mt-1.5 text-xs text-rose-600">Blocked: {a.blockReason}</p>}
                  <p className="mt-1 text-xs text-zinc-400">
                    {a.createdAt.toLocaleString()} {a.consent ? `· consent: ${a.consent.scope}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-zinc-900">Audit log</h2>
        {logs.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">No log entries yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 font-mono text-xs text-zinc-600">
            {logs.map((l) => (
              <li key={l.id} className="border-b border-zinc-50 pb-2">
                <span className="text-zinc-400">{l.createdAt.toISOString()}</span> &middot;{" "}
                <span className="font-semibold text-zinc-800">{l.actor}</span> &middot; {l.event}
                <div className="text-zinc-400">{l.detail}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
