import { fromZonedTime, toZonedTime, format } from "date-fns-tz";
import { addMinutes } from "date-fns";

/**
 * タイムゾーン方針:
 *   - DB内部・API・比較はすべて UTC (Date)
 *   - 入力・表示のみ Asia/Tokyo
 */

export const TOKYO = "Asia/Tokyo";

/** Asia/Tokyo のローカル時刻文字列 (例: "2026-07-14 15:30") を UTC Date に変換 */
export function tokyoToUtc(localWallClock: string | Date): Date {
  return fromZonedTime(localWallClock, TOKYO);
}

/** UTC Date を Asia/Tokyo の表示用文字列に変換 */
export function utcToTokyoString(
  date: Date,
  pattern = "yyyy-MM-dd HH:mm",
): string {
  return format(toZonedTime(date, TOKYO), pattern, { timeZone: TOKYO });
}

/**
 * 施術枠（占有枠）の算出。
 * 前準備ぶん開始を早め、施術＋後片付けぶん終了を遅らせた「実占有区間」を返す。
 * ダブルブッキング判定はこの占有区間で行う。
 */
export function occupancyWindow(params: {
  startAt: Date;
  durationMinutes: number;
  prepMinutesBefore?: number;
  prepMinutesAfter?: number;
}): { start: Date; end: Date } {
  const before = params.prepMinutesBefore ?? 0;
  const after = params.prepMinutesAfter ?? 0;
  const start = addMinutes(params.startAt, -before);
  const end = addMinutes(params.startAt, params.durationMinutes + after);
  return { start, end };
}

/** 2区間が重なるか（境界の接触は重複としない: end == start はOK） */
export function overlaps(
  a: { start: Date; end: Date },
  b: { start: Date; end: Date },
): boolean {
  return a.start < b.end && b.start < a.end;
}
