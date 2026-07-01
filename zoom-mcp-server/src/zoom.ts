/**
 * Zoom API client (Server-to-Server OAuth).
 *
 * - Access token is fetched via Basic-auth against zoom.us/oauth/token and
 *   cached in-memory for 50 minutes (token lifetime is ~1 hour).
 * - Meetings are created against api.zoom.us/v2/users/me/meetings.
 *
 * Secrets are read from environment variables only and are never logged.
 */

const OAUTH_URL = "https://zoom.us/oauth/token";
const API_BASE = "https://api.zoom.us/v2";

// Cache the token for 50 minutes even though it lives ~60, to leave headroom.
const TOKEN_TTL_MS = 50 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

let cache: CachedToken | null = null;

/** Raised when the Zoom API returns a non-2xx response. Carries the raw body. */
export class ZoomApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    context: string,
  ) {
    super(`Zoom API error (${context}): HTTP ${status}\n${body}`);
    this.name = "ZoomApiError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. .env を確認してください。`,
    );
  }
  return value;
}

/**
 * Get a valid Server-to-Server OAuth access token, using the in-memory cache
 * when it is still fresh.
 */
export async function getAccessToken(): Promise<string> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.token;
  }

  const accountId = requireEnv("ZOOM_ACCOUNT_ID");
  const clientId = requireEnv("ZOOM_CLIENT_ID");
  const clientSecret = requireEnv("ZOOM_CLIENT_SECRET");

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const url = `${OAUTH_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(
    accountId,
  )}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new ZoomApiError(res.status, text, "token");
  }

  const data = JSON.parse(text) as { access_token?: string };
  if (!data.access_token) {
    throw new ZoomApiError(res.status, text, "token: no access_token in body");
  }

  cache = { token: data.access_token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return data.access_token;
}

export interface CreateMeetingInput {
  start_time: string; // "YYYY-MM-DDTHH:mm:ss" — JST local time
  duration: number; // minutes
  topic: string;
}

export interface ZoomMeeting {
  id: number;
  join_url: string;
  start_url: string;
  password: string;
  start_time: string;
  duration: number;
  topic: string;
}

/** Create a scheduled (type 2) Zoom meeting in the Asia/Tokyo timezone. */
export async function createMeeting(
  input: CreateMeetingInput,
): Promise<ZoomMeeting> {
  const token = await getAccessToken();

  const body = {
    topic: input.topic,
    type: 2, // scheduled meeting
    start_time: input.start_time, // JST local time
    duration: input.duration,
    timezone: "Asia/Tokyo",
    settings: {
      host_video: true,
      participant_video: true,
      waiting_room: true,
      join_before_host: false,
      mute_upon_entry: true,
      approval_type: 2,
    },
  };

  const res = await fetch(`${API_BASE}/users/me/meetings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new ZoomApiError(res.status, text, "create meeting");
  }

  const data = JSON.parse(text) as {
    id: number;
    join_url: string;
    start_url: string;
    password?: string;
    start_time: string;
    duration: number;
    topic: string;
  };

  return {
    id: data.id,
    join_url: data.join_url,
    start_url: data.start_url,
    password: data.password ?? "",
    start_time: data.start_time,
    duration: data.duration,
    topic: data.topic,
  };
}
