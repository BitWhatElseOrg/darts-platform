import { and, eq, notInArray } from "drizzle-orm";
import { z } from "zod";

import {
  matchParticipantPlayers,
  matchParticipants,
  tournamentGroupParticipants,
  tournamentGroups,
  tournamentMatches,
  tournamentParticipants,
} from "@darts-platform/database";
import { calculateGroupStandings, type GroupMatchResult } from "@darts-platform/tournament-engine";

import type { DatabaseService } from "../database/database.service.js";

type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];

const groupRankReferenceSchema = z.object({
  type: z.literal("GROUP_RANK"),
  groupKey: z.string(),
  rank: z.number().int().positive(),
});

export async function resolveCompletedTournamentGroup(
  transaction: DatabaseTransaction,
  organizationId: string,
  tournamentId: string,
  groupId: string,
): Promise<void> {
  const [unfinished] = await transaction.select({ id: tournamentMatches.id }).from(tournamentMatches).where(and(
    eq(tournamentMatches.organizationId, organizationId),
    eq(tournamentMatches.groupId, groupId),
    notInArray(tournamentMatches.status, ["COMPLETED", "BYE", "CANCELLED"]),
  )).limit(1);
  if (unfinished !== undefined) return;

  const [group] = await transaction.select().from(tournamentGroups).where(and(
    eq(tournamentGroups.organizationId, organizationId),
    eq(tournamentGroups.id, groupId),
  )).limit(1);
  if (group === undefined) throw new Error("Tournament group invariant violated.");

  const [members, completed, withdrawnParticipants] = await Promise.all([
    transaction.select().from(tournamentGroupParticipants).where(and(
      eq(tournamentGroupParticipants.organizationId, organizationId),
      eq(tournamentGroupParticipants.groupId, groupId),
    )),
    transaction.select().from(tournamentMatches).where(and(
      eq(tournamentMatches.organizationId, organizationId),
      eq(tournamentMatches.groupId, groupId),
      eq(tournamentMatches.status, "COMPLETED"),
    )),
    transaction.select({ playerId: tournamentParticipants.playerId }).from(tournamentParticipants).where(and(
      eq(tournamentParticipants.organizationId, organizationId),
      eq(tournamentParticipants.tournamentId, tournamentId),
      eq(tournamentParticipants.status, "WITHDRAWN"),
    )),
  ]);

  const results: GroupMatchResult[] = [];
  for (const match of completed) {
    if (match.participantOneId === null || match.participantTwoId === null || match.winnerPlayerId === null) {
      throw new Error("Completed tournament match invariant violated.");
    }
    if (match.resultType === "WALKOVER") {
      results.push({ type: "WALKOVER", playerOneId: match.participantOneId, playerTwoId: match.participantTwoId, playerOneLegs: 0, playerTwoLegs: 0, winnerPlayerId: match.winnerPlayerId });
      continue;
    }
    if (match.scoringMatchId === null) throw new Error("Completed tournament match invariant violated.");
    const participantRows = await transaction
      .select({ playerId: matchParticipantPlayers.playerId, legsWon: matchParticipants.legsWon })
      .from(matchParticipants)
      .innerJoin(matchParticipantPlayers, and(
        eq(matchParticipantPlayers.participantId, matchParticipants.id),
        eq(matchParticipantPlayers.organizationId, organizationId),
      ))
      .where(and(
        eq(matchParticipants.organizationId, organizationId),
        eq(matchParticipants.matchId, match.scoringMatchId),
      ));
    const first = participantRows.find((participant) => participant.playerId === match.participantOneId);
    const second = participantRows.find((participant) => participant.playerId === match.participantTwoId);
    if (first === undefined || second === undefined) throw new Error("Completed match participant invariant violated.");
    results.push({ type: "PLAYED", playerOneId: first.playerId, playerTwoId: second.playerId, playerOneLegs: first.legsWon, playerTwoLegs: second.legsWon, winnerPlayerId: match.winnerPlayerId });
  }

  const standings = calculateGroupStandings({
    participants: members.map((member) => ({ playerId: member.playerId, seed: member.seed })),
    results,
    withdrawnPlayerIds: withdrawnParticipants.map((participant) => participant.playerId),
  });
  const qualifiers = standings.filter((standing) => !standing.withdrawn).slice(0, group.qualifyCount);
  const knockoutMatches = await transaction.select().from(tournamentMatches).where(and(
    eq(tournamentMatches.organizationId, organizationId),
    eq(tournamentMatches.tournamentId, tournamentId),
    eq(tournamentMatches.round, 1),
    eq(tournamentMatches.status, "WAITING"),
  )).for("update");

  for (const index of Array.from({ length: group.qualifyCount }, (_, rankIndex) => rankIndex)) {
    const standing = qualifiers[index];
    for (const knockoutMatch of knockoutMatches) {
      const firstReference = groupRankReferenceSchema.safeParse(knockoutMatch.participantOneRef);
      const secondReference = groupRankReferenceSchema.safeParse(knockoutMatch.participantTwoRef);
      const rank = index + 1;
      const resolvesFirst = firstReference.success && firstReference.data.groupKey === group.key && firstReference.data.rank === rank;
      const resolvesSecond = secondReference.success && secondReference.data.groupKey === group.key && secondReference.data.rank === rank;
      const participantOneId = resolvesFirst ? (standing?.playerId ?? null) : knockoutMatch.participantOneId;
      const participantTwoId = resolvesSecond ? (standing?.playerId ?? null) : knockoutMatch.participantTwoId;
      const participantOneRef = resolvesFirst && standing === undefined ? null : knockoutMatch.participantOneRef;
      const participantTwoRef = resolvesSecond && standing === undefined ? null : knockoutMatch.participantTwoRef;
      if (
        participantOneId === knockoutMatch.participantOneId &&
        participantTwoId === knockoutMatch.participantTwoId &&
        participantOneRef === knockoutMatch.participantOneRef &&
        participantTwoRef === knockoutMatch.participantTwoRef
      ) continue;
      await transaction.update(tournamentMatches).set({
        participantOneId,
        participantTwoId,
        participantOneRef,
        participantTwoRef,
        status: participantOneId !== null && participantTwoId !== null ? "READY" : knockoutMatch.status,
        updatedAt: new Date(),
      }).where(and(eq(tournamentMatches.organizationId, organizationId), eq(tournamentMatches.id, knockoutMatch.id)));
      knockoutMatch.participantOneId = participantOneId;
      knockoutMatch.participantTwoId = participantTwoId;
      knockoutMatch.participantOneRef = participantOneRef;
      knockoutMatch.participantTwoRef = participantTwoRef;
    }
  }
}
