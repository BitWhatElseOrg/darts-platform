import {
  CLUB_DUEL_STAGE_KEYS,
  calculateClubScore,
  calculateClubStandings,
  calculateCrossRoundStandings,
  type ClubMatchResult,
  type ClubSide,
} from "@darts-platform/tournament-engine";
import type { ClubDuelDashboard } from "@darts-platform/schemas";

import { isFinalRoundOccupied, occupiedFinalRoundEntrants, projectedQualifiers, type FinalRoundEntrant } from "./club-duel-entrants.js";
import type { TournamentDashboardData } from "./tournaments.repository.js";

type MatchRow = TournamentDashboardData["matches"][number];
type LegsOf = (scoringMatchId: string, playerId: string) => number | undefined;

function sideRankOf(reference: unknown): { readonly rank: number } | null {
  if (typeof reference !== "object" || reference === null) return null;
  const candidate = reference as { type?: unknown; rank?: unknown };
  if (candidate.type !== "SIDE_RANK" || typeof candidate.rank !== "number") return null;
  return { rank: candidate.rank };
}

function toSide(value: string | null): ClubSide {
  if (value === "A" || value === "B") return value;
  throw new Error("Club duel participant without side.");
}

function resultOf(match: MatchRow, legsOf: LegsOf): ClubMatchResult | "unopposed" | null {
  if (match.status !== "COMPLETED" || match.winnerPlayerId === null) return null;
  if (match.participantOneId === null || match.participantTwoId === null) return match.resultType === "WALKOVER" ? "unopposed" : null;
  if (match.resultType === "WALKOVER") {
    return { type: "WALKOVER", playerOneId: match.participantOneId, playerTwoId: match.participantTwoId, playerOneLegs: 0, playerTwoLegs: 0, winnerPlayerId: match.winnerPlayerId };
  }
  if (match.scoringMatchId === null) return null;
  const legsOne = legsOf(match.scoringMatchId, match.participantOneId);
  const legsTwo = legsOf(match.scoringMatchId, match.participantTwoId);
  if (legsOne === undefined || legsTwo === undefined) return null;
  return { type: "PLAYED", playerOneId: match.participantOneId, playerTwoId: match.participantTwoId, playerOneLegs: legsOne, playerTwoLegs: legsTwo, winnerPlayerId: match.winnerPlayerId };
}

function collect(matches: readonly MatchRow[], legsOf: LegsOf): { results: ClubMatchResult[]; unopposedWalkoverWinnerIds: string[] } {
  const results: ClubMatchResult[] = [];
  const unopposedWalkoverWinnerIds: string[] = [];
  for (const match of matches) {
    const result = resultOf(match, legsOf);
    if (result === null) continue;
    if (result === "unopposed") {
      if (match.winnerPlayerId !== null) unopposedWalkoverWinnerIds.push(match.winnerPlayerId);
      continue;
    }
    results.push(result);
  }
  return { results, unopposedWalkoverWinnerIds };
}

/**
 * Reine Projektion der gespeicherten Daten; entscheidet nichts, was nicht die
 * Engine entscheidet. Die Finalrunden-Teilnehmer folgen derselben Regel wie
 * `advance-club-duel.ts`: bei besetzter Finalrunde aus deren Matches, sonst
 * voraussichtlich aus der Quali-Rangliste.
 */
