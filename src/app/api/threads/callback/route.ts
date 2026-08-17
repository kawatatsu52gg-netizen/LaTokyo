import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode } from "@/lib/threads";
import { errorMessage } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/settings?threads_error=${encodeURIComponent(error)}`, req.url),
      303,
    );
  }

  const store = await cookies();
  const expected = store.get("threads_oauth_state")?.value;
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/settings?threads_error=state_mismatch", req.url), 303);
  }
  store.delete("threads_oauth_state");

  try {
    const auth = await exchangeCode(code);
    return NextResponse.redirect(
      new URL(`/settings?threads_connected=${encodeURIComponent(auth.username ?? auth.user_id)}`, req.url),
      303,
    );
  } catch (e) {
    return NextResponse.redirect(
      new URL(`/settings?threads_error=${encodeURIComponent(errorMessage(e))}`, req.url),
      303,
    );
  }
}
