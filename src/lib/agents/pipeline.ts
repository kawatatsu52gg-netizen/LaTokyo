import { sql } from "../db";
import { env } from "../env";
import { anthropicJson } from "../ai/anthropic";
import { openaiJson } from "../ai/openai";
import type { LlmCall } from "../ai/types";
import { ja, lengthBucket } from "../taxonomy";
import { loadGenerationContext, summarizeWinningPatterns } from "./context";
import {
  CHALLENGER_SYSTEM,
  CRITIC_SYSTEM,
  INTEGRATOR_SYSTEM,
  LENGTH_GUIDE,
  STRATEGIST_SYSTEM,
  fmtPostList,
  judgeSystem,
} from "./prompts";
import {
  challengerSchema,
  criticSchema,
  integratorSchema,
  judgeSchema,
  strategistSchema,
  type ChallengerOutput,
  type CriticOutput,
  type IntegratorOutput,
  type JudgeOutput,
  type StrategistOutput,
} from "./schemas";

export const PASS_SCORE = 85;

export interface PlannedPost {
  id: string;
  jst_date: string;
  jst_slot: string;
  jst_dow: number;
  theme: string;
  format: string;
  hook_type: string;
  cta_type: string;
  length_bucket: string;
  hypothesis_id: string | null;
  variant: string | null;
}

export interface PipelineResult {
  postId: string;
  status: "APPROVED" | "NEEDS_HUMAN" | "FAILED";
  rounds: number;
  finalScore: number | null;
  costUsd: number;
  body: string | null;
  reason?: string;
}

const DOW_JA = ["日", "月", "火", "水", "木", "金", "土"];

async function logDebate(args: {
  postId: string;
  round: number;
  step: number;
  agent: string;
  call: LlmCall;
  inputSummary: unknown;
  output: unknown;
  error?: string;
}) {
  await sql`
    insert into debates (
      post_id, round, step, agent, provider, model,
      input_summary, output, input_tokens, output_tokens, cached_input_tokens,
      cost_usd, latency_ms, error
    ) values (
      ${args.postId}, ${args.round}, ${args.step}, ${args.agent},
      ${args.call.provider}, ${args.call.model},
      ${JSON.stringify(args.inputSummary)}::jsonb, ${JSON.stringify(args.output)}::jsonb,
      ${args.call.inputTokens}, ${args.call.outputTokens}, ${args.call.cachedInputTokens},
      ${args.call.costUsd}, ${args.call.latencyMs}, ${args.error ?? null}
    )
  `;
}

/**
 * The debate loop.
 *
 * GPT drafts, Claude attacks, GPT decides what to accept, Claude attacks the
 * revision, and a Judge that never saw any of it scores the result. Max 3
 * rounds, plus a hard dollar ceiling — two independent stop conditions, because
 * "AI agents arguing forever" is the failure mode that actually costs money.
 */
