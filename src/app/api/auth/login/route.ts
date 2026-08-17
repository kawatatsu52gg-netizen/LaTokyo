import { NextResponse } from "next/server";
import { checkPassword, setSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  if (!checkPassword(password)) {
    return NextResponse.redirect(new URL("/login?error=1", req.url), 303);
  }
  await setSession();
  return NextResponse.redirect(new URL("/", req.url), 303);
}
