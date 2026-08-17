/**
 * Per-model pricing in USD per 1M tokens.
 *
 * Anthropic figures are the published list rates. OpenAI figures should be
 * checked against platform.openai.com/pricing for your account — they are here
 * so cost tracking has a number to work with, and every row is overridable via
 * the AI_PRICE_OVERRIDES env var (JSON: {"model":{"input":n,"output":n}}).
 *
 * Cost tracking exists to answer one operational question: is this system
 * spending more per post than the post is worth? Precision to the cent matters
 * less than the trend line.
 */
export interface Price {
  input: number;
  output: number;
  cachedInput?: number;
}

const BASE: Record<string, Price> = {
  // Anthropic (list rates, USD / 1M tokens)
  "claude-opus-5": { input: 5, output: 25, cachedInput: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cachedInput: 0.5 },
  "claude-sonnet-5": { input: 3, output: 15, cachedInput: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cachedInput: 0.1 },

  // OpenAI — verify against your account's pricing page
  "gpt-5.1": { input: 1.25, output: 10, cachedInput: 0.125 },
  "gpt-5": { input: 1.25, output: 10, cachedInput: 0.125 },
  "gpt-5-mini": { input: 0.25, output: 2, cachedInput: 0.025 },
  "gpt-4.1": { input: 2, output: 8, cachedInput: 0.5 },
};

function overrides(): Record<string, Price> {
  const raw = process.env.AI_PRICE_OVERRIDES;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, Price>;
  } catch {
    return {};
  }
}

/** Unknown models fall back to Opus-tier pricing so cost is over- not under-stated. */
const FALLBACK: Price = { input: 5, output: 25, cachedInput: 0.5 };

export function priceFor(model: string): Price {
  const o = overrides();
  if (o[model]) return o[model];
  if (BASE[model]) return BASE[model];
  const prefix = Object.keys(BASE).find((k) => model.startsWith(k));
  return prefix ? BASE[prefix] : FALLBACK;
}

export function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): number {
  const p = priceFor(model);
  const fresh = Math.max(0, inputTokens - cachedInputTokens);
  return (
    (fresh * p.input + cachedInputTokens * (p.cachedInput ?? p.input) + outputTokens * p.output) /
    1_000_000
  );
}
