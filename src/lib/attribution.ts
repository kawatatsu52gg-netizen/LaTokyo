import { sql } from "./db";

/**
 * Profile visits and follows are only available at the account level.
 * This module distributes a day's account totals across that day's posts in
 * proportion to each post's share of views.
 *
 * The estimate is crude in absolute terms, but the bias is identical across the
 * six posts of the same day — which is exactly the comparison the optimiser
 * makes. Rows are written with source='estimated' so they never overwrite a
 * hand-entered figure, and so the dashboard can label them honestly.
 */

export interface AttributionResult {
  jstDate: string;
  posts: number;
  profileVisitsDistributed: number;
  followsDistributed: number;
  skipped?: string;
}

export async function attributeDay(jstDate: string): Promise<AttributionResult> {
  const daily = await sql<{
    profile_visits: number | null;
    follows_delta: number | null;
  }[]>`
    select profile_visits, follows_delta from account_daily where jst_date = ${jstDate}
  `;
  const d = daily[0];
  if (!d) return { jstDate, posts: 0, profileVisitsDistributed: 0, followsDistributed: 0, skipped: "no account_daily row" };

  const pv = Number(d.profile_visits ?? 0);
  const fl = Number(d.follows_delta ?? 0);
  if (pv <= 0 && fl <= 0) {
    return { jstDate, posts: 0, profileVisitsDistributed: 0, followsDistributed: 0, skipped: "nothing to distribute" };
  }

  // Views share is taken from the best available snapshot per post.
  const posts = await sql<{ post_id: string; impressions: number }[]>`
    select p.id as post_id, coalesce(f.impressions, 0) as impressions
    from posts p
    join post_final_metrics f on f.post_id = p.id
    where p.jst_date = ${jstDate} and p.published_at is not null
  `;
  const totalViews = posts.reduce((a, p) => a + Number(p.impressions), 0);
  if (posts.length === 0 || totalViews === 0) {
    return { jstDate, posts: posts.length, profileVisitsDistributed: 0, followsDistributed: 0, skipped: "no views to weight by" };
  }

  let pvOut = 0;
  let flOut = 0;
  for (const p of posts) {
    const share = Number(p.impressions) / totalViews;
    const estPv = Math.round(pv * share);
    const estFl = Math.round(fl * share);
    pvOut += estPv;
    flOut += estFl;

    // Carry forward the measured counters so the estimated row is a complete,
    // self-consistent snapshot rather than a fragment.
    await sql`
      insert into post_metrics (
        post_id, horizon, source, snapshot_at,
        impressions, likes, replies, reposts, quotes, shares,
        profile_visits, follows, link_clicks
      )
      select
        m.post_id, '24h', 'estimated', now(),
        m.impressions, m.likes, m.replies, m.reposts, m.quotes, m.shares,
        ${estPv}, ${estFl}, m.link_clicks
      from post_final_metrics m
      where m.post_id = ${p.post_id}
      on conflict (post_id, horizon, source) do update set
        impressions = excluded.impressions,
        likes = excluded.likes, replies = excluded.replies,
        reposts = excluded.reposts, quotes = excluded.quotes, shares = excluded.shares,
        profile_visits = excluded.profile_visits,
        follows = excluded.follows,
        link_clicks = excluded.link_clicks,
        snapshot_at = now()
    `;
  }

  return { jstDate, posts: posts.length, profileVisitsDistributed: pvOut, followsDistributed: flOut };
}

/** Roll the redirector's raw click log into the metrics snapshots. */
export async function syncLinkClicks(): Promise<number> {
  const result = await sql`
    update post_metrics m
    set link_clicks = c.n
    from (
      select post_id, count(*)::int as n
      from link_clicks
      where post_id is not null
      group by post_id
    ) c
    where m.post_id = c.post_id and m.link_clicks <> c.n
  `;
  return result.count ?? 0;
}
