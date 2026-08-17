/**
 * JSON Schemas for every agent output.
 *
 * OpenAI strict mode requires: every property listed in `required`,
 * `additionalProperties: false` on every object, and no validation keywords
 * beyond type/enum/items/properties. Anthropic accepts the same shapes, so one
 * schema serves both providers.
 */

import { CTA_TYPES, FORMATS, HOOK_TYPES, THEMES } from "../taxonomy";

const str = { type: "string" } as const;
const num = { type: "number" } as const;
const bool = { type: "boolean" } as const;
const strArray = { type: "array", items: str } as const;

export const strategistSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "target_problem",
    "theme",
    "format",
    "hook_type",
    "cta_type",
    "hypothesis",
    "goal",
    "post_text",
    "cta",
    "reason",
  ],
  properties: {
    target_problem: { ...str, description: "誰のどんな悩みに刺すのか。1文。" },
    theme: { type: "string", enum: [...THEMES] },
    format: { type: "string", enum: [...FORMATS] },
    hook_type: { type: "string", enum: [...HOOK_TYPES] },
    cta_type: { type: "string", enum: [...CTA_TYPES] },
    hypothesis: { ...str, description: "この投稿で検証したいこと" },
    goal: { ...str, description: "この投稿で起こしたい読者の行動" },
    post_text: { ...str, description: "Threadsにそのまま投稿する本文" },
    cta: { ...str, description: "最後の一行（問い or 誘導）。本文に含まれている場合も再掲。" },
    reason: { ...str, description: "なぜこの構成にしたか。2文以内。" },
  },
} as const;

export interface StrategistOutput {
  target_problem: string;
  theme: string;
  format: string;
  hook_type: string;
  cta_type: string;
  hypothesis: string;
  goal: string;
  post_text: string;
  cta: string;
  reason: string;
}

const issueItem = {
  type: "object",
  additionalProperties: false,
  required: ["id", "axis", "issue", "why_it_matters"],
  properties: {
    id: { ...str, description: "C1, C2... の連番。Integratorが参照する。" },
    axis: {
      type: "string",
      enum: [
        "target_fit",
        "hook_strength",
        "self_relevance",
        "threads_native",
        "promotional_smell",
        "reply_trigger",
        "profile_pull",
        "originality",
        "duplication",
        "ai_tone",
        "risk",
        "cvr",
      ],
    },
    issue: str,
    why_it_matters: str,
  },
} as const;

export const criticSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "critical_issues",
    "minor_issues",
    "improvement_suggestions",
    "alternative_hook",
    "duplicate_of_post_id",
    "overall_read",
  ],
  properties: {
    critical_issues: { type: "array", items: issueItem },
    minor_issues: { type: "array", items: issueItem },
    improvement_suggestions: strArray,
    alternative_hook: { ...str, description: "1行目の代案。1つだけ。" },
    duplicate_of_post_id: {
      type: ["string", "null"],
      description: "過去投稿と実質同じならそのID。違えば null。",
    },
    overall_read: { ...str, description: "この投稿の一番の問題を1文で。" },
  },
} as const;

export interface CriticIssue {
  id: string;
  axis: string;
  issue: string;
  why_it_matters: string;
}
export interface CriticOutput {
  critical_issues: CriticIssue[];
  minor_issues: CriticIssue[];
  improvement_suggestions: string[];
  alternative_hook: string;
  duplicate_of_post_id: string | null;
  overall_read: string;
}

export const integratorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decisions", "post_text", "cta", "changes_made"],
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["issue_ref", "verdict", "reason"],
        properties: {
          issue_ref: { ...str, description: "CriticのissueのID" },
          verdict: { type: "string", enum: ["ACCEPT", "PARTIAL_ACCEPT", "REJECT"] },
          reason: { ...str, description: "1文で。" },
        },
      },
    },
    post_text: { ...str, description: "改善した第2案の本文" },
    cta: str,
    changes_made: strArray,
  },
} as const;

export interface IntegratorOutput {
  decisions: { issue_ref: string; verdict: string; reason: string }[];
  post_text: string;
  cta: string;
  changes_made: string[];
}

