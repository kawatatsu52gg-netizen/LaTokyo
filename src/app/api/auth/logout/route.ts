import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await clearSession();
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
