import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main() {
  const config = loadConfig();
  const server = buildServer(config);

  try {
    await server.listen({ port: config.port, host: config.host });
    console.log(`Server listening on http://${config.host}:${config.port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
