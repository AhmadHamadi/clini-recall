import { describe, it, expect } from "vitest";
import { createJwt, verifyJwt } from "../src/auth/jwt.js";

describe("JWT", () => {
  const config = {
    secret: "test-secret-key-minimum-32-chars-long",
    expiresInSeconds: 3600,
  };

  it("creates and verifies a valid token", () => {
    const payload = {
      sub: "user-123",
      clinicId: "clinic-456",
      role: "clinic_admin",
      isPlatformAdmin: false,
    };

    const token = createJwt(payload, config);
    const verified = verifyJwt(token, config);

    expect(verified).not.toBeNull();
    expect(verified!.sub).toBe("user-123");
    expect(verified!.clinicId).toBe("clinic-456");
    expect(verified!.role).toBe("clinic_admin");
    expect(verified!.isPlatformAdmin).toBe(false);
  });

  it("rejects token with wrong secret", () => {
    const payload = {
      sub: "user-123",
      clinicId: "clinic-456",
      role: "clinic_admin",
      isPlatformAdmin: false,
    };

    const token = createJwt(payload, config);
    const verified = verifyJwt(token, {
      ...config,
      secret: "wrong-secret-key-that-is-different",
    });

    expect(verified).toBeNull();
  });

  it("rejects expired token", () => {
    const payload = {
      sub: "user-123",
      clinicId: "clinic-456",
      role: "clinic_admin",
      isPlatformAdmin: false,
    };

    const token = createJwt(payload, {
      ...config,
      expiresInSeconds: -1, // Already expired
    });

    const verified = verifyJwt(token, config);
    expect(verified).toBeNull();
  });

  it("rejects malformed token", () => {
    expect(verifyJwt("not.a.valid.token", config)).toBeNull();
    expect(verifyJwt("invalid", config)).toBeNull();
    expect(verifyJwt("", config)).toBeNull();
  });
});
