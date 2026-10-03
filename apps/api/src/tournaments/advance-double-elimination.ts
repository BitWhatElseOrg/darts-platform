import { and, eq } from "drizzle-orm";

import { auditEvents, outboxEvents, tournamentMatches, tournamentStages, tournaments } from "@darts-platform/database";
import {
  DOUBLE_ELIMINATION_STAGE_KEYS,
  GRAND_FINAL_KEY,
  GRAND_FINAL_RESET_KEY,
  planGrandFinalReset,
} from "@darts-platform/tournament-engine";

import type { Principal } from "../auth/auth.types.js";
import { auditActor } from "../common/audit-actor.js";
import type { AuditContext } from "../common/audit-context.js";
import type { DatabaseService } from "../database/database.service.js";
import { stageLabel } from "./planned-match-label.js";

type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];

export interface AdvanceDoubleEliminationInput {
  readonly organizationId: string;
  readonly tournamentId: string;
  readonly now: Date;
  readonly actor: { readonly principal: Principal; readonly audit: AuditContext };
}

/**
 * Legt nach dem ersten Final eines Doppel-K.-o. bei Bedarf das Rückspiel an
 * (Spec 2026-10-03, ADR 0022). Läuft in der Transaktion des Abschlusses bzw.
 * Rückzugs, vor `updateTournamentProgress`, damit das neue Spiel das Turnier
 * offen hält. Die Turnierzeile wird gesperrt, bevor nach dem Rückspiel gesucht
 * wird; der eindeutige Key `(tournament_id, key)` ist die zweite Linie.
 * Für andere Formate ein No-op ohne Sperre.
 */
export async function advanceDoubleElimination(transaction: DatabaseTransaction, input: AdvanceDoubleEliminationInput): Promise<void> {
  const [probe] = await transaction
    .select({ format: tournaments.format })
    .from(tournaments)
    .where(and(eq(tournaments.organizationId, input.organizationId), eq(tournaments.id, input.tournamentId)))
    .limit(1);
  if (probe?.format !== "DOUBLE_ELIMINATION") return;
  // Sperre vor dem Lesen von Final und Rückspiel: zwei parallele Abschlüsse
  // dürfen das Rückspiel nicht beide anlegen.
  await transaction
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(and(eq(tournaments.organizationId, input.organizationId), eq(tournaments.id, input.tournamentId)))
    .for("update")
    .limit(1);

  const matchRows = await transaction
    .select()
    .from(tournamentMatches)
    .where(and(
      eq(tournamentMatches.organizationId, input.organizationId),
      eq(tournamentMatches.tournamentId, input.tournamentId),
    ));
  const final = matchRows.find((row) => row.key === GRAND_FINAL_KEY);
  if (final === undefined || matchRows.some((row) => row.key === GRAND_FINAL_RESET_KEY)) return;
  const reset = planGrandFinalReset({
    status: final.status as "WAITING" | "READY" | "IN_PROGRESS" | "COMPLETED" | "BYE" | "CANCELLED",
    resultType: final.resultType as "PLAYED" | "BYE" | "WALKOVER" | null,
    participantOneId: final.participantOneId,
    participantTwoId: final.participantTwoId,
    winnerPlayerId: final.winnerPlayerId,
  });
  if (reset === null) return;
  const [stage] = await transaction
    .select({ id: tournamentStages.id })
    .from(tournamentStages)
    .where(and(
      eq(tournamentStages.organizationId, input.organizationId),
      eq(tournamentStages.tournamentId, input.tournamentId),
      eq(tournamentStages.key, DOUBLE_ELIMINATION_STAGE_KEYS.grandFinal),
    ))
    .limit(1);
  if (stage === undefined) throw new Error("Grand final stage invariant violated.");

  const [created] = await transaction.insert(tournamentMatches).values({
    organizationId: input.organizationId,
    tournamentId: input.tournamentId,
    stageId: stage.id,
    groupId: null,
    key: reset.key,
    stageLabel: stageLabel(reset, new Map()),
    round: reset.round,
    position: reset.position,
    status: "READY",
    resultType: null,
    participantOneId: final.participantOneId,
    participantTwoId: final.participantTwoId,
    participantOneRef: reset.participantOne,
    participantTwoRef: reset.participantTwo,
    winnerPlayerId: null,
  }).returning({ id: tournamentMatches.id });
  if (created === undefined) throw new Error("Grand final reset insert did not return a row.");

  const payload = {
    tournamentId: input.tournamentId,
    tournamentMatchId: created.id,
    participantOneId: final.participantOneId,
    participantTwoId: final.participantTwoId,
  };
  await transaction.insert(outboxEvents).values({
    organizationId: input.organizationId,
    aggregateType: "Tournament",
    aggregateId: input.tournamentId,
    eventType: "TOURNAMENT_GRAND_FINAL_RESET",
    payload,
  });
  await transaction.insert(auditEvents).values({
    organizationId: input.organizationId,
    ...auditActor(input.actor.principal),
    action: "TOURNAMENT_GRAND_FINAL_RESET",
    entityType: "Tournament",
    entityId: input.tournamentId,
    newValue: payload,
    ip: input.actor.audit.ip,
    userAgent: input.actor.audit.userAgent,
    correlationId: input.actor.audit.correlationId,
  });
}
