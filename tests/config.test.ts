import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // JWT_SECRET is required
    process.env.JWT_SECRET = "test-secret-key-for-testing-only";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("loads default values when optional env vars are not set", () => {
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.NODE_ENV;

    const config = loadConfig();

    expect(config.port).toBe(3000);
    expect(config.host).toBe("0.0.0.0");
    expect(config.nodeEnv).toBe("development");
  });

  it("loads values from environment variables", () => {
    process.env.PORT = "8080";
    process.env.HOST = "127.0.0.1";
    process.env.NODE_ENV = "production";

    const config = loadConfig();

    expect(config.port).toBe(8080);
    expect(config.host).toBe("127.0.0.1");
    expect(config.nodeEnv).toBe("production");
  });

  it("throws on invalid NODE_ENV", () => {
    process.env.NODE_ENV = "invalid";

    expect(() => loadConfig()).toThrow("Invalid NODE_ENV");
  });

  it("accepts test as NODE_ENV", () => {
    process.env.NODE_ENV = "test";

    const config = loadConfig();

    expect(config.nodeEnv).toBe("test");
  });

  it("throws when JWT_SECRET is missing", () => {
    delete process.env.JWT_SECRET;

    expect(() => loadConfig()).toThrow(
      "Missing required environment variable: JWT_SECRET"
    );
  });

  it("parses JWT_EXPIRES_IN with time units", () => {
    process.env.JWT_EXPIRES_IN = "2h";

    const config = loadConfig();

    expect(config.jwt.expiresInSeconds).toBe(7200);
  });

  it("parses JWT_EXPIRES_IN in days", () => {
    process.env.JWT_EXPIRES_IN = "7d";

    const config = loadConfig();

    expect(config.jwt.expiresInSeconds).toBe(604800);
  });

  it("throws when JWT_EXPIRES_IN exceeds 7 day maximum", () => {
    process.env.JWT_EXPIRES_IN = "8d";

    expect(() => loadConfig()).toThrow(
      "JWT_EXPIRES_IN exceeds maximum of 7 days"
    );
  });

  it("throws when JWT_EXPIRES_IN in seconds exceeds maximum", () => {
    process.env.JWT_EXPIRES_IN = "700000"; // > 604800 seconds

    expect(() => loadConfig()).toThrow(
      "JWT_EXPIRES_IN exceeds maximum of 7 days"
    );
  });
});
