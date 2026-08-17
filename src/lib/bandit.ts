import { sql } from "./db";
import { sampleBeta } from "./stats";
import { REWARD_PERCENTILE } from "./scoring";

/**
 * Thompson Sampling with time decay.
 *
 * Arms are factorised per dimension (theme / format / hook_type / slot /
 * length_bucket / cta_type) rather than over the full cross-product — with six
 * posts a day the joint space would never accumulate enough evidence to leave
 * the prior. Interactions are tracked separately as `combo` patterns and only
 * promoted once a cell has real support.
 *
 * Observations are weighted by 0.5^(age_days / HALF_LIFE_DAYS), so a pattern
 * that stops working decays out of the posterior on its own. This is what makes
 * the system notice audience fatigue without any explicit rule for it.
 */

export const HALF_LIFE_DAYS = 30;

export const BANDIT_DIMENSIONS = [
  "theme",
  "format",
  "hook_type",
  "jst_slot",
  "length_bucket",
  "cta_type",
] as const;
export type BanditDimension = (typeof BANDIT_DIMENSIONS)[number];

export interface ArmPosterior {
  dimension: BanditDimension;
  value: string;
  alpha: number;
  beta: number;
  n: number;
  effectiveN: number;
  meanScore: number | null;
  winProb: number;
}

interface ObservationRow {
  dimension: string;
  value: string;
  performance_percentile: number;
  performance_score: number;
  age_days: number;
}

/** Pull decayed observations for every dimension in one query. */
export async function loadPosteriors(
  candidates: Partial<Record<BanditDimension, readonly string[]>>,
): Promise<Map<BanditDimension, Map<string, ArmPosterior>>> {
  const rows = await sql<ObservationRow[]>`
    with evaluated as (
      select
        theme, format, hook_type, jst_slot, length_bucket, cta_type,
        performance_percentile, performance_score,
        extract(epoch from (now() - published_at)) / 86400.0 as age_days
      from posts
      where status = 'EVALUATED'
        and performance_percentile is not null
        and published_at is not null
    )
    select 'theme'         as dimension, theme         as value, performance_percentile, performance_score, age_days from evaluated where theme is not null
    union all
    select 'format',        format,        performance_percentile, performance_score, age_days from evaluated where format is not null
    union all
    select 'hook_type',     hook_type,     performance_percentile, performance_score, age_days from evaluated where hook_type is not null
    union all
    select 'jst_slot',      jst_slot,      performance_percentile, performance_score, age_days from evaluated where jst_slot is not null
    union all
    select 'length_bucket', length_bucket, performance_percentile, performance_score, age_days from evaluated where length_bucket is not null
    union all
    select 'cta_type',      cta_type,      performance_percentile, performance_score, age_days from evaluated where cta_type is not null
  `;

  const out = new Map<BanditDimension, Map<string, ArmPosterior>>();
  for (const dim of BANDIT_DIMENSIONS) {
    const inner = new Map<string, ArmPosterior>();
    for (const v of candidates[dim] ?? []) {
      inner.set(v, {
        dimension: dim,
        value: v,
        alpha: 1,
        beta: 1,
        n: 0,
        effectiveN: 0,
        meanScore: null,
        winProb: 0.5,
      });
    }
    out.set(dim, inner);
  }

  const scoreSums = new Map<string, { sum: number; n: number }>();

  for (const r of rows) {
    const dim = r.dimension as BanditDimension;
    const inner = out.get(dim);
    if (!inner) continue;
    let arm = inner.get(r.value);
    if (!arm) {
      // A value observed in history but not in the current candidate list —
      // keep it so reporting stays honest, just never select it.
      arm = {
        dimension: dim,
        value: r.value,
        alpha: 1,
        beta: 1,
        n: 0,
        effectiveN: 0,
        meanScore: null,
        winProb: 0.5,
      };
      inner.set(r.value, arm);
    }
    const w = Math.pow(0.5, Number(r.age_days) / HALF_LIFE_DAYS);
    const reward = Number(r.performance_percentile) >= REWARD_PERCENTILE ? 1 : 0;
    arm.alpha += w * reward;
    arm.beta += w * (1 - reward);
    arm.n += 1;
    arm.effectiveN += w;

    const key = `${dim}|${r.value}`;
    const acc = scoreSums.get(key) ?? { sum: 0, n: 0 };
    acc.sum += Number(r.performance_score);
    acc.n += 1;
    scoreSums.set(key, acc);
  }

  for (const [dim, inner] of out) {
    for (const arm of inner.values()) {
      arm.winProb = arm.alpha / (arm.alpha + arm.beta);
      const acc = scoreSums.get(`${dim}|${arm.value}`);
      arm.meanScore = acc && acc.n > 0 ? acc.sum / acc.n : null;
    }
  }
  return out;
}

