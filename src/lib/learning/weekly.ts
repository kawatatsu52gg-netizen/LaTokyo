import { sql } from "../db";
import { anthropicJson } from "../ai/anthropic";
import { weeklySchema, type WeeklyOutput } from "../agents/schemas";
import { WEEKLY_SYSTEM } from "../agents/prompts";
import { loadPosteriors, persistWinningPatterns, BANDIT_DIMENSIONS, type BanditDimension } from "../bandit";
import {
  CTA_TYPES,
  DEFAULT_SLOTS,
  FORMATS,
  HOOK_TYPES,
  LENGTH_BUCKETS,
  THEMES,
  ja,
} from "../taxonomy";
import { spearman, twoProportionTest } from "../stats";
import { addDaysJst, weekStartJst, jstDateString } from "../time";
import { aiEnabled } from "../env";

const EXPERIMENT_ALPHA = 0.15; // deliberately loose — n is tiny; repetition does the work

export interface WeeklyRunResult {
  weekStart: string;
  postsAnalyzed: number;
  patternsUpdated: number;
  experimentsDecided: number;
  themeMixChanged: boolean;
  aiReportGenerated: boolean;
  costUsd: number;
}

/** Decide any A/B pair whose 24h data has landed. */
export async function decideExperiments(): Promise<number> {
  const rows = await sql<{
    id: string;
    primary_metric: string;
    a_num: number | null;
    a_den: number | null;
    b_num: number | null;
    b_den: number | null;
  }[]>`
    select
      e.id, e.primary_metric,
      case e.primary_metric
        when 'reply_rate' then fa.replies
        when 'like_rate' then fa.likes
        when 'repost_rate' then fa.reposts + fa.quotes
        when 'link_ctr' then fa.link_clicks
        else fa.replies end as a_num,
      fa.impressions as a_den,
      case e.primary_metric
        when 'reply_rate' then fb.replies
        when 'like_rate' then fb.likes
        when 'repost_rate' then fb.reposts + fb.quotes
        when 'link_ctr' then fb.link_clicks
        else fb.replies end as b_num,
      fb.impressions as b_den
    from experiments e
    join post_final_metrics fa on fa.post_id = e.variant_a_post_id
    join post_final_metrics fb on fb.post_id = e.variant_b_post_id
    where e.result is null
      and e.variant_a_post_id is not null
      and e.variant_b_post_id is not null
  `;

  let decided = 0;
  for (const r of rows) {
    const aN = Number(r.a_num ?? 0);
    const aD = Number(r.a_den ?? 0);
    const bN = Number(r.b_num ?? 0);
    const bD = Number(r.b_den ?? 0);
    if (aD < 100 || bD < 100) continue; // not enough exposure to say anything

    const { p, lift } = twoProportionTest(aN, aD, bN, bD);
    const result = p < EXPERIMENT_ALPHA ? (lift > 0 ? "b_wins" : "a_wins") : "inconclusive";
    await sql`
      update experiments set result = ${result}, p_value = ${p}, lift = ${lift}, decided_at = now()
      where id = ${r.id}
    `;
    decided++;
  }
  return decided;
}

/** Judge-vs-reality calibration for the week. */
export async function judgeCalibration() {
  const rows = await sql<{ judge_score: number; performance_percentile: number }[]>`
    select judge_score::float8, performance_percentile::float8
    from posts
    where judge_score is not null and performance_percentile is not null
      and published_at > now() - interval '45 days'
  `;
  if (rows.length < 5) return { n: rows.length, bias: null, mae: null, spearman: null };
  const judge = rows.map((r) => Number(r.judge_score));
  const actual = rows.map((r) => Number(r.performance_percentile));
  const errs = judge.map((j, i) => j - actual[i]);
  return {
    n: rows.length,
    bias: errs.reduce((a, b) => a + b, 0) / errs.length,
    mae: errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length,
    spearman: spearman(judge, actual),
  };
}

/** Aggregate statistics handed to the AI — never raw rows. */
async function weeklyStats(weekStart: string) {
  const weekEnd = addDaysJst(weekStart, 7);
  const [posts, byTheme, byFormat, byHook, bySlot, byLength, byDow, experiments] = await Promise.all([
    sql<{ n: number; avg_score: number | null; avg_imp: number | null; avg_reply: number | null }[]>`
      select count(*)::int as n,
             avg(p.performance_score)::float8 as avg_score,
             avg(f.impressions)::float8 as avg_imp,
             avg(f.reply_rate)::float8 as avg_reply
      from posts p join post_final_metrics f on f.post_id = p.id
      where p.jst_date >= ${weekStart} and p.jst_date < ${weekEnd}
    `,
    dimAgg("theme", weekStart, weekEnd),
    dimAgg("format", weekStart, weekEnd),
    dimAgg("hook_type", weekStart, weekEnd),
    dimAgg("jst_slot", weekStart, weekEnd),
    dimAgg("length_bucket", weekStart, weekEnd),
    sql<{ value: string; n: number; avg_score: number | null; avg_reply: number | null }[]>`
      select p.jst_dow::text as value, count(*)::int as n,
             avg(p.performance_score)::float8 as avg_score,
             avg(f.reply_rate)::float8 as avg_reply
      from posts p join post_final_metrics f on f.post_id = p.id
      where p.jst_date >= ${weekStart} and p.jst_date < ${weekEnd} and p.jst_dow is not null
      group by p.jst_dow order by p.jst_dow
    `,
    sql<{ name: string; variable: string; result: string | null; lift: number | null; p_value: number | null }[]>`
      select name, variable, result, lift::float8, p_value::float8
      from experiments where jst_date >= ${weekStart} and jst_date < ${weekEnd}
    `,
  ]);
  return { summary: posts[0], byTheme, byFormat, byHook, bySlot, byLength, byDow, experiments };
}

