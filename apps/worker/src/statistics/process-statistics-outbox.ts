import { and, asc, eq, isNull } from "drizzle-orm";
import {
  OUTBOX_MAX_ATTEMPTS,
  STATISTICS_OUTBOX_EVENT_TYPE,
  matchParticipantPlayers,
  outboxEvents,
  outboxPending,
  recordOutboxFailure,
  type Database,
  type OutboxLogger,
} from "@darts-platform/database";

import type { RebuildPlayerStatistics } from "./rebuild-player-statistics.js";

export interface ProcessStatisticsOutboxOptions {
  readonly database: Database;
  readonly rebuild: RebuildPlayerStatistics;
  readonly logger: OutboxLogger;
  readonly limit?: number;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
}

/**
 * Eine Runde des Statistik-Konsumenten. Verarbeitet ausschliesslich
 * `MATCH_COMPLETED`; fuer jeden anderen Ereignistyp bleibt
 * `statistics_processed_at` bewusst leer. Jede Abfrage auf den
 * Statistik-Rueckstand muss deshalb denselben Typfilter tragen, sonst zaehlt
 * sie nie verarbeitete Ereignisse als Rueckstand mit.
 *
 * Sortiert wird nach `sequence`, nicht nach `occurred_at`: letzteres ist
 * `now()` und damit die Transaktions-STARTzeit, eine laengere Transaktion,
 * die nach einer kuerzeren committet, waere sonst vorgezogen.
 *
 * `FOR UPDATE SKIP LOCKED` macht den Stapel exklusiv (derselbe Befund wie I8
 * beim Relay, `apps/api/src/realtime/publish-outbox.ts`): eine zweite
 * Worker-Replik ueberspringt die gesperrten Zeilen, statt denselben Stapel
 * ein zweites Mal zu aggregieren. Die Sperre haelt dabei ueber die
 * Aggregation — bewusst, denn genau das haelt die zweite Replik fern; bei
 * `limit` in der Groessenordnung von 20 Ereignissen ist die Transaktion kurz
 * genug. Der Rebuild selbst schreibt ueber `options.rebuild` und damit
 * ausserhalb dieser Transaktion; er ist idempotent, ein Rollback der Zeile
 * kostet also nur einen erneuten Durchlauf.
 *
 * Jedes Ereignis laeuft in einem eigenen Savepoint
 * (`transaction.transaction`): ein Postgres-Fehler beendet sonst die ganze
 * Transaktion — jede weitere Anweisung scheitert danach mit "current
 * transaction is aborted" — und ein einzelnes kaputtes Ereignis kostete den
 * ganzen Stapel statt nur sich selbst.
 *
 * Scheitert ein Ereignis, wird der Fehlversuch ueber `recordOutboxFailure`
 * NACH dem Commit auf der Zeile gebucht — innerhalb der Transaktion waere
 * die Buchung vom Rollback des Savepoints nicht betroffen, wohl aber von
 * einem spaeteren Fehler des Stapels. Nach `maxAttempts` Versuchen wandert
 * das Ereignis ins Dead Letter und faellt damit aus `outboxPending` heraus;
 * `recordOutboxFailure` protokolliert das selbst als
 * `outbox.retry_scheduled` beziehungsweise `outbox.dead_letter`.
 *
 * Der Poller liest organisationsuebergreifend: ein Systemprozess ohne
 * Benutzeranfrage, der je Ereignis mit dessen eigener `organizationId`
 * weiterrechnet.
 */
export async function processStatisticsOutbox(
  options: ProcessStatisticsOutboxOptions,
): Promise<number> {
  const { database, logger } = options;
  const now = options.now ?? ((): Date => new Date());
  const currentTime = now();
  const maxAttempts = options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;

  const failures: { readonly eventId: string; readonly error: unknown }[] = [];
  const claimed = await database.transaction(async (transaction) => {
    const events = await transaction
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, STATISTICS_OUTBOX_EVENT_TYPE),
          outboxPending("statistics", currentTime),
        ),
      )
      .orderBy(asc(outboxEvents.sequence))
      .limit(options.limit ?? 20)
      .for("update", { skipLocked: true });

    for (const event of events) {
      try {
        await transaction.transaction(async (savepoint) => {
          const participantRows = await savepoint
            .select({
              playerId: matchParticipantPlayers.playerId,
              participantId: matchParticipantPlayers.participantId,
            })
            .from(matchParticipantPlayers)
            .where(
              and(
                eq(matchParticipantPlayers.organizationId, event.organizationId),
                eq(matchParticipantPlayers.matchId, event.aggregateId),
              ),
            );

          // Ein Doppel traegt je Sitz mehr als eine Person und zaehlt in der
          // Einzelrangliste nicht mit (Spec "Statistik"). Das Ereignis gilt
          // trotzdem als verarbeitet, sonst laeuft der Poller ewig dagegen.
          const seats = new Set(
            participantRows.map((participant) => participant.participantId),
          );
          if (seats.size === participantRows.length) {
            for (const participant of participantRows) {
              await options.rebuild(participant.playerId, event.organizationId);
            }
          }

          // `isNull` ist bei einer unter der Zeilensperre gelesenen Zeile
          // redundant, bleibt aber als defensive Absicherung stehen.
          await savepoint
            .update(outboxEvents)
            .set({ statisticsProcessedAt: currentTime })
            .where(
              and(
                eq(outboxEvents.id, event.id),
                isNull(outboxEvents.statisticsProcessedAt),
              ),
            );

          logger.emit("debug", {
            event: "statistics.event_processed",
            eventId: event.id,
            eventType: event.eventType,
            aggregateId: event.aggregateId,
            organizationId: event.organizationId,
            players: participantRows.length,
          });
        });
      } catch (error) {
        failures.push({ eventId: event.id, error });
      }
    }

    return events.length;
  });

  for (const failure of failures) {
    // Eigenes try/catch um die Buchung selbst: scheitert sie (z. B. eine
    // Verbindungsstoerung waehrend des `UPDATE`), soll das die Buchung der
    // uebrigen fehlgeschlagenen Ereignisse dieses Stapels nicht verhindern.
    try {
      await recordOutboxFailure({
        database,
        consumer: "statistics",
        eventId: failure.eventId,
        error: failure.error,
        now: currentTime,
        maxAttempts,
        logger,
      });
    } catch (bookingError) {
      logger.emit("error", {
        event: "outbox.failure_booking_failed",
        consumer: "statistics",
        eventId: failure.eventId,
        error:
          bookingError instanceof Error ? bookingError.message : String(bookingError),
      });
    }
  }

  return claimed;
}
