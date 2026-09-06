import { and, eq, isNull, lte, or, type SQL } from "drizzle-orm";

import type { Database } from "./client.js";
import { outboxEvents, type OutboxEvent } from "./schema.js";

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
  readonly event: OutboxEvent;
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

/**
 * Bucht einen Fehlversuch: Zähler hoch, Fehlermeldung (ohne Payload und
 * ohne Personendaten) festhalten, entweder Backoff setzen oder ins Dead
 * Letter legen. Eine Dead-Letter-Zeile wird von keinem Poller mehr gezogen
 * und blockiert damit die nachfolgenden Ereignisse nicht.
 */
export async function recordOutboxFailure(
  input: OutboxFailureInput,
): Promise<"retry" | "dead_letter"> {
  const { consumer, event, logger, maxAttempts, now } = input;
  const previous =
    consumer === "publish" ? event.publishAttempts : event.statisticsAttempts;
  const attempts = previous + 1;
  const lastError = describeError(input.error);
  const deadLettered = attempts >= maxAttempts;
  const notBefore = deadLettered
    ? null
    : new Date(now.getTime() + outboxRetryDelayMs(attempts));

  const values: Partial<typeof outboxEvents.$inferInsert> =
    consumer === "publish"
      ? {
          publishAttempts: attempts,
          publishLastError: lastError,
          publishNotBefore: notBefore,
          publishDeadLetteredAt: deadLettered ? now : null,
        }
      : {
          statisticsAttempts: attempts,
          statisticsLastError: lastError,
          statisticsNotBefore: notBefore,
          statisticsDeadLetteredAt: deadLettered ? now : null,
        };

  await input.database
    .update(outboxEvents)
    .set(values)
    .where(eq(outboxEvents.id, event.id));

  logger.emit(deadLettered ? "error" : "warn", {
    event: deadLettered ? "outbox.dead_letter" : "outbox.retry_scheduled",
    consumer,
    eventId: event.id,
    eventType: event.eventType,
    aggregateId: event.aggregateId,
    organizationId: event.organizationId,
    attempts,
    lastError,
    ...(notBefore === null ? {} : { nextAttemptAt: notBefore.toISOString() }),
  });

  return deadLettered ? "dead_letter" : "retry";
}
