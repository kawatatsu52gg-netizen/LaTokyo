export interface LlmCall {
  provider: "openai" | "anthropic";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface LlmResult<T> {
  data: T;
  call: LlmCall;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly model: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
