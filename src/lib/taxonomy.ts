export const THEMES = ["acquisition", "retention", "revenue", "ai", "honest"] as const;
export type Theme = (typeof THEMES)[number];

export const FORMATS = [
  "paradox",
  "diagnostic",
  "question",
  "number",
  "failure",
  "experience",
  "howto",
  "problem",
  "before_after",
  "ai_use",
  "owner_relatable",
  "strong_opinion",
] as const;
export type Format = (typeof FORMATS)[number];

export const HOOK_TYPES = [
  "contrarian",
  "empathy",
  "number_shock",
  "question_open",
  "confession",
  "callout",
  "scene",
  "warning",
] as const;
export type HookType = (typeof HOOK_TYPES)[number];

export const CTA_TYPES = ["none", "question", "reply_prompt", "profile", "link", "dm"] as const;
export type CtaType = (typeof CTA_TYPES)[number];

export const LENGTH_BUCKETS = ["s", "m", "l", "xl"] as const;
export type LengthBucket = (typeof LENGTH_BUCKETS)[number];

export const DEFAULT_SLOTS = ["06:30", "08:30", "10:30", "12:30", "15:30", "21:30"] as const;

export const DEFAULT_THEME_MIX: Record<Theme, number> = {
  acquisition: 0.4,
  retention: 0.25,
  revenue: 0.15,
  ai: 0.1,
  honest: 0.1,
};

export const LABELS_JA: Record<string, string> = {
  acquisition: "集客",
  retention: "リピート",
  revenue: "売上・数字",
  ai: "AI活用",
  honest: "経営者の本音",

  paradox: "逆説型",
  diagnostic: "診断型",
  question: "質問型",
  number: "数字型",
  failure: "失敗談型",
  experience: "実体験型",
  howto: "ノウハウ型",
  problem: "問題提起型",
  before_after: "Before/After型",
  ai_use: "AI活用型",
  owner_relatable: "あるある型",
  strong_opinion: "強い意見型",

  contrarian: "逆張り",
  empathy: "共感",
  number_shock: "数字インパクト",
  question_open: "問いかけ",
  confession: "告白",
  callout: "名指し",
  scene: "情景",
  warning: "警告",

  none: "CTAなし",
  reply_prompt: "返信誘導",
  profile: "プロフ誘導",
  link: "リンク",
  dm: "DM誘導",

  s: "〜80字",
  m: "81-150字",
  l: "151-300字",
  xl: "301字〜",
};

export const ja = (v: string | null | undefined) => (v ? (LABELS_JA[v] ?? v) : "—");

export function lengthBucket(chars: number): LengthBucket {
  if (chars <= 80) return "s";
  if (chars <= 150) return "m";
  if (chars <= 300) return "l";
  return "xl";
}

export function armKey(p: {
  theme: string;
  format: string;
  hook_type: string;
  jst_slot: string;
  length_bucket: string;
}): string {
  return [p.theme, p.format, p.hook_type, p.jst_slot, p.length_bucket].join("|");
}
