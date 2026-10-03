import {
  TournamentValidationError,
  generateKnockoutBracket,
  type EngineParticipant,
  type KnockoutParticipantReference,
  type PlannedMatch,
  type TournamentStructurePreview,
} from "./tournament.js";

/**
 * Doppel-K.-o. (Spec 2026-10-03, ADR 0022). Alle Spiele beider Tableaus und
 * das erste Final entstehen beim Start; nur das Rückspiel kommt bei Bedarf
 * dazu (`planGrandFinalReset`). Byes der Gewinnerrunde sind beim Start
 * bekannt: Wer aus einem Bye «verliert», existiert nicht. Solche Plätze im
 * Verlierer-Tableau werden hier weggekürzt, damit zur Laufzeit nie ein leerer
 * Verlierer weitergereicht werden muss.
 */
export const DOUBLE_ELIMINATION_STAGE_KEYS = {
  upper: "upper",
  lower: "lower",
  grandFinal: "grand-final",
} as const;

export const GRAND_FINAL_KEY = "grand-final:r1:m1";
export const GRAND_FINAL_RESET_KEY = "grand-final:r2:m1";

export type DoubleEliminationBracketSize = 4 | 8 | 16 | 32 | 64;

const BRACKET_SIZES: readonly number[] = [4, 8, 16, 32, 64];

interface Source {
  readonly kind: "WINNER" | "LOSER";
  readonly matchKey: string;
}

function reference(source: Source): KnockoutParticipantReference {
  return source.kind === "WINNER"
    ? { type: "MATCH_WINNER", matchKey: source.matchKey }
    : { type: "MATCH_LOSER", matchKey: source.matchKey };
}

function upperKey(round: number, position: number): string {
  return `${DOUBLE_ELIMINATION_STAGE_KEYS.upper}:r${round}:m${position}`;
}

export function planDoubleElimination(input: {
  readonly participants: readonly EngineParticipant[];
  readonly bracketSize: DoubleEliminationBracketSize;
}): readonly PlannedMatch[] {
  if (input.participants.length < 4) {
    throw new TournamentValidationError("NOT_ENOUGH_PARTICIPANTS", "Doppel-K.-o. braucht mindestens vier Teilnehmer.");
  }
  if (!BRACKET_SIZES.includes(input.bracketSize)) {
    throw new TournamentValidationError("INVALID_BRACKET_SIZE", "Das Doppel-K.-o.-Tableau braucht 4 bis 64 Plätze.");
  }
  const ordered = [...input.participants].sort((left, right) => left.seed - right.seed);
  // generateKnockoutBracket prüft Kapazität, Duplikate und leere Erstrundenpaarungen.
  const upper = generateKnockoutBracket({
    stageKey: DOUBLE_ELIMINATION_STAGE_KEYS.upper,
    participants: ordered.map((participant) => ({ type: "PLAYER" as const, playerId: participant.playerId })),
    bracketSize: input.bracketSize,
  }).map((match): PlannedMatch => ({ ...match, stageType: "DOUBLE_ELIMINATION_UPPER" }));
  const upperRounds = Math.log2(input.bracketSize);
  const byeKeys = new Set(upper.filter((match) => match.state === "BYE").map((match) => match.key));

  // Entfallene Verlierer-Spiele: was an ihrer Stelle weiterwandert (einzige Quelle oder nichts).
  const passthrough = new Map<string, Source | null>();
  const resolve = (source: Source): Source | null => {
    if (source.kind === "LOSER" && byeKeys.has(source.matchKey)) return null;
    if (source.kind === "WINNER" && passthrough.has(source.matchKey)) return passthrough.get(source.matchKey) ?? null;
    return source;
  };
  const lower: PlannedMatch[] = [];
  const addLower = (round: number, position: number, first: Source, second: Source): string => {
    const key = `${DOUBLE_ELIMINATION_STAGE_KEYS.lower}:r${round}:m${position}`;
    const one = resolve(first);
    const two = resolve(second);
    if (one !== null && two !== null) {
      lower.push({
        key,
        stageKey: DOUBLE_ELIMINATION_STAGE_KEYS.lower,
        stageType: "DOUBLE_ELIMINATION_LOWER",
        groupKey: null,
        round,
        position,
        participantOne: reference(one),
        participantTwo: reference(two),
        state: "WAITING",
        byeWinnerPlayerId: null,
      });
    } else {
      passthrough.set(key, one ?? two);
    }
    return key;
  };

  // Runde 1: Verlierer der Erstrunde paarweise.
  let previous: string[] = [];
  for (let position = 1; position <= input.bracketSize / 4; position += 1) {
    previous.push(
      addLower(1, position, { kind: "LOSER", matchKey: upperKey(1, position * 2 - 1) }, { kind: "LOSER", matchKey: upperKey(1, position * 2) }),
    );
  }
  let round = 1;
  for (let upperRound = 2; upperRound <= upperRounds; upperRound += 1) {
    // Einfallrunde: Sieger der Verliererrunde gegen Verlierer der Gewinnerrunde.
    // Jede zweite Einfallrunde gespiegelt, damit frühe Wiederholungsduelle ausbleiben.
    round += 1;
    const count = previous.length;
    const mirrored = upperRound % 2 === 0;
    const dropRound = round;
    previous = previous.map((winnerKey, index) =>
      addLower(
        dropRound,
        index + 1,
        { kind: "WINNER", matchKey: winnerKey },
        { kind: "LOSER", matchKey: upperKey(upperRound, mirrored ? count - index : index + 1) },
      ),
    );
    if (upperRound === upperRounds) break;
    // Konsolidierungsrunde: Sieger gegen Sieger.
    round += 1;
    const next: string[] = [];
    for (let index = 0; index < previous.length; index += 2) {
      const first = previous[index];
      const second = previous[index + 1];
      if (first === undefined || second === undefined) throw new Error("Double elimination pairing invariant violated.");
      next.push(addLower(round, index / 2 + 1, { kind: "WINNER", matchKey: first }, { kind: "WINNER", matchKey: second }));
    }
    previous = next;
  }

  const lowerFinal = previous[0];
  const lowerChampion = lowerFinal === undefined ? null : resolve({ kind: "WINNER", matchKey: lowerFinal });
  if (previous.length !== 1 || lowerChampion === null) {
    throw new Error("Double elimination invariant violated: lower bracket has no champion.");
  }
  const grandFinal: PlannedMatch = {
    key: GRAND_FINAL_KEY,
    stageKey: DOUBLE_ELIMINATION_STAGE_KEYS.grandFinal,
    stageType: "GRAND_FINAL",
    groupKey: null,
    round: 1,
    position: 1,
    participantOne: { type: "MATCH_WINNER", matchKey: upperKey(upperRounds, 1) },
    participantTwo: reference(lowerChampion),
    state: "WAITING",
    byeWinnerPlayerId: null,
  };
  return [...upper, ...renumberLowerRounds([...lower, grandFinal])];
}

