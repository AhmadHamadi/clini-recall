export interface Config {
  port: number;
  host: string;
  nodeEnv: "development" | "production" | "test";
  jwt: {
    secret: string;
    expiresInSeconds: number;
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  return value;
}

function parseNodeEnv(value: string): Config["nodeEnv"] {
  if (value === "production" || value === "development" || value === "test") {
    return value;
  }
  throw new Error(
    `Invalid NODE_ENV: ${value}. Must be development, production, or test.`
  );
}

// Maximum allowed JWT TTL: 7 days
const MAX_JWT_TTL_SECONDS = 7 * 24 * 3600;

function parseExpiresIn(value: string): number {
  const match = value.match(/^(\d+)([smhd])$/);
  let seconds: number;

  if (!match) {
    seconds = parseInt(value, 10) || 28800; // default 8h
  } else {
    const num = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case "s":
        seconds = num;
        break;
      case "m":
        seconds = num * 60;
        break;
      case "h":
        seconds = num * 3600;
        break;
      case "d":
        seconds = num * 86400;
        break;
      default:
        seconds = 28800;
    }
  }

  // Cap at maximum to prevent accidental never-expiring tokens
  if (seconds > MAX_JWT_TTL_SECONDS) {
    throw new Error(
      `JWT_EXPIRES_IN exceeds maximum of 7 days (${MAX_JWT_TTL_SECONDS}s). Got: ${seconds}s`
    );
  }

  return seconds;
}

export function loadConfig(): Config {
  const nodeEnv = parseNodeEnv(optionalEnv("NODE_ENV", "development"));

  return {
    port: parseInt(optionalEnv("PORT", "3000"), 10),
    host: optionalEnv("HOST", "0.0.0.0"),
    nodeEnv,
    jwt: {
      secret: requireEnv("JWT_SECRET"),
      expiresInSeconds: parseExpiresIn(optionalEnv("JWT_EXPIRES_IN", "8h")),
    },
  };
}
