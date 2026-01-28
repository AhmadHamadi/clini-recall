import { loadConfig } from "./config.js";
import { loadDbConfig, createPool } from "./db/pool.js";
import { buildServer } from "./server.js";

async function main() {
  const config = loadConfig();

  // Create database pool
  const dbConfig = loadDbConfig();
  const pool = createPool(dbConfig);

  // Verify database connection
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    console.log("Database connected");
  } catch (err) {
    console.error("Database connection failed:", err);
    process.exit(1);
  }

  const server = buildServer(config, pool);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down...");
    await server.close();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await server.listen({ port: config.port, host: config.host });
    console.log(`Server listening on http://${config.host}:${config.port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
