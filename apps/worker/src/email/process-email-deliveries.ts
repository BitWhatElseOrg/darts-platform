import { asc } from "drizzle-orm";

import {
  EMAIL_DELIVERY_BATCH_SIZE,
  OUTBOX_MAX_ATTEMPTS,
  emailDeliveries,
  emailDeliveryPending,
  markEmailDeliverySent,
  recordEmailDeliveryFailure,
  type Database,
  type DatabaseTransaction,
  type OutboxLogger,
} from "@darts-platform/database";
import {
  renderEmailDelivery,
  type EmailSender,
  type EmailSendResult,
} from "@darts-platform/notifications";

export interface ProcessEmailDeliveriesOptions {
  readonly database: Database;
  readonly sender: EmailSender;
  readonly logger: OutboxLogger;
  readonly limit?: number;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
}

/**
 * Eine Runde des Mail-Pollers. Beansprucht bis `limit` offene Zeilen mit
 * `FOR UPDATE SKIP LOCKED`, rendert je Zeile das Template, ruft den Sender
 * mit der Zeilen-ID als Idempotency-Key auf und bucht das Ergebnis — alles
 * unter der Zeilensperre, damit eine zweite Replik die Zeile nicht greift,
 * solange der Versand laeuft (dasselbe Muster wie
 * `process-statistics-outbox.ts`). Der Stapel ist deshalb klein.
 *
 * Stirbt der Prozess zwischen Versand und Buchung, rollt die Transaktion
 * zurueck, die Zeile bleibt offen, und der naechste Versuch traegt
 * denselben Idempotency-Key — der Provider liefert nicht doppelt aus.
 *
 * Fehler des Senders (Wurf) gelten als wiederholbar; ein Payload, der nicht
 * zum Schema passt, geht ohne Versand ins Dead-Letter. Jede Buchung laeuft
 * im eigenen Savepoint: ein Postgres-Fehler kostet nur diese Zeile.
 *
 * Die eigenen Log-Zeilen tragen weder Empfaenger noch Link, nur
 * `deliveryId`, `kind`, `attempts`, `lastError` und `providerMessageId`
 * (Spec "Log-Hygiene"). Der Grund eines Fehlversuchs stammt immer vom
 * Adapter oder aus `renderEmailDelivery`, nie aus dem Payload.
 */
export async function processEmailDeliveries(
  options: ProcessEmailDeliveriesOptions,
): Promise<number> {
  const { database, sender, logger } = options;
  const currentTime = (options.now ?? ((): Date => new Date()))();
  const maxAttempts = options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;

  return database.transaction(async (transaction) => {
    const rows = await transaction
      .select()
      .from(emailDeliveries)
      .where(emailDeliveryPending(currentTime))
      .orderBy(asc(emailDeliveries.createdAt))
      .limit(options.limit ?? EMAIL_DELIVERY_BATCH_SIZE)
      .for("update", { skipLocked: true });

    for (const row of rows) {
      const rendered = renderEmailDelivery(row.kind, row.payload);
      if (!rendered.ok) {
        await book(
          transaction,
          row.id,
          { kind: "rejected", reason: rendered.reason },
          currentTime,
          maxAttempts,
          logger,
        );
        continue;
      }

      let result: EmailSendResult;
      try {
        result = await sender.send({ to: row.recipient, ...rendered.email }, row.id);
      } catch (error: unknown) {
        result = {
          kind: "retryable",
          reason: error instanceof Error ? error.message : String(error),
        };
      }

      await book(transaction, row.id, result, currentTime, maxAttempts, logger);
    }

    return rows.length;
  });
}

/**
 * Bucht ein Versandergebnis in einem eigenen Savepoint. Scheitert die
 * Buchung mit einem Postgres-Fehler, waere sonst die ganze beanspruchende
 * Transaktion beendet und der Stapel verloren.
 */
async function book(
  transaction: DatabaseTransaction,
  id: string,
  result: EmailSendResult,
  now: Date,
  maxAttempts: number,
  logger: OutboxLogger,
): Promise<void> {
  try {
    await transaction.transaction(async (savepoint) => {
      switch (result.kind) {
        case "sent": {
          await markEmailDeliverySent(savepoint, {
            id,
            providerMessageId: result.providerMessageId,
            now,
          });
          logger.emit("debug", {
            event: "email.sent",
            deliveryId: id,
            providerMessageId: result.providerMessageId,
          });
          return;
        }
        case "retryable":
        case "rejected": {
          await recordEmailDeliveryFailure({
            executor: savepoint,
            id,
            reason: result.reason,
            now,
            maxAttempts,
            permanent: result.kind === "rejected",
            logger,
          });
          return;
        }
        default: {
          const exhaustive: never = result;
          throw new Error(`Unbekanntes Versandergebnis: ${String(exhaustive)}`);
        }
      }
    });
  } catch (bookingError: unknown) {
    logger.emit("error", {
      event: "email.booking_failed",
      deliveryId: id,
      error: bookingError instanceof Error ? bookingError.message : String(bookingError),
    });
  }
}
