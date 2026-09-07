import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import {
  OUTBOX_MAX_ATTEMPTS,
  encounterSlots,
  outboxEvents,
  outboxPending,
  recordOutboxFailure,
  tournamentMatches,
  type OutboxLogger,
} from "@darts-platform/database";

import type { DatabaseService } from "../database/database.service.js";
import {
  toBroadcast,
  type RealtimeBroadcast,
  type RealtimeScope,
  type RoutableEvent,
} from "./event-routing.js";

type Database = DatabaseService["database"];
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/**
 * Die Zuordnung laeuft jetzt innerhalb der Transaktion, die den Stapel
 * beansprucht — sie muss deshalb beides annehmen.
 */
export type OutboxExecutor = Database | DatabaseTransaction;

export interface RealtimeBroadcaster {
  emit(room: string, event: string, payload: RealtimeBroadcast["payload"]): void;
}

interface ResolvableEvent {
  readonly organizationId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
}

/**
 * Ein Match gehört entweder zu einem Turnier oder zu einem Begegnungsslot.
 * Beide Quellen müssen befragt werden: ein Ligaspiel steht nicht in
 * `tournament_matches`, und ohne die zweite Abfrage bliebe der Spielabend
 * ohne Live-Verteilung.
 *
 * Ein abgebrochenes Match verliert seinen Slotbezug in derselben Transaktion,
 * in der `MATCH_ABORTED` entsteht. Dieses eine Ereignis ist danach keinem
 * Raum mehr zuzuordnen — der Begegnungsraum erfährt den Abbruch über
 * `ENCOUNTER_SLOT_REOPENED`, das dieselbe Transaktion mitschreibt.
 */
export async function resolveScope(
  executor: OutboxExecutor,
  event: ResolvableEvent,
): Promise<RealtimeScope | null> {
  if (event.aggregateType === "Tournament") {
    return { kind: "tournament", id: event.aggregateId };
  }
  if (event.aggregateType === "Encounter") {
    return { kind: "encounter", id: event.aggregateId };
  }
  if (event.aggregateType !== "Match") return null;

  const [scheduled] = await executor
    .select({ tournamentId: tournamentMatches.tournamentId })
    .from(tournamentMatches)
    .where(
      and(
        eq(tournamentMatches.organizationId, event.organizationId),
        eq(tournamentMatches.scoringMatchId, event.aggregateId),
      ),
    )
    .limit(1);
  if (scheduled !== undefined) {
    return { kind: "tournament", id: scheduled.tournamentId };
  }

  const [slot] = await executor
    .select({ encounterId: encounterSlots.encounterId })
    .from(encounterSlots)
    .where(
      and(
        eq(encounterSlots.organizationId, event.organizationId),
        eq(encounterSlots.matchId, event.aggregateId),
      ),
    )
    .limit(1);
  return slot === undefined ? null : { kind: "encounter", id: slot.encounterId };
}

export type ResolveScope = (
  executor: OutboxExecutor,
  event: ResolvableEvent & RoutableEvent,
) => Promise<RealtimeScope | null>;

export interface PublishOutboxOptions {
  readonly logger: OutboxLogger;
  readonly limit?: number;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
  /**
   * Nur fuer Tests: die Zuordnung austauschen, um einen Datenbankfehler
   * genau in ihr zu erzeugen. In der Anwendung bleibt es bei `resolveScope`.
   */
  readonly resolveScope?: ResolveScope;
}

