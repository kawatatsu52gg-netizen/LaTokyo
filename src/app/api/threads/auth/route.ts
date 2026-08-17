import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { threadsEnabled } from "@/lib/env";
import { authorizeUrl } from "@/lib/threads";
import { guardSession } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guardSession();
  if (denied) return denied;
  if (!threadsEnabled()) {
    return NextResponse.json(
      { error: "THREADS_APP_ID / THREADS_APP_SECRET are not set" },
      { status: 400 },
    );
  }
  const state = randomBytes(16).toString("hex");
  const store = await cookies();
  store.set("threads_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(state));
}
