import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/client";
import { runForecast, openRiskWindowIfDue } from "@/lib/agents/forecast";

async function makeUser(label: string) {
  return prisma.user.create({
    data: { name: `${label} Test`, email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local` },
  });
}

function todayMonthDay(d: Date = new Date()): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("Forecast Agent: runForecast", () => {
  it("returns null when there's no marked hard date nearby and no low mood trend", async () => {
    const user = await makeUser("no-signal");
    const result = await runForecast(user.id);
    expect(result).toBeNull();
  });

  it("opens a window from a hard date alone, citing exactly that signal", async () => {
    const user = await makeUser("hard-date-only");
    await prisma.hardDate.create({
      data: { userId: user.id, label: "Birthday", monthDay: todayMonthDay(), windowDaysBefore: 3, windowDaysAfter: 4 },
    });

    const result = await runForecast(user.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("active");
    expect(result!.signals).toHaveLength(1);
    expect(result!.signals[0].signal).toBe("hard_date");
    expect(result!.confidence).toBeCloseTo(0.6);
  });

  it("boosts confidence and cites both signals when a hard date and a low mood trend coincide", async () => {
    const user = await makeUser("hard-date-plus-mood");
    await prisma.hardDate.create({
      data: { userId: user.id, label: "Birthday", monthDay: todayMonthDay(), windowDaysBefore: 3, windowDaysAfter: 4 },
    });
    await prisma.moodCheckIn.create({ data: { userId: user.id, score: 2 } });
    await prisma.moodCheckIn.create({ data: { userId: user.id, score: 2 } });

    const result = await runForecast(user.id);
    expect(result).not.toBeNull();
    expect(result!.signals.map((s) => s.signal).sort()).toEqual(["hard_date", "mood_checkin_trend"]);
    expect(result!.confidence).toBeGreaterThan(0.6);
  });

  it("still opens a lower-confidence window from a low mood trend alone, with no hard date nearby", async () => {
    const user = await makeUser("mood-only");
    await prisma.moodCheckIn.create({ data: { userId: user.id, score: 1 } });
    await prisma.moodCheckIn.create({ data: { userId: user.id, score: 2 } });

    const result = await runForecast(user.id);
    expect(result).not.toBeNull();
    expect(result!.signals).toEqual([expect.objectContaining({ signal: "mood_checkin_trend" })]);
    expect(result!.confidence).toBeLessThan(0.6);
  });

  it("does not open a window when mood check-ins are fine", async () => {
    const user = await makeUser("mood-fine");
    await prisma.moodCheckIn.create({ data: { userId: user.id, score: 5 } });
    await prisma.moodCheckIn.create({ data: { userId: user.id, score: 4 } });

    const result = await runForecast(user.id);
    expect(result).toBeNull();
  });
});

describe("Forecast Agent: openRiskWindowIfDue", () => {
  it("persists a RiskWindow and logs why, then is idempotent on a second call", async () => {
    const user = await makeUser("open-window");
    await prisma.hardDate.create({
      data: { userId: user.id, label: "Birthday", monthDay: todayMonthDay(), windowDaysBefore: 3, windowDaysAfter: 4 },
    });

    const first = await openRiskWindowIfDue(user.id);
    expect(first.opened).toBe(true);
    expect(first.riskWindow).not.toBeNull();

    const logs = await prisma.auditLog.findMany({ where: { userId: user.id, event: "forecast.window_opened" } });
    expect(logs).toHaveLength(1);
    const detail = JSON.parse(logs[0].detail);
    expect(detail.signals[0].signal).toBe("hard_date");

    const second = await openRiskWindowIfDue(user.id);
    expect(second.opened).toBe(false);
    expect(second.riskWindow!.id).toBe(first.riskWindow!.id);

    const allWindows = await prisma.riskWindow.findMany({ where: { userId: user.id } });
    expect(allWindows).toHaveLength(1);
  });

  it("opens nothing when no signal qualifies", async () => {
    const user = await makeUser("open-window-none");
    const result = await openRiskWindowIfDue(user.id);
    expect(result.opened).toBe(false);
    expect(result.riskWindow).toBeNull();
  });
});
