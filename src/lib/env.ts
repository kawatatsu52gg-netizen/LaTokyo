function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export const env = {
  get databaseUrl() {
    return req("DATABASE_URL");
  },
  get appPassword() {
    return req("APP_PASSWORD");
  },
  get sessionSecret() {
    return req("SESSION_SECRET");
  },
  get cronSecret() {
    return req("CRON_SECRET");
  },
  appUrl: opt("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),

  openaiKey: opt("OPENAI_API_KEY"),
  anthropicKey: opt("ANTHROPIC_API_KEY"),
  openaiModel: opt("OPENAI_MODEL", "gpt-5.1"),
  anthropicModel: opt("ANTHROPIC_MODEL", "claude-opus-5"),
  anthropicJudgeModel: opt("ANTHROPIC_JUDGE_MODEL", "claude-opus-5"),
  maxDebateRounds: Number(opt("MAX_DEBATE_ROUNDS", "3")),
  maxCostPerPostUsd: Number(opt("MAX_COST_PER_POST_USD", "0.60")),

  threadsAppId: opt("THREADS_APP_ID"),
  threadsAppSecret: opt("THREADS_APP_SECRET"),
  threadsRedirectUri: opt(
    "THREADS_REDIRECT_URI",
    `${opt("NEXT_PUBLIC_APP_URL", "http://localhost:3000")}/api/threads/callback`,
  ),

  linkDestinationDefault: opt("LINK_DESTINATION_DEFAULT"),
};

export const aiEnabled = () => Boolean(env.openaiKey && env.anthropicKey);
export const threadsEnabled = () => Boolean(env.threadsAppId && env.threadsAppSecret);
