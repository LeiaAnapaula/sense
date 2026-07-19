import { prisma } from "@/lib/db/client";
import { writeAuditLog } from "@/lib/agents/guardian";

// Forecast Agent: rule-based, explainable, and built only from signals the
// user chose to share (marked hard dates, self-reported mood check-ins).
// Every window it opens cites exactly which of those signals produced it —
// no inferred mental state, no black-box score.

export type ForecastSignal = { signal: string; detail: string };
export type ForecastWindow = {
  startDate: Date;
  endDate: Date;
  confidence: number;
  status: "active" | "upcoming";
  signals: ForecastSignal[];
};

const MOOD_LOOKBACK = 3;
const MOOD_LOW_THRESHOLD = 2.5; // out of 5, average across the lookback window
const MOOD_ONLY_WINDOW_DAYS = 3;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);
}

type HardDateRow = { id: string; label: string; monthDay: string; windowDaysBefore: number; windowDaysAfter: number };

function windowForYear(hd: HardDateRow, year: number) {
  const [month, day] = hd.monthDay.split("-").map(Number);
  const occurrence = startOfDay(new Date(year, month - 1, day));
  const start = addDays(occurrence, -hd.windowDaysBefore);
  const end = addDays(occurrence, hd.windowDaysAfter);
  return { occurrence, start, end };
}

/** The hard-date window (this/prev/next year, whichever is relevant) closest to `today`. */
function nearestHardDateWindow(hd: HardDateRow, today: Date) {
  const candidates = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map((y) => windowForYear(hd, y));
  const active = candidates.find((c) => today >= c.start && today <= c.end);
  if (active) return { ...active, active: true };
  const upcoming = candidates
    .filter((c) => c.start > today)
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  return upcoming ? { ...upcoming, active: false } : null;
}

/**
 * Pure computation, no side effects: what would Forecast Agent say about
 * this user's risk calendar right now, and why. Safe to call as often as
 * needed for display (e.g. the calendar view) without opening anything.
 */
export async function runForecast(userId: string, now: Date = new Date()): Promise<ForecastWindow | null> {
  const today = startOfDay(now);
  const hardDates = await prisma.hardDate.findMany({ where: { userId } });
  const recentCheckIns = await prisma.moodCheckIn.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: MOOD_LOOKBACK,
  });

  const moodAvg = recentCheckIns.length > 0 ? recentCheckIns.reduce((s, c) => s + c.score, 0) / recentCheckIns.length : null;
  const moodLow = moodAvg !== null && moodAvg <= MOOD_LOW_THRESHOLD;
  const moodSignal: ForecastSignal | null = moodLow
    ? {
        signal: "mood_checkin_trend",
        detail: `Last ${recentCheckIns.length} self-reported mood check-in${recentCheckIns.length === 1 ? "" : "s"} averaged ${moodAvg!.toFixed(1)}/5 (at or below the ${MOOD_LOW_THRESHOLD} threshold).`,
      }
    : null;

  // Find the closest currently-active hard-date window, if any.
  let bestActive: { hd: HardDateRow; win: NonNullable<ReturnType<typeof nearestHardDateWindow>> } | null = null;
  for (const hd of hardDates) {
    const win = nearestHardDateWindow(hd, today);
    if (win?.active) {
      if (!bestActive || Math.abs(daysBetween(today, win.occurrence)) < Math.abs(daysBetween(today, bestActive.win.occurrence))) {
        bestActive = { hd, win };
      }
    }
  }

  if (bestActive) {
    const { hd, win } = bestActive;
    const offset = daysBetween(today, win.occurrence);
    const signals: ForecastSignal[] = [
      {
        signal: "hard_date",
        detail: `Marked "${hd.label}" (${hd.monthDay}); today is ${offset === 0 ? "the date itself" : `${Math.abs(offset)} day(s) ${offset > 0 ? "before" : "after"}`}, within the ${hd.windowDaysBefore}-day-before/${hd.windowDaysAfter}-day-after window.`,
      },
    ];
    let confidence = 0.6;
    if (moodSignal) {
      signals.push(moodSignal);
      confidence = Math.min(0.95, confidence + 0.25);
    }
    return { startDate: win.start, endDate: win.end, confidence, status: "active", signals };
  }

  // No hard date active right now — a sustained low mood trend alone is
  // still a legitimate, if lower-confidence, signal.
  if (moodSignal) {
    return {
      startDate: today,
      endDate: addDays(today, MOOD_ONLY_WINDOW_DAYS),
      confidence: 0.35,
      status: "active",
      signals: [moodSignal],
    };
  }

  return null;
}

/**
 * Opens (persists) a RiskWindow if Forecast Agent's computation says today
 * qualifies, and none is already active. Idempotent: repeated calls don't
 * create duplicates. This never messages anyone by itself — it only makes
 * the window available for Companion/Circle/Bridge to act within, each
 * still gated by Guardian.
 */
export async function openRiskWindowIfDue(userId: string, now: Date = new Date()) {
  const existing = await prisma.riskWindow.findFirst({ where: { userId, status: "active" } });
  if (existing) return { opened: false as const, riskWindow: existing };

  const forecast = await runForecast(userId, now);
  if (!forecast) return { opened: false as const, riskWindow: null };

  const riskWindow = await prisma.riskWindow.create({
    data: {
      userId,
      startDate: forecast.startDate,
      endDate: forecast.endDate,
      confidence: forecast.confidence,
      sourceSignalsJson: JSON.stringify(forecast.signals),
      status: forecast.status,
    },
  });

  await writeAuditLog(userId, null, "forecast", "forecast.window_opened", {
    riskWindowId: riskWindow.id,
    confidence: forecast.confidence,
    signals: forecast.signals,
  });

  return { opened: true as const, riskWindow };
}
