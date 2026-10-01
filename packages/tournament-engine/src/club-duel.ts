import {
  TournamentValidationError,
  type GroupMatchResult,
  type PlannedMatch,
} from "./tournament.js";

export type ClubSide = "A" | "B";

export interface ClubDuelParticipant {
  readonly playerId: string;
  readonly seed: number;
  readonly side: ClubSide;
}

/** Spieler einer Seite, Reihenfolge im Array = aktueller Rang (bester zuerst). */
export interface ClubRankedPlayer {
  readonly playerId: string;
  readonly seed: number;
}

export interface ClubSwissPairing {
  readonly position: number;
  readonly playerAId: string;
  readonly playerBId: string;
  /** Diese beiden haben in der Quali schon gegeneinander gespielt. */
  readonly repeated: boolean;
}

export interface ClubSwissRound {
  readonly round: number;
  readonly pairings: readonly ClubSwissPairing[];
  readonly pausedPlayerIds: readonly string[];
  readonly warnings: readonly string[];
}

export interface ClubSwissPairingInput {
  readonly round: number;
  readonly sideA: readonly ClubRankedPlayer[];
  readonly sideB: readonly ClubRankedPlayer[];
  readonly previousPairings: readonly { readonly playerAId: string; readonly playerBId: string }[];
  /** Pausen bisher je Spieler (fehlt ein Spieler: 0). */
  readonly pauses: ReadonlyMap<string, number>;
  /** Spiele bisher je Spieler (fehlt ein Spieler: 0). */
  readonly played: ReadonlyMap<string, number>;
}

export interface ClubDuelPlanInput {
  readonly participants: readonly ClubDuelParticipant[];
  readonly qualifyingRounds: number;
  readonly finalRoundSize: number;
  readonly thirdPlaceMatch: boolean;
}

export interface ClubDuelPlan {
  readonly matches: readonly PlannedMatch[];
  readonly roundOne: ClubSwissRound;
}

export interface ClubDuelPreviewInput {
  readonly sideACount: number;
  readonly sideBCount: number;
  readonly qualifyingRounds: number;
  readonly finalRoundSize: number;
  readonly thirdPlaceMatch: boolean;
  readonly boardCount: number;
  readonly bestOfLegs: number;
}

export interface ClubDuelPreview {
  readonly qualifyingMatches: number;
  readonly finalRoundMatches: number;
  readonly finalMatches: number;
  readonly totalMatches: number;
  readonly matchesPerPlayer: {
    readonly sideA: { readonly min: number; readonly max: number };
    readonly sideB: { readonly min: number; readonly max: number };
  };
  readonly estimatedMinutes: number;
  readonly warnings: readonly string[];
}

export const CLUB_DUEL_STAGE_KEYS = {
  qualifying: "qualifying",
  finalRound: "final-round",
  final: "final",
} as const;

export const CLUB_DUEL_LIMITS = {
  minRounds: 1,
  maxRounds: 15,
  minFinalRoundSize: 2,
  maxFinalRoundSize: 6,
} as const;

/** Grobe Planungsgrösse für die Vorschau; dieselbe Annahme wie `match-overrun.ts` in der API. */
const ESTIMATED_MINUTES_PER_LEG = 4;

function assertRounds(rounds: number): void {
  if (!Number.isInteger(rounds) || rounds < CLUB_DUEL_LIMITS.minRounds || rounds > CLUB_DUEL_LIMITS.maxRounds) {
    throw new TournamentValidationError("INVALID_CLUB_DUEL_ROUNDS", "Die Qualifikation braucht 1 bis 15 Runden.");
  }
}

function assertFinalRoundSize(size: number, smallerSide: number): void {
  if (!Number.isInteger(size) || size < CLUB_DUEL_LIMITS.minFinalRoundSize || size > CLUB_DUEL_LIMITS.maxFinalRoundSize) {
    throw new TournamentValidationError("INVALID_CLUB_DUEL_FINAL_ROUND_SIZE", "Die Finalrunde braucht 2 bis 6 Spieler je Verein.");
  }
  if (smallerSide < size) {
    throw new TournamentValidationError("CLUB_DUEL_SIDE_TOO_SMALL", "Jeder Verein braucht mindestens so viele Spieler wie die Finalrunde Plätze hat.");
  }
}

