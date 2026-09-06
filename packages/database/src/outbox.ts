import { and, eq, isNull, lte, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import type { Database } from "./client.js";
import { outboxEvents } from "./schema.js";

/** Ereignistyp, den der Statistik-Konsument als einziger verarbeitet. */
export const STATISTICS_OUTBOX_EVENT_TYPE = "MATCH_COMPLETED";

/** Nach dem fünften Fehlversuch wandert ein Ereignis ins Dead Letter. */
export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_BACKOFF_BASE_MS = 1_000;
export const OUTBOX_BACKOFF_CAP_MS = 300_000;

const MAX_ERROR_LENGTH = 500;

export type OutboxConsumer = "publish" | "statistics";

/**
 * Schmale Log-Schnittstelle, damit dieses Paket ohne Abhängigkeit auf
 * `@darts-platform/config` auskommt. Ein `StructuredLogEmitter` erfüllt sie.
 */
export interface OutboxLogger {
  emit(
    level: "error" | "warn" | "debug",
    fields: Readonly<Record<string, unknown>>,
  ): void;
}

export interface OutboxFailureInput {
  readonly database: Database;
  readonly consumer: OutboxConsumer;
  readonly eventId: string;
  readonly error: unknown;
  readonly now: Date;
  readonly maxAttempts: number;
  readonly logger: OutboxLogger;
}

/** Exponentiell wachsende Wartezeit, gedeckelt bei fünf Minuten. */
export function outboxRetryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(OUTBOX_BACKOFF_BASE_MS * 2 ** exponent, OUTBOX_BACKOFF_CAP_MS);
}

/**
 * Auswahlprädikat eines Konsumenten: noch nicht verarbeitet, nicht im Dead
 * Letter, und die Backoff-Sperre ist abgelaufen. Ohne Organisationsfilter —
 * beide Poller sind Systemprozesse ohne Benutzeranfrage und verteilen bzw.
 * verrechnen jedes Ereignis in dessen eigener Organisation weiter.
 */
