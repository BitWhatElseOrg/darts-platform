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
 * Scheitert ein Ereignis, wird der Fehlversuch ueber `recordOutboxFailure`
 * auf der Zeile gebucht und die Runde fortgesetzt — ein kaputtes Ereignis
 * darf die Aggregation nicht anhalten (Befund F-1). Nach `maxAttempts`
 * Versuchen wandert es ins Dead Letter und faellt damit aus
 * `outboxPending` heraus; `recordOutboxFailure` protokolliert das selbst als
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
  const maxAttempts = options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;

  const events = await database
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.eventType, STATISTICS_OUTBOX_EVENT_TYPE),
        outboxPending("statistics", now()),
      ),
    )
    .orderBy(asc(outboxEvents.sequence))
    .limit(options.limit ?? 20);

  for (const event of events) {
    try {
      const participantRows = await database
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

      // `isNull` ist bei einer frisch als offen gelesenen Zeile redundant,
      // verhindert aber, dass zwei ueberlappende Runden denselben Stempel
      // nachtraeglich verschieben.
      await database
        .update(outboxEvents)
        .set({ statisticsProcessedAt: now() })
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
    } catch (error) {
      // Eigenes try/catch um die Buchung selbst: scheitert sie (z. B. eine
      // Verbindungsstoerung waehrend des `UPDATE`), soll das die Verarbeitung
      // der uebrigen Ereignisse dieser Runde nicht anhalten.
      try {
        await recordOutboxFailure({
          database,
          consumer: "statistics",
          eventId: event.id,
          error,
          now: now(),
          maxAttempts,
          logger,
        });
      } catch (bookingError) {
        logger.emit("error", {
          event: "outbox.failure_booking_failed",
          consumer: "statistics",
          eventId: event.id,
          error: bookingError instanceof Error ? bookingError.message : String(bookingError),
        });
      }
    }
  }

  return events.length;
}