async function dimAgg(col: string, weekStart: string, weekEnd: string) {
  return sql<{
    value: string;
    n: number;
    avg_score: number | null;
    avg_imp: number | null;
    avg_reply: number | null;
    avg_engagement: number | null;
    avg_pv: number | null;
  }[]>`
    select p.${sql(col)}::text as value, count(*)::int as n,
           avg(p.performance_score)::float8 as avg_score,
           avg(f.impressions)::float8 as avg_imp,
           avg(f.reply_rate)::float8 as avg_reply,
           avg(f.engagement_rate)::float8 as avg_engagement,
           avg(f.profile_visit_rate)::float8 as avg_pv
    from posts p join post_final_metrics f on f.post_id = p.id
    where p.jst_date >= ${weekStart} and p.jst_date < ${weekEnd} and p.${sql(col)} is not null
    group by p.${sql(col)}
    order by avg(p.performance_score) desc nulls last
  `;
}

function fmtDim(label: string, rows: Awaited<ReturnType<typeof dimAgg>>): string {
  if (rows.length === 0) return `### ${label}\n(データなし)`;
  const lines = rows.map(
    (r) =>
      `- ${ja(r.value)} (${r.value}): n=${r.n} / スコア ${fmtN(r.avg_score)} / 表示 ${fmtN(
        r.avg_imp,
        0,
      )} / Reply ${fmtPct(r.avg_reply)} / ER ${fmtPct(r.avg_engagement)} / PV率 ${fmtPct(r.avg_pv)}`,
  );
  return `### ${label}\n${lines.join("\n")}`;
}

