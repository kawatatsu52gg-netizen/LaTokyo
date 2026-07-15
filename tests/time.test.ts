import { describe, expect, it } from "vitest";
import {
  occupancyWindow,
  overlaps,
  tokyoToUtc,
  utcToTokyoString,
} from "@/lib/time";

describe("timezone (Asia/Tokyo <-> UTC)", () => {
  it("converts Tokyo wall-clock to UTC (JST = UTC+9)", () => {
    // 2026-07-14 15:30 JST == 2026-07-14 06:30 UTC
    const utc = tokyoToUtc("2026-07-14 15:30");
    expect(utc.toISOString()).toBe("2026-07-14T06:30:00.000Z");
  });

  it("converts UTC back to Tokyo display string", () => {
    const utc = new Date("2026-07-14T06:30:00.000Z");
    expect(utcToTokyoString(utc)).toBe("2026-07-14 15:30");
  });

  it("handles a booking that crosses midnight in Tokyo", () => {
    // 23:30 JST, +90min crosses into the next Tokyo day
    const start = tokyoToUtc("2026-07-14 23:30");
    const win = occupancyWindow({ startAt: start, durationMinutes: 90 });
    expect(utcToTokyoString(win.start)).toBe("2026-07-14 23:30");
    expect(utcToTokyoString(win.end)).toBe("2026-07-15 01:00");
  });
});

describe("occupancy window & overlap", () => {
  it("applies prep time before and after", () => {
    const start = new Date("2026-07-14T06:00:00.000Z");
    const w = occupancyWindow({
      startAt: start,
      durationMinutes: 60,
      prepMinutesBefore: 10,
      prepMinutesAfter: 15,
    });
    expect(w.start.toISOString()).toBe("2026-07-14T05:50:00.000Z");
    expect(w.end.toISOString()).toBe("2026-07-14T07:15:00.000Z");
  });

  it("detects overlap and treats touching boundaries as non-overlap", () => {
    const a = {
      start: new Date("2026-07-14T06:00:00Z"),
      end: new Date("2026-07-14T07:00:00Z"),
    };
    const b = {
      start: new Date("2026-07-14T06:30:00Z"),
      end: new Date("2026-07-14T07:30:00Z"),
    };
    const c = {
      start: new Date("2026-07-14T07:00:00Z"),
      end: new Date("2026-07-14T08:00:00Z"),
    };
    expect(overlaps(a, b)).toBe(true);
    expect(overlaps(a, c)).toBe(false); // touching boundary
  });
});
