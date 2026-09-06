import { createStructuredLogEmitter, parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, type OutboxLogger } from "@darts-platform/database";

import { pruneProcessedOutboxEvents } from "./prune-outbox.js";
import { processStatisticsOutbox } from "./statistics/process-statistics-outbox.js";
import { rebuildPlayerStatistics } from "./statistics/rebuild-player-statistics.js";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
const logger = createStructuredLogEmitter("worker", environment.LOG_LEVEL);
const outboxLogger: OutboxLogger = {
  emit: (level, fields) => logger.emit(level, fields),
};

let working = false;

async function tick(): Promise<void> {
  if (working) return;
  working = true;
  try {
    await processStatisticsOutbox({
      database: connection.database,
      logger: outboxLogger,
      rebuild: (playerId, organizationId) =>
        rebuildPlayerStatistics(connection.database, playerId, organizationId),
    });
  } catch (error) {
    // Hierher kommen nur Fehler ausserhalb der Ereignisschleife, etwa eine
    // abgerissene Verbindung beim Lesen des Stapels. Fehler einzelner
    // Ereignisse werden in der Schleife gebucht.
    logger.emit("error", {
      event: "statistics.tick_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    working = false;
  }
}

let pruning = false;

/**
 * Stuendlich, nicht sekuendlich: die Aufraeumregel raeumt einen Rueckstand von
 * Tagen ab und muss nicht schneller laufen als er entsteht.
 */
async function prune(): Promise<void> {
  if (pruning) return;
  pruning = true;
  try {
    const removed = await pruneProcessedOutboxEvents(connection.database, new Date());
    if (removed > 0) {
      logger.emit("log", { event: "outbox.pruned", removed });
    }
  } catch (error) {
    logger.emit("error", {
      event: "outbox.prune_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    pruning = false;
  }
}

setInterval(() => void tick(), 1_000);
void tick();
setInterval(() => void prune(), 3_600_000);
void prune();

process.on("SIGTERM", () => void connection.close().finally(() => process.exit(0)));
process.on("SIGINT", () => void connection.close().finally(() => process.exit(0)));
