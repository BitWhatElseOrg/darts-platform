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

function numberAt(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) throw new Error("Assignment index invariant violated.");
  return value;
}

/**
 * Ungarischer Algorithmus (Kuhn–Munkres, Potentialform), O(n³). Liefert für
 * jede Zeile i die Spalte `assignment[i]` mit minimalen Gesamtkosten.
 * Deterministisch: gleiche Matrix, gleiche Zuordnung.
 */
function solveAssignment(cost: readonly (readonly number[])[]): readonly number[] {
  const n = cost.length;
  const INF = Number.MAX_SAFE_INTEGER;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(INF);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = numberAt(p, j0);
      let delta = INF;
      let j1 = 0;
      const row = cost[i0 - 1];
      if (row === undefined) throw new Error("Assignment row invariant violated.");
      for (let j = 1; j <= n; j += 1) {
        if (used[j] === true) continue;
        const current = numberAt(row, j - 1) - numberAt(u, i0) - numberAt(v, j);
        if (current < numberAt(minv, j)) {
          minv[j] = current;
          way[j] = j0;
        }
        if (numberAt(minv, j) < delta) {
          delta = numberAt(minv, j);
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j] === true) {
          u[numberAt(p, j)] = numberAt(u, numberAt(p, j)) + delta;
          v[j] = numberAt(v, j) - delta;
        } else {
          minv[j] = numberAt(minv, j) - delta;
        }
      }
      j0 = j1;
    } while (numberAt(p, j0) !== 0);
    do {
      const j1 = numberAt(way, j0);
      p[j0] = numberAt(p, j1);
      j0 = j1;
    } while (j0 !== 0);
  }
  const assignment = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j += 1) assignment[numberAt(p, j) - 1] = j - 1;
  return assignment;
}

function selectPaused(
  larger: readonly ClubRankedPlayer[],
  count: number,
  pauses: ReadonlyMap<string, number>,
  played: ReadonlyMap<string, number>,
): readonly string[] {
  // Spec: wenigste Pausen → bei Gleichstand mehr Spiele → höhere Seed-Nummer
  return [...larger]
    .sort((left, right) =>
      (pauses.get(left.playerId) ?? 0) - (pauses.get(right.playerId) ?? 0) ||
      (played.get(right.playerId) ?? 0) - (played.get(left.playerId) ?? 0) ||
      right.seed - left.seed,
    )
    .slice(0, count)
    .map((player) => player.playerId);
}

/**
 * Paart eine Quali-Runde (Spec, Engine). Pausen nur bei der grösseren Seite;
 * dann Zuordnung A×B mit Kosten `|RangA − RangB|` plus Strafe je Wiederholung,
 * so dass Wiederholungen zuerst minimiert werden und danach die Rangnähe.
 */
export function pairClubSwissRound(input: ClubSwissPairingInput): ClubSwissRound {
  if (input.sideA.length === 0 || input.sideB.length === 0) {
    throw new TournamentValidationError("CLUB_DUEL_SIDE_EMPTY", "Beide Vereine brauchen mindestens einen aktiven Spieler.");
  }
  const larger = input.sideA.length >= input.sideB.length ? input.sideA : input.sideB;
  const pauseCount = Math.abs(input.sideA.length - input.sideB.length);
  const pausedPlayerIds = selectPaused(larger, pauseCount, input.pauses, input.played);
  const paused = new Set(pausedPlayerIds);
  const playingA = input.sideA.filter((player) => !paused.has(player.playerId));
  const playingB = input.sideB.filter((player) => !paused.has(player.playerId));
  if (playingA.length !== playingB.length) throw new Error("Club duel pause invariant violated.");

  const previous = new Set(input.previousPairings.map((pair) => `${pair.playerAId}:${pair.playerBId}`));
  // Die Summe aller Rangabstände einer Zuordnung ist < n²; eine Wiederholung kostet n²+1
  // und wiegt damit immer schwerer als jede Rangordnung.
  const repeatPenalty = playingA.length * playingA.length + 1;
  const cost = playingA.map((playerA, rankA) =>
    playingB.map((playerB, rankB) =>
      Math.abs(rankA - rankB) + (previous.has(`${playerA.playerId}:${playerB.playerId}`) ? repeatPenalty : 0),
    ),
  );
  const assignment = solveAssignment(cost);
  const pairings = playingA.map((playerA, index) => {
    const playerB = playingB[numberAt(assignment, index)];
    if (playerB === undefined) throw new Error("Club duel assignment invariant violated.");
    return {
      position: index + 1,
      playerAId: playerA.playerId,
      playerBId: playerB.playerId,
      repeated: previous.has(`${playerA.playerId}:${playerB.playerId}`),
    };
  });
  const repeated = pairings.filter((pairing) => pairing.repeated).length;
  const warnings = repeated === 0
    ? []
    : [
        repeated === 1
          ? `Runde ${input.round}: 1 Paarung wiederholt sich, weil keine neuen Gegner mehr frei sind.`
          : `Runde ${input.round}: ${repeated} Paarungen wiederholen sich, weil keine neuen Gegner mehr frei sind.`,
      ];
  return { round: input.round, pairings, pausedPlayerIds, warnings };
}

