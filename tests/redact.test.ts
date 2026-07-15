import { describe, expect, it } from "vitest";
import { redact } from "@/lib/redact";

describe("redact (log/notification masking)", () => {
  it("masks tokens and secrets", () => {
    const out = redact({
      accessToken: "sq0atp-super-secret",
      refresh_token: "rt-secret",
      nested: { authorization: "Bearer abc" },
    }) as Record<string, any>;
    expect(out.accessToken).not.toContain("super-secret");
    expect(out.refresh_token).not.toContain("secret");
    expect(out.nested.authorization).not.toContain("abc");
  });

  it("masks customer PII but keeps a name initial for audit", () => {
    const out = redact({
      customerName: "山田太郎",
      customerEmail: "taro@example.com",
      customerPhone: "09012345678",
    }) as Record<string, any>;
    expect(out.customerName).toBe("山***");
    expect(out.customerEmail).not.toContain("taro@example.com");
    expect(out.customerPhone).not.toContain("09012345678");
  });

  it("preserves non-sensitive fields", () => {
    const out = redact({
      startAt: "2026-07-14T06:00:00Z",
      serviceId: "svc_1",
      status: "confirmed",
    }) as Record<string, any>;
    expect(out.startAt).toBe("2026-07-14T06:00:00Z");
    expect(out.serviceId).toBe("svc_1");
    expect(out.status).toBe("confirmed");
  });
});
