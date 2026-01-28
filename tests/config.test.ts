import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("loads default values when env vars are not set", () => {
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
});
