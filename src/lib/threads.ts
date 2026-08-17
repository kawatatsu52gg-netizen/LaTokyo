import { sql } from "./db";
import { env } from "./env";

/**
 * Threads API client.
 *
 * Scope of what this can and cannot do is the single biggest constraint on the
 * whole system — see docs/DESIGN.md §7. In short: per-post views/likes/replies/
 * reposts/quotes/shares are available; per-post profile visits, follows, and
 * link clicks are not, and are covered by attribution.ts and the /r redirector.
 */

const GRAPH = "https://graph.threads.net";
const API = `${GRAPH}/v1.0`;

export const THREADS_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_insights",
  "threads_manage_replies",
].join(",");

export class ThreadsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ThreadsError";
  }
}

export interface ThreadsAuth {
  user_id: string;
  username: string | null;
  access_token: string;
  expires_at: string | null;
}

export async function getAuth(): Promise<ThreadsAuth | null> {
  const rows = await sql<ThreadsAuth[]>`
    select user_id, username, access_token, expires_at::text
    from threads_auth where id = 1
  `;
  const a = rows[0];
  if (!a?.access_token || !a.user_id) return null;
  return a;
}

export function authorizeUrl(state: string): string {
  const u = new URL("https://threads.net/oauth/authorize");
  u.searchParams.set("client_id", env.threadsAppId);
  u.searchParams.set("redirect_uri", env.threadsRedirectUri);
  u.searchParams.set("scope", THREADS_SCOPES);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  return u.toString();
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail =
      typeof body === "object" && body && "error" in body
        ? JSON.stringify((body as { error: unknown }).error)
        : text.slice(0, 500);
    throw new ThreadsError(`Threads API ${res.status}: ${detail}`, res.status, body);
  }
  return body as T;
}

