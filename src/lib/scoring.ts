import { sql } from "./db";
import { mean, percentileRank, quantile, shrink } from "./stats";

/**
 * Why not a plain weighted sum of raw rates?
 *
 * like_rate runs 2-6% while follow_conversion_rate runs 0.05-0.5% — two orders
 * of magnitude apart. Summing them with 20/25-style weights makes the biggest
 * number win regardless of the weight you wrote down: a "reply-weighted" score
 * built that way is, in practice, a like ranking.
 *
 * So the pipeline is:
 *   1. shrink each rate toward the cohort mean (kills small-sample noise)
 *   2. convert each to a 0-100 percentile *within the cohort*
 *   3. weighted-sum the percentiles
 *
 * Every metric then contributes on the same scale, and the weights mean what
 * they say.
 */

export const METRIC_KEYS = [
  "engagement_rate",
  "reply_rate",
  "like_rate",
  "repost_rate",
  "profile_visit_rate",
  "follow_conversion_rate",
  "link_ctr",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_LABELS_JA: Record<MetricKey, string> = {
  engagement_rate: "Engagement Rate",
  reply_rate: "Reply Rate",
  like_rate: "Like Rate",
  repost_rate: "Repost Rate",
  profile_visit_rate: "Profile Visit Rate",
  follow_conversion_rate: "Follow Conversion Rate",
  link_ctr: "Link CTR",
};

/** numerator column for each rate, used by the shrinkage step */
const NUMERATOR: Record<MetricKey, (m: MetricRow) => number | null> = {
  engagement_rate: (m) => m.likes + m.replies + m.reposts + m.quotes,
  reply_rate: (m) => m.replies,
  like_rate: (m) => m.likes,
  repost_rate: (m) => m.reposts + m.quotes,
  profile_visit_rate: (m) => m.profile_visits,
  follow_conversion_rate: (m) => m.follows,
  link_ctr: (m) => m.link_clicks,
};

export interface MetricRow {
  post_id: string;
  impressions: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  profile_visits: number | null;
  follows: number | null;
  link_clicks: number;
}

export interface ScoredPost {
  post_id: string;
  impressions: number;
  /** shrunk rate per metric (null when the metric has no data at all) */
  rates: Partial<Record<MetricKey, number>>;
  /** 0-100 percentile within the cohort, per metric */
  percentiles: Partial<Record<MetricKey, number>>;
  performance_score: number;
  performance_percentile: number;
}

export interface Weights {
  version: string;
  weights: Partial<Record<MetricKey, number>>;
}

export const MIN_IMPRESSIONS = 100;
export const COHORT_DAYS = 60;
export const SHRINK_K = 300;

export async function activeWeights(): Promise<Weights> {
  const rows = await sql<{ version: string; weights: Record<string, number> }[]>`
    select version, weights from score_weights where active = true limit 1
  `;
  if (rows.length > 0) return { version: rows[0].version, weights: rows[0].weights };
  return {
    version: "v1_api_only",
    weights: {
      reply_rate: 30,
      link_ctr: 20,
      repost_rate: 20,
      engagement_rate: 20,
      like_rate: 10,
    },
  };
}

/**
 * Score a whole cohort at once. Percentiles are only meaningful relative to a
 * peer group, so scoring is inherently a batch operation.
 */
export function scoreCohort(rows: MetricRow[], weights: Weights): ScoredPost[] {
  const eligible = rows.filter((r) => r.impressions >= MIN_IMPRESSIONS);
  const basis = eligible.length >= 5 ? eligible : rows.filter((r) => r.impressions > 0);
  if (basis.length === 0) return [];

  const activeMetrics = (Object.keys(weights.weights) as MetricKey[]).filter(
    (k) => (weights.weights[k] ?? 0) > 0,
  );

  // Step 1: cohort mean per metric (the shrinkage prior), computed pooled so
  // that a single huge post cannot define the prior on its own.
  const priorMu: Partial<Record<MetricKey, number>> = {};
  for (const k of activeMetrics) {
    let num = 0;
    let den = 0;
    for (const r of basis) {
      const x = NUMERATOR[k](r);
      if (x === null || x === undefined) continue;
      num += x;
      den += r.impressions;
    }
    priorMu[k] = den > 0 ? num / den : 0;
  }

  // Step 2: shrunk rate per post per metric
  const shrunk = new Map<string, Partial<Record<MetricKey, number>>>();
  for (const r of basis) {
    const per: Partial<Record<MetricKey, number>> = {};
    for (const k of activeMetrics) {
      const x = NUMERATOR[k](r);
      if (x === null || x === undefined) continue; // metric not measured for this post
      per[k] = shrink(x, r.impressions, priorMu[k] ?? 0, SHRINK_K);
    }
    shrunk.set(r.post_id, per);
  }

  // Step 3: percentile within cohort
  const sortedByMetric: Partial<Record<MetricKey, number[]>> = {};
  for (const k of activeMetrics) {
    const vals: number[] = [];
    for (const per of shrunk.values()) {
      const v = per[k];
      if (v !== undefined) vals.push(v);
    }
    sortedByMetric[k] = vals.sort((a, b) => a - b);
  }

  // Step 4: weighted sum, renormalizing over the metrics actually present so a
  // post missing profile_visits is not silently penalized to zero on that axis.
  const scored: ScoredPost[] = basis.map((r) => {
    const per = shrunk.get(r.post_id) ?? {};
    const pcts: Partial<Record<MetricKey, number>> = {};
    let weighted = 0;
    let usedWeight = 0;
    for (const k of activeMetrics) {
      const v = per[k];
      if (v === undefined) continue;
      const pct = percentileRank(sortedByMetric[k] ?? [], v);
      pcts[k] = pct;
      const w = weights.weights[k] ?? 0;
      weighted += pct * w;
      usedWeight += w;
    }
    const score = usedWeight > 0 ? weighted / usedWeight : 0;
    return {
      post_id: r.post_id,
      impressions: r.impressions,
      rates: per,
      percentiles: pcts,
      performance_score: score,
      performance_percentile: 0, // filled below
    };
  });

  // Step 5: percentile of the composite score itself — this is what gets
  // compared against the Judge's 0-100 prediction.
  const scores = scored.map((s) => s.performance_score).sort((a, b) => a - b);
  for (const s of scored) {
    s.performance_percentile = percentileRank(scores, s.performance_score);
  }
  return scored;
}

/** Load the current cohort (trailing COHORT_DAYS of published posts). */
export async function loadCohort(days = COHORT_DAYS): Promise<MetricRow[]> {
  return sql<MetricRow[]>`
    select
      p.id as post_id,
      f.impressions, f.likes, f.replies, f.reposts, f.quotes,
      f.profile_visits, f.follows, f.link_clicks
    from posts p
    join post_final_metrics f on f.post_id = p.id
    where p.published_at is not null
      and p.published_at > now() - (${days}::int * interval '1 day')
  `;
}

/** Recompute and persist performance_score / percentile / prediction_error. */
export async function recomputeScores(): Promise<{ updated: number; version: string }> {
  const weights = await activeWeights();
  const rows = await loadCohort();
  const scored = scoreCohort(rows, weights);
  if (scored.length === 0) return { updated: 0, version: weights.version };

  for (const s of scored) {
    await sql`
      update posts set
        performance_score = ${s.performance_score},
        performance_percentile = ${s.performance_percentile},
        prediction_error = case
          when judge_score is null then null
          else judge_score - ${s.performance_percentile}
        end,
        evaluated_at = now(),
        status = case when status = 'PUBLISHED' then 'EVALUATED' else status end,
        updated_at = now()
      where id = ${s.post_id}
    `;
  }
  return { updated: scored.length, version: weights.version };
}

/** The reward threshold used by the bandit: "was this a top-30% post?" */
export const REWARD_PERCENTILE = 70;

export function summarizeCohort(scored: ScoredPost[]) {
  return {
    n: scored.length,
    meanScore: mean(scored.map((s) => s.performance_score)),
    p70: quantile(
      scored.map((s) => s.performance_score),
      REWARD_PERCENTILE,
    ),
  };
}
