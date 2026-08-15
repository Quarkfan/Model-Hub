import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PgModelRepository } from "./pg-repository.js";
const c = loadConfig(),
  repository = new PgModelRepository(c.DATABASE_URL);
await repository.migrate();
const app = buildApp({
  repository,
  internalToken: c.INTERNAL_SERVICE_TOKEN,
  logger: { level: c.LOG_LEVEL },
});
await app.listen({ host: c.HOST, port: c.PORT });
const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
