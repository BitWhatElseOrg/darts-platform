import { and, eq, isNotNull, ne, or } from "drizzle-orm";

import { tournamentMatches, tournamentStages, tournaments } from "@darts-platform/database";
import { CLUB_DUEL_STAGE_KEYS } from "@darts-platform/tournament-engine";

import type { DatabaseService } from "../database/database.service.js";

type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];

/**
 * Spec, Resultatkorrektur: gesperrt, sobald die Phase nach dem Spiel feststeht,
 * also Folgerunde gepaart, Finalrunde besetzt oder Final besetzt. Fuer andere
 * Formate immer false. Der Aufrufer haelt die Turnierzeile bereits gesperrt
 * (`FOR UPDATE`), damit keine Paarung zwischen Pruefung und Korrektur entsteht.
 */
export async function isClubDuelResultLocked(
  transaction: DatabaseTransaction,
  organizationId: string,
  tournamentId: string,
  scheduled: { readonly stageId: string; readonly round: number },
): Promise<boolean> {
  const [tournament] = await transaction
    .select({ format: tournaments.format, qualifyingRounds: tournaments.qualifyingRounds })
    .from(tournaments)
    .where(and(eq(tournaments.organizationId, organizationId), eq(tournaments.id, tournamentId)))
    .limit(1);
  if (tournament?.format !== "CLUB_DUEL") return false;
  const stages = await transaction
    .select()
    .from(tournamentStages)
    .where(and(eq(tournamentStages.organizationId, organizationId), eq(tournamentStages.tournamentId, tournamentId)));
  const keyById = new Map(stages.map((stage) => [stage.id, stage.key]));
  const idByKey = new Map(stages.map((stage) => [stage.key, stage.id]));
  const occupied = async (stageId: string | undefined, round?: number): Promise<boolean> => {
    if (stageId === undefined) return false;
    const [row] = await transaction
      .select({ id: tournamentMatches.id })
      .from(tournamentMatches)
      .where(and(
        eq(tournamentMatches.organizationId, organizationId),
        eq(tournamentMatches.stageId, stageId),
        round === undefined ? undefined : eq(tournamentMatches.round, round),
        or(
          isNotNull(tournamentMatches.participantOneId),
          isNotNull(tournamentMatches.participantTwoId),
          ne(tournamentMatches.status, "WAITING"),
        ),
      ))
      .limit(1);
    return row !== undefined;
  };
  const stageKey = keyById.get(scheduled.stageId);
  if (stageKey === CLUB_DUEL_STAGE_KEYS.qualifying) {
    if (tournament.qualifyingRounds !== null && scheduled.round < tournament.qualifyingRounds) {
      if (await occupied(idByKey.get(CLUB_DUEL_STAGE_KEYS.qualifying), scheduled.round + 1)) return true;
    }
    return occupied(idByKey.get(CLUB_DUEL_STAGE_KEYS.finalRound));
  }
  if (stageKey === CLUB_DUEL_STAGE_KEYS.finalRound) return occupied(idByKey.get(CLUB_DUEL_STAGE_KEYS.final));
  return false;
}