function assertUniqueClubParticipants(participants: readonly ClubDuelParticipant[]): void {
  if (new Set(participants.map((participant) => participant.playerId)).size !== participants.length) {
    throw new TournamentValidationError("DUPLICATE_PARTICIPANT", "A participant may only appear once.");
  }
  if (new Set(participants.map((participant) => participant.seed)).size !== participants.length) {
    throw new TournamentValidationError("DUPLICATE_SEED", "Every seed must be unique.");
  }
}

export function sidePlayers(participants: readonly ClubDuelParticipant[], side: ClubSide): readonly ClubRankedPlayer[] {
  return participants
    .filter((participant) => participant.side === side)
    .sort((left, right) => left.seed - right.seed)
    .map((participant) => ({ playerId: participant.playerId, seed: participant.seed }));
}

export function plannedQualifyingMatch(round: number, pairing: ClubSwissPairing): PlannedMatch {
  return {
    key: `${CLUB_DUEL_STAGE_KEYS.qualifying}:r${round}:m${pairing.position}`,
    stageKey: CLUB_DUEL_STAGE_KEYS.qualifying,
    stageType: "CLUB_SWISS",
    groupKey: null,
    round,
    position: pairing.position,
    participantOne: { type: "PLAYER", playerId: pairing.playerAId },
    participantTwo: { type: "PLAYER", playerId: pairing.playerBId },
    state: "READY",
    byeWinnerPlayerId: null,
  };
}

function crossRoundMatches(size: number): readonly PlannedMatch[] {
  const matches: PlannedMatch[] = [];
  for (let round = 1; round <= size; round += 1) {
    for (let rankA = 1; rankA <= size; rankA += 1) {
      // Spec: Runde r, A_i trifft B_j mit j = ((i + r − 2) mod N) + 1
      const rankB = ((rankA + round - 2) % size) + 1;
      matches.push({
        key: `${CLUB_DUEL_STAGE_KEYS.finalRound}:r${round}:m${rankA}`,
        stageKey: CLUB_DUEL_STAGE_KEYS.finalRound,
        stageType: "CLUB_CROSS_ROUND_ROBIN",
        groupKey: null,
        round,
        position: rankA,
        participantOne: { type: "SIDE_RANK", stageKey: CLUB_DUEL_STAGE_KEYS.qualifying, side: "A", rank: rankA },
        participantTwo: { type: "SIDE_RANK", stageKey: CLUB_DUEL_STAGE_KEYS.qualifying, side: "B", rank: rankB },
        state: "WAITING",
        byeWinnerPlayerId: null,
      });
    }
  }
  return matches;
}

function finalMatches(thirdPlaceMatch: boolean): readonly PlannedMatch[] {
  const finalMatch = (position: number, rank: number): PlannedMatch => ({
    key: `${CLUB_DUEL_STAGE_KEYS.final}:r1:m${position}`,
    stageKey: CLUB_DUEL_STAGE_KEYS.final,
    stageType: "SINGLE_ELIMINATION",
    groupKey: null,
    round: 1,
    position,
    participantOne: { type: "SIDE_RANK", stageKey: CLUB_DUEL_STAGE_KEYS.finalRound, side: "A", rank },
    participantTwo: { type: "SIDE_RANK", stageKey: CLUB_DUEL_STAGE_KEYS.finalRound, side: "B", rank },
    state: "WAITING",
    byeWinnerPlayerId: null,
  });
  return thirdPlaceMatch ? [finalMatch(1, 1), finalMatch(2, 2)] : [finalMatch(1, 1)];
}

