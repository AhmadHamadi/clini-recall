import Fastify from "fastify";
import type { Config } from "./config.js";
import type { Pool } from "./db/pool.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { adminRoutes } from "./routes/admin.js";

export function buildServer(config: Config, pool?: Pool) {
  const app = Fastify({
    logger:
      config.nodeEnv === "production"
        ? true
        : {
            transport: {
              target: "pino-pretty",
              options: { colorize: true },
            },
          },
  });

  // Health check (no auth, no db required)
  app.register(healthRoutes);

  // Routes requiring database
  if (pool) {
    const jwtConfig = {
      secret: config.jwt.secret,
      expiresInSeconds: config.jwt.expiresInSeconds,
    };

    app.register(async (instance) => {
      await authRoutes(instance, pool, jwtConfig);
    });

    app.register(async (instance) => {
      await meRoutes(instance, pool, jwtConfig);
    });

    app.register(async (instance) => {
      await adminRoutes(instance, pool, jwtConfig);
    });
  }

  return app;
}
