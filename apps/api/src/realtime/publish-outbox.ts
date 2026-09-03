import { and, asc, eq, isNull } from "drizzle-orm";

import { encounterSlots, outboxEvents, tournamentMatches } from "@darts-platform/database";

import type { DatabaseService } from "../database/database.service.js";
import { toBroadcast, type RealtimeBroadcast, type RealtimeScope } from "./event-routing.js";

type Database = DatabaseService["database"];

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
  database: Database,
  event: ResolvableEvent,
): Promise<RealtimeScope | null> {
  if (event.aggregateType === "Tournament") {
    return { kind: "tournament", id: event.aggregateId };
  }
  if (event.aggregateType === "Encounter") {
    return { kind: "encounter", id: event.aggregateId };
  }
  if (event.aggregateType !== "Match") return null;

  const [scheduled] = await database
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

  const [slot] = await database
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
 * Verteilt einen Stapel unpublizierter Ereignisse und stempelt jedes einzeln.
 * Der Stempel fällt auch dann, wenn kein Raum zuständig ist — sonst liefe der
 * Poller ewig gegen dieselbe Zeile.
 */
export async function publishOutboxBatch(
  database: Database,
  broadcaster: RealtimeBroadcaster,
  limit = 100,
): Promise<number> {
  const events = await database
    .select()
    .from(outboxEvents)
    .where(isNull(outboxEvents.publishedAt))
    .orderBy(asc(outboxEvents.occurredAt))
    .limit(limit);

  for (const event of events) {
    const broadcast = toBroadcast(event, await resolveScope(database, event));
    if (broadcast !== null) {
      broadcaster.emit(broadcast.room, broadcast.event, broadcast.payload);
    }
    await database
      .update(outboxEvents)
      .set({ publishedAt: new Date() })
      .where(and(eq(outboxEvents.id, event.id), isNull(outboxEvents.publishedAt)));
  }
  return events.length;
}
