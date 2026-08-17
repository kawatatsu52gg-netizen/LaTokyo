import { sql } from "./../db";
import type { PostContextRow } from "./prompts";

export interface GenerationContext {
  recent7d: PostContextRow[];
  top30d: PostContextRow[];
  worst30d: PostContextRow[];
  winningPatterns: { dimension: string; value: string; win_prob: number; sample_n: number; lift: number | null }[];
  hypothesis: { id: string; statement: string } | null;
  themeMixActual: { theme: string; n: number }[];
  calibrationNote: string | null;
}

/** Everything the agents need to know about what has already happened. */
export async function loadGenerationContext(hypothesisId: string | null): Promise<GenerationContext> {
  const [recent7d, top30d, worst30d, winningPatterns, themeMixActual] = await Promise.all([
    sql<PostContextRow[]>`
      select p.id, p.jst_date::text, p.jst_slot, p.theme, p.format, p.hook_type, p.body,
             f.impressions, f.reply_rate, p.performance_score
      from posts p
      left join post_final_metrics f on f.post_id = p.id
      where p.published_at > now() - interval '7 days'
      order by p.published_at desc
      limit 20
    `,
    sql<PostContextRow[]>`
      select p.id, p.jst_date::text, p.jst_slot, p.theme, p.format, p.hook_type, p.body,
             f.impressions, f.reply_rate, p.performance_score
      from posts p
      join post_final_metrics f on f.post_id = p.id
      where p.status = 'EVALUATED'
        and p.published_at > now() - interval '30 days'
        and p.performance_score is not null
      order by p.performance_score desc
      limit 10
    `,
    sql<PostContextRow[]>`
      select p.id, p.jst_date::text, p.jst_slot, p.theme, p.format, p.hook_type, p.body,
             f.impressions, f.reply_rate, p.performance_score
      from posts p
      join post_final_metrics f on f.post_id = p.id
      where p.status = 'EVALUATED'
        and p.published_at > now() - interval '30 days'
        and p.performance_score is not null
      order by p.performance_score asc
      limit 5
    `,
    sql<{ dimension: string; value: string; win_prob: number; sample_n: number; lift: number | null }[]>`
      select dimension, value, win_prob, sample_n, lift
      from winning_patterns
      where sample_n >= 3
      order by dimension, win_prob desc
    `,
    sql<{ theme: string; n: number }[]>`
      select theme, count(*)::int as n from posts
      where published_at > now() - interval '14 days' and theme is not null
      group by theme
    `,
  ]);

  let hypothesis: { id: string; statement: string } | null = null;
  if (hypothesisId) {
    const rows = await sql<{ id: string; statement: string }[]>`
      select id, statement from hypotheses where id = ${hypothesisId}
    `;
    hypothesis = rows[0] ?? null;
  }

  return {
    recent7d,
    top30d,
    worst30d,
    winningPatterns,
    hypothesis,
    themeMixActual,
    calibrationNote: await loadCalibrationNote(),
  };
}

/**
 * The Judge's self-correction signal. If the Judge has been systematically
 * over-scoring, it is told so in its own system prompt next time — this is the
 * loop that keeps the pre-post prediction anchored to real outcomes rather than
 * to the model's taste.
 */
export async function loadCalibrationNote(): Promise<string | null> {
  const rows = await sql<{ n: number; bias: number | null; mae: number | null }[]>`
    select
      count(*)::int as n,
      avg(prediction_error) as bias,
      avg(abs(prediction_error)) as mae
    from posts
    where prediction_error is not null
      and published_at > now() - interval '45 days'
  `;
  const r = rows[0];
  if (!r || r.n < 10 || r.bias === null) return null;

  const bias = Number(r.bias);
  const mae = Number(r.mae ?? 0);
  const direction = bias > 0 ? "過大評価" : "過小評価";
  return [
    `直近${r.n}投稿で、Judgeの点数は実績パーセンタイルに対して平均 ${bias.toFixed(1)} 点の${direction}（平均絶対誤差 ${mae.toFixed(1)}点）。`,
    bias > 8
      ? "点が甘い傾向が続いている。特に reply_probability と profile_visit_probability を厳しめに見積もること。"
      : bias < -8
        ? "点が辛い傾向が続いている。実際には反応が取れている投稿を落としている可能性がある。"
        : "偏りは小さい。現在の基準を維持すること。",
  ].join("\n");
}

export function summarizeWinningPatterns(
  patterns: GenerationContext["winningPatterns"],
): string {
  if (patterns.length === 0) return "## 現在の勝ちパターン\n(まだデータ不足)";
  const byDim = new Map<string, typeof patterns>();
  for (const p of patterns) {
    const arr = byDim.get(p.dimension) ?? [];
    arr.push(p);
    byDim.set(p.dimension, arr);
  }
  const lines: string[] = ["## 現在の勝ちパターン（上位のみ / n=サンプル数）"];
  for (const [dim, arr] of byDim) {
    const top = arr.slice(0, 3).map((p) => `${p.value}(勝率${(p.win_prob * 100).toFixed(0)}% n=${p.sample_n})`);
    lines.push(`- ${dim}: ${top.join(" / ")}`);
  }
  return lines.join("\n");
}
