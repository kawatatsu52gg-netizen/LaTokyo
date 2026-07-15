/**
 * ログ/通知に平文の機密（トークン・個人情報）を残さないためのマスキング。
 * sync_logs へ保存する requestPayload / responsePayload は必ずこれを通す。
 */

const SENSITIVE_KEYS = [
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "authorization",
  "signature",
  "encryptedAccessToken",
  "token",
  "secret",
  "password",
  "customerPhone",
  "customerEmail",
  "phone",
  "email",
  "emailAddress",
  "phoneNumber",
];

// 姓名は完全には消さず、頭一文字＋伏字（監査で追える最小限）
const NAME_KEYS = ["customerName", "name", "givenName", "familyName"];

function maskString(v: string): string {
  if (v.length <= 2) return "*".repeat(v.length);
  return v[0] + "*".repeat(Math.max(1, v.length - 2)) + v[v.length - 1];
}

function maskName(v: string): string {
  if (!v) return v;
  return v[0] + "***";
}

export function redact(input: unknown): unknown {
  if (input == null) return input;
  if (typeof input === "string") return input;
  if (Array.isArray(input)) return input.map(redact);
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(input as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (SENSITIVE_KEYS.some((s) => lower.includes(s.toLowerCase()))) {
        out[k] = typeof val === "string" ? maskString(val) : "[REDACTED]";
      } else if (NAME_KEYS.includes(k) && typeof val === "string") {
        out[k] = maskName(val);
      } else {
        out[k] = redact(val);
      }
    }
    return out;
  }
  return input;
}
