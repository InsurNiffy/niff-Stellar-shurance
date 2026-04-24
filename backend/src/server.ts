/**
 * Production entry point. Starts the HTTP server and registers signal handlers.
 * Kept separate from index.ts so tests can import the app without side effects.
 */
import config from "./config";
import app, { closeRedisClient, initializeApp } from "./index";

const PORT = config.port;

let server: ReturnType<typeof app.listen> | null = null;

async function start(): Promise<void> {
  await initializeApp();
  await new Promise<void>((resolve) => {
    server = app.listen(PORT, () => {
      console.info(`[server] listening on port ${PORT} in ${config.env} mode`);
      console.info(`[server] health check: http://localhost:${PORT}/health`);
      resolve();
    });
  });
}

async function shutdown(): Promise<void> {
  console.info("[server] shutting down…");
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
    server = null;
  }
  await closeRedisClient();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

void start().catch((err) => {
  console.error("[server] failed to start", err);
  process.exit(1);
});
