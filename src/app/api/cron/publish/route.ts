import { sql } from "@/lib/db";
import { env, threadsEnabled } from "@/lib/env";
import { publishText, refreshIfNeeded } from "@/lib/threads";
import { errorMessage, fail, guardCron, ok } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ATTEMPTS = 3;
/** Don't publish something whose slot passed long ago — a 6-hour-late "morning"
 *  post pollutes the time-of-day data we're trying to learn from. */
const STALE_MINUTES = 45;

/** Publish anything whose slot has arrived. Runs every 10 minutes. */
export async function GET(req: Request) {
  const denied = await guardCron(req);
  if (denied) return denied;
  if (!threadsEnabled()) return fail("Threads API is not configured", 400);

  try {
    await refreshIfNeeded();
  } catch (e) {
    return fail(`Token refresh failed: ${errorMessage(e)}`);
  }

  // SKIP LOCKED so overlapping cron ticks can never double-publish the same row.
  const due = await sql<{ id: string; body: string; link_slug: string | null; publish_attempts: number }[]>`
    with picked as (
      select id from posts
      where status in ('APPROVED','SCHEDULED')
        and body is not null
        and scheduled_at <= now()
        and scheduled_at > now() - (${STALE_MINUTES}::int * interval '1 minute')
        and publish_attempts < ${MAX_ATTEMPTS}
      order by scheduled_at
      limit 3
      for update skip locked
    )
    update posts p
    set status = 'PUBLISHING', publish_attempts = p.publish_attempts + 1, updated_at = now()
    from picked
    where p.id = picked.id
    returning p.id, p.body, p.link_slug, p.publish_attempts
  `;

  const results: { id: string; ok: boolean; mediaId?: string; error?: string }[] = [];

  for (const post of due) {
    try {
      // Swap any bare destination URL for the tracked redirector so link CTR is
      // attributable per post — the API will not tell us this.
      let body = post.body;
      if (post.link_slug && env.linkDestinationDefault) {
        body = body.replaceAll(env.linkDestinationDefault, `${env.appUrl}/r/${post.link_slug}`);
      }

      const { mediaId, permalink } = await publishText(body);
      await sql`
        update posts set
          status = 'PUBLISHED', threads_media_id = ${mediaId},
          threads_permalink = ${permalink}, published_at = now(),
          failure_reason = null, updated_at = now()
        where id = ${post.id}
      `;
      results.push({ id: post.id, ok: true, mediaId });
    } catch (e) {
      const msg = errorMessage(e);
      const exhausted = post.publish_attempts >= MAX_ATTEMPTS;
      await sql`
        update posts set
          status = ${exhausted ? "FAILED" : "APPROVED"},
          failure_reason = ${msg}, updated_at = now()
        where id = ${post.id}
      `;
      results.push({ id: post.id, ok: false, error: msg });
    }
  }

  // Anything that sat past its window is marked failed rather than left pending.
  const expired = await sql`
    update posts set status = 'FAILED', failure_reason = '投稿時刻を過ぎたためスキップ', updated_at = now()
    where status in ('APPROVED','SCHEDULED')
      and scheduled_at <= now() - (${STALE_MINUTES}::int * interval '1 minute')
  `;

  return ok({ attempted: due.length, results, expired: expired.count ?? 0 });
}

export const POST = GET;
