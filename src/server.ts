import Fastify from "fastify";
import type { Config } from "./config.js";
import { healthRoutes } from "./routes/health.js";

export function buildServer(config: Config) {
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

  app.register(healthRoutes);

  return app;
}