export type ClubMatchResult = GroupMatchResult;

export interface ClubStandingRow {
  readonly position: number;
  readonly playerId: string;
  readonly side: ClubSide;
  readonly seed: number;
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly legsFor: number;
  readonly legsAgainst: number;
  /** Siege / Spiele; 0 ohne Spiel. */
  readonly winRate: number;
  /** (legsFor − legsAgainst) / Spiele; 0 ohne Spiel. */
  readonly legDifferencePerMatch: number;
  readonly withdrawn: boolean;
}

export interface ClubStandings {
  readonly overall: readonly ClubStandingRow[];
  readonly sideA: readonly ClubStandingRow[];
  readonly sideB: readonly ClubStandingRow[];
}

interface Tally {
  readonly playerId: string;
  readonly side: ClubSide;
  readonly seed: number;
  played: number;
  won: number;
  lost: number;
  legsFor: number;
  legsAgainst: number;
}

function assertClubResult(result: ClubMatchResult, sideOf: ReadonlyMap<string, ClubSide>): void {
  const sideOne = sideOf.get(result.playerOneId);
  const sideTwo = sideOf.get(result.playerTwoId);
  if (sideOne === undefined || sideTwo === undefined) {
    throw new TournamentValidationError("INVALID_GROUP_RESULT", "A result references an invalid participant.");
  }
  if (sideOne === sideTwo) {
    throw new TournamentValidationError("CLUB_DUEL_SAME_SIDE_PAIRING", "Ein Spiel muss zwischen den beiden Vereinen stattfinden.");
  }
  const validWinner = result.winnerPlayerId === result.playerOneId || result.winnerPlayerId === result.playerTwoId;
  // Ruling R10: Bei Saetzen kann der Sieger insgesamt gleich viele oder weniger Legs haben;
  // massgeblich ist der gespeicherte Sieger.
  const validScore = result.type === "WALKOVER"
    ? result.playerOneLegs === 0 && result.playerTwoLegs === 0
    : result.playerOneLegs >= 0 && result.playerTwoLegs >= 0;
  if (!validWinner || !validScore) {
    throw new TournamentValidationError("INVALID_GROUP_RESULT", "A result is invalid.");
  }
}

function applyResult(tallies: ReadonlyMap<string, Tally>, result: ClubMatchResult): void {
  const one = tallies.get(result.playerOneId);
  const two = tallies.get(result.playerTwoId);
  if (one === undefined || two === undefined) throw new Error("Tally invariant violated.");
  one.played += 1;
  two.played += 1;
  one.legsFor += result.playerOneLegs;
  one.legsAgainst += result.playerTwoLegs;
  two.legsFor += result.playerTwoLegs;
  two.legsAgainst += result.playerOneLegs;
  const winner = result.winnerPlayerId === one.playerId ? one : two;
  const loser = winner === one ? two : one;
  winner.won += 1;
  loser.lost += 1;
}

/**
 * Ganzzahlige Quotenvergleiche (Kreuzmultiplikation) statt Gleitkomma, damit
 * gleiche Quoten exakt gleich sind. Spieler ohne Spiel stehen hinter allen mit Spiel.
 */
function compareTallies(left: Tally, right: Tally): number {
  if ((left.played === 0) !== (right.played === 0)) return left.played === 0 ? 1 : -1;
  if (left.played === 0) return left.seed - right.seed;
  const winRate = right.won * left.played - left.won * right.played;
  if (winRate !== 0) return winRate;
  const legDifference = (right.legsFor - right.legsAgainst) * left.played - (left.legsFor - left.legsAgainst) * right.played;
  if (legDifference !== 0) return legDifference;
  const legsFor = right.legsFor * left.played - left.legsFor * right.played;
  if (legsFor !== 0) return legsFor;
  return left.seed - right.seed;
}

function toRows(tallies: readonly Tally[], withdrawn: ReadonlySet<string>): readonly ClubStandingRow[] {
  return [...tallies].sort(compareTallies).map((tally, index) => ({
    position: index + 1,
    playerId: tally.playerId,
    side: tally.side,
    seed: tally.seed,
    played: tally.played,
    won: tally.won,
    lost: tally.lost,
    legsFor: tally.legsFor,
    legsAgainst: tally.legsAgainst,
    winRate: tally.played === 0 ? 0 : tally.won / tally.played,
    legDifferencePerMatch: tally.played === 0 ? 0 : (tally.legsFor - tally.legsAgainst) / tally.played,
    withdrawn: withdrawn.has(tally.playerId),
  }));
}

