import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/server.js";
import type { FastifyInstance } from "fastify";

describe("GET /health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer({
      port: 3000,
      host: "0.0.0.0",
      nodeEnv: "test",
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
