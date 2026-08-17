import { sql } from "@/lib/db";
import { threadsEnabled } from "@/lib/env";
import { fetchAccountInsights, fetchMediaInsights } from "@/lib/threads";
import { attributeDay, syncLinkClicks } from "@/lib/attribution";
import { addDaysJst, jstDateString, jstSlotToUtc } from "@/lib/time";
import { errorMessage, fail, guardCron, ok } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Which snapshot horizons are due for a post published `hours` ago. */
function dueHorizons(hoursSince: number): ("1h" | "6h" | "24h")[] {
  const out: ("1h" | "6h" | "24h")[] = [];
  if (hoursSince >= 1) out.push("1h");
  if (hoursSince >= 6) out.push("6h");
  if (hoursSince >= 24) out.push("24h");
  return out;
}

/** Pull post + account insights. Runs hourly. */
export async function GET(req: Request) {
  const denied = await guardCron(req);
  if (denied) return denied;

  const clicksSynced = await syncLinkClicks();
  if (!threadsEnabled()) {
    return ok({ skipped: "Threads API not configured", clicksSynced });
  }

  // Posts still inside the 26-hour collection window.
  const posts = await sql<{ id: string; threads_media_id: string; hours: number; jst_date: string }[]>`
    select id, threads_media_id,
           extract(epoch from (now() - published_at)) / 3600.0 as hours,
           jst_date::text
    from posts
    where threads_media_id is not null
      and published_at is not null
      and published_at > now() - interval '26 hours'
  `;

  const existing = await sql<{ post_id: string; horizon: string }[]>`
    select post_id, horizon from post_metrics where source = 'api'
  `;
  const have = new Set(existing.map((e) => `${e.post_id}|${e.horizon}`));

  let written = 0;
  const errors: { id: string; error: string }[] = [];

  for (const p of posts) {
    const pending = dueHorizons(Number(p.hours)).filter((h) => !have.has(`${p.id}|${h}`));
    if (pending.length === 0) continue;
    try {
      const m = await fetchMediaInsights(p.threads_media_id);
      const clicks = await sql<{ n: number }[]>`
        select count(*)::int as n from link_clicks where post_id = ${p.id}
      `;
      for (const horizon of pending) {
        await sql`
          insert into post_metrics (
            post_id, horizon, source, snapshot_at,
            impressions, likes, replies, reposts, quotes, shares, link_clicks
          ) values (
            ${p.id}, ${horizon}, 'api', now(),
            ${m.views}, ${m.likes}, ${m.replies}, ${m.reposts}, ${m.quotes}, ${m.shares},
            ${clicks[0]?.n ?? 0}
          )
          on conflict (post_id, horizon, source) do update set
            impressions = excluded.impressions, likes = excluded.likes,
            replies = excluded.replies, reposts = excluded.reposts,
            quotes = excluded.quotes, shares = excluded.shares,
            link_clicks = excluded.link_clicks, snapshot_at = now()
        `;
        written++;
      }
      await sql`update posts set status = 'COLLECTING', updated_at = now()
                where id = ${p.id} and status = 'PUBLISHED'`;
    } catch (e) {
      errors.push({ id: p.id, error: errorMessage(e) });
    }
  }

  // Account-level daily insights — the only source for profile visits/follows.
  const today = jstDateString();
  const yesterday = addDaysJst(today, -1);
  let attributed: unknown = null;
  try {
    const since = jstSlotToUtc(yesterday, "00:00").getTime();
    const until = jstSlotToUtc(today, "00:00").getTime();
    const a = await fetchAccountInsights(since, until);

    const prev = await sql<{ followers_total: number | null }[]>`
      select followers_total from account_daily
      where jst_date < ${yesterday} and followers_total is not null
      order by jst_date desc limit 1
    `;
    const delta =
      a.followers_total !== null && prev[0]?.followers_total != null
        ? a.followers_total - Number(prev[0].followers_total)
        : null;

    await sql`
      insert into account_daily (jst_date, views, likes, replies, reposts, quotes, followers_total, follows_delta, source)
      values (${yesterday}, ${a.views}, ${a.likes}, ${a.replies}, ${a.reposts}, ${a.quotes},
              ${a.followers_total}, ${delta}, 'api')
      on conflict (jst_date) do update set
        views = excluded.views, likes = excluded.likes, replies = excluded.replies,
        reposts = excluded.reposts, quotes = excluded.quotes,
        followers_total = excluded.followers_total,
        follows_delta = coalesce(excluded.follows_delta, account_daily.follows_delta)
    `;
    attributed = await attributeDay(yesterday);
  } catch (e) {
    errors.push({ id: "account_daily", error: errorMessage(e) });
  }

  if (errors.length > 0 && written === 0) {
    return fail("collection failed", 502, { errors, clicksSynced });
  }
  return ok({ snapshotsWritten: written, clicksSynced, attributed, errors });
}

export const POST = GET;