/**
 * Nach dem Wegkürzen kann eine ganze Runde des Verlierer-Tableaus fehlen
 * (5 Teilnehmer im 8er-Tableau: keine Runde 1). Angezeigt würde sonst
 * «Verliererrunde · Runde 2» als erste Runde. Die verbliebenen Runden werden
 * deshalb fortlaufend ab 1 nummeriert; Keys und Verweise ziehen mit.
 */
function renumberLowerRounds(matches: readonly PlannedMatch[]): readonly PlannedMatch[] {
  const rounds = [...new Set(matches.filter((match) => match.stageType === "DOUBLE_ELIMINATION_LOWER").map((match) => match.round))]
    .sort((left, right) => left - right);
  const roundMap = new Map(rounds.map((round, index) => [round, index + 1]));
  const keyMap = new Map<string, string>();
  for (const match of matches) {
    const round = roundMap.get(match.round);
    if (match.stageType === "DOUBLE_ELIMINATION_LOWER" && round !== undefined) {
      keyMap.set(match.key, `${DOUBLE_ELIMINATION_STAGE_KEYS.lower}:r${round}:m${match.position}`);
    }
  }
  const remap = (reference: KnockoutParticipantReference | null): KnockoutParticipantReference | null =>
    reference !== null && (reference.type === "MATCH_WINNER" || reference.type === "MATCH_LOSER")
      ? { ...reference, matchKey: keyMap.get(reference.matchKey) ?? reference.matchKey }
      : reference;
  return matches.map((match) => ({
    ...match,
    key: keyMap.get(match.key) ?? match.key,
    round: match.stageType === "DOUBLE_ELIMINATION_LOWER" ? (roundMap.get(match.round) ?? match.round) : match.round,
    participantOne: remap(match.participantOne),
    participantTwo: remap(match.participantTwo),
  }));
}

export function previewDoubleElimination(input: {
  readonly participantCount: number;
  readonly knockoutSize: number;
}): TournamentStructurePreview {
  const warnings: string[] = [];
  if (input.participantCount < 4) warnings.push("Doppel-K.-o. braucht mindestens vier Teilnehmer.");
  if (!BRACKET_SIZES.includes(input.knockoutSize)) warnings.push("Das Doppel-K.-o.-Tableau braucht 4 bis 64 Plätze.");
  if (input.participantCount > input.knockoutSize) warnings.push("Das K.-o.-Tableau bietet nicht genug Plätze für alle Teilnehmer.");
  if (input.participantCount < input.knockoutSize / 2) {
    warnings.push("Das K.-o.-Tableau würde ein vollständig leeres Erstrundenmatch enthalten.");
  }
  if (warnings.length > 0) {
    return { groups: [], groupMatchCount: 0, knockoutSize: input.knockoutSize, knockoutMatchCount: 0, byes: 0, totalMatches: 0, warnings };
  }
  const plan = planDoubleElimination({
    participants: Array.from({ length: input.participantCount }, (_, index) => ({ playerId: `preview-${index + 1}`, seed: index + 1 })),
    bracketSize: input.knockoutSize as DoubleEliminationBracketSize,
  });
  const playable = plan.filter((match) => match.state !== "BYE").length;
  return {
    groups: [],
    groupMatchCount: 0,
    knockoutSize: input.knockoutSize,
    knockoutMatchCount: playable,
    byes: input.knockoutSize - input.participantCount,
    totalMatches: playable,
    warnings,
  };
}

