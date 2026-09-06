import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { encounterSlots, outboxEvents, tournamentMatches } from "@darts-platform/database";

import type { DatabaseService } from "../database/database.service.js";
import { toBroadcast, type RealtimeBroadcast, type RealtimeScope } from "./event-routing.js";

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

/**
 * Beansprucht einen Stapel unpublizierter Ereignisse und sendet innerhalb
 * derselben Transaktion, bevor gestempelt wird.
 *
 * `FOR UPDATE SKIP LOCKED` macht den Stapel exklusiv: eine zweite Replik
 * ueberspringt die gesperrten Zeilen, statt sie ein zweites Mal zu senden
 * (Befund I8).
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
 * UI-Zustaende, die sie aktualisieren, idempotent sind. Schlaegt der Versand
 * fehl, bleibt die Zeile ungestempelt und wird im naechsten Durchlauf erneut
 * versucht; ein dauerhaft fehlschlagendes Ereignis wuerde so bei jedem
 * Durchlauf erneut versucht — eine Dead-Letter-Behandlung dafuer ist ein
 * separater, geplanter Schritt.
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
  limit = 100,
): Promise<number> {
  const failures: { outboxId: string; error: unknown }[] = [];
  const claimed = await database.transaction(async (transaction) => {
    const events = await transaction
      .select()
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt))
      .orderBy(asc(outboxEvents.sequence))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (events.length === 0) return 0;

    const stampable: string[] = [];
    for (const event of events) {
      const broadcast = toBroadcast(event, await resolveScope(transaction, event));
      if (broadcast === null) {
        stampable.push(event.id);
        continue;
      }
      try {
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
        .set({ publishedAt: new Date() })
        .where(and(inArray(outboxEvents.id, stampable), isNull(outboxEvents.publishedAt)));
    }
    return events.length;
  });

  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.error),
      `Realtime-Zustellung fuer ${failures.length} Outbox-Events fehlgeschlagen: ${failures
        .map((failure) => failure.outboxId)
        .join(", ")}`,
    );
  }
  return claimed;
}