export function planClubDuel(input: ClubDuelPlanInput): ClubDuelPlan {
  assertUniqueClubParticipants(input.participants);
  assertRounds(input.qualifyingRounds);
  const sideA = sidePlayers(input.participants, "A");
  const sideB = sidePlayers(input.participants, "B");
  if (sideA.length === 0 || sideB.length === 0) {
    throw new TournamentValidationError("CLUB_DUEL_SIDE_EMPTY", "Beide Vereine brauchen mindestens einen Spieler.");
  }
  assertFinalRoundSize(input.finalRoundSize, Math.min(sideA.length, sideB.length));

  const roundOne = pairClubSwissRound({
    round: 1,
    sideA,
    sideB,
    previousPairings: [],
    pauses: new Map(),
    played: new Map(),
  });
  return {
    roundOne,
    matches: [
      ...roundOne.pairings.map((pairing) => plannedQualifyingMatch(1, pairing)),
      ...crossRoundMatches(input.finalRoundSize),
      ...finalMatches(input.thirdPlaceMatch),
    ],
  };
}

export function previewClubDuel(input: ClubDuelPreviewInput): ClubDuelPreview {
  assertRounds(input.qualifyingRounds);
  if (!Number.isInteger(input.sideACount) || !Number.isInteger(input.sideBCount) || input.sideACount < 1 || input.sideBCount < 1) {
    throw new TournamentValidationError("CLUB_DUEL_SIDE_EMPTY", "Beide Vereine brauchen mindestens einen Spieler.");
  }
  if (!Number.isInteger(input.boardCount) || input.boardCount < 1) {
    throw new TournamentValidationError("INVALID_STRUCTURE", "Mindestens eine Scheibe ist nötig.");
  }
  const smaller = Math.min(input.sideACount, input.sideBCount);
  const larger = Math.max(input.sideACount, input.sideBCount);
  assertFinalRoundSize(input.finalRoundSize, smaller);

  const qualifyingMatches = input.qualifyingRounds * smaller;
  const largerMin = Math.floor(qualifyingMatches / larger);
  const largerMax = Math.ceil(qualifyingMatches / larger);
  const perSmaller = { min: input.qualifyingRounds, max: input.qualifyingRounds };
  const perLarger = { min: largerMin, max: largerMax };
  const finalRoundMatches = input.finalRoundSize * input.finalRoundSize;
  const finalCount = input.thirdPlaceMatch ? 2 : 1;
  const totalMatches = qualifyingMatches + finalRoundMatches + finalCount;
  const minutesPerMatch = input.bestOfLegs * ESTIMATED_MINUTES_PER_LEG;
  const warnings: string[] = [];
  // Ein Spieler der kleineren Seite hat `larger` mögliche Gegner; danach wiederholt sich etwas.
  if (input.qualifyingRounds > larger) {
    warnings.push(`Ab Runde ${larger + 1} sind Wiederholungen von Paarungen unvermeidbar.`);
  }
  return {
    qualifyingMatches,
    finalRoundMatches,
    finalMatches: finalCount,
    totalMatches,
    matchesPerPlayer: {
      sideA: input.sideACount <= input.sideBCount ? perSmaller : perLarger,
      sideB: input.sideBCount <= input.sideACount ? perSmaller : perLarger,
    },
    estimatedMinutes: Math.ceil(totalMatches / input.boardCount) * minutesPerMatch,
    warnings,
  };
}

/**
 * Vorläufig (Task 1): paart Rang i gegen Rang i ohne Historie. Task 2 ersetzt
 * den Rumpf durch Pausen-Rotation und Zuordnungsproblem.
 */
export function pairClubSwissRound(input: ClubSwissPairingInput): ClubSwissRound {
  const larger = input.sideA.length >= input.sideB.length ? input.sideA : input.sideB;
  const pauseCount = Math.abs(input.sideA.length - input.sideB.length);
  const pausedPlayerIds = [...larger].reverse().slice(0, pauseCount).map((player) => player.playerId);
  const paused = new Set(pausedPlayerIds);
  const playingA = input.sideA.filter((player) => !paused.has(player.playerId));
  const playingB = input.sideB.filter((player) => !paused.has(player.playerId));
  const pairings = playingA.map((playerA, index) => {
    const playerB = playingB[index];
    if (playerB === undefined) throw new Error("Club duel pairing invariant violated.");
    return { position: index + 1, playerAId: playerA.playerId, playerBId: playerB.playerId, repeated: false };
  });
  return { round: input.round, pairings, pausedPlayerIds, warnings: [] };
}

// `GroupMatchResult` wird in Task 3 für die Ranglisten wiederverwendet.
export type ClubMatchResult = GroupMatchResult;
