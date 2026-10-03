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
  return [...upper, ...lower, grandFinal];
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
