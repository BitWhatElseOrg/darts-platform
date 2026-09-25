import { createStructuredLogEmitter, parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, type OutboxLogger } from "@darts-platform/database";
import { createEmailSender } from "@darts-platform/notifications";

import { processEmailDeliveries } from "./email/process-email-deliveries.js";
import { pruneEmailDeliveries } from "./email/prune-email-deliveries.js";
import { pruneProcessedOutboxEvents } from "./prune-outbox.js";
import { processStatisticsOutbox } from "./statistics/process-statistics-outbox.js";
import { rebuildPlayerStatistics } from "./statistics/rebuild-player-statistics.js";
import { isUndefinedTableError } from "./undefined-table.js";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
const logger = createStructuredLogEmitter("worker", environment.LOG_LEVEL);
const outboxLogger: OutboxLogger = {
  emit: (level, fields) => logger.emit(level, fields),
};

// Startsignal. Der Worker hat keinen Health-Endpunkt; ohne diese Zeile ist von
// aussen -- im CI-Rauchtest wie im Railway-Log -- nicht zu erkennen, ob er die
// Umgebung gelesen hat und die Verdrahtung durchlief.
//
// Die Zeile belegt NICHT, dass die Datenbankverbindung steht: `connection`
// haelt einen Pool, und Drizzle baut Verbindungen lazy beim ersten Query auf,
// nicht schon bei `createDatabaseConnection`. Dieses Ereignis kommt also auch
// dann, wenn die Datenbank spaeter nicht erreichbar ist. Dass die Verbindung
// tatsaechlich traegt, belegen zwei andere Dinge: das ruhige Beobachtungsfenster
// (der Tick laeuft im Sekundentakt gegen die Datenbank, ohne es waere er
// laengst gescheitert) und der Fehler-Grep auf den Log-Level im CI-Rauchtest
// (`.github/workflows/ci.yml`, Ruling E10).
const startedAt = Date.now();
logger.emit("log", { event: "worker_started" });

/**
 * Railway startet die Dienste eines Deploys nebeneinander: der Worker pollt
 * los, bevor die API ihre Migration durchhat. Beim Staging-Deploy des
 * Mailversands lief er rund 20 Sekunden vor der neuen Tabelle an und schrieb
 * 23 Fehlerzeilen, bis die Migration sass — danach war es still. Eine
 * fehlende Tabelle ist in diesem Fenster also die erwartete Reihenfolge und
 * keine Stoerung; nach Ablauf bleibt sie ein Fehler, denn dann fehlt sie
 * wirklich.
 */
const MIGRATION_GRACE_MS = 120_000;

function isDeferredByMigration(error: unknown): boolean {
  return isUndefinedTableError(error) && Date.now() - startedAt < MIGRATION_GRACE_MS;
}

// Der Adapter wird einmal beim Start gewaehlt, nicht je Runde: `resend` ohne
// Schluessel wirft hier und laesst den Worker sofort scheitern, statt den
// Fehler erst beim ersten Auftrag zu zeigen.
const emailSender = createEmailSender(
  {
    provider: environment.EMAIL_PROVIDER,
    apiKey: environment.RESEND_API_KEY,
    from: environment.EMAIL_FROM,
    // In Production traegt die Textvariante den Klartext-Einladungscode
    // beziehungsweise den Reset-Link; im Log hat beides nichts verloren.
    redactBody: environment.NODE_ENV === "production",
  },
  outboxLogger,
);

// Production auf `log` ist der erste Rollout-Schritt, kein Regelbetrieb:
// es wird nichts versendet, obwohl jede Zeile als zugestellt gebucht wird.
// Deshalb `warn` statt `log` — die Zeile hebt sich damit im Railway-Log
// sichtbar ab und `warn` ist die hoechste sinnvolle Stufe unterhalb von
// `error`, auf die der CI-Rauchtest anspringt. Der Better-Stack-Monitor
// haengt am Health-Endpunkt der API und sieht Worker-Logs ohnehin nicht.
const emailSenderSilentInProduction =
  environment.NODE_ENV === "production" && environment.EMAIL_PROVIDER === "log";
if (emailSenderSilentInProduction) {
  logger.emit("warn", {
    event: "email_sender_ready",
    provider: environment.EMAIL_PROVIDER,
    warning: "EMAIL_PROVIDER=log: es werden keine Mails versendet",
  });
} else {
  logger.emit("log", { event: "email_sender_ready", provider: environment.EMAIL_PROVIDER });
}

let deliveringEmails = false;

async function deliverEmails(): Promise<void> {
  if (deliveringEmails) return;
  deliveringEmails = true;
  try {
    await processEmailDeliveries({
      database: connection.database,
      sender: emailSender,
      logger: outboxLogger,
    });
  } catch (error) {
    // Nur Fehler ausserhalb der Zeilenschleife, etwa eine abgerissene
    // Verbindung beim Beanspruchen des Stapels. Fehler einzelner Auftraege
    // bucht der Poller selbst.
    const deferred = isDeferredByMigration(error);
    logger.emit(deferred ? "warn" : "error", {
      event: deferred ? "email.tick_deferred" : "email.tick_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    deliveringEmails = false;
  }
}

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
    const deferred = isDeferredByMigration(error);
    logger.emit(deferred ? "warn" : "error", {
      event: deferred ? "statistics.tick_deferred" : "statistics.tick_failed",
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
  // Die Wache faellt in einem aeusseren `finally`: wirft einer der beiden
  // Fehlerzweige selbst (ein kaputter Logger etwa), bliebe sie sonst fuer
  // immer gesetzt und die Aufraeumregel liefe nie wieder.
  try {
    try {
      const removed = await pruneProcessedOutboxEvents(connection.database, new Date());
      if (removed > 0) {
        logger.emit("log", { event: "outbox.pruned", removed });
      }
    } catch (error) {
      // Gleiches Startfenster wie bei den Ticks: der Aufraeumlauf startet
      // sofort und traf in Production (Release #59, Migration 0034) die
      // Tabelle noch nicht an, siehe Protokoll B3.
      const deferred = isDeferredByMigration(error);
      logger.emit(deferred ? "warn" : "error", {
        event: deferred ? "outbox.prune_deferred" : "outbox.prune_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    // Eigener Fehlerzweig, nicht derselbe wie oben: sonst zeigte eine
    // gescheiterte Mail-Aufraeumung als `outbox.prune_failed` auf die falsche
    // Tabelle, und eine gescheiterte Outbox-Aufraeumung liesse die Mail-Zeilen
    // fuer eine ganze Stunde ungeraeumt liegen.
    try {
      const removedEmails = await pruneEmailDeliveries(connection.database, new Date());
      if (removedEmails > 0) {
        logger.emit("log", { event: "email.pruned", removed: removedEmails });
      }
    } catch (error) {
      const deferred = isDeferredByMigration(error);
      logger.emit(deferred ? "warn" : "error", {
        event: deferred ? "email.prune_deferred" : "email.prune_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    pruning = false;
  }
}

setInterval(() => void tick(), 1_000);
void tick();
setInterval(() => void deliverEmails(), 1_000);
void deliverEmails();
setInterval(() => void prune(), 3_600_000);
void prune();

process.on("SIGTERM", () => void connection.close().finally(() => process.exit(0)));
process.on("SIGINT", () => void connection.close().finally(() => process.exit(0)));
