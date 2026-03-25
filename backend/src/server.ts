/**
 * Production entry point. Starts the HTTP server and registers signal handlers.
 * Kept separate from index.ts so tests can import the app without side effects.
 */
import app, { closeRedisClient } from "./index";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const server = app.listen(PORT, () => {
  console.info(`[server] listening on port ${PORT}`);
});

async function shutdown(): Promise<void> {
  console.info("[server] shutting down…");
  server.close();
  await closeRedisClient();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