const fmtN = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? "—" : Number(v).toFixed(d);
const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${(Number(v) * 100).toFixed(2)}%`;

/**
 * Move the theme mix toward what is working, but slowly.
 * A hard jump to the current winner would starve exploration and lock the
 * system into whatever happened to work in one seven-post week.
 */
const MAX_WEEKLY_SHIFT = 0.05;
const MAX_DRIFT_FROM_DEFAULT = 0.1;

export async function adjustThemeMix(
  advice: WeeklyOutput["theme_mix_advice"],
): Promise<{ before: Record<string, number>; after: Record<string, number>; changed: boolean }> {
  const rows = await sql<{ value: string; target_share: number | null }[]>`
    select value, target_share from taxonomy where dimension = 'theme' and active = true
  `;
  const before: Record<string, number> = {};
  for (const r of rows) before[r.value] = Number(r.target_share ?? 0);

  const defaults: Record<string, number> = {
    acquisition: 0.4,
    retention: 0.25,
    revenue: 0.15,
    ai: 0.1,
    honest: 0.1,
  };

  const after = { ...before };
  for (const a of advice) {
    if (!(a.theme in after)) continue;
    const delta = a.direction === "increase" ? MAX_WEEKLY_SHIFT : a.direction === "decrease" ? -MAX_WEEKLY_SHIFT : 0;
    if (delta === 0) continue;
    const base = defaults[a.theme] ?? before[a.theme];
    const next = after[a.theme] + delta;
    after[a.theme] = Math.min(
      base + MAX_DRIFT_FROM_DEFAULT,
      Math.max(base - MAX_DRIFT_FROM_DEFAULT, Math.max(0.05, next)),
    );
  }

  const total = Object.values(after).reduce((a, b) => a + b, 0);
  if (total > 0) for (const k of Object.keys(after)) after[k] /= total;

  const changed = Object.keys(after).some((k) => Math.abs(after[k] - before[k]) > 1e-6);
  if (changed) {
    for (const [k, v] of Object.entries(after)) {
      await sql`update taxonomy set target_share = ${v} where dimension = 'theme' and value = ${k}`;
    }
  }
  return { before, after, changed };
}

export async function runWeekly(refDate = jstDateString()): Promise<WeeklyRunResult> {
  // analyse the week that just finished
  const weekStart = addDaysJst(weekStartJst(refDate), -7);

  const experimentsDecided = await decideExperiments();

  const candidates: Partial<Record<BanditDimension, readonly string[]>> = {
    theme: THEMES,
    format: FORMATS,
    hook_type: HOOK_TYPES,
    jst_slot: DEFAULT_SLOTS,
    length_bucket: LENGTH_BUCKETS,
    cta_type: CTA_TYPES,
  };
  const posteriors = await loadPosteriors(candidates);
  const patternsUpdated = await persistWinningPatterns(posteriors);

  const stats = await weeklyStats(weekStart);
  const calib = await judgeCalibration();
  const postsAnalyzed = stats.summary?.n ?? 0;

  let ai: WeeklyOutput | null = null;
  let costUsd = 0;

  if (aiEnabled() && postsAnalyzed > 0) {
    const user = [
      `# 対象週: ${weekStart} 〜 ${addDaysJst(weekStart, 6)}（JST）`,
      `## 全体`,
      `- 投稿数: ${postsAnalyzed}`,
      `- 平均総合スコア: ${fmtN(stats.summary?.avg_score)}`,
      `- 平均表示回数: ${fmtN(stats.summary?.avg_imp, 0)}`,
      `- 平均Reply Rate: ${fmtPct(stats.summary?.avg_reply)}`,
      ``,
      fmtDim("テーマ別", stats.byTheme),
      fmtDim("フォーマット別", stats.byFormat),
      fmtDim("Hookタイプ別", stats.byHook),
      fmtDim("投稿時刻別", stats.bySlot),
      fmtDim("文字数帯別", stats.byLength),
      ``,
      `### 曜日別`,
      stats.byDow
        .map(
          (d) =>
            `- ${["日", "月", "火", "水", "木", "金", "土"][Number(d.value)]}曜: n=${d.n} / スコア ${fmtN(
              d.avg_score,
            )} / Reply ${fmtPct(d.avg_reply)}`,
        )
        .join("\n") || "(データなし)",
      ``,
      `### A/Bテスト結果`,
      stats.experiments
        .map(
          (e) =>
            `- ${e.name}: ${e.result ?? "判定待ち"}（lift ${fmtN(
              e.lift === null ? null : Number(e.lift) * 100,
            )}% / p=${fmtN(e.p_value, 3)}）`,
        )
        .join("\n") || "(なし)",
      ``,
      `### AI予測と実績のズレ`,
      calib.bias === null
        ? "(サンプル不足)"
        : `- n=${calib.n} / 平均誤差 ${fmtN(calib.bias)}点 / MAE ${fmtN(calib.mae)}点 / 順位相関 ${fmtN(
            calib.spearman,
            2,
          )}`,
    ].join("\n");

    try {
      const res = await anthropicJson<WeeklyOutput>({
        system: WEEKLY_SYSTEM,
        user,
        schema: weeklySchema as unknown as Record<string, unknown>,
        maxTokens: 12000,
        effort: "high",
      });
      ai = res.data;
      costUsd = res.call.costUsd;
    } catch {
      // A failed weekly report must not lose the statistical updates above.
      ai = null;
    }
  }

  let themeMix = { before: {} as Record<string, number>, after: {} as Record<string, number>, changed: false };
  if (ai?.theme_mix_advice?.length) {
    themeMix = await adjustThemeMix(ai.theme_mix_advice);
  }

  if (ai?.next_experiments?.length) {
    for (const h of ai.next_experiments) {
      await sql`
        insert into hypotheses (statement, dimension, target_value, status, source)
        values (${h.statement}, ${h.dimension}, ${h.target_value}, 'untested', 'weekly_ai')
      `;
    }
  }

  await sql`
    insert into weekly_insights (
      week_start, posts_analyzed, findings, next_actions, next_experiments,
      judge_calibration, theme_mix_before, theme_mix_after, report_md, ai_cost_usd
    ) values (
      ${weekStart}, ${postsAnalyzed},
      ${JSON.stringify(ai?.findings ?? [])}::jsonb,
      ${JSON.stringify(ai?.next_actions ?? [])}::jsonb,
      ${JSON.stringify(ai?.next_experiments ?? [])}::jsonb,
      ${JSON.stringify(calib)}::jsonb,
      ${JSON.stringify(themeMix.before)}::jsonb,
      ${JSON.stringify(themeMix.after)}::jsonb,
      ${ai?.report_md ?? null}, ${costUsd}
    )
    on conflict (week_start) do update set
      posts_analyzed = excluded.posts_analyzed,
      findings = excluded.findings,
      next_actions = excluded.next_actions,
      next_experiments = excluded.next_experiments,
      judge_calibration = excluded.judge_calibration,
      theme_mix_before = excluded.theme_mix_before,
      theme_mix_after = excluded.theme_mix_after,
      report_md = excluded.report_md,
      ai_cost_usd = excluded.ai_cost_usd
  `;

  return {
    weekStart,
    postsAnalyzed,
    patternsUpdated,
    experimentsDecided,
    themeMixChanged: themeMix.changed,
    aiReportGenerated: ai !== null,
    costUsd,
  };
}
