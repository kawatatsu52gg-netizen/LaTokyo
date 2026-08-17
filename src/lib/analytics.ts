import { sql } from "./db";
import { METRIC_KEYS, type MetricKey } from "./scoring";

/** Read-side queries for the dashboard. All of these are safe to call on a
 *  fresh, empty database — every page must render before any data exists. */

export interface PostSummary {
  id: string;
  status: string;
  jst_date: string | null;
  jst_slot: string | null;
  jst_dow: number | null;
  theme: string | null;
  format: string | null;
  hook_type: string | null;
  cta_type: string | null;
  length_bucket: string | null;
  char_count: number | null;
  body: string | null;
  variant: string | null;
  selection_mode: string | null;
  judge_score: number | null;
  performance_score: number | null;
  performance_percentile: number | null;
  prediction_error: number | null;
  ai_cost_usd: number | null;
  published_at: string | null;
  scheduled_at: string | null;
  threads_permalink: string | null;
  impressions: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  profile_visits: number | null;
  follows: number | null;
  link_clicks: number | null;
  engagement_rate: number | null;
  reply_rate: number | null;
  like_rate: number | null;
  repost_rate: number | null;
  profile_visit_rate: number | null;
  follow_conversion_rate: number | null;
  link_ctr: number | null;
  metric_source: string | null;
  failure_reason: string | null;
}

const POST_SELECT = sql`
  p.id, p.status, p.jst_date::text, p.jst_slot, p.jst_dow,
  p.theme, p.format, p.hook_type, p.cta_type, p.length_bucket, p.char_count,
  p.body, p.variant, p.selection_mode,
  p.judge_score, p.performance_score, p.performance_percentile, p.prediction_error,
  p.ai_cost_usd, p.published_at::text, p.scheduled_at::text, p.threads_permalink,
  p.failure_reason,
  f.impressions, f.likes, f.replies, f.reposts, f.quotes,
  f.profile_visits, f.follows, f.link_clicks,
  f.engagement_rate, f.reply_rate, f.like_rate, f.repost_rate,
  f.profile_visit_rate, f.follow_conversion_rate, f.link_ctr,
  f.source as metric_source
`;

export async function todayPosts(jstDate: string): Promise<PostSummary[]> {
  return sql<PostSummary[]>`
    select ${POST_SELECT}
    from posts p left join post_final_metrics f on f.post_id = p.id
    where p.jst_date = ${jstDate}
    order by p.jst_slot
  `;
}

export async function topPosts(limit = 10): Promise<PostSummary[]> {
  return sql<PostSummary[]>`
    select ${POST_SELECT}
    from posts p join post_final_metrics f on f.post_id = p.id
    where p.performance_score is not null
    order by p.performance_score desc
    limit ${limit}
  `;
}

export async function worstPosts(limit = 5): Promise<PostSummary[]> {
  return sql<PostSummary[]>`
    select ${POST_SELECT}
    from posts p join post_final_metrics f on f.post_id = p.id
    where p.performance_score is not null
    order by p.performance_score asc
    limit ${limit}
  `;
}

export async function listPosts(opts: { limit?: number; status?: string } = {}): Promise<PostSummary[]> {
  const limit = opts.limit ?? 100;
  if (opts.status) {
    return sql<PostSummary[]>`
      select ${POST_SELECT}
      from posts p left join post_final_metrics f on f.post_id = p.id
      where p.status = ${opts.status}
      order by coalesce(p.published_at, p.scheduled_at, p.created_at) desc
      limit ${limit}
    `;
  }
  return sql<PostSummary[]>`
    select ${POST_SELECT}
    from posts p left join post_final_metrics f on f.post_id = p.id
    order by coalesce(p.published_at, p.scheduled_at, p.created_at) desc
    limit ${limit}
  `;
}

export async function getPost(id: string): Promise<PostSummary | null> {
  const rows = await sql<PostSummary[]>`
    select ${POST_SELECT}
    from posts p left join post_final_metrics f on f.post_id = p.id
    where p.id = ${id}
  `;
  return rows[0] ?? null;
}

// ------------------------------------------------------------------ heatmap

export interface HeatCell {
  dow: number;
  slot: string;
  n: number;
  value: number | null;
}

/**
 * dow x slot heatmap. Averages the selected metric over every published post in
 * that cell. Cells with n=0 render as empty rather than as zero — an untested
 * time slot is not a bad time slot.
 */
export async function heatmap(metric: MetricKey | "impressions"): Promise<HeatCell[]> {
  const col = metric === "impressions" ? "impressions" : metric;
  if (metric !== "impressions" && !METRIC_KEYS.includes(metric)) {
    throw new Error(`unknown metric: ${metric}`);
  }
  return sql<HeatCell[]>`
    select
      p.jst_dow as dow,
      p.jst_slot as slot,
      count(*)::int as n,
      avg(f.${sql(col)})::float8 as value
    from posts p
    join post_final_metrics f on f.post_id = p.id
    where p.published_at is not null and p.jst_dow is not null and p.jst_slot is not null
    group by p.jst_dow, p.jst_slot
  `;
}

// ------------------------------------------------------------ dimension bests

export interface DimensionStat {
  value: string;
  n: number;
  mean_score: number | null;
  mean_reply_rate: number | null;
  mean_engagement_rate: number | null;
  win_prob: number | null;
  lift: number | null;
}

const DIMENSION_COLUMNS = {
  theme: "theme",
  format: "format",
  hook_type: "hook_type",
  cta_type: "cta_type",
  length_bucket: "length_bucket",
  jst_slot: "jst_slot",
} as const;
export type DimensionName = keyof typeof DIMENSION_COLUMNS;