export async function runDebate(post: PlannedPost): Promise<PipelineResult> {
  const ctx = await loadGenerationContext(post.hypothesis_id);
  const maxRounds = Math.max(1, env.maxDebateRounds);
  const costCap = env.maxCostPerPostUsd;

  const lengthHint = LENGTH_GUIDE[post.length_bucket] ?? "81〜150字";
  const brief = [
    `## 今回の投稿枠`,
    `- 日付: ${post.jst_date}（${DOW_JA[post.jst_dow]}曜）`,
    `- 投稿時刻: ${post.jst_slot} JST`,
    `- theme: ${post.theme}（${ja(post.theme)}）`,
    `- format: ${post.format}（${ja(post.format)}）`,
    `- hook_type: ${post.hook_type}（${ja(post.hook_type)}）`,
    `- cta_type: ${post.cta_type}（${ja(post.cta_type)}）`,
    `- 文字数: ${lengthHint}`,
    post.variant ? `- A/Bテスト: variant ${post.variant}` : "",
    ctx.hypothesis ? `- 今回検証したい仮説: ${ctx.hypothesis.statement}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const history = [
    fmtPostList("過去7日の投稿", ctx.recent7d),
    fmtPostList("直近30日のTop投稿", ctx.top30d),
    fmtPostList("直近30日のWorst投稿", ctx.worst30d),
    summarizeWinningPatterns(ctx.winningPatterns),
  ].join("\n\n");

  let totalCost = 0;
  let currentBody = "";
  let currentCta = "";
  let strategist: StrategistOutput | null = null;
  let lastJudge: JudgeOutput | null = null;
  let judgeFeedback = "";

  await sql`update posts set status = 'DRAFTING', updated_at = now() where id = ${post.id}`;

  for (let round = 1; round <= maxRounds; round++) {
    try {
      // ---------------------------------------------------------- 1 Strategist
      const strategistUser = [
        brief,
        history,
        judgeFeedback
          ? `## 前ラウンドでJudgeに落とされた理由（必ず解消すること）\n${judgeFeedback}`
          : "",
        currentBody ? `## 前ラウンドの本文（これを土台に作り直す）\n${currentBody}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const s = await openaiJson<StrategistOutput>({
        system: STRATEGIST_SYSTEM,
        user: strategistUser,
        schema: strategistSchema as unknown as Record<string, unknown>,
        schemaName: "strategist_draft",
      });
      totalCost += s.call.costUsd;
      strategist = s.data;
      currentBody = s.data.post_text;
      currentCta = s.data.cta;
      await logDebate({
        postId: post.id,
        round,
        step: 1,
        agent: "strategist",
        call: s.call,
        inputSummary: { brief, hypothesis: ctx.hypothesis?.statement ?? null },
        output: s.data,
      });
      if (totalCost > costCap) break;

      // -------------------------------------------------------------- 2 Critic
      const c = await anthropicJson<CriticOutput>({
        system: CRITIC_SYSTEM,
        user: [
          brief,
          `## 評価対象の投稿案\n${currentBody}`,
          fmtPostList("過去30日の投稿（重複チェック用）", [...ctx.recent7d, ...ctx.top30d]),
        ].join("\n\n"),
        schema: criticSchema as unknown as Record<string, unknown>,
        effort: "high",
      });
      totalCost += c.call.costUsd;
      await logDebate({
        postId: post.id,
        round,
        step: 2,
        agent: "critic",
        call: c.call,
        inputSummary: { body: currentBody },
        output: c.data,
      });
      if (totalCost > costCap) break;

      // ---------------------------------------------------------- 3 Integrator
      const allIssues = [...c.data.critical_issues, ...c.data.minor_issues];
      const i = await openaiJson<IntegratorOutput>({
        system: INTEGRATOR_SYSTEM,
        user: [
          brief,
          `## 現在の本文\n${currentBody}`,
          `## 批評（Claude）`,
          `全体所見: ${c.data.overall_read}`,
          `致命的:\n${
            c.data.critical_issues.map((x) => `${x.id} [${x.axis}] ${x.issue} — ${x.why_it_matters}`).join("\n") ||
            "(なし)"
          }`,
          `軽微:\n${
            c.data.minor_issues.map((x) => `${x.id} [${x.axis}] ${x.issue}`).join("\n") || "(なし)"
          }`,
          `改善提案:\n${c.data.improvement_suggestions.join("\n") || "(なし)"}`,
          `Hook代案: ${c.data.alternative_hook}`,
          c.data.duplicate_of_post_id
            ? `重複警告: 過去投稿 ${c.data.duplicate_of_post_id} と実質同じ内容と判定された。切り口を変えること。`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        schema: integratorSchema as unknown as Record<string, unknown>,
        schemaName: "integrator_revision",
      });
      totalCost += i.call.costUsd;
      currentBody = i.data.post_text;
      currentCta = i.data.cta;
      await logDebate({
        postId: post.id,
        round,
        step: 3,
        agent: "integrator",
        call: i.call,
        inputSummary: { issueCount: allIssues.length },
        output: i.data,
      });
      if (totalCost > costCap) break;

      // ---------------------------------------------------------- 4 Challenger
      const ch = await anthropicJson<ChallengerOutput>({
        system: CHALLENGER_SYSTEM,
        user: [brief, `## 改善後の投稿\n${currentBody}`].join("\n\n"),
        schema: challengerSchema as unknown as Record<string, unknown>,
        effort: "high",
      });
      totalCost += ch.call.costUsd;
      await logDebate({
        postId: post.id,
        round,
        step: 4,
        agent: "challenger",
        call: ch.call,
        inputSummary: { body: currentBody },
        output: ch.data,
      });

      // A stronger hook offered by the challenger is applied directly — it is a
      // complete replacement line, and re-running the integrator for it would
      // cost another round-trip for a one-line change.
      if (ch.data.verdict === "revise" && ch.data.stronger_hook_candidate) {
        const lines = currentBody.split("\n");
        lines[0] = ch.data.stronger_hook_candidate;
        currentBody = lines.join("\n");
      }
      if (totalCost > costCap) break;

      // --------------------------------------------------------------- 5 Judge
      // The Judge sees only the finished text. Showing it the debate would let
      // effort leak into the score.
      const j = await anthropicJson<JudgeOutput>({
        model: env.anthropicJudgeModel,
        system: judgeSystem(ctx.calibrationNote),
        user: [
          `## 採点対象の投稿`,
          currentBody,
          ``,
          `## メタ情報`,
          `- 投稿予定: ${post.jst_date}（${DOW_JA[post.jst_dow]}）${post.jst_slot} JST`,
          `- theme: ${ja(post.theme)} / format: ${ja(post.format)} / hook: ${ja(post.hook_type)}`,
          `- 文字数: ${currentBody.length}字`,
        ].join("\n"),
        schema: judgeSchema as unknown as Record<string, unknown>,
        effort: "high",
      });
      totalCost += j.call.costUsd;
      lastJudge = j.data;
      await logDebate({
        postId: post.id,
        round,
        step: 5,
        agent: "judge",
        call: j.call,
        inputSummary: { body: currentBody, chars: currentBody.length },
        output: j.data,
      });

      await sql`
        insert into judge_scores (
          post_id, round, hook, target_fit, empathy, reply_probability,
          originality, profile_visit_probability, naturalness,
          total_score, approved, major_issue, unresolved_issues, confidence
        ) values (
          ${post.id}, ${round}, ${j.data.hook}, ${j.data.target_fit}, ${j.data.empathy},
          ${j.data.reply_probability}, ${j.data.originality},
          ${j.data.profile_visit_probability}, ${j.data.naturalness},
          ${j.data.total_score}, ${j.data.approved}, ${j.data.major_issue},
          ${JSON.stringify(j.data.unresolved_issues)}::jsonb, ${j.data.confidence}
        )
        on conflict (post_id, round) do update set
          total_score = excluded.total_score,
          approved = excluded.approved
      `;

      const passed = j.data.total_score >= PASS_SCORE && !j.data.major_issue;
      if (passed) {
        await finalize(post, currentBody, currentCta, strategist, j.data, round, totalCost, "APPROVED");
        return {
          postId: post.id,
          status: "APPROVED",
          rounds: round,
          finalScore: j.data.total_score,
          costUsd: totalCost,
          body: currentBody,
        };
      }

      judgeFeedback = [
        `点数: ${j.data.total_score}/100（合格ライン ${PASS_SCORE}）`,
        j.data.major_issue ? "major_issue あり — 致命的な問題を必ず解消すること" : "",
        `未解決: ${j.data.unresolved_issues.join(" / ") || "(記載なし)"}`,
        `Judgeの所見: ${j.data.rationale}`,
      ]
        .filter(Boolean)
        .join("\n");

      if (totalCost > costCap) break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sql`
        update posts set status = 'FAILED', failure_reason = ${msg},
               ai_cost_usd = ${totalCost}, debate_rounds = ${round}, updated_at = now()
        where id = ${post.id}
      `;
      return {
        postId: post.id,
        status: "FAILED",
        rounds: round,
        finalScore: lastJudge?.total_score ?? null,
        costUsd: totalCost,
        body: currentBody || null,
        reason: msg,
      };
    }
  }

  // Out of rounds or out of budget: hand it to a human rather than shipping
  // something the Judge rejected.
  const reason =
    totalCost > costCap
      ? `コスト上限 $${costCap} を超過（実績 $${totalCost.toFixed(3)}）`
      : `${maxRounds}ラウンドで${PASS_SCORE}点に到達せず`;
  await finalize(post, currentBody, currentCta, strategist, lastJudge, maxRounds, totalCost, "NEEDS_HUMAN", reason);
  return {
    postId: post.id,
    status: "NEEDS_HUMAN",
    rounds: maxRounds,
    finalScore: lastJudge?.total_score ?? null,
    costUsd: totalCost,
    body: currentBody || null,
    reason,
  };
}

async function finalize(
  post: PlannedPost,
  body: string,
  cta: string,
  strategist: StrategistOutput | null,
  judge: JudgeOutput | null,
  rounds: number,
  cost: number,
  status: "APPROVED" | "NEEDS_HUMAN",
  reason?: string,
) {
  await sql`
    update posts set
      status = ${status},
      body = ${body},
      cta_text = ${cta},
      char_count = ${body.length},
      length_bucket = ${lengthBucket(body.length)},
      target_problem = ${strategist?.target_problem ?? null},
      goal = ${strategist?.goal ?? null},
      judge_score = ${judge?.total_score ?? null},
      debate_rounds = ${rounds},
      ai_cost_usd = ${cost},
      failure_reason = ${reason ?? null},
      updated_at = now()
    where id = ${post.id}
  `;
}
