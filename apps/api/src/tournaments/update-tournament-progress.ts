import { and, eq, notInArray } from "drizzle-orm";

import { tournamentMatches, tournaments, tournamentStages } from "@darts-platform/database";
import { calculateTournamentLifecycle } from "@darts-platform/tournament-engine";

import type { DatabaseService } from "../database/database.service.js";

type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];

export async function updateTournamentProgress(
  transaction: DatabaseTransaction,
  organizationId: string,
  tournamentId: string,
  now: Date,
): Promise<void> {
  const [[tournament], stages, openMatches] = await Promise.all([
    transaction.select({ format: tournaments.format }).from(tournaments).where(and(
      eq(tournaments.organizationId, organizationId),
      eq(tournaments.id, tournamentId),
    )).limit(1),
    transaction.select().from(tournamentStages).where(and(
      eq(tournamentStages.organizationId, organizationId),
      eq(tournamentStages.tournamentId, tournamentId),
    )),
    transaction.select({ stageId: tournamentMatches.stageId }).from(tournamentMatches).where(and(
      eq(tournamentMatches.organizationId, organizationId),
      eq(tournamentMatches.tournamentId, tournamentId),
      notInArray(tournamentMatches.status, ["COMPLETED", "BYE", "CANCELLED"]),
    )),
  ]);
  if (tournament === undefined) throw new Error("Tournament progression invariant violated.");
  const openStageIds = new Set(openMatches.map((match) => match.stageId));
  const lifecycle = calculateTournamentLifecycle({
    format: tournament.format as "GROUPS_THEN_KNOCKOUT" | "ROUND_ROBIN" | "SINGLE_ELIMINATION",
    stages: stages.map((stage) => ({
      id: stage.id,
      type: stage.type as "GROUP" | "ROUND_ROBIN" | "SINGLE_ELIMINATION",
      hasOpenMatches: openStageIds.has(stage.id),
    })),
  });

  for (const stage of lifecycle.stages) {
    await transaction.update(tournamentStages).set({ status: stage.status, updatedAt: now }).where(and(
      eq(tournamentStages.organizationId, organizationId),
      eq(tournamentStages.id, stage.id),
    ));
  }
  await transaction.update(tournaments).set({ status: lifecycle.tournamentStatus, updatedAt: now }).where(and(
    eq(tournaments.organizationId, organizationId),
    eq(tournaments.id, tournamentId),
  ));
}