export interface DoubleEliminationMatchResult {
  readonly key: string;
  readonly stageType: "DOUBLE_ELIMINATION_UPPER" | "DOUBLE_ELIMINATION_LOWER" | "GRAND_FINAL";
  readonly round: number;
  readonly status: "WAITING" | "READY" | "IN_PROGRESS" | "COMPLETED" | "BYE" | "CANCELLED";
  readonly resultType: "PLAYED" | "BYE" | "WALKOVER" | null;
  readonly participantOneId: string | null;
  readonly participantTwoId: string | null;
  readonly winnerPlayerId: string | null;
}

/**
 * Rückspiel, wenn der Sieger der Verliererrunde (Platz zwei des Finals) das
 * erste Final gespielt gewinnt: Beide stehen dann bei einer Niederlage. Ein
 * Walkover löst kein Rückspiel aus – wer sich zurückzieht, spielt auch das
 * Rückspiel nicht.
 */
export function planGrandFinalReset(
  final: Pick<DoubleEliminationMatchResult, "status" | "resultType" | "participantOneId" | "participantTwoId" | "winnerPlayerId">,
): PlannedMatch | null {
  if (final.status !== "COMPLETED" || final.resultType !== "PLAYED") return null;
  if (final.participantOneId === null || final.participantTwoId === null) return null;
  if (final.winnerPlayerId !== final.participantTwoId) return null;
  return {
    key: GRAND_FINAL_RESET_KEY,
    stageKey: DOUBLE_ELIMINATION_STAGE_KEYS.grandFinal,
    stageType: "GRAND_FINAL",
    groupKey: null,
    round: 2,
    position: 1,
    participantOne: { type: "PLAYER", playerId: final.participantOneId },
    participantTwo: { type: "PLAYER", playerId: final.participantTwoId },
    state: "READY",
    byeWinnerPlayerId: null,
  };
}

export function doubleEliminationChampion(matches: readonly DoubleEliminationMatchResult[]): string | null {
  const reset = matches.find((match) => match.key === GRAND_FINAL_RESET_KEY);
  if (reset !== undefined) return reset.status === "COMPLETED" ? reset.winnerPlayerId : null;
  const final = matches.find((match) => match.key === GRAND_FINAL_KEY);
  if (final === undefined || final.status !== "COMPLETED") return null;
  return planGrandFinalReset(final) === null ? final.winnerPlayerId : null;
}

/**
 * Endrangliste, sobald der Sieger feststeht. Rang = 1 + Anzahl Spieler, die
 * später ausgeschieden sind. Ausscheiden heisst: Niederlage im
 * Verlierer-Tableau (Stufe = Runde) oder im Final (Stufe hinter der letzten
 * Verliererrunde). Wer gleichzeitig ausscheidet, teilt den Rang. Ohne
 * Ausscheide-Spiel (beide zurückgezogen, Spiel entfällt) steht man am Ende.
 */
export function doubleEliminationPlacements(input: {
  readonly playerIds: readonly string[];
  readonly matches: readonly DoubleEliminationMatchResult[];
}): readonly { readonly rank: number; readonly playerId: string }[] {
  const champion = doubleEliminationChampion(input.matches);
  if (champion === null) return [];
  const lowerRounds = Math.max(
    0,
    ...input.matches.filter((match) => match.stageType === "DOUBLE_ELIMINATION_LOWER").map((match) => match.round),
  );
  const level = new Map<string, number>();
  // Nach Runde sortiert, damit das Rückspiel (Runde 2) die Stufe aus Runde 1 überschreibt.
  const ordered = [...input.matches].sort((left, right) => left.round - right.round);
  for (const match of ordered) {
    if (match.status !== "COMPLETED" || match.winnerPlayerId === null) continue;
    if (match.stageType === "DOUBLE_ELIMINATION_UPPER") continue;
    const loser = match.participantOneId === match.winnerPlayerId ? match.participantTwoId : match.participantOneId;
    if (loser === null) continue;
    level.set(loser, match.stageType === "GRAND_FINAL" ? lowerRounds + match.round : match.round);
  }
  level.set(champion, Number.POSITIVE_INFINITY);
  const levelOf = (playerId: string): number => level.get(playerId) ?? 0;
  return input.playerIds
    .map((playerId) => ({
      playerId,
      rank: 1 + input.playerIds.filter((other) => levelOf(other) > levelOf(playerId)).length,
    }))
    .sort((left, right) => left.rank - right.rank || left.playerId.localeCompare(right.playerId))
    .map(({ rank, playerId }) => ({ rank, playerId }));
}
