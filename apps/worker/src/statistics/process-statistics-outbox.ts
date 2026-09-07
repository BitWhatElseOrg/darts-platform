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
 * Scheitert ein Ereignis, bucht `recordOutboxFailure` den Fehlversuch noch
 * INNERHALB der beanspruchenden Transaktion, unmittelbar nachdem der
 * Savepoint zurueckgerollt ist. Nach dem Commit zu buchen liess ein Fenster
 * offen, in dem die Zeile bereits entsperrt, aber noch ohne Zaehler und
 * Backoff war: eine zweite Replik konnte sie darin greifen und den Backoff
 * umgehen. Unter der Sperre gebucht, steht beides in dem Moment, in dem die
 * Sperre faellt. Verloren geht die Buchung dadurch nur, wenn die Transaktion
 * selbst scheitert — dann bliebe sie ohnehin aus, weil dieser Aufruf dann
 * wirft, bevor irgendetwas nachgelagert laufen koennte.
 *
 * Die Buchung liegt dafuer in einem eigenen Savepoint: schluege sie mit einem
 * Postgres-Fehler fehl, waere sonst die ganze Transaktion beendet und der
 * Stapel verloren. Nach `maxAttempts` Versuchen wandert das Ereignis ins Dead
 * Letter und faellt damit aus `outboxPending` heraus; `recordOutboxFailure`
 * protokolliert das selbst als `outbox.retry_scheduled` beziehungsweise
 * `outbox.dead_letter`.
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
        // Eigener Savepoint um die Buchung: scheitert sie mit einem
        // Postgres-Fehler, kostet das nur dieses Ereignis, nicht den Stapel.
        try {
          await transaction.transaction(async (savepoint) => {
            await recordOutboxFailure({
              executor: savepoint,
              consumer: "statistics",
              eventId: event.id,
              error,
              now: currentTime,
              maxAttempts,
              logger,
            });
          });
        } catch (bookingError) {
          logger.emit("error", {
            event: "outbox.failure_booking_failed",
            consumer: "statistics",
            eventId: event.id,
            error:
              bookingError instanceof Error
                ? bookingError.message
                : String(bookingError),
          });
        }
      }
    }

    return events.length;
  });

  return claimed;
}
