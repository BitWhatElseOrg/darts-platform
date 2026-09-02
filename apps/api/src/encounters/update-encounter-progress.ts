import { and, eq, inArray } from "drizzle-orm";

import {
  competitions,
  encounterSlots,
  encounters,
  outboxEvents,
} from "@darts-platform/database";
import {
  calculateEncounterResult,
  resolveDeciderRequirement,
  type ResultInput,
  type ResultSlot,
  type Side,
  type SlotOutcome,
} from "@darts-platform/league-engine";

import type { DatabaseService } from "../database/database.service.js";

type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];

type SlotRow = typeof encounterSlots.$inferSelect;

function toOutcome(slot: SlotRow): SlotOutcome {
  if (slot.status === "CANCELLED") return { type: "CANCELLED" };
  if (slot.winnerSide !== "HOME" && slot.winnerSide !== "AWAY") return { type: "PENDING" };
  const winner: Side = slot.winnerSide;
  if (slot.status === "WALKOVER") return { type: "WALKOVER", winner };
  if (slot.status === "COMPLETED") {
    return { type: "PLAYED", winner, homeLegs: slot.homeLegs, awayLegs: slot.awayLegs };
  }
  return { type: "PENDING" };
}

export function toResultSlot(slot: SlotRow): ResultSlot {
  return {
    sequence: slot.sequence,
    role: slot.role === "DECIDER" ? "DECIDER" : "REGULAR",
    legsToWinSet: slot.legsToWinSet,
    setsToWin: slot.setsToWin,
    outcome: toOutcome(slot),
  };
}

export function toResultInput(
  competition: typeof competitions.$inferSelect,
  slots: readonly SlotRow[],
  forfeitSide?: Side | null,
): ResultInput {
  return {
    slots: slots.map(toResultSlot),
    scoring: {
      pointsWin: competition.pointsWin,
      pointsDraw: competition.pointsDraw,
      pointsLoss: competition.pointsLoss,
      pointsDeciderBonus: competition.pointsDeciderBonus,
      deciderRule: competition.deciderRule === "EXTRA_SLOT" ? "EXTRA_SLOT" : "NONE",
    },
    ...(forfeitSide === undefined || forfeitSide === null ? {} : { forfeitSide }),
  };
}

/**
 * Schreibt Spiele, Legs und — sobald die Begegnung entschieden ist — Punkte
 * und Ergebnis fort. Sie läuft in derselben Transaktion wie das auslösende
 * Ereignis, damit Zwischenstand und Slotzustand nie auseinanderlaufen.
 *
 * Die Version der Begegnung bleibt unberührt: die Fortschreibung ist kein
 * Kommando, und ein laufender Spielabend soll nicht dadurch Versionskonflikte
 * erzeugen, dass nebenan ein Slot fertig wird.
 */
export async function updateEncounterProgress(
  transaction: DatabaseTransaction,
  organizationId: string,
  encounterId: string,
  now: Date,
): Promise<void> {
  const [encounter] = await transaction
    .select()
    .from(encounters)
    .where(and(eq(encounters.organizationId, organizationId), eq(encounters.id, encounterId)))
    .for("update")
    .limit(1);
  if (encounter === undefined) throw new Error("Encounter progression invariant violated.");
  if (encounter.status === "COMPLETED" || encounter.status === "CANCELLED") return;

  const [[competition], slots] = await Promise.all([
    transaction
      .select()
      .from(competitions)
      .where(
        and(
          eq(competitions.organizationId, organizationId),
          eq(competitions.id, encounter.competitionId),
        ),
      )
      .limit(1),
    transaction
      .select()
      .from(encounterSlots)
      .where(
        and(
          eq(encounterSlots.organizationId, organizationId),
          eq(encounterSlots.encounterId, encounterId),
        ),
      ),
  ]);
  if (competition === undefined) throw new Error("Encounter competition invariant violated.");

  const decision = resolveDeciderRequirement(toResultInput(competition, slots));

  // Ein nicht gebrauchtes Entscheidungsdoppel zählt in keiner Wertung mit.
  const unusedDecider =
    decision.status === "NOT_REQUIRED"
      ? slots.filter(
          (slot) =>
            slot.role === "DECIDER" && (slot.status === "WAITING" || slot.status === "READY"),
        )
      : [];
  if (unusedDecider.length > 0) {
    await transaction
      .update(encounterSlots)
      .set({ status: "CANCELLED", updatedAt: now })
      .where(
        and(
          eq(encounterSlots.organizationId, organizationId),
          inArray(
            encounterSlots.id,
            unusedDecider.map((slot) => slot.id),
          ),
        ),
      );
  }
  const cancelledIds = new Set(unusedDecider.map((slot) => slot.id));
  const effectiveSlots = slots.map((slot) =>
    cancelledIds.has(slot.id) ? { ...slot, status: "CANCELLED" } : slot,
  );

  const result = calculateEncounterResult(toResultInput(competition, effectiveSlots));

  await transaction
    .update(encounters)
    .set({
      homeGames: result.homeGames,
      awayGames: result.awayGames,
      homeLegs: result.homeLegs,
      awayLegs: result.awayLegs,
      ...(result.complete
        ? {
            homePoints: result.homePoints,
            awayPoints: result.awayPoints,
            result: result.result,
            resultType: result.resultType,
            status: "COMPLETED" as const,
            completedAt: now,
          }
        : {}),
      updatedAt: now,
    })
    .where(and(eq(encounters.organizationId, organizationId), eq(encounters.id, encounterId)));

  if (result.complete) {
    await transaction.insert(outboxEvents).values({
      organizationId,
      aggregateType: "Encounter",
      aggregateId: encounterId,
      eventType: "ENCOUNTER_COMPLETED",
      payload: {
        encounterId,
        result: result.result,
        resultType: result.resultType,
        homePoints: result.homePoints,
        awayPoints: result.awayPoints,
        homeGames: result.homeGames,
        awayGames: result.awayGames,
        homeLegs: result.homeLegs,
        awayLegs: result.awayLegs,
      },
    });
  }
}
