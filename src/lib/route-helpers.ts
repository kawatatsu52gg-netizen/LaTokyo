import { NextResponse } from "next/server";
import { checkCron, isAuthed } from "./auth";

/** Cron endpoints accept either the shared secret or an authenticated browser
 *  session, so every job can also be triggered by hand from the dashboard. */
export async function guardCron(req: Request): Promise<NextResponse | null> {
  if (checkCron(req)) return null;
  if (await isAuthed()) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function guardSession(): Promise<NextResponse | null> {
  if (await isAuthed()) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export function ok(data: unknown) {
  return NextResponse.json({ ok: true, ...(data as object) });
}

export function fail(message: string, status = 500, extra?: unknown) {
  return NextResponse.json({ ok: false, error: message, ...(extra as object) }, { status });
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