/**
 * Beansprucht einen Stapel unpublizierter Ereignisse und sendet innerhalb
 * derselben Transaktion, bevor gestempelt wird.
 *
 * `FOR UPDATE SKIP LOCKED` macht den Stapel exklusiv: eine zweite Replik
 * ueberspringt die gesperrten Zeilen, statt sie ein zweites Mal zu senden
 * (Befund I8). `outboxPending("publish", now)` schraenkt die Auswahl
 * zusaetzlich ein: bereits im Dead Letter liegende Zeilen und Zeilen mit
 * noch nicht abgelaufener Backoff-Sperre werden gar nicht erst gezogen.
 *
 * Der Kanal ist bewusst At-least-once, nicht At-most-once: `socket.io.emit`
 * ist synchron und feuert-und-vergisst, traegt also keine Bestaetigung. Eine
 * Zeile erst zu stempeln und danach zu senden hiesse, bei einem Absturz
 * zwischen Commit und Versand bis zu `limit` Ereignisse endgueltig zu
 * verlieren — und zwei Web-Ansichten stellen ihr Polling ein, solange der
 * Socket verbunden ist (`apps/web/src/components/live/live-tournament.tsx`,
 * `apps/web/src/components/league/use-encounter-command.ts`), ein verlorenes
 * Ereignis liesse sie einfrieren. Deshalb wird zuerst gesendet und erst bei
 * Erfolg gestempelt: ein Absturz zwischen Versand und Commit sendet beim
 * naechsten Durchlauf noch einmal. Die Duplikate sind harmlos, weil die
 * UI-Zustaende, die sie aktualisieren, idempotent sind.
 *
 * Schlaegt der Versand fehl, bleibt die Zeile innerhalb der Transaktion
 * ungestempelt. Erst NACH dem Commit — die abgeschlossene Transaktion kann
 * nicht mehr schreiben — bucht `recordOutboxFailure` je fehlgeschlagenem
 * Ereignis einen Fehlversuch in einer eigenen Anweisung: Zaehler hoch,
 * Backoff gesetzt, und nach `maxAttempts` Versuchen ein Dead-Letter-Stempel,
 * der die Zeile fortan von `outboxPending` ausschliesst. Diese Funktion wirft
 * dafuer bewusst kein `AggregateError` mehr (anders als vor diesem Befund):
 * ein fehlgeschlagenes Ereignis ist damit vollstaendig behandelt — gebucht
 * und ueber `options.logger` als `outbox.retry_scheduled` bzw.
 * `outbox.dead_letter` protokolliert (`recordOutboxFailure` erzeugt diesen
 * Log-Eintrag selbst) — und muss den Aufrufer nicht mehr zusaetzlich per
 * Exception alarmieren. Ein einzelnes kaputtes Ereignis haelt so weder den
 * Rest des Stapels noch kuenftige Durchlaeufe auf; geworfen wird nur noch,
 * wenn das Beanspruchen des Stapels selbst scheitert (Infrastrukturfehler),
 * unveraendert gegenueber Teil A. Scheitert die Buchung selbst (z. B. eine
 * Verbindungsstoerung waehrend des `UPDATE`), faengt ein eigenes try/catch je
 * Ereignis das ab und protokolliert `outbox.failure_booking_failed`, statt
 * die Buchung der uebrigen Ereignisse dieses Stapels zu verhindern.
 *
 * Jedes Ereignis wird einzeln abgesichert, damit ein Fehler in der Mitte des
 * Stapels nur dieses eine Ereignis kostet statt den ganzen Rest zu blockieren.
 * Ein Ereignis ohne zustaendigen Raum (`resolveScope` liefert `null`) wird wie
 * bisher gestempelt, ohne gesendet zu werden — sonst liefe der Poller ewig
 * gegen dieselbe Zeile.
 *
 * Sortiert wird nach `sequence`, nicht nach `occurred_at`: letzteres ist
 * `now()` und damit die Transaktions-STARTzeit, eine laengere Transaktion, die
 * nach einer kuerzeren committet, wuerde vor ihr publiziert.
 */
export async function publishOutboxBatch(
  database: Database,
  broadcaster: RealtimeBroadcaster,
  options: PublishOutboxOptions,
): Promise<number> {
  const now = options.now ?? ((): Date => new Date());
  const currentTime = now();
  const maxAttempts = options.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;
  const limit = options.limit ?? 100;

  const failures: { outboxId: string; error: unknown }[] = [];
  const claimed = await database.transaction(async (transaction) => {
    const events = await transaction
      .select()
      .from(outboxEvents)
      .where(and(isNull(outboxEvents.publishedAt), outboxPending("publish", currentTime)))
      .orderBy(asc(outboxEvents.sequence))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (events.length === 0) return 0;

    const stampable: string[] = [];
    const resolve = options.resolveScope ?? resolveScope;
    for (const event of events) {
      // `resolveScope` liegt bewusst mit im `try`: sein DB-Zugriff kann
      // genauso fehlschlagen wie der Versand selbst, und ein einzelnes
      // kaputtes Ereignis soll auch dann nur sich selbst kosten, nicht den
      // Rest des Stapels abbrechen. Der Savepoint
      // (`transaction.transaction`) ist dafuer noetig: ein Postgres-Fehler
      // beendet sonst die ganze Transaktion, jede weitere Anweisung
      // scheitert danach mit "current transaction is aborted" — auch die
      // Zuordnung der uebrigen Ereignisse und der Stempel-`UPDATE`.
      try {
        const broadcast = await transaction.transaction(async (savepoint) =>
          toBroadcast(event, await resolve(savepoint, event)),
        );
        if (broadcast === null) {
          stampable.push(event.id);
          continue;
        }
        broadcaster.emit(broadcast.room, broadcast.event, broadcast.payload);
        stampable.push(event.id);
      } catch (error) {
        failures.push({ outboxId: event.id, error });
      }
    }

    if (stampable.length > 0) {
      // isNull ist unter der Zeilensperre redundant, bleibt aber als defensive
      // Absicherung stehen.
      await transaction
        .update(outboxEvents)
        .set({ publishedAt: currentTime })
        .where(and(inArray(outboxEvents.id, stampable), isNull(outboxEvents.publishedAt)));
    }
    return events.length;
  });

  for (const failure of failures) {
    // Eigenes try/catch je Buchung: scheitert `recordOutboxFailure` selbst
    // (z. B. eine Verbindungsstoerung zur Datenbank), darf das nicht die
    // Buchung der uebrigen fehlgeschlagenen Ereignisse dieses Stapels
    // verhindern.
    try {
      await recordOutboxFailure({
        database,
        consumer: "publish",
        eventId: failure.outboxId,
        error: failure.error,
        now: currentTime,
        maxAttempts,
        logger: options.logger,
      });
    } catch (error) {
      options.logger.emit("error", {
        event: "outbox.failure_booking_failed",
        consumer: "publish",
        eventId: failure.outboxId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return claimed;
}
