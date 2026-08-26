import { TournamentValidationError } from "./tournament.js";

export type AdvancedCompetitor =
  | { readonly id: string; readonly kind: "PLAYER"; readonly memberIds: readonly [string]; readonly seed: number; readonly region?: string }
  | { readonly id: string; readonly kind: "PAIR" | "TEAM"; readonly memberIds: readonly string[]; readonly seed: number; readonly region?: string };

export type StageDefinition =
  | { readonly key: string; readonly type: "ROUND_ROBIN" | "SINGLE_ELIMINATION" | "DOUBLE_ELIMINATION"; readonly advance: number }
  | { readonly key: string; readonly type: "SWISS"; readonly rounds: number; readonly advance: number }
  | { readonly key: string; readonly type: "PLACEMENT"; readonly places: readonly [number, number] };

export interface EliminationSource { readonly result: "WINNER" | "LOSER"; readonly matchKey: string }
export interface EliminationMatch { readonly key: string; readonly bracket: "UPPER" | "LOWER" | "GRAND_FINAL"; readonly round: number; readonly position: number; readonly sources: readonly EliminationSource[] }
export interface SwissStanding { readonly competitorId: string; readonly points: number; readonly buchholz: number; readonly seed: number; readonly opponentIds: readonly string[]; readonly hadBye: boolean }
export interface SwissPairing { readonly boardOrder: number; readonly competitorOneId: string; readonly competitorTwoId: string | null; readonly bye: boolean }

export function validateCompetitors(competitors: readonly AdvancedCompetitor[]): void {
  if (competitors.length < 2) throw new TournamentValidationError("NOT_ENOUGH_COMPETITORS", "Mindestens zwei Teilnehmer sind erforderlich.");
  if (new Set(competitors.map((competitor) => competitor.id)).size !== competitors.length) throw new TournamentValidationError("DUPLICATE_COMPETITOR", "Ein Teilnehmer darf nur einmal vorkommen.");
  const members = competitors.flatMap((competitor) => [...competitor.memberIds]);
  if (new Set(members).size !== members.length) throw new TournamentValidationError("DUPLICATE_TEAM_MEMBER", "Eine Person darf nur einem Team oder Paar angehören.");
  for (const competitor of competitors) {
    if (competitor.kind === "PLAYER" && competitor.memberIds.length !== 1) throw new TournamentValidationError("INVALID_PLAYER", "Ein Einzelteilnehmer braucht genau eine Person.");
    if (competitor.kind === "PAIR" && competitor.memberIds.length !== 2) throw new TournamentValidationError("INVALID_PAIR", "Ein Paar braucht genau zwei Personen.");
    if (competitor.kind === "TEAM" && competitor.memberIds.length < 2) throw new TournamentValidationError("INVALID_TEAM", "Ein Team braucht mindestens zwei Personen.");
  }
}

export function validateStageComposition(stages: readonly StageDefinition[]): void {
  if (stages.length === 0) throw new TournamentValidationError("EMPTY_STAGE_COMPOSITION", "Mindestens eine Stage ist erforderlich.");
  if (new Set(stages.map((stage) => stage.key)).size !== stages.length) throw new TournamentValidationError("DUPLICATE_STAGE_KEY", "Jeder Stage-Schlüssel muss eindeutig sein.");
  stages.forEach((stage, index) => {
    if (stage.type === "SWISS" && (stage.rounds < 1 || stage.rounds > 15)) throw new TournamentValidationError("INVALID_SWISS_ROUNDS", "Das Schweizer System braucht 1 bis 15 Runden.");
    if (stage.type === "PLACEMENT" && index !== stages.length - 1) throw new TournamentValidationError("PLACEMENT_NOT_LAST", "Platzierungsspiele müssen die letzte Stage sein.");
    if (stage.type !== "PLACEMENT" && stage.advance < 1) throw new TournamentValidationError("INVALID_QUALIFICATION", "Mindestens ein Teilnehmer muss weiterkommen.");
  });
}