export function projectClubDuel(input: {
  readonly data: TournamentDashboardData;
  readonly legsOf: LegsOf;
}): ClubDuelDashboard | null {
  const { tournament } = input.data;
  if (tournament.format !== "CLUB_DUEL") return null;
  if (tournament.sideAName === null || tournament.sideBName === null || tournament.qualifyingRounds === null || tournament.finalRoundSize === null) {
    throw new Error("Club duel configuration invariant violated.");
  }
  const finalRoundSize = tournament.finalRoundSize;
  const stageByKey = new Map(input.data.stages.map((stage) => [stage.key, stage.id]));
  const qualifyingId = stageByKey.get(CLUB_DUEL_STAGE_KEYS.qualifying);
  const finalRoundId = stageByKey.get(CLUB_DUEL_STAGE_KEYS.finalRound);
  if (qualifyingId === undefined || finalRoundId === undefined) throw new Error("Club duel stage invariant violated.");

  const names = new Map(input.data.participants.map((participant) => [participant.playerId, participant.displayName]));
  const nameOf = (playerId: string) => names.get(playerId) ?? "Unbekannter Teilnehmer";
  const participants = input.data.participants.map((participant) => ({ playerId: participant.playerId, seed: participant.seed, side: toSide(participant.side) }));
  const withdrawnPlayerIds = input.data.participants.filter((participant) => participant.status === "WITHDRAWN").map((participant) => participant.playerId);
  const activeIds = new Set(input.data.participants.filter((participant) => participant.status === "ACTIVE").map((participant) => participant.playerId));
  const sideOf = new Map(participants.map((participant) => [participant.playerId, participant.side]));

  const qualifyingMatches = input.data.matches.filter((match) => match.stageId === qualifyingId);
  const finalRoundMatches = input.data.matches.filter((match) => match.stageId === finalRoundId);
  const qualifyingResults = collect(qualifyingMatches, input.legsOf);
  const standings = calculateClubStandings({ participants, results: qualifyingResults.results, withdrawnPlayerIds });

  const occupied = isFinalRoundOccupied(finalRoundMatches);
  const entrants: Record<ClubSide, readonly FinalRoundEntrant[]> = occupied
    ? { A: occupiedFinalRoundEntrants(finalRoundMatches, sideOf, standings, "A"), B: occupiedFinalRoundEntrants(finalRoundMatches, sideOf, standings, "B") }
    : (() => {
        const projected = projectedQualifiers(standings, finalRoundSize);
        const entrantsOf = (side: ClubSide) => projected[side].map((playerId) => ({
          playerId,
          qualifyingRank: (side === "A" ? standings.sideA : standings.sideB).find((row) => row.playerId === playerId)?.position ?? 0,
        }));
        return { A: entrantsOf("A"), B: entrantsOf("B") };
      })();
  const qualified = { A: new Set(entrants.A.map((entrant) => entrant.playerId)), B: new Set(entrants.B.map((entrant) => entrant.playerId)) };
  const toRow = (row: (typeof standings.overall)[number]) => {
    const { seed, ...rest } = row;
    void seed;
    return { ...rest, displayName: nameOf(row.playerId), qualified: qualified[row.side].has(row.playerId) };
  };

  const currentRound = qualifyingMatches.reduce((max, match) => Math.max(max, match.round), 0);
  const rounds = Array.from({ length: currentRound }, (_, index) => {
    const round = index + 1;
    const inRound = qualifyingMatches.filter((match) => match.round === round);
    const playing = new Set(inRound.flatMap((match) => [match.participantOneId, match.participantTwoId]));
    return {
      round,
      matchIds: inRound.map((match) => match.id),
      pausedPlayerIds: [...activeIds].filter((playerId) => !playing.has(playerId)),
    };
  });

  const crossResults = collect(finalRoundMatches, input.legsOf);
  const cross = calculateCrossRoundStandings({
    sideA: entrants.A,
    sideB: entrants.B,
    results: crossResults.results,
    unopposedWalkoverWinnerIds: crossResults.unopposedWalkoverWinnerIds,
  });
  const toCrossRow = (side: ClubSide) => (row: (typeof cross.sideA)[number]) => ({ ...row, side, displayName: nameOf(row.playerId) });

  const allResults = collect(input.data.matches, input.legsOf);
  const score = calculateClubScore({ sideOf, results: allResults.results, unopposedWalkoverWinnerIds: allResults.unopposedWalkoverWinnerIds });

  return {
    sideAName: tournament.sideAName,
    sideBName: tournament.sideBName,
    qualifyingRounds: tournament.qualifyingRounds,
    finalRoundSize,
    thirdPlaceMatch: tournament.thirdPlaceMatch,
    currentRound,
    rounds,
    standings: {
      overall: standings.overall.map(toRow),
      sideA: standings.sideA.map(toRow),
      sideB: standings.sideB.map(toRow),
    },
    finalRound: {
      sideA: cross.sideA.map(toCrossRow("A")),
      sideB: cross.sideB.map(toCrossRow("B")),
      matches: finalRoundMatches.map((match) => {
        const first = sideRankOf(match.participantOneRef);
        const second = sideRankOf(match.participantTwoRef);
        const result = resultOf(match, input.legsOf);
        return {
          matchId: match.id,
          round: match.round,
          rankA: first?.rank ?? match.position,
          rankB: second?.rank ?? ((match.position + match.round - 2) % finalRoundSize) + 1,
          playerAId: match.participantOneId,
          playerBId: match.participantTwoId,
          status: match.status as "WAITING" | "READY" | "IN_PROGRESS" | "COMPLETED" | "BYE" | "CANCELLED",
          winnerPlayerId: match.winnerPlayerId,
          legs: typeof result === "object" && result !== null && result.type === "PLAYED" ? [result.playerOneLegs, result.playerTwoLegs] : null,
        };
      }),
    },
    score,
  };
}