export const challengerSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "remaining_concerns",
    "stronger_hook_candidate",
    "logic_problems",
    "cta_naturalness",
    "reply_barrier",
    "profile_pull",
    "expert_posturing",
    "sales_smell",
    "verdict",
    "revise_reason",
  ],
  properties: {
    remaining_concerns: strArray,
    stronger_hook_candidate: {
      type: ["string", "null"],
      description: "本当により強い案がある場合のみ。無ければ null。",
    },
    logic_problems: strArray,
    cta_naturalness: { type: "string", enum: ["natural", "slightly_forced", "forced"] },
    reply_barrier: { type: "string", enum: ["low", "medium", "high"] },
    profile_pull: { type: "string", enum: ["strong", "some", "none"] },
    expert_posturing: bool,
    sales_smell: bool,
    verdict: { type: "string", enum: ["ship", "revise"] },
    revise_reason: { type: ["string", "null"] },
  },
} as const;

export interface ChallengerOutput {
  remaining_concerns: string[];
  stronger_hook_candidate: string | null;
  logic_problems: string[];
  cta_naturalness: string;
  reply_barrier: string;
  profile_pull: string;
  expert_posturing: boolean;
  sales_smell: boolean;
  verdict: "ship" | "revise";
  revise_reason: string | null;
}

export const judgeSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "hook",
    "target_fit",
    "empathy",
    "reply_probability",
    "originality",
    "profile_visit_probability",
    "naturalness",
    "total_score",
    "approved",
    "major_issue",
    "unresolved_issues",
    "confidence",
    "rationale",
  ],
  properties: {
    hook: { ...num, description: "0-20" },
    target_fit: { ...num, description: "0-15" },
    empathy: { ...num, description: "0-15" },
    reply_probability: { ...num, description: "0-20" },
    originality: { ...num, description: "0-10" },
    profile_visit_probability: { ...num, description: "0-10" },
    naturalness: { ...num, description: "0-10" },
    total_score: { ...num, description: "上記7項目の合計。0-100。" },
    approved: { ...bool, description: "total_score >= 85 かつ major_issue が false" },
    major_issue: { ...bool, description: "炎上・信頼毀損・事実誤認・強い宣伝臭のいずれかがある" },
    unresolved_issues: strArray,
    confidence: { ...num, description: "0.0-1.0" },
    rationale: { ...str, description: "点数の根拠。3文以内。" },
  },
} as const;

export interface JudgeOutput {
  hook: number;
  target_fit: number;
  empathy: number;
  reply_probability: number;
  originality: number;
  profile_visit_probability: number;
  naturalness: number;
  total_score: number;
  approved: boolean;
  major_issue: boolean;
  unresolved_issues: string[];
  confidence: number;
  rationale: string;
}

export const weeklySchema = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "not_working", "next_actions", "next_experiments", "theme_mix_advice", "report_md"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "evidence", "confidence"],
        properties: {
          statement: { ...str, description: "わかったこと。必ず数値の裏付けを含める。" },
          evidence: str,
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    not_working: strArray,
    next_actions: strArray,
    next_experiments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "dimension", "target_value"],
        properties: {
          statement: str,
          dimension: {
            type: "string",
            enum: ["theme", "format", "hook_type", "slot", "length_bucket", "cta_type", "combo"],
          },
          target_value: str,
        },
      },
    },
    theme_mix_advice: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["theme", "direction", "reason"],
        properties: {
          theme: { type: "string", enum: [...THEMES] },
          direction: { type: "string", enum: ["increase", "keep", "decrease"] },
          reason: str,
        },
      },
    },
    report_md: { ...str, description: "人間が読む週次レポート本文（Markdown）" },
  },
} as const;

export interface WeeklyOutput {
  findings: { statement: string; evidence: string; confidence: string }[];
  not_working: string[];
  next_actions: string[];
  next_experiments: { statement: string; dimension: string; target_value: string }[];
  theme_mix_advice: { theme: string; direction: string; reason: string }[];
  report_md: string;
}
