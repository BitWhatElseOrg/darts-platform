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
 * Beansprucht einen Stapel unpublizierter Ereignisse, stempelt ihn in
 * derselben Transaktion und sendet erst nach dem Commit.
 *
 * `FOR UPDATE SKIP LOCKED` macht den Stapel exklusiv: eine zweite Replik
 * ueberspringt die gesperrten Zeilen, statt sie ein zweites Mal zu senden
 * (Befund I8). Der Stempel faellt vor dem Commit — nicht danach —, damit kein
 * Fenster bleibt, in dem ein Ereignis gesendet, aber nicht gestempelt ist. Er
 * faellt auch dann, wenn kein Raum zustaendig ist; sonst liefe der Poller ewig
 * gegen dieselbe Zeile.
 *
 * Gesendet wird erst NACH dem Commit (AGENTS.md 16): scheitert die
 * Transaktion, hat niemand etwas empfangen, und der naechste Durchlauf nimmt
 * denselben Stapel erneut.
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
  const pending: RealtimeBroadcast[] = [];
  const claimed = await database.transaction(async (transaction) => {
    const events = await transaction
      .select()
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt))
      .orderBy(asc(outboxEvents.sequence))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (events.length === 0) return 0;
    for (const event of events) {
      const broadcast = toBroadcast(event, await resolveScope(transaction, event));
      if (broadcast !== null) pending.push(broadcast);
    }
    // isNull ist unter der Zeilensperre redundant, bleibt aber als defensive
    // Absicherung stehen.
    await transaction
      .update(outboxEvents)
      .set({ publishedAt: new Date() })
      .where(
        and(
          inArray(outboxEvents.id, events.map((event) => event.id)),
          isNull(outboxEvents.publishedAt),
        ),
      );
    return events.length;
  });

  // Der ganze Stapel ist bereits gestempelt, bevor gesendet wird — das ist
  // der bewusste At-most-once-Kompromiss dieses Vorgehens. Jedes Ereignis
  // wird einzeln abgesichert, damit ein Fehler in der Mitte des Stapels nur
  // dieses eine Ereignis kostet statt den ganzen Rest der Sendung abzubrechen.
  const failures: { eventId: string; error: unknown }[] = [];
  for (const broadcast of pending) {
    try {
      broadcaster.emit(broadcast.room, broadcast.event, broadcast.payload);
    } catch (error) {
      failures.push({ eventId: broadcast.payload.eventId ?? "", error });
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.error),
      `Realtime-Zustellung fuer ${failures.length} Outbox-Events fehlgeschlagen: ${failures
        .map((failure) => failure.eventId)
        .join(", ")}`,
    );
  }
  return claimed;
}
