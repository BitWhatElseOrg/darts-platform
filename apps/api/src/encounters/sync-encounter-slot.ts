import { and, eq } from "drizzle-orm";

import { auditEvents, boards, encounterSlots, encounters, outboxEvents } from "@darts-platform/database";

import type { Principal } from "../auth/auth.types.js";
import { auditActor } from "../common/audit-actor.js";
import type { AuditContext } from "../common/audit-context.js";

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

export type ReopenEncounterSlotOutcome = "no-slot" | "slot-not-completed" | "encounter-closed" | "reopened";

/**
 * Ein Undo auf ein beendetes Liga-Match öffnet den zugehörigen Slot mit, damit
 * das korrigierte Resultat beim nächsten Checkout über
 * `completeEncounterSlotForMatch` wieder in den Slot gelangt. Läuft in
 * derselben Transaktion wie das Undo und vor dessen erstem Schreibzugriff.
 *
 * Sperrreihenfolge Encounter -> EncounterSlot (-> Match beim Aufrufer). Der
 * Scoringpfad hält beide Zeilen bereits über `lockEncounterScoringContext`;
 * hier wird die Begegnung trotzdem vor dem Slot gesperrt, damit die Funktion
 * auch ohne diese Vorsperre keine gegenläufige Reihenfolge einführt.
 *
 * Abgelehnt wird, wenn
 * - der Slot nicht als gespielt abgeschlossen ist (`"slot-not-completed"`):
 *   ein beendetes Match mit offenem oder per Walkover gewertetem Slot ist ein
 *   widersprüchlicher Zustand, den ein Undo nicht still übergehen darf;
 * - die Begegnung COMPLETED oder CANCELLED ist (`"encounter-closed"`): Punkte und Resultat sind
 *   festgeschrieben, ein Undo darf sie nicht still zurückdrehen;
 * - ein Entscheidungsdoppel (Reglement 2.2.9) nicht mehr im Ausgangszustand
 *   steht. Der Decider-Slot entsteht mit der Begegnung als `WAITING` und
 *   verlässt diesen Zustand nur, wenn er angesetzt (IN_PROGRESS), gespielt
 *   (COMPLETED), per Walkover gewertet (WALKOVER) oder von
 *   `updateEncounterProgress` als nicht gebraucht gestrichen wird
 *   (CANCELLED). Jeder dieser Zustände beruht auf dem Stand der regulären
 *   Spiele, den das Undo gerade ändern würde. Ein gestrichener Decider käme
 *   nicht zurück, wenn das korrigierte Resultat doch ein Unentschieden ergibt
 *   — deshalb gilt auch CANCELLED als abgeschlossen. Nur `WAITING` (und das
 *   gleichwertige `READY`) lässt das Öffnen zu; eine bereits erfasste
 *   Doppelmeldung für den Decider bleibt dabei gültig.
 */
export async function reopenEncounterSlotForMatch(
  transaction: DatabaseTransaction,
  input: {
    readonly organizationId: string;
    readonly matchId: string;
    readonly boardId: string | null;
    readonly auth: Principal;
    readonly audit: AuditContext;
  },
): Promise<ReopenEncounterSlotOutcome> {
  const [candidate] = await transaction
    .select({ encounterId: encounterSlots.encounterId })
    .from(encounterSlots)
    .where(
      and(
        eq(encounterSlots.organizationId, input.organizationId),
        eq(encounterSlots.matchId, input.matchId),
      ),
    )
    .limit(1);
  if (candidate === undefined) return "no-slot";

  const [encounter] = await transaction
    .select()
    .from(encounters)
    .where(
      and(
        eq(encounters.organizationId, input.organizationId),
        eq(encounters.id, candidate.encounterId),
      ),
    )
    .for("update")
    .limit(1);
  const slot = await lockSlotOfMatch(transaction, input.organizationId, input.matchId);
  if (slot === null) return "no-slot";
  if (slot.status !== "COMPLETED" || slot.resultType !== "PLAYED") return "slot-not-completed";
  if (encounter === undefined || encounter.id !== slot.encounterId) {
    throw new Error("Encounter slot reopen invariant violated.");
  }
  if (encounter.status === "COMPLETED" || encounter.status === "CANCELLED") {
    return "encounter-closed";
  }

  const deciders = await transaction
    .select({ id: encounterSlots.id, status: encounterSlots.status })
    .from(encounterSlots)
    .where(
      and(
        eq(encounterSlots.organizationId, input.organizationId),
        eq(encounterSlots.encounterId, slot.encounterId),
        eq(encounterSlots.role, "DECIDER"),
      ),
    );
  if (deciders.some((decider) => decider.status !== "WAITING" && decider.status !== "READY")) {
    return "encounter-closed";
  }

  const now = new Date();
  const reopened = {
    status: "IN_PROGRESS",
    boardId: input.boardId,
    winnerSide: null,
    resultType: null,
    homeLegs: 0,
    awayLegs: 0,
    completedAt: null,
    version: slot.version + 1,
    updatedAt: now,
  } as const;
  await transaction
    .update(encounterSlots)
    .set(reopened)
    .where(
      and(eq(encounterSlots.organizationId, input.organizationId), eq(encounterSlots.id, slot.id)),
    );
  await transaction.insert(outboxEvents).values({
    organizationId: input.organizationId,
    aggregateType: "Encounter",
    aggregateId: slot.encounterId,
    eventType: "ENCOUNTER_SLOT_REOPENED",
    payload: {
      encounterId: slot.encounterId,
      slotId: slot.id,
      sequence: slot.sequence,
      matchId: input.matchId,
    },
  });
  await transaction.insert(auditEvents).values({
    organizationId: input.organizationId,
    ...auditActor(input.auth),
    action: "ENCOUNTER_SLOT_REOPENED",
    entityType: "EncounterSlot",
    entityId: slot.id,
    oldValue: slot,
    newValue: { ...slot, ...reopened },
    ip: input.audit.ip,
    userAgent: input.audit.userAgent,
    correlationId: input.audit.correlationId,
  });
  await updateEncounterProgress(transaction, input.organizationId, slot.encounterId, now);
  return "reopened";
}
