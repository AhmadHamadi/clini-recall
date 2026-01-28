import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/server.js";
import type { FastifyInstance } from "fastify";

describe("GET /health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Build server without pool (health check only)
    app = buildServer({
      port: 3000,
      host: "0.0.0.0",
      nodeEnv: "test",
      jwt: {
        secret: "test-secret",
        expiresInSeconds: 3600,
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns status ok with 200", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
