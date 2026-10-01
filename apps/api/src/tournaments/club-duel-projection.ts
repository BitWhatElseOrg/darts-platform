import {
  CLUB_DUEL_STAGE_KEYS,
  calculateClubScore,
  calculateClubStandings,
  calculateCrossRoundStandings,
  type ClubMatchResult,
  type ClubSide,
} from "@darts-platform/tournament-engine";
import type { ClubDuelDashboard, ClubRoundMatchResponse } from "@darts-platform/schemas";

import { isFinalRoundOccupied, occupiedFinalRoundEntrants, projectedQualifiers, type FinalRoundEntrant } from "./club-duel-entrants.js";
import { toCompletedResult, type LegsOf } from "./completed-match-results.js";
import type { TournamentDashboardData } from "./tournaments.repository.js";

type MatchRow = TournamentDashboardData["matches"][number];
type ParticipantRow = TournamentDashboardData["participants"][number];

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

function resultTypeOf(match: MatchRow): "PLAYED" | "WALKOVER" | "BYE" | null {
  return match.resultType === "PLAYED" || match.resultType === "WALKOVER" || match.resultType === "BYE" ? match.resultType : null;
}

/** Match aus Sicht A/B; die Seite eines vorhandenen Spielers bestimmt die Ausrichtung. */
function toRoundMatch(match: MatchRow, sideOf: ReadonlyMap<string, ClubSide>, legsOf: LegsOf, boardNameOf: ReadonlyMap<string, string>): ClubRoundMatchResponse {
  const swapped = match.participantOneId !== null ? sideOf.get(match.participantOneId) === "B" : match.participantTwoId !== null && sideOf.get(match.participantTwoId) === "A";
  const [playerAId, playerBId] = swapped ? [match.participantTwoId, match.participantOneId] : [match.participantOneId, match.participantTwoId];
  const result = toCompletedResult(match, legsOf);
  const legs = typeof result === "object" && result !== null && result.type === "PLAYED"
    ? (swapped ? [result.playerTwoLegs, result.playerOneLegs] : [result.playerOneLegs, result.playerTwoLegs]) as [number, number]
    : null;
  return {
    matchId: match.id,
    position: match.position,
    playerAId,
    playerBId,
    status: match.status as ClubRoundMatchResponse["status"],
    resultType: resultTypeOf(match),
    winnerPlayerId: match.winnerPlayerId,
    legs,
    // `boardId` bleibt nach dem Abschluss stehen (nur die Korrektur leert ihn).
    boardName: match.boardId === null ? null : boardNameOf.get(match.boardId) ?? null,
  };
}

/**
 * Wer zum Zeitpunkt einer abgeschlossenen Runde aktiv war: heute aktiv oder
 * erst nach dem Abschluss der Runde zurueckgezogen (`roundClosedAt`). Fuer
 * die laufende Runde (`null`) zaehlt nur der heutige Status.
 */
function wasActive(participant: ParticipantRow, roundClosedAt: Date | null): boolean {
  if (participant.status === "ACTIVE") return true;
  return roundClosedAt !== null && participant.withdrawnAt !== null && participant.withdrawnAt > roundClosedAt;
}

/**
 * Zeitpunkt, an dem die letzte Quali-Runde in die Finalrunde ueberging. Die
 * Finalrunde wird in derselben Transaktion besetzt, die das letzte Spiel der
 * Runde abschliesst; dessen `completedAt` ist deshalb der Besetzungszeitpunkt.
 * `updatedAt` der Finalrunden-Matches taugt nicht als Dauerreferenz: es
 * wandert mit Start, Abschluss und Rueckzug nach vorn. Nur wenn kein Spiel der
 * Runde einen Abschlusszeitpunkt traegt (alle abgesagt), dient das kleinste
 * `updatedAt` der Finalrunde als Naeherung.
 */
function finalRoundOccupiedAt(lastRound: readonly MatchRow[], finalRoundMatches: readonly MatchRow[]): Date | null {
  const completed = lastRound.flatMap((match) => (match.completedAt === null ? [] : [match.completedAt.getTime()]));
  if (completed.length > 0) return new Date(Math.max(...completed));
  return finalRoundMatches.length === 0 ? null : new Date(Math.min(...finalRoundMatches.map((match) => match.updatedAt.getTime())));
}

function collect(matches: readonly MatchRow[], legsOf: LegsOf): { results: ClubMatchResult[]; unopposedWalkoverWinnerIds: string[] } {
  const results: ClubMatchResult[] = [];
  const unopposedWalkoverWinnerIds: string[] = [];
  for (const match of matches) {
    const result = toCompletedResult(match, legsOf);
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
  const finalId = stageByKey.get(CLUB_DUEL_STAGE_KEYS.final);
  if (qualifyingId === undefined || finalRoundId === undefined || finalId === undefined) throw new Error("Club duel stage invariant violated.");

  const names = new Map(input.data.participants.map((participant) => [participant.playerId, participant.displayName]));
  const nameOf = (playerId: string) => names.get(playerId) ?? "Unbekannter Teilnehmer";
  const participants = input.data.participants.map((participant) => ({ playerId: participant.playerId, seed: participant.seed, side: toSide(participant.side) }));
  const withdrawnPlayerIds = input.data.participants.filter((participant) => participant.status === "WITHDRAWN").map((participant) => participant.playerId);
  const sideOf = new Map(participants.map((participant) => [participant.playerId, participant.side]));
  const boardNameOf = new Map(input.data.boards.map((board) => [board.boardId, board.boardName]));

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
    // Abschluss einer Runde: Paarung der Folgerunde, fuer die letzte Runde die Besetzung der Finalrunde.
    const followingRound = qualifyingMatches.filter((match) => match.round === round + 1);
    const roundClosedAt = followingRound.length > 0
      ? new Date(Math.min(...followingRound.map((match) => match.createdAt.getTime())))
      : round === currentRound && occupied ? finalRoundOccupiedAt(inRound, finalRoundMatches) : null;
    return {
      round,
      matchIds: inRound.map((match) => match.id),
      matches: inRound.map((match) => toRoundMatch(match, sideOf, input.legsOf, boardNameOf)),
      pausedPlayerIds: input.data.participants
        .filter((participant) => wasActive(participant, roundClosedAt) && !playing.has(participant.playerId))
        .map((participant) => participant.playerId),
    };
  });

  const finalStageMatches = input.data.matches.filter((match) => match.stageId === finalId);
  const finalMatchAt = (position: number): ClubRoundMatchResponse | null => {
    const match = finalStageMatches.find((candidate) => candidate.position === position);
    return match === undefined ? null : toRoundMatch(match, sideOf, input.legsOf, boardNameOf);
  };

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
        const result = toCompletedResult(match, input.legsOf);
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
    // Position 1 ist das Final, Position 2 das Spiel um Platz 3 (Engine: finalMatches).
    finals: {
      final: finalMatchAt(1),
      thirdPlace: finalMatchAt(2),
    },
    score,
  };
}