export function generateDoubleElimination(size: 4 | 8 | 16 | 32 | 64): readonly EliminationMatch[] {
  const upperRounds = Math.log2(size);
  const matches: EliminationMatch[] = [];
  const upperKeys: string[][] = [];
  for (let round = 1; round <= upperRounds; round += 1) {
    const count = size / 2 ** round;
    const keys = Array.from({ length: count }, (_, position) => `upper-${round}-${position + 1}`);
    upperKeys.push(keys);
    keys.forEach((key, position) => {
      const previous = upperKeys[round - 2];
      matches.push({ key, bracket: "UPPER", round, position: position + 1, sources: previous === undefined ? [] : [
        { result: "WINNER", matchKey: previous[position * 2] ?? "" },
        { result: "WINNER", matchKey: previous[position * 2 + 1] ?? "" },
      ] });
    });
  }
  let previousLower: string[] = [];
  for (let upperRound = 2; upperRound <= upperRounds; upperRound += 1) {
    const incomingUpper = upperKeys[upperRound - 2] ?? [];
    const consolidationRound = upperRound * 2 - 3;
    const consolidationKeys = Array.from({ length: incomingUpper.length / 2 }, (_, position) => `lower-${consolidationRound}-${position + 1}`);
    consolidationKeys.forEach((key, position) => {
      const sources = previousLower.length === 0
        ? [incomingUpper[position * 2], incomingUpper[position * 2 + 1]].map((matchKey) => ({ result: "LOSER" as const, matchKey: matchKey ?? "" }))
        : [previousLower[position * 2], previousLower[position * 2 + 1]].map((matchKey) => ({ result: "WINNER" as const, matchKey: matchKey ?? "" }));
      matches.push({ key, bracket: "LOWER", round: consolidationRound, position: position + 1, sources });
    });
    const dropRound = consolidationRound + 1;
    const dropKeys = consolidationKeys.map((_, position) => `lower-${dropRound}-${position + 1}`);
    const currentUpper = upperKeys[upperRound - 1] ?? [];
    dropKeys.forEach((key, position) => matches.push({ key, bracket: "LOWER", round: dropRound, position: position + 1, sources: [
      { result: "WINNER", matchKey: consolidationKeys[position] ?? "" },
      { result: "LOSER", matchKey: currentUpper[position] ?? "" },
    ] }));
    previousLower = dropKeys;
  }
  const upperFinal = upperKeys.at(-1)?.[0];
  const lowerFinal = previousLower[0];
  if (upperFinal === undefined || lowerFinal === undefined) throw new Error("Double-Elimination-Plan ist unvollständig.");
  matches.push({ key: "grand-final", bracket: "GRAND_FINAL", round: 1, position: 1, sources: [
    { result: "WINNER", matchKey: upperFinal }, { result: "WINNER", matchKey: lowerFinal },
  ] });
  return matches;
}

export function pairSwissRound(standings: readonly SwissStanding[]): readonly SwissPairing[] {
  if (standings.length < 2) throw new TournamentValidationError("NOT_ENOUGH_COMPETITORS", "Mindestens zwei Teilnehmer sind erforderlich.");
  const ordered = [...standings].sort((left, right) => right.points - left.points || right.buchholz - left.buchholz || left.seed - right.seed);
  const pairings: SwissPairing[] = [];
  if (ordered.length % 2 === 1) {
    const reverseIndex = [...ordered].reverse().findIndex((standing) => !standing.hadBye);
    if (reverseIndex < 0) throw new TournamentValidationError("NO_SWISS_BYE_AVAILABLE", "Kein Teilnehmer kann ein weiteres Bye erhalten.");
    const [bye] = ordered.splice(ordered.length - 1 - reverseIndex, 1);
    if (bye === undefined) throw new Error("Bye-Auswahl ist fehlgeschlagen.");
    pairings.push({ boardOrder: Math.ceil(standings.length / 2), competitorOneId: bye.competitorId, competitorTwoId: null, bye: true });
  }
  let boardOrder = 1;
  while (ordered.length > 0) {
    const first = ordered.shift();
    if (first === undefined) break;
    const freshOpponent = ordered.findIndex((candidate) => !first.opponentIds.includes(candidate.competitorId));
    const [second] = ordered.splice(freshOpponent >= 0 ? freshOpponent : 0, 1);
    if (second === undefined) throw new Error("Schweizer Paarung ist unvollständig.");
    pairings.push({ boardOrder, competitorOneId: first.competitorId, competitorTwoId: second.competitorId, bye: false });
    boardOrder += 1;
  }
  return pairings.sort((left, right) => left.boardOrder - right.boardOrder);
}

export function allocateAdvancedSeeds(competitors: readonly AdvancedCompetitor[], groupCount: number): readonly (readonly AdvancedCompetitor[])[] {
  validateCompetitors(competitors);
  if (!Number.isInteger(groupCount) || groupCount < 1 || groupCount > competitors.length) throw new TournamentValidationError("INVALID_GROUP_COUNT", "Die Gruppenzahl ist ungültig.");
  const groups: AdvancedCompetitor[][] = Array.from({ length: groupCount }, () => []);
  for (const competitor of [...competitors].sort((left, right) => left.seed - right.seed)) {
    const candidates = groups.map((group, index) => ({ group, index, sameRegion: group.filter((entry) => entry.region !== undefined && entry.region === competitor.region).length }))
      .sort((left, right) => left.sameRegion - right.sameRegion || left.group.length - right.group.length || left.index - right.index);
    candidates[0]?.group.push(competitor);
  }
  return groups;
}
