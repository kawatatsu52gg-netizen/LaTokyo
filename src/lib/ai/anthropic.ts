import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import { computeCost } from "./cost";
import { LlmError, type LlmResult } from "./types";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!env.anthropicKey) throw new LlmError("ANTHROPIC_API_KEY is not set", "anthropic", "-");
  client ??= new Anthropic({ apiKey: env.anthropicKey, maxRetries: 2, timeout: 600_000 });
  return client;
}

/**
 * Structured JSON output via `output_config.format`. Streaming is on because
 * critique and judging run at high effort and can exceed the non-streaming
 * timeout on a long post history.
 */
export async function anthropicJson<T>(opts: {
  model?: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}): Promise<LlmResult<T>> {
  const model = opts.model ?? env.anthropicModel;
  const started = Date.now();
  try {
    const stream = getClient().messages.stream({
      model,
      max_tokens: opts.maxTokens ?? 8000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: opts.effort ?? "high",
        format: { type: "json_schema", schema: opts.schema },
      },
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: opts.user }],
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new LlmError("Anthropic declined the request", "anthropic", model);
    }

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new LlmError("No text block in Anthropic response", "anthropic", model);
    }

    const inputTokens = message.usage.input_tokens ?? 0;
    const outputTokens = message.usage.output_tokens ?? 0;
    const cachedInputTokens = message.usage.cache_read_input_tokens ?? 0;

    return {
      data: JSON.parse(textBlock.text) as T,
      call: {
        provider: "anthropic",
        model,
        inputTokens: inputTokens + cachedInputTokens,
        outputTokens,
        cachedInputTokens,
        costUsd: computeCost(model, inputTokens + cachedInputTokens, outputTokens, cachedInputTokens),
        latencyMs: Date.now() - started,
      },
    };
  } catch (e) {
    if (e instanceof LlmError) throw e;
    throw new LlmError(
      `Anthropic call failed: ${e instanceof Error ? e.message : String(e)}`,
      "anthropic",
      model,
      e,
    );
  }
}