export async function dimensionStats(dim: DimensionName): Promise<DimensionStat[]> {
  const col = DIMENSION_COLUMNS[dim];
  if (!col) throw new Error(`unknown dimension: ${dim}`);
  return sql<DimensionStat[]>`
    select
      p.${sql(col)}::text as value,
      count(*)::int as n,
      avg(p.performance_score)::float8 as mean_score,
      avg(f.reply_rate)::float8 as mean_reply_rate,
      avg(f.engagement_rate)::float8 as mean_engagement_rate,
      max(w.win_prob)::float8 as win_prob,
      max(w.lift)::float8 as lift
    from posts p
    join post_final_metrics f on f.post_id = p.id
    left join winning_patterns w on w.dimension = ${dim} and w.value = p.${sql(col)}::text
    where p.${sql(col)} is not null and p.performance_score is not null
    group by p.${sql(col)}
    order by avg(p.performance_score) desc nulls last
  `;
}

// --------------------------------------------------------------------- misc

export async function overviewStats() {
  const rows = await sql<{
    total: number;
    evaluated: number;
    needs_human: number;
    scheduled: number;
    ai_cost_7d: number | null;
    avg_score: number | null;
    avg_judge: number | null;
    avg_pred_error: number | null;
  }[]>`
    select
      (select count(*)::int from posts) as total,
      (select count(*)::int from posts where status = 'EVALUATED') as evaluated,
      (select count(*)::int from posts where status = 'NEEDS_HUMAN') as needs_human,
      (select count(*)::int from posts where status in ('APPROVED','SCHEDULED')) as scheduled,
      (select sum(ai_cost_usd)::float8 from posts where created_at > now() - interval '7 days') as ai_cost_7d,
      (select avg(performance_score)::float8 from posts where status = 'EVALUATED') as avg_score,
      (select avg(judge_score)::float8 from posts where judge_score is not null) as avg_judge,
      (select avg(prediction_error)::float8 from posts where prediction_error is not null) as avg_pred_error
  `;
  return rows[0];
}

export async function latestWeeklyInsight() {
  const rows = await sql<{
    week_start: string;
    posts_analyzed: number;
    findings: unknown;
    next_actions: unknown;
    next_experiments: unknown;
    judge_calibration: unknown;
    report_md: string | null;
    created_at: string;
  }[]>`
    select week_start::text, posts_analyzed, findings, next_actions, next_experiments,
           judge_calibration, report_md, created_at::text
    from weekly_insights order by week_start desc limit 1
  `;
  return rows[0] ?? null;
}

export async function allWeeklyInsights() {
  return sql<{ week_start: string; posts_analyzed: number; report_md: string | null }[]>`
    select week_start::text, posts_analyzed, report_md
    from weekly_insights order by week_start desc limit 20
  `;
}

export async function currentWinningPatterns() {
  return sql<{
    dimension: string;
    value: string;
    win_prob: number | null;
    lift: number | null;
    sample_n: number;
    mean_score: number | null;
  }[]>`
    select dimension, value, win_prob::float8, lift::float8, sample_n, mean_score::float8
    from winning_patterns
    order by dimension, win_prob desc nulls last
  `;
}

export async function openHypotheses() {
  return sql<{
    id: string;
    statement: string;
    dimension: string | null;
    target_value: string | null;
    status: string;
    evidence_n: number;
    confidence: number | null;
  }[]>`
    select id, statement, dimension, target_value, status, evidence_n, confidence::float8
    from hypotheses order by
      case status when 'testing' then 0 when 'untested' then 1 when 'supported' then 2 else 3 end,
      updated_at desc
    limit 40
  `;
}

export async function experimentList() {
  return sql<{
    id: string;
    name: string;
    variable: string;
    control_value: string | null;
    treatment_value: string | null;
    primary_metric: string;
    jst_date: string | null;
    result: string | null;
    p_value: number | null;
    lift: number | null;
  }[]>`
    select id, name, variable, control_value, treatment_value, primary_metric,
           jst_date::text, result, p_value::float8, lift::float8
    from experiments order by jst_date desc nulls last, created_at desc limit 40
  `;
}

export async function debateLog(postId: string) {
  return sql<{
    round: number;
    step: number;
    agent: string;
    provider: string;
    model: string;
    output: unknown;
    cost_usd: number;
    latency_ms: number | null;
    error: string | null;
  }[]>`
    select round, step, agent, provider, model, output, cost_usd::float8, latency_ms, error
    from debates where post_id = ${postId} order by round, step
  `;
}

export async function recentDebates(limit = 20) {
  return sql<{
    post_id: string;
    jst_date: string | null;
    jst_slot: string | null;
    status: string;
    theme: string | null;
    format: string | null;
    rounds: number;
    judge_score: number | null;
    ai_cost_usd: number | null;
    calls: number;
  }[]>`
    select p.id as post_id, p.jst_date::text, p.jst_slot, p.status, p.theme, p.format,
           p.debate_rounds as rounds, p.judge_score::float8, p.ai_cost_usd::float8,
           count(d.id)::int as calls
    from posts p join debates d on d.post_id = p.id
    group by p.id
    order by max(d.created_at) desc
    limit ${limit}
  `;
}

/** Judge prediction vs. actual outcome — the calibration scatter. */
export async function calibrationPoints() {
  return sql<{ id: string; judge_score: number; performance_percentile: number; jst_date: string | null }[]>`
    select id, judge_score::float8, performance_percentile::float8, jst_date::text
    from posts
    where judge_score is not null and performance_percentile is not null
    order by published_at
  `;
}