export function outboxPending(consumer: OutboxConsumer, now: Date): SQL | undefined {
  switch (consumer) {
    case "publish":
      return and(
        isNull(outboxEvents.publishedAt),
        isNull(outboxEvents.publishDeadLetteredAt),
        or(
          isNull(outboxEvents.publishNotBefore),
          lte(outboxEvents.publishNotBefore, now),
        ),
      );
    case "statistics":
      return and(
        isNull(outboxEvents.statisticsProcessedAt),
        isNull(outboxEvents.statisticsDeadLetteredAt),
        or(
          isNull(outboxEvents.statisticsNotBefore),
          lte(outboxEvents.statisticsNotBefore, now),
        ),
      );
    default: {
      const exhaustive: never = consumer;
      throw new Error(`Unbekannter Outbox-Konsument: ${String(exhaustive)}`);
    }
  }
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

interface OutboxFailureUpdateResult {
  readonly attempts: number;
  readonly deadLetteredAt: Date | null;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly organizationId: string;
}

/**
 * Wartezeit bis zum nächsten Versuch als SQL-Ausdruck, serverseitig aus der
 * VOR dieser Anweisung gültigen Zähler-Spalte berechnet. `attemptsColumn + 1`
 * ist die Anzahl Versuche NACH dieser Buchung; `outboxRetryDelayMs` erwartet
 * genau diese Zahl, ihr Exponent ist `max(0, attempts - 1)`, was sich hier zu
 * `attemptsColumn` selbst vereinfacht, weil die Spalte nie negativ ist.
 */
function backoffMillisSql(attemptsColumn: SQLWrapper) {
  return sql`least(${OUTBOX_BACKOFF_BASE_MS}::numeric * power(2, greatest(0, ${attemptsColumn})), ${OUTBOX_BACKOFF_CAP_MS}::numeric)`;
}

/**
 * Bucht einen Fehlversuch als eine einzige atomare `UPDATE`-Anweisung: Zähler,
 * Backoff-Sperre und Dead-Letter-Stempel werden serverseitig aus dem
 * Zeilenzustand berechnet (`attempts = attempts + 1` in derselben Anweisung),
 * nicht aus einer clientseitig mitgebrachten Momentaufnahme. Zwei
 * überlappende Poll-Zyklen auf derselben Zeile serialisiert Postgres über das
 * Zeilenlock des `UPDATE`; keiner verliert dadurch einen Zähler-Schritt, und
 * ein bereits gesetzter Dead-Letter-Stempel wird nie mit `null` oder einem
 * späteren Zeitpunkt überschrieben (`coalesce(dead_lettered_at, now)`).
 * Erreicht die Zeile beim selben Aufruf die Obergrenze, wird `not_before`
 * geleert: eine Backoff-Sperre hat für eine dead-gelettete Zeile keine
 * Bedeutung mehr, und ein manuelles Wiedereinreihen (siehe
 * `DATABASE_SCHEMA.md` §18) setzt sie ohnehin frisch.
 */
export async function recordOutboxFailure(
  input: OutboxFailureInput,
): Promise<"retry" | "dead_letter"> {
  const { consumer, eventId, logger, maxAttempts, now } = input;
  const lastError = describeError(input.error);
  // Explizit als ISO-String eingebettet statt als rohes `Date`: der
  // postgres-js-Treiber leitet den Parametertyp eines generischen
  // `sql`-Fragments aus dem JS-Wert her, bevor Postgres den `::timestamptz`-
  // Cast im Text sieht, und verwechselt ein rohes `Date` dabei mit einem
  // Textparameter. Ein ISO-String ist eindeutig und von Postgres als
  // `timestamptz` sauber parsbar.
  const nowIso = now.toISOString();

  let rows: readonly OutboxFailureUpdateResult[];
  switch (consumer) {
    case "publish": {
      rows = await input.database
        .update(outboxEvents)
        .set({
          publishAttempts: sql`${outboxEvents.publishAttempts} + 1`,
          publishLastError: lastError,
          publishNotBefore: sql`case
            when ${outboxEvents.publishAttempts} + 1 >= ${maxAttempts}::integer then null
            else ${nowIso}::timestamptz + (${backoffMillisSql(outboxEvents.publishAttempts)} * interval '1 millisecond')
          end`,
          publishDeadLetteredAt: sql`case
            when ${outboxEvents.publishAttempts} + 1 >= ${maxAttempts}::integer then coalesce(${outboxEvents.publishDeadLetteredAt}, ${nowIso}::timestamptz)
            else ${outboxEvents.publishDeadLetteredAt}
          end`,
        })
        .where(eq(outboxEvents.id, eventId))
        .returning({
          attempts: outboxEvents.publishAttempts,
          deadLetteredAt: outboxEvents.publishDeadLetteredAt,
          eventType: outboxEvents.eventType,
          aggregateId: outboxEvents.aggregateId,
          organizationId: outboxEvents.organizationId,
        });
      break;
    }
    case "statistics": {
      rows = await input.database
        .update(outboxEvents)
        .set({
          statisticsAttempts: sql`${outboxEvents.statisticsAttempts} + 1`,
          statisticsLastError: lastError,
          statisticsNotBefore: sql`case
            when ${outboxEvents.statisticsAttempts} + 1 >= ${maxAttempts}::integer then null
            else ${nowIso}::timestamptz + (${backoffMillisSql(outboxEvents.statisticsAttempts)} * interval '1 millisecond')
          end`,
          statisticsDeadLetteredAt: sql`case
            when ${outboxEvents.statisticsAttempts} + 1 >= ${maxAttempts}::integer then coalesce(${outboxEvents.statisticsDeadLetteredAt}, ${nowIso}::timestamptz)
            else ${outboxEvents.statisticsDeadLetteredAt}
          end`,
        })
        .where(eq(outboxEvents.id, eventId))
        .returning({
          attempts: outboxEvents.statisticsAttempts,
          deadLetteredAt: outboxEvents.statisticsDeadLetteredAt,
          eventType: outboxEvents.eventType,
          aggregateId: outboxEvents.aggregateId,
          organizationId: outboxEvents.organizationId,
        });
      break;
    }
    default: {
      const exhaustive: never = consumer;
      throw new Error(`Unbekannter Outbox-Konsument: ${String(exhaustive)}`);
    }
  }

  const row = rows[0];
  if (row === undefined) {
    throw new Error(`Outbox-Ereignis ${eventId} nicht gefunden.`);
  }

  const deadLettered = row.deadLetteredAt !== null;

  logger.emit(deadLettered ? "error" : "warn", {
    event: deadLettered ? "outbox.dead_letter" : "outbox.retry_scheduled",
    consumer,
    eventId,
    eventType: row.eventType,
    aggregateId: row.aggregateId,
    organizationId: row.organizationId,
    attempts: row.attempts,
    lastError,
  });

  return deadLettered ? "dead_letter" : "retry";
}