export function calculateClubStandings(input: {
  readonly participants: readonly ClubDuelParticipant[];
  readonly results: readonly ClubMatchResult[];
  readonly withdrawnPlayerIds?: readonly string[];
}): ClubStandings {
  assertUniqueClubParticipants(input.participants);
  const sideOf = new Map(input.participants.map((participant) => [participant.playerId, participant.side]));
  const tallies = new Map<string, Tally>(
    input.participants.map((participant) => [
      participant.playerId,
      { playerId: participant.playerId, side: participant.side, seed: participant.seed, played: 0, won: 0, lost: 0, legsFor: 0, legsAgainst: 0 },
    ]),
  );
  for (const result of input.results) {
    assertClubResult(result, sideOf);
    applyResult(tallies, result);
  }
  const withdrawn = new Set(input.withdrawnPlayerIds ?? []);
  const all = [...tallies.values()];
  return {
    overall: toRows(all, withdrawn),
    sideA: toRows(all.filter((tally) => tally.side === "A"), withdrawn),
    sideB: toRows(all.filter((tally) => tally.side === "B"), withdrawn),
  };
}

export interface CrossRoundEntrant {
  readonly playerId: string;
  readonly qualifyingRank: number;
}

export interface CrossRoundStandingRow {
  readonly position: number;
  readonly playerId: string;
  readonly played: number;
  readonly won: number;
  readonly legsFor: number;
  readonly legsAgainst: number;
  readonly legDifference: number;
  readonly qualifyingRank: number;
}

export function calculateCrossRoundStandings(input: {
  readonly sideA: readonly CrossRoundEntrant[];
  readonly sideB: readonly CrossRoundEntrant[];
  readonly results: readonly ClubMatchResult[];
  readonly unopposedWalkoverWinnerIds?: readonly string[];
}): { readonly sideA: readonly CrossRoundStandingRow[]; readonly sideB: readonly CrossRoundStandingRow[] } {
  const sideOf = new Map<string, ClubSide>([
    ...input.sideA.map((entrant) => [entrant.playerId, "A"] as const),
    ...input.sideB.map((entrant) => [entrant.playerId, "B"] as const),
  ]);
  const rankOf = new Map([...input.sideA, ...input.sideB].map((entrant) => [entrant.playerId, entrant.qualifyingRank]));
  const tallies = new Map<string, Tally>(
    [...sideOf.entries()].map(([playerId, side]) => [playerId, { playerId, side, seed: rankOf.get(playerId) ?? 0, played: 0, won: 0, lost: 0, legsFor: 0, legsAgainst: 0 }]),
  );
  for (const result of input.results) {
    assertClubResult(result, sideOf);
    applyResult(tallies, result);
  }
  for (const playerId of input.unopposedWalkoverWinnerIds ?? []) {
    const tally = tallies.get(playerId);
    if (tally === undefined) throw new TournamentValidationError("INVALID_GROUP_RESULT", "A walkover references an invalid participant.");
    tally.played += 1;
    tally.won += 1;
  }
  const rows = (side: ClubSide): readonly CrossRoundStandingRow[] =>
    [...tallies.values()]
      .filter((tally) => tally.side === side)
      .sort((left, right) =>
        right.won - left.won ||
        (right.legsFor - right.legsAgainst) - (left.legsFor - left.legsAgainst) ||
        left.seed - right.seed,
      )
      .map((tally, index) => ({
        position: index + 1,
        playerId: tally.playerId,
        played: tally.played,
        won: tally.won,
        legsFor: tally.legsFor,
        legsAgainst: tally.legsAgainst,
        legDifference: tally.legsFor - tally.legsAgainst,
        qualifyingRank: tally.seed,
      }));
  return { sideA: rows("A"), sideB: rows("B") };
}

export interface ClubScore {
  readonly pointsA: number;
  readonly pointsB: number;
  /** Legdifferenz aus Sicht von A; für B ist sie das Negative. */
  readonly legDifferenceA: number;
  readonly leader: ClubSide | "TIED";
}

/** Spec, Vereinswertung: 1 Punkt pro gewonnenem Spiel inkl. Walkover; Gleichstand → Legdifferenz → TIED. */
export function calculateClubScore(input: {
  readonly sideOf: ReadonlyMap<string, ClubSide>;
  readonly results: readonly ClubMatchResult[];
  readonly unopposedWalkoverWinnerIds?: readonly string[];
}): ClubScore {
  let pointsA = 0;
  let pointsB = 0;
  let legDifferenceA = 0;
  for (const result of input.results) {
    assertClubResult(result, input.sideOf);
    const winnerSide = input.sideOf.get(result.winnerPlayerId);
    if (winnerSide === "A") pointsA += 1;
    else pointsB += 1;
    const legsA = input.sideOf.get(result.playerOneId) === "A" ? result.playerOneLegs - result.playerTwoLegs : result.playerTwoLegs - result.playerOneLegs;
    legDifferenceA += legsA;
  }
  for (const playerId of input.unopposedWalkoverWinnerIds ?? []) {
    const side = input.sideOf.get(playerId);
    if (side === undefined) throw new TournamentValidationError("INVALID_GROUP_RESULT", "A walkover references an invalid participant.");
    if (side === "A") pointsA += 1;
    else pointsB += 1;
  }
  const leader: ClubSide | "TIED" =
    pointsA !== pointsB ? (pointsA > pointsB ? "A" : "B") : legDifferenceA !== 0 ? (legDifferenceA > 0 ? "A" : "B") : "TIED";
  return { pointsA, pointsB, legDifferenceA, leader };
}
