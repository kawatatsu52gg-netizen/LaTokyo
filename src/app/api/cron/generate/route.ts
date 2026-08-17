import { sql } from "@/lib/db";
import { aiEnabled } from "@/lib/env";
import { runDebate, type PlannedPost } from "@/lib/agents/pipeline";
import { errorMessage, fail, guardCron, ok } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Run the debate pipeline over every PLANNED post that is still ahead of us.
 * Runs 03:30 JST, after the planner.
 */
export async function GET(req: Request) {
  const denied = await guardCron(req);
  if (denied) return denied;
  if (!aiEnabled()) {
    return fail("OPENAI_API_KEY and ANTHROPIC_API_KEY are required for generation", 400);
  }

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "6");
  const only = url.searchParams.get("post_id");

  const planned = only
    ? await sql<PlannedPost[]>`
        select id, jst_date::text, jst_slot, jst_dow, theme, format, hook_type,
               cta_type, length_bucket, hypothesis_id, variant
        from posts where id = ${only}
      `
    : await sql<PlannedPost[]>`
        select id, jst_date::text, jst_slot, jst_dow, theme, format, hook_type,
               cta_type, length_bucket, hypothesis_id, variant
        from posts
        where status = 'PLANNED' and scheduled_at > now()
        order by scheduled_at
        limit ${limit}
      `;

  const results = [];
  for (const p of planned) {
    try {
      results.push(await runDebate(p));
    } catch (e) {
      results.push({ postId: p.id, status: "FAILED" as const, reason: errorMessage(e) });
    }
  }

  const totalCost = results.reduce((a, r) => a + ("costUsd" in r ? (r.costUsd ?? 0) : 0), 0);
  return ok({ generated: results.length, totalCostUsd: Number(totalCost.toFixed(4)), results });
}

export const POST = GET;
