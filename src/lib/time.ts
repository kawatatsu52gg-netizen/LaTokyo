/**
 * All analysis is done in JST. Storage is UTC.
 * We avoid a date library by working with the +09:00 offset directly —
 * Japan has had no DST since 1951, so a fixed offset is exact.
 */
export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** UTC instant -> the wall-clock fields an observer in Tokyo would read. */
export function toJstParts(d: Date) {
  const shifted = new Date(d.getTime() + JST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dow: shifted.getUTCDay(), // 0=Sun
  };
}

/** 'YYYY-MM-DD' in JST */
export function jstDateString(d: Date = new Date()): string {
  const p = toJstParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** 'HH:MM' in JST */
export function jstTimeString(d: Date = new Date()): string {
  const p = toJstParts(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function jstDow(d: Date = new Date()): number {
  return toJstParts(d).dow;
}

/** JST calendar date + 'HH:MM' slot -> the UTC instant it refers to. */
export function jstSlotToUtc(jstDate: string, slot: string): Date {
  const [y, m, day] = jstDate.split("-").map(Number);
  const [hh, mm] = slot.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, day, hh, mm) - JST_OFFSET_MS);
}

export function addDaysJst(jstDate: string, days: number): string {
  const [y, m, d] = jstDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** Monday of the JST week containing `jstDate`. */
export function weekStartJst(jstDate: string): string {
  const [y, m, d] = jstDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Sun
  const backToMonday = dow === 0 ? 6 : dow - 1;
  return addDaysJst(jstDate, -backToMonday);
}

export const DOW_LABELS_JA = ["日", "月", "火", "水", "木", "金", "土"];

export function formatJst(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  const p = toJstParts(date);
  return `${p.month}/${p.day}(${DOW_LABELS_JA[p.dow]}) ${String(p.hour).padStart(2, "0")}:${String(
    p.minute,
  ).padStart(2, "0")}`;
}
