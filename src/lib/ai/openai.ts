import OpenAI from "openai";
import { env } from "../env";
import { computeCost } from "./cost";
import { LlmError, type LlmResult } from "./types";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!env.openaiKey) throw new LlmError("OPENAI_API_KEY is not set", "openai", "-");
  client ??= new OpenAI({ apiKey: env.openaiKey, maxRetries: 2, timeout: 180_000 });
  return client;
}

/**
 * Structured JSON output with a hard schema. We use `json_schema` with
 * `strict: true` so the model physically cannot return a shape the pipeline
 * can't parse — a malformed draft at 03:30 with nobody watching is a silent
 * missed post, not a visible error.
 */
export async function openaiJson<T>(opts: {
  model?: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens?: number;
}): Promise<LlmResult<T>> {
  const model = opts.model ?? env.openaiModel;
  const started = Date.now();
  try {
    const res = await getClient().chat.completions.create({
      model,
      max_completion_tokens: opts.maxTokens ?? 4000,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
      },
    });

    const text = res.choices[0]?.message?.content;
    if (!text) throw new LlmError("Empty response from OpenAI", "openai", model);

    const usage = res.usage;
    const inputTokens = usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? 0;
    const cachedInputTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;

    return {
      data: JSON.parse(text) as T,
      call: {
        provider: "openai",
        model,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        costUsd: computeCost(model, inputTokens, outputTokens, cachedInputTokens),
        latencyMs: Date.now() - started,
      },
    };
  } catch (e) {
    if (e instanceof LlmError) throw e;
    throw new LlmError(
      `OpenAI call failed: ${e instanceof Error ? e.message : String(e)}`,
      "openai",
      model,
      e,
    );
  }
}
