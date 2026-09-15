import app from "./app";
import { purgeExpiredArchivedSessions } from "./lib/analysis-store";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];
const archivedSessionCleanupIntervalMs = 6 * 60 * 60 * 1000;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  const runArchivedSessionCleanup = async () => {
    try {
      const deletedCount = await purgeExpiredArchivedSessions();
      if (deletedCount > 0) {
        logger.info(
          { deletedCount },
          "Purged expired archived analysis sessions",
        );
      }
    } catch (cleanupError) {
      logger.error(
        { err: cleanupError },
        "Failed to purge expired archived analysis sessions",
      );
    }
  };

  void runArchivedSessionCleanup();
  const cleanupTimer = setInterval(
    runArchivedSessionCleanup,
    archivedSessionCleanupIntervalMs,
  );
  cleanupTimer.unref();
});
