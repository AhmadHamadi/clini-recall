/**
 * Database Migration Runner
 *
 * Applies versioned SQL migrations in order, tracking state in schema_migrations table.
 * MUST run as clini_admin role (has RLS bypass for schema changes).
 *
 * Usage:
 *   DB_HOST=... DB_ADMIN_USER=clini_admin DB_ADMIN_PASSWORD=... npm run migrate
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import pg from "pg";

const { Client } = pg;

interface Migration {
  version: number;
  name: string;
  filename: string;
  sql: string;
  checksum: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function computeChecksum(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function buildSslConfig():
  | { rejectUnauthorized: boolean; ca?: string }
  | undefined {
  if (process.env.DB_SSL !== "true") {
    return undefined;
  }

  const nodeEnv = process.env.NODE_ENV ?? "development";
  const caCert = process.env.DB_CA_CERT;

  if (nodeEnv === "production") {
    if (!caCert) {
      throw new Error(
        "DB_CA_CERT required in production when DB_SSL=true. " +
          "Set to file path or PEM content (starting with -----BEGIN CERTIFICATE-----)."
      );
    }
    return {
      rejectUnauthorized: true,
      ca: caCert.startsWith("-----BEGIN")
        ? caCert
        : fs.readFileSync(caCert, "utf8"),
    };
  }

  if (caCert) {
    return {
      rejectUnauthorized: true,
      ca: caCert.startsWith("-----BEGIN")
        ? caCert
        : fs.readFileSync(caCert, "utf8"),
    };
  }

  if (process.env.DB_INSECURE_SSL === "true") {
    return { rejectUnauthorized: false };
  }

  throw new Error(
    "DB_SSL=true but no DB_CA_CERT provided. " +
      "Either provide DB_CA_CERT or set DB_INSECURE_SSL=true for development."
  );
}

function parseMigrations(migrationsDir: string): Migration[] {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  files.sort();

  return files.map((filename) => {
    const match = filename.match(/^(\d+)_(.+)\.sql$/);
    if (!match) {
      throw new Error(`Invalid migration filename: ${filename}`);
    }

    const version = parseInt(match[1], 10);
    const name = match[2];
    const filepath = path.join(migrationsDir, filename);
    const sql = fs.readFileSync(filepath, "utf8");
    const checksum = computeChecksum(sql);

    return { version, name, filename, sql, checksum };
  });
}

async function run() {
  // REQUIRE admin credentials - migrations must not run as clini_app
  const adminUser = requireEnv("DB_ADMIN_USER");
  const adminPassword = requireEnv("DB_ADMIN_PASSWORD");

  if (adminUser === "clini_app") {
    throw new Error(
      "Migrations must run as clini_admin, not clini_app. Set DB_ADMIN_USER=clini_admin"
    );
  }

  const migrationsDir = path.resolve(process.cwd(), "migrations");

  const client = new Client({
    host: requireEnv("DB_HOST"),
    port: parseInt(process.env.DB_PORT ?? "5432", 10),
    database: requireEnv("DB_NAME"),
    user: adminUser,
    password: adminPassword,
    ssl: buildSslConfig(),
  });

  await client.connect();
  console.log(`Connected to database as ${adminUser}`);

  try {
    // Ensure schema_migrations exists (bootstrap)
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        checksum    TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Get applied migrations
    const applied = await client.query<{
      version: number;
      checksum: string;
    }>("SELECT version, checksum FROM schema_migrations ORDER BY version");

    const appliedMap = new Map(
      applied.rows.map((r) => [r.version, r.checksum])
    );

    // Parse migrations from disk
    const migrations = parseMigrations(migrationsDir);

    // Verify checksums of applied migrations haven't changed
    for (const m of migrations) {
      const existingChecksum = appliedMap.get(m.version);
      if (existingChecksum && existingChecksum !== m.checksum) {
        throw new Error(
          `Checksum mismatch for migration ${m.version}_${m.name}: ` +
            `file was modified after it was applied. This is not allowed.`
        );
      }
    }

    // Find pending migrations
    const pending = migrations.filter((m) => !appliedMap.has(m.version));

    if (pending.length === 0) {
      console.log("No pending migrations");
      return;
    }

    // Apply each pending migration in a transaction
    for (const m of pending) {
      console.log(`Applying migration ${m.version}_${m.name}...`);

      await client.query("BEGIN");

      try {
        // Execute migration SQL
        await client.query(m.sql);

        // Record in schema_migrations
        await client.query(
          `INSERT INTO schema_migrations (version, name, checksum)
           VALUES ($1, $2, $3)`,
          [m.version, m.name, m.checksum]
        );

        await client.query("COMMIT");
        console.log(`  ✓ Applied ${m.version}_${m.name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(`  ✗ Failed ${m.version}_${m.name}`);
        throw error;
      }
    }

    console.log(`\nApplied ${pending.length} migration(s) successfully`);
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
