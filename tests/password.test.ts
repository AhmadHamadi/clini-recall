import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

describe("password", () => {
  it("hashes and verifies correct password", async () => {
    const password = "secure-password-123";
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash).toContain(":");

    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);
  });

  it("rejects incorrect password", async () => {
    const hash = await hashPassword("correct-password");
    const valid = await verifyPassword("wrong-password", hash);

    expect(valid).toBe(false);
  });

  it("produces different hashes for same password", async () => {
    const password = "same-password";
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);

    expect(hash1).not.toBe(hash2);

    // Both should verify
    expect(await verifyPassword(password, hash1)).toBe(true);
    expect(await verifyPassword(password, hash2)).toBe(true);
  });

  it("rejects malformed hash", async () => {
    const valid = await verifyPassword("password", "malformed-hash");
    expect(valid).toBe(false);
  });
});
