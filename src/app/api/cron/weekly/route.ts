import { runWeekly } from "@/lib/learning/weekly";
import { recomputeScores } from "@/lib/scoring";
import { jstDateString } from "@/lib/time";
import { errorMessage, fail, guardCron, ok } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/** Weekly learning pass. Runs Monday 04:00 JST. */
export async function GET(req: Request) {
  const denied = await guardCron(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? jstDateString();
  try {
    await recomputeScores();
    const result = await runWeekly(date);
    return ok(result);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export const POST = GET;
