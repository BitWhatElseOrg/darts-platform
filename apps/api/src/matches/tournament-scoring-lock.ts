import { and, eq } from "drizzle-orm";

import {
  tournamentMatches,
  tournaments,
  type Database,
  type TournamentMatch,
} from "@darts-platform/database";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function lockTournamentScoringContext(
  transaction: DatabaseTransaction,
  organizationId: string,
  scoringMatchId: string,
): Promise<TournamentMatch | null> {
  const [candidate] = await transaction
    .select({ id: tournamentMatches.id, tournamentId: tournamentMatches.tournamentId })
    .from(tournamentMatches)
    .where(and(
      eq(tournamentMatches.organizationId, organizationId),
      eq(tournamentMatches.scoringMatchId, scoringMatchId),
    ))
    .limit(1);
  if (candidate === undefined) return null;

  const [tournament] = await transaction
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(and(
      eq(tournaments.organizationId, organizationId),
      eq(tournaments.id, candidate.tournamentId),
    ))
    .for("update")
    .limit(1);
  if (tournament === undefined) throw new Error("Tournament scoring lock invariant violated.");

  const [scheduled] = await transaction
    .select()
    .from(tournamentMatches)
    .where(and(
      eq(tournamentMatches.organizationId, organizationId),
      eq(tournamentMatches.id, candidate.id),
      eq(tournamentMatches.scoringMatchId, scoringMatchId),
    ))
    .for("update")
    .limit(1);
  if (scheduled === undefined) throw new Error("Tournament scoring lock invariant violated.");
  return scheduled;
}