/**
 * Minimum decayed evidence before an arm counts as "known" for exploitation.
 *
 * Without this, exploit is indistinguishable from explore on high-cardinality
 * dimensions: an untried arm has a Beta(1,1) posterior, so its draw is
 * Uniform(0,1), which beats a genuine 61% winner ~39% of the time. With a dozen
 * untried formats, one of them wins the argmax almost every round and the known
 * winner is never actually used. Untested values belong in the explore branch,
 * which selects them deliberately rather than by accident.
 */
export const MIN_EVIDENCE_FOR_EXPLOIT = 2;

/** exploit: highest Thompson draw among candidates that have real evidence. */
export function thompsonPick(arms: ArmPosterior[], allowed: readonly string[]): string {
  const all = arms.filter((a) => allowed.includes(a.value));
  const known = all.filter((a) => a.effectiveN >= MIN_EVIDENCE_FOR_EXPLOIT);
  // Fall back to the full pool while the system is still cold-starting.
  const pool = known.length >= 2 ? known : all;
  if (pool.length === 0) return allowed[Math.floor(Math.random() * allowed.length)];
  let best = pool[0];
  let bestDraw = -1;
  for (const a of pool) {
    const draw = sampleBeta(a.alpha, a.beta);
    if (draw > bestDraw) {
      bestDraw = draw;
      best = a;
    }
  }
  return best.value;
}

/** explore: prefer the least-tested candidate, breaking ties at random. */
export function explorePick(arms: ArmPosterior[], allowed: readonly string[]): string {
  const pool = arms.filter((a) => allowed.includes(a.value));
  if (pool.length === 0) return allowed[Math.floor(Math.random() * allowed.length)];
  const minN = Math.min(...pool.map((a) => a.effectiveN));
  const tied = pool.filter((a) => a.effectiveN <= minN + 1e-9);
  return tied[Math.floor(Math.random() * tied.length)].value;
}

/** Persist posteriors so the dashboard can show "current winning patterns". */
export async function persistWinningPatterns(
  posteriors: Map<BanditDimension, Map<string, ArmPosterior>>,
): Promise<number> {
  const overall = await sql<{ avg: number | null }[]>`
    select avg(performance_score) as avg from posts where status = 'EVALUATED'
  `;
  const globalMean = Number(overall[0]?.avg ?? 0) || 0;

  let count = 0;
  for (const [dim, inner] of posteriors) {
    const ranked = [...inner.values()].sort((a, b) => b.winProb - a.winProb);
    for (let i = 0; i < ranked.length; i++) {
      const a = ranked[i];
      const lift = globalMean > 0 && a.meanScore !== null ? a.meanScore / globalMean : null;
      await sql`
        insert into winning_patterns
          (dimension, value, metric, mean_score, lift, sample_n,
           posterior_alpha, posterior_beta, win_prob, rank, updated_at)
        values
          (${dim}, ${a.value}, 'performance_score', ${a.meanScore}, ${lift}, ${a.n},
           ${a.alpha}, ${a.beta}, ${a.winProb}, ${i + 1}, now())
        on conflict (dimension, value, metric) do update set
          mean_score = excluded.mean_score,
          lift = excluded.lift,
          sample_n = excluded.sample_n,
          posterior_alpha = excluded.posterior_alpha,
          posterior_beta = excluded.posterior_beta,
          win_prob = excluded.win_prob,
          rank = excluded.rank,
          updated_at = now()
      `;
      count++;
    }
  }
  return count;
}
