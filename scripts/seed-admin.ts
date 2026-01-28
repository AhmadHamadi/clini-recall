/**
 * Seed first platform admin user
 *
 * Run AFTER migrations, as clini_admin role (bypasses RLS).
 *
 * Usage:
 *   DB_ADMIN_USER=clini_admin DB_ADMIN_PASSWORD=... \
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=... \
 *   npm run seed:admin
 */

import pg from "pg";
import crypto from "crypto";
import fs from "fs";

const { Client } = pg;

const ITERATIONS = 100000;
const KEY_LENGTH = 64;
const DIGEST = "sha512";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");

  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      password,
      salt,
      ITERATIONS,
      KEY_LENGTH,
      DIGEST,
      (err, key) => {
        if (err) return reject(err);
        resolve(`${salt}:${key.toString("hex")}`);
      }
    );
  });
}

async function run() {
  // REQUIRE admin credentials
  const adminUser = requireEnv("DB_ADMIN_USER");
  const adminPassword = requireEnv("DB_ADMIN_PASSWORD");

  if (adminUser === "clini_app") {
    throw new Error(
      "Seeding must run as clini_admin, not clini_app. Set DB_ADMIN_USER=clini_admin"
    );
  }

  const email = requireEnv("ADMIN_EMAIL");
  const password = requireEnv("ADMIN_PASSWORD");
  const name = process.env.ADMIN_NAME ?? "Platform Admin";

  if (password.length < 12) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters");
  }

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
    // Check if admin already exists
    const existing = await client.query(
      "SELECT id, is_platform_admin FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      console.log(`User ${email} already exists (id: ${user.id})`);

      if (!user.is_platform_admin) {
        // Promote to platform admin
        await client.query(
          "UPDATE users SET is_platform_admin = TRUE WHERE id = $1",
          [user.id]
        );
        console.log("Promoted to platform admin");
      } else {
        console.log("Already a platform admin");
      }
      return;
    }

    // Create platform admin
    const passwordHash = await hashPassword(password);

    const result = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, is_platform_admin)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id`,
      [email.toLowerCase(), passwordHash, name]
    );

    console.log(`Created platform admin: ${result.rows[0].id}`);
    console.log(`Email: ${email}`);
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
