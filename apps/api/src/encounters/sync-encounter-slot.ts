import { and, eq } from "drizzle-orm";

import { boards, encounterSlots, outboxEvents } from "@darts-platform/database";

import type { DatabaseService } from "../database/database.service.js";
import { updateEncounterProgress } from "./update-encounter-progress.js";

type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];

async function lockSlotOfMatch(
  transaction: DatabaseTransaction,
  organizationId: string,
  matchId: string,
): Promise<(typeof encounterSlots.$inferSelect) | null> {
  const [slot] = await transaction
    .select()
    .from(encounterSlots)
    .where(
      and(
        eq(encounterSlots.organizationId, organizationId),
        eq(encounterSlots.matchId, matchId),
      ),
    )
    .for("update")
    .limit(1);
  return slot ?? null;
}

/**
 * Schliesst den Begegnungsslot ab, zu dem ein gerade beendetes Match gehört.
 * Läuft in derselben Transaktion wie der abschliessende Visit — Slotstand und
 * Matchstand können deshalb nicht auseinanderlaufen. Gehört das Match zu
 * keinem Slot, passiert nichts.
 */
export async function completeEncounterSlotForMatch(
  transaction: DatabaseTransaction,
  input: {
    readonly organizationId: string;
    readonly matchId: string;
    readonly winnerSeat: 1 | 2;
    readonly homeLegs: number;
    readonly awayLegs: number;
  },
): Promise<void> {
  const slot = await lockSlotOfMatch(transaction, input.organizationId, input.matchId);
  if (slot === null || slot.status !== "IN_PROGRESS") return;
  const now = new Date();
  // Sitz 1 ist die Heimseite, Sitz 2 die Gastseite.
  const winnerSide = input.winnerSeat === 1 ? "HOME" : "AWAY";

  if (slot.boardId !== null) {
    await transaction
      .update(boards)
      .set({ status: "AVAILABLE", updatedAt: now })
      .where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, slot.boardId)));
  }
  await transaction
    .update(encounterSlots)
    .set({
      status: "COMPLETED",
      resultType: "PLAYED",
      winnerSide,
      homeLegs: input.homeLegs,
      awayLegs: input.awayLegs,
      boardId: null,
      completedAt: now,
      version: slot.version + 1,
      updatedAt: now,
    })
    .where(
      and(eq(encounterSlots.organizationId, input.organizationId), eq(encounterSlots.id, slot.id)),
    );
  await transaction.insert(outboxEvents).values({
    organizationId: input.organizationId,
    aggregateType: "Encounter",
    aggregateId: slot.encounterId,
    eventType: "ENCOUNTER_SLOT_COMPLETED",
    payload: {
      encounterId: slot.encounterId,
      slotId: slot.id,
      sequence: slot.sequence,
      matchId: input.matchId,
      winnerSide,
      resultType: "PLAYED",
      homeLegs: input.homeLegs,
      awayLegs: input.awayLegs,
    },
  });
  await updateEncounterProgress(transaction, input.organizationId, slot.encounterId, now);
}

/**
 * Gehört ein abgebrochenes Match zu einem Slot, geht dieser zurück auf
 * `WAITING` und gibt sein Board frei — dieselbe Systematik wie bei
 * Turniermatches. Das Board selbst wird bereits von `abortScoringMatch`
 * freigegeben.
 */
export async function resetEncounterSlotForMatch(
  transaction: DatabaseTransaction,
  input: { readonly organizationId: string; readonly matchId: string },
): Promise<{ readonly encounterId: string; readonly slotId: string; readonly sequence: number } | null> {
  const slot = await lockSlotOfMatch(transaction, input.organizationId, input.matchId);
  if (slot === null) return null;
  const now = new Date();
  await transaction
    .update(encounterSlots)
    .set({
      status: "WAITING",
      boardId: null,
      matchId: null,
      version: slot.version + 1,
      updatedAt: now,
    })
    .where(
      and(eq(encounterSlots.organizationId, input.organizationId), eq(encounterSlots.id, slot.id)),
    );
  return { encounterId: slot.encounterId, slotId: slot.id, sequence: slot.sequence };
}
