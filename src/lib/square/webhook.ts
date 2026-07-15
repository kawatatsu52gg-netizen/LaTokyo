import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Square Webhook 署名検証。
 *
 * Squareは HMAC-SHA256( key = signatureKey, message = notificationUrl + rawBody )
 * を base64 で返し、`x-square-hmacsha256-signature` ヘッダに載せる。
 *
 * 重要:
 *  - rawBody は「受信した生バイト列」を使う（再シリアライズしない）。
 *  - notificationUrl は Dashboard に登録したURLと完全一致させる。
 */
export function verifySquareSignature(params: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  signatureKey: string;
  notificationUrl: string;
}): boolean {
  const { rawBody, signatureHeader, signatureKey, notificationUrl } = params;
  if (!signatureHeader || !signatureKey) return false;

  const hmac = createHmac("sha256", signatureKey);
  hmac.update(notificationUrl + rawBody);
  const expected = hmac.digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const SQUARE_SIGNATURE_HEADER = "x-square-hmacsha256-signature";
