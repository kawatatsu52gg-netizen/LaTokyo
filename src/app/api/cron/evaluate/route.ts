import { recomputeScores } from "@/lib/scoring";
import { syncLinkClicks } from "@/lib/attribution";
import { decideExperiments } from "@/lib/learning/weekly";
import { errorMessage, fail, guardCron, ok } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Recompute performance scores across the whole cohort. Runs 05:00 JST.
 *
 * Scoring is a batch operation, not a per-post one: percentiles only mean
 * something relative to peers, so yesterday's posts entering the cohort shift
 * everyone's rank slightly. Recomputing the full window keeps the numbers
 * internally consistent.
 */
export async function GET(req: Request) {
  const denied = await guardCron(req);
  if (denied) return denied;
  try {
    const clicksSynced = await syncLinkClicks();
    const scored = await recomputeScores();
    const experimentsDecided = await decideExperiments();
    return ok({ ...scored, clicksSynced, experimentsDecided });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export const POST = GET;
