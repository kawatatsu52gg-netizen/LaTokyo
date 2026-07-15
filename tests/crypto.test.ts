import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt } from "@/lib/crypto";

describe("crypto (AES-256-GCM)", () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips a token", () => {
    const secret = "sq0atp-EXAMPLE-access-token";
    const enc = encrypt(secret);
    expect(enc).not.toContain(secret);
    expect(decrypt(enc)).toBe(secret);
  });

  it("produces different ciphertext each time (random IV)", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("fails to decrypt tampered ciphertext", () => {
    const enc = encrypt("value");
    const parts = enc.split(".");
    const tampered = [parts[0], parts[1], Buffer.from("xxxx").toString("base64")].join(".");
    expect(() => decrypt(tampered)).toThrow();
  });
});