/** Exchange the OAuth code for a short-lived token, then upgrade to long-lived. */
export async function exchangeCode(code: string): Promise<ThreadsAuth> {
  const form = new URLSearchParams({
    client_id: env.threadsAppId,
    client_secret: env.threadsAppSecret,
    grant_type: "authorization_code",
    redirect_uri: env.threadsRedirectUri,
    code,
  });
  const short = await call<{ access_token: string; user_id: string | number }>(
    `${GRAPH}/oauth/access_token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
  );

  const longUrl = new URL(`${GRAPH}/access_token`);
  longUrl.searchParams.set("grant_type", "th_exchange_token");
  longUrl.searchParams.set("client_secret", env.threadsAppSecret);
  longUrl.searchParams.set("access_token", short.access_token);
  const long = await call<{ access_token: string; expires_in: number }>(longUrl.toString());

  const userId = String(short.user_id);
  const expiresAt = new Date(Date.now() + long.expires_in * 1000);

  let username: string | null = null;
  try {
    const me = await call<{ username?: string }>(
      `${API}/me?fields=id,username&access_token=${encodeURIComponent(long.access_token)}`,
    );
    username = me.username ?? null;
  } catch {
    // username is cosmetic; a failure here must not block the auth flow
  }

  await sql`
    insert into threads_auth (id, user_id, username, access_token, expires_at, updated_at)
    values (1, ${userId}, ${username}, ${long.access_token}, ${expiresAt}, now())
    on conflict (id) do update set
      user_id = excluded.user_id, username = excluded.username,
      access_token = excluded.access_token, expires_at = excluded.expires_at,
      updated_at = now()
  `;
  return { user_id: userId, username, access_token: long.access_token, expires_at: expiresAt.toISOString() };
}

/** Long-lived tokens last 60 days; refresh when under 10 days remain. */
export async function refreshIfNeeded(): Promise<void> {
  const auth = await getAuth();
  if (!auth?.expires_at) return;
  const remainingDays = (new Date(auth.expires_at).getTime() - Date.now()) / 86_400_000;
  if (remainingDays > 10) return;

  const u = new URL(`${GRAPH}/refresh_access_token`);
  u.searchParams.set("grant_type", "th_refresh_token");
  u.searchParams.set("access_token", auth.access_token);
  const r = await call<{ access_token: string; expires_in: number }>(u.toString());
  await sql`
    update threads_auth set
      access_token = ${r.access_token},
      expires_at = ${new Date(Date.now() + r.expires_in * 1000)},
      updated_at = now()
    where id = 1
  `;
}

/** Two-step publish: create a text container, then publish it. */
export async function publishText(text: string): Promise<{ mediaId: string; permalink: string | null }> {
  const auth = await getAuth();
  if (!auth) throw new ThreadsError("Threads is not connected. Visit /api/threads/auth first.");

  const createUrl = new URL(`${API}/${auth.user_id}/threads`);
  createUrl.searchParams.set("media_type", "TEXT");
  createUrl.searchParams.set("text", text);
  createUrl.searchParams.set("access_token", auth.access_token);
  const container = await call<{ id: string }>(createUrl.toString(), { method: "POST" });

  // The container needs a moment to become publishable.
  await new Promise((r) => setTimeout(r, 3000));

  const pubUrl = new URL(`${API}/${auth.user_id}/threads_publish`);
  pubUrl.searchParams.set("creation_id", container.id);
  pubUrl.searchParams.set("access_token", auth.access_token);
  const published = await call<{ id: string }>(pubUrl.toString(), { method: "POST" });

  let permalink: string | null = null;
  try {
    const meta = await call<{ permalink?: string }>(
      `${API}/${published.id}?fields=permalink&access_token=${encodeURIComponent(auth.access_token)}`,
    );
    permalink = meta.permalink ?? null;
  } catch {
    // permalink is cosmetic
  }
  return { mediaId: published.id, permalink };
}

export interface MediaInsights {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  shares: number;
}

const MEDIA_METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares"];

interface InsightsResponse {
  data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[];
}

function flatten(res: InsightsResponse): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of res.data ?? []) {
    const v = d.total_value?.value ?? d.values?.[0]?.value ?? 0;
    out[d.name] = Number(v) || 0;
  }
  return out;
}

export async function fetchMediaInsights(mediaId: string): Promise<MediaInsights> {
  const auth = await getAuth();
  if (!auth) throw new ThreadsError("Threads is not connected.");
  const u = new URL(`${API}/${mediaId}/insights`);
  u.searchParams.set("metric", MEDIA_METRICS.join(","));
  u.searchParams.set("access_token", auth.access_token);
  const m = flatten(await call<InsightsResponse>(u.toString()));
  return {
    views: m.views ?? 0,
    likes: m.likes ?? 0,
    replies: m.replies ?? 0,
    reposts: m.reposts ?? 0,
    quotes: m.quotes ?? 0,
    shares: m.shares ?? 0,
  };
}

export interface AccountInsights {
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  followers_total: number | null;
}

/**
 * Account-level insights for a day. This is the only source of profile-visit
 * and follower data, and it is not attributable to individual posts — hence
 * the estimation step in attribution.ts.
 */
export async function fetchAccountInsights(sinceMs: number, untilMs: number): Promise<AccountInsights> {
  const auth = await getAuth();
  if (!auth) throw new ThreadsError("Threads is not connected.");
  const u = new URL(`${API}/${auth.user_id}/threads_insights`);
  u.searchParams.set("metric", "views,likes,replies,reposts,quotes,followers_count");
  u.searchParams.set("since", String(Math.floor(sinceMs / 1000)));
  u.searchParams.set("until", String(Math.floor(untilMs / 1000)));
  u.searchParams.set("access_token", auth.access_token);
  const m = flatten(await call<InsightsResponse>(u.toString()));
  return {
    views: m.views ?? null,
    likes: m.likes ?? null,
    replies: m.replies ?? null,
    reposts: m.reposts ?? null,
    quotes: m.quotes ?? null,
    followers_total: m.followers_count ?? null,
  };
}

/** Remaining posts in the rolling 24h window (limit is 250). */
export async function publishingLimit(): Promise<{ used: number; total: number }> {
  const auth = await getAuth();
  if (!auth) throw new ThreadsError("Threads is not connected.");
  const u = new URL(`${API}/${auth.user_id}/threads_publishing_limit`);
  u.searchParams.set("fields", "quota_usage,config");
  u.searchParams.set("access_token", auth.access_token);
  const r = await call<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
    u.toString(),
  );
  const d = r.data?.[0];
  return { used: d?.quota_usage ?? 0, total: d?.config?.quota_total ?? 250 };
}
