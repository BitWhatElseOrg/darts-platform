import { and, eq } from "drizzle-orm";

import {
  outboxEvents,
  tournamentMatches,
  tournamentParticipants,
} from "@darts-platform/database";
import { resolveTournamentWithdrawals } from "@darts-platform/tournament-engine";

import type { DatabaseService } from "../database/database.service.js";
import { getWalkoverWithdrawnPlayerId } from "./walkover-provenance.js";

type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];

export async function applyWithdrawalPropagation(
  transaction: DatabaseTransaction,
  organizationId: string,
  tournamentId: string,
  now: Date,
): Promise<void> {
  const withdrawnRows = await transaction.select({ playerId: tournamentParticipants.playerId }).from(tournamentParticipants).where(and(
    eq(tournamentParticipants.organizationId, organizationId),
    eq(tournamentParticipants.tournamentId, tournamentId),
    eq(tournamentParticipants.status, "WITHDRAWN"),
  ));
  if (withdrawnRows.length === 0) return;

  const withdrawnPlayerIds = withdrawnRows.map((row) => row.playerId);
  const withdrawnSet = new Set(withdrawnPlayerIds);
  const matchRows = await transaction.select().from(tournamentMatches).where(and(
    eq(tournamentMatches.organizationId, organizationId),
    eq(tournamentMatches.tournamentId, tournamentId),
  )).for("update");
  const decisions = resolveTournamentWithdrawals({
    withdrawnPlayerIds,
    matches: matchRows.map((match) => ({
      id: match.id,
      status: match.status as "WAITING" | "READY" | "IN_PROGRESS" | "COMPLETED" | "BYE" | "CANCELLED",
      participantOneId: match.participantOneId,
      participantTwoId: match.participantTwoId,
      participantOneResolved: match.participantOneId !== null || match.participantOneRef === null,
      participantTwoResolved: match.participantTwoId !== null || match.participantTwoRef === null,
      sourceOneMatchId: match.sourceOneMatchId,
      sourceTwoMatchId: match.sourceTwoMatchId,
      winnerPlayerId: match.winnerPlayerId,
    })),
  });

  for (const decision of decisions) {
    const stored = matchRows.find((match) => match.id === decision.matchId);
    if (stored === undefined) throw new Error("Withdrawal propagation invariant violated.");
    if (stored.status === "IN_PROGRESS") {
      throw new Error("Automatic withdrawal propagation cannot abort an active scoring match.");
    }
    const completed = decision.status === "COMPLETED" || decision.status === "BYE";
    await transaction.update(tournamentMatches).set({
      status: decision.status,
      participantOneId: decision.participantOneId,
      participantTwoId: decision.participantTwoId,
      winnerPlayerId: decision.winnerPlayerId,
      resultType: decision.resultType,
      completedAt: completed ? now : null,
      version: stored.version + 1,
      updatedAt: now,
    }).where(and(
      eq(tournamentMatches.organizationId, organizationId),
      eq(tournamentMatches.id, stored.id),
    ));
    if (decision.resultType === "WALKOVER") {
      const withdrawnPlayerId = getWalkoverWithdrawnPlayerId(decision, withdrawnSet);
      await transaction.insert(outboxEvents).values({
        organizationId,
        aggregateType: "Tournament",
        aggregateId: tournamentId,
        eventType: "TOURNAMENT_MATCH_WALKOVER",
        payload: {
          tournamentId,
          tournamentMatchId: stored.id,
          winnerPlayerId: decision.winnerPlayerId,
          withdrawnPlayerId,
        },
      });
    }
  }
}
