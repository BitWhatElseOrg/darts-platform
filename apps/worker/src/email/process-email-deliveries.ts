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
  /**
   * Nur fuer Tests: die beiden Buchungsschritte sind austauschbar, damit ein
   * Test eine scheiternde Buchung herstellen kann. Es gibt keine
   * Datenbankbedingung, die `markEmailDeliverySent` von aussen scheitern
   * liesse, und ohne diesen Fall bliebe die Nachbuchung unbelegt.
   */
  readonly markSent?: typeof markEmailDeliverySent;
  readonly recordFailure?: typeof recordEmailDeliveryFailure;
}

/** Was `book` je Zeile braucht; buendelt die Parameterliste. */
interface BookingContext {
  readonly transaction: DatabaseTransaction;
  readonly logger: OutboxLogger;
  readonly now: Date;
  readonly maxAttempts: number;
  readonly markSent: typeof markEmailDeliverySent;
  readonly recordFailure: typeof recordEmailDeliveryFailure;
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
 * Scheitert die Buchung selbst, wird der Fehlversuch in einem frischen
 * Savepoint nachgebucht. Ohne diese Nachbuchung bliebe die Zeile unveraendert
 * offen, und der naechste Tick — eine Sekunde spaeter — riefe den Provider
 * erneut auf: bei einem dauerhaften Buchungsfehler tausende Aufrufe pro
 * Stunde, gegen die der Idempotency-Key nur innerhalb des Provider-Fensters
 * schuetzt. Mit der Nachbuchung greifen Backoff und Hoechstzahl Versuche.
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
    const context: BookingContext = {
      transaction,
      logger,
      now: currentTime,
      maxAttempts,
      markSent: options.markSent ?? markEmailDeliverySent,
      recordFailure: options.recordFailure ?? recordEmailDeliveryFailure,
    };

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
        await book(context, row.id, { kind: "rejected", reason: rendered.reason });
        continue;
      }

      let result: EmailSendResult;
      try {
        result = await sender.send({ to: row.recipient, ...rendered.email }, row.id);
      } catch (error: unknown) {
        result = { kind: "retryable", reason: describeError(error) };
      }

      await book(context, row.id, result);
    }

    return rows.length;
  });
}

/**
 * Bucht ein Versandergebnis in einem eigenen Savepoint. Scheitert die
 * Buchung mit einem Postgres-Fehler, waere sonst die ganze beanspruchende
 * Transaktion beendet und der Stapel verloren.
 *
 * Scheitert die Buchung, bleibt die Zeile unveraendert offen — und damit
 * sofort wieder faellig. Deshalb wird der Fehlversuch anschliessend in einem
 * frischen Savepoint nachgebucht: erst damit tragen Zaehler und Backoff, und
 * ein dauerhaft scheiternder Auftrag landet nach `maxAttempts` im
 * Dead-Letter, statt den Provider im Sekundentakt zu beschaeftigen.
 * Scheitert auch die Nachbuchung, ist die Transaktion oder die Verbindung
 * selbst kaputt; dann bleibt nur die Meldung, und der Tick in `main.ts`
 * faengt den Rest.
 */
async function book(
  context: BookingContext,
  id: string,
  result: EmailSendResult,
): Promise<void> {
  const { transaction, logger, now, maxAttempts } = context;
  try {
    await transaction.transaction(async (savepoint) => {
      switch (result.kind) {
        case "sent": {
          const booked = await context.markSent(savepoint, {
            id,
            providerMessageId: result.providerMessageId,
            now,
          });
          if (!booked) {
            // Die Zeile war schon erledigt — der Versand lief also ein
            // zweites Mal. Das ist kein Fehler (der Idempotency-Key haelt
            // den Provider ab), aber es gehoert sichtbar ins Log, statt
            // als Erfolg durchzugehen.
            logger.emit("log", { event: "email.sent_already_booked", deliveryId: id });
            return;
          }
          logger.emit("debug", {
            event: "email.sent",
            deliveryId: id,
            providerMessageId: result.providerMessageId,
          });
          return;
        }
        case "retryable":
        case "rejected": {
          await context.recordFailure({
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
    return;
  } catch (bookingError: unknown) {
    const message = describeError(bookingError);
    logger.emit("error", { event: "email.booking_failed", deliveryId: id, error: message });

    try {
      await transaction.transaction(async (savepoint) => {
        // Nie `permanent`: ein Buchungsfehler sagt nichts darueber, ob der
        // Auftrag zustellbar ist. Der Backoff haelt den Provider fern, die
        // Hoechstzahl Versuche beendet den Fall.
        await context.recordFailure({
          executor: savepoint,
          id,
          reason: message,
          now,
          maxAttempts,
          permanent: false,
          logger,
        });
      });
    } catch (fallbackError: unknown) {
      logger.emit("error", {
        event: "email.booking_fallback_failed",
        deliveryId: id,
        error: describeError(fallbackError),
      });
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
