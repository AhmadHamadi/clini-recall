import pg from "pg";
import fs from "fs";

const { Pool } = pg;

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: { rejectUnauthorized: boolean; ca?: string } | false;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadDbConfig(): DbConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const sslEnabled = process.env.DB_SSL === "true";

  let ssl: DbConfig["ssl"] = false;

  if (sslEnabled) {
    const caCert = process.env.DB_CA_CERT;

    if (nodeEnv === "production") {
      // Production: MUST verify CA certificate
      if (!caCert) {
        throw new Error(
          "DB_CA_CERT required in production when DB_SSL=true. " +
            "Set to file path or PEM content (starting with -----BEGIN CERTIFICATE-----)."
        );
      }
      ssl = {
        rejectUnauthorized: true,
        ca: caCert.startsWith("-----BEGIN")
          ? caCert
          : fs.readFileSync(caCert, "utf8"),
      };
    } else if (caCert) {
      // Development with CA: verify certificate
      ssl = {
        rejectUnauthorized: true,
        ca: caCert.startsWith("-----BEGIN")
          ? caCert
          : fs.readFileSync(caCert, "utf8"),
      };
    } else if (process.env.DB_INSECURE_SSL === "true") {
      // Development without CA: explicit opt-in to insecure mode
      ssl = { rejectUnauthorized: false };
    } else {
      throw new Error(
        "DB_SSL=true but no DB_CA_CERT provided. " +
          "Either provide DB_CA_CERT or set DB_INSECURE_SSL=true for development."
      );
    }
  }

  return {
    host: requireEnv("DB_HOST"),
    port: parseInt(process.env.DB_PORT ?? "5432", 10),
    database: requireEnv("DB_NAME"),
    user: requireEnv("DB_USER"),
    password: requireEnv("DB_PASSWORD"),
    ssl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
}

export function createPool(config: DbConfig): pg.Pool {
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
    max: config.max,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
  });
}

export type { Pool, PoolClient } from "pg";
