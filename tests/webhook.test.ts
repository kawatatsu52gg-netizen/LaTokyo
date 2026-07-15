import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifySquareSignature } from "@/lib/square/webhook";

const KEY = "test-signature-key";
const URL = "https://example.com/api/webhooks/square";

function sign(body: string): string {
  return createHmac("sha256", KEY).update(URL + body).digest("base64");
}

describe("Square webhook signature verification", () => {
  const body = JSON.stringify({ type: "booking.created", event_id: "evt_1" });

  it("accepts a valid signature", () => {
    expect(
      verifySquareSignature({
        rawBody: body,
        signatureHeader: sign(body),
        signatureKey: KEY,
        notificationUrl: URL,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(
      verifySquareSignature({
        rawBody: body + " ",
        signatureHeader: sign(body),
        signatureKey: KEY,
        notificationUrl: URL,
      }),
    ).toBe(false);
  });

  it("rejects a wrong key", () => {
    expect(
      verifySquareSignature({
        rawBody: body,
        signatureHeader: sign(body),
        signatureKey: "other-key",
        notificationUrl: URL,
      }),
    ).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(
      verifySquareSignature({
        rawBody: body,
        signatureHeader: null,
        signatureKey: KEY,
        notificationUrl: URL,
      }),
    ).toBe(false);
  });
});
