import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  DOUBLE_ELIMINATION_STAGE_KEYS,
  GRAND_FINAL_KEY,
  GRAND_FINAL_RESET_KEY,
  doubleEliminationChampion,
  doubleEliminationPlacements,
  planDoubleElimination,
  planGrandFinalReset,
  previewDoubleElimination,
  type DoubleEliminationBracketSize,
  type DoubleEliminationMatchResult,
} from "./double-elimination";
import { TournamentValidationError, type PlannedMatch } from "./tournament";

const participants = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ playerId: `p${index + 1}`, seed: index + 1 }));

function bracketSizeFor(count: number): DoubleEliminationBracketSize {
  const size = 2 ** Math.ceil(Math.log2(count));
  return Math.max(4, size) as DoubleEliminationBracketSize;
}

function sourceKey(reference: PlannedMatch["participantOne"]): string | null {
  return reference !== null && (reference.type === "MATCH_WINNER" || reference.type === "MATCH_LOSER") ? reference.matchKey : null;
}

/**
 * Spielt einen Plan durch: `pick` entscheidet jedes Spiel. Liefert Niederlagen
 * je Spieler und die Anzahl gespielter Spiele (ohne Byes, ohne Rückspiel).
 */
function simulate(plan: readonly PlannedMatch[], pick: (one: string, two: string) => string) {
  const winners = new Map<string, string>();
  const losers = new Map<string, string>();
  const losses = new Map<string, number>();
  const resolve = (reference: PlannedMatch["participantOne"]): string | null => {
    if (reference === null) return null;
    switch (reference.type) {
      case "PLAYER": return reference.playerId;
      case "MATCH_WINNER": return winners.get(reference.matchKey) ?? null;
      case "MATCH_LOSER": return losers.get(reference.matchKey) ?? null;
      case "GROUP_RANK":
      case "SIDE_RANK": throw new Error("unexpected reference");
    }
  };
  let played = 0;
  const pending = [...plan];
  while (pending.length > 0) {
    const index = pending.findIndex((match) => {
      if (match.state === "BYE") return true;
      return resolve(match.participantOne) !== null && resolve(match.participantTwo) !== null;
    });
    if (index < 0) throw new Error(`Blockiert: ${pending.map((match) => match.key).join(", ")}`);
    const [match] = pending.splice(index, 1);
    if (match === undefined) throw new Error("unreachable");
    if (match.state === "BYE") {
      if (match.byeWinnerPlayerId === null) throw new Error("Bye ohne Sieger");
      winners.set(match.key, match.byeWinnerPlayerId);
      continue;
    }
    const one = resolve(match.participantOne);
    const two = resolve(match.participantTwo);
    if (one === null || two === null) throw new Error("unreachable");
    const winner = pick(one, two);
    const loser = winner === one ? two : one;
    winners.set(match.key, winner);
    losers.set(match.key, loser);
    losses.set(loser, (losses.get(loser) ?? 0) + 1);
    played += 1;
  }
  const final = plan.find((match) => match.key === GRAND_FINAL_KEY);
  if (final === undefined) throw new Error("kein Final");
  const finalists = [resolve(final.participantOne), resolve(final.participantTwo)] as const;
  return { winners, losses, played, finalists };
}

describe("planDoubleElimination", () => {
  it("legt bei 4 Teilnehmern 3 Gewinner-, 2 Verlierer-Spiele und das Final an", () => {
    const plan = planDoubleElimination({ participants: participants(4), bracketSize: 4 });
    expect(plan.filter((match) => match.stageType === "DOUBLE_ELIMINATION_UPPER")).toHaveLength(3);
    expect(plan.filter((match) => match.stageType === "DOUBLE_ELIMINATION_LOWER")).toHaveLength(2);
    const final = plan.find((match) => match.key === GRAND_FINAL_KEY);
    expect(final).toMatchObject({
      stageKey: DOUBLE_ELIMINATION_STAGE_KEYS.grandFinal,
      stageType: "GRAND_FINAL",
      round: 1,
      position: 1,
      participantOne: { type: "MATCH_WINNER", matchKey: "upper:r2:m1" },
      participantTwo: { type: "MATCH_WINNER", matchKey: "lower:r2:m1" },
      state: "WAITING",
    });
    expect(plan.find((match) => match.key === "lower:r1:m1")).toMatchObject({
      participantOne: { type: "MATCH_LOSER", matchKey: "upper:r1:m1" },
      participantTwo: { type: "MATCH_LOSER", matchKey: "upper:r1:m2" },
    });
    expect(plan.find((match) => match.key === "lower:r2:m1")).toMatchObject({
      participantOne: { type: "MATCH_WINNER", matchKey: "lower:r1:m1" },
      participantTwo: { type: "MATCH_LOSER", matchKey: "upper:r2:m1" },
    });
  });

  it.each([4, 5, 6, 7, 9, 13, 17, 33, 64])(
    "%i Teilnehmer: Runden der Verliererrunde fortlaufend ab 1, Keys passend zur Runde",
    (count) => {
      const lower = planDoubleElimination({ participants: participants(count), bracketSize: bracketSizeFor(count) })
        .filter((match) => match.stageType === "DOUBLE_ELIMINATION_LOWER");
      const rounds = [...new Set(lower.map((match) => match.round))].sort((left, right) => left - right);
      expect(rounds).toEqual(Array.from({ length: rounds.length }, (_, index) => index + 1));
      for (const match of lower) expect(match.key).toBe(`lower:r${match.round}:m${match.position}`);
    },
  );

  it("kürzt Verlierer-Spiele weg, deren Zubringer ein Bye ist", () => {
    // 5 Teilnehmer im 8er-Tableau: drei Byes in Runde 1 der Gewinnerrunde.
    const plan = planDoubleElimination({ participants: participants(5), bracketSize: 8 });
    for (const match of plan.filter((entry) => entry.stageType === "DOUBLE_ELIMINATION_LOWER")) {
      expect(match.participantOne).not.toBeNull();
      expect(match.participantTwo).not.toBeNull();
    }
    const byeKeys = new Set(plan.filter((match) => match.state === "BYE").map((match) => match.key));
    for (const match of plan) {
      for (const reference of [match.participantOne, match.participantTwo]) {
        if (reference?.type === "MATCH_LOSER") expect(byeKeys.has(reference.matchKey)).toBe(false);
      }
    }
  });

  it.each([4, 5, 6, 7, 8, 9, 13, 16, 17, 31, 32, 33, 48, 64])(
    "%i Teilnehmer: Quellen existieren und liegen früher, Keys eindeutig",
    (count) => {
      const plan = planDoubleElimination({ participants: participants(count), bracketSize: bracketSizeFor(count) });
      const order = new Map(plan.map((match, index) => [match.key, index]));
      expect(order.size).toBe(plan.length);
      plan.forEach((match, index) => {
        for (const reference of [match.participantOne, match.participantTwo]) {
          const key = sourceKey(reference);
          if (key === null) continue;
          const sourceIndex = order.get(key);
          expect(sourceIndex, `${match.key} -> ${key}`).toBeDefined();
          expect(sourceIndex ?? Infinity).toBeLessThan(index);
        }
      });
    },
  );

  it("bis zum ersten Final: 2n−2 Spiele, alle ausser den Finalisten verlieren genau zweimal", () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 64 }), fc.array(fc.boolean(), { minLength: 200, maxLength: 200 }), (count, coins) => {
        const plan = planDoubleElimination({ participants: participants(count), bracketSize: bracketSizeFor(count) });
        let flip = 0;
        const { losses, played, finalists } = simulate(plan, (one, two) => ((coins[flip++ % coins.length] ?? true) ? one : two));
        // Summe aller Niederlagen = gespielte Spiele. Bis und mit erstem Final:
        // n−2 Ausgeschiedene à 2, Sieger der Verliererrunde 1, Sieger der
        // Gewinnerrunde 0 oder 1 – zusammen immer 2n−2 bzw. 2n−3 + Final.
        expect(played).toBe(2 * count - 2);
        const [upperChampion, lowerChampion] = finalists;
        if (upperChampion === null || lowerChampion === null) throw new Error("Finalist fehlt");
        for (const participant of participants(count)) {
          if (participant.playerId === upperChampion || participant.playerId === lowerChampion) continue;
          expect(losses.get(participant.playerId), participant.playerId).toBe(2);
        }
        expect(losses.get(lowerChampion) ?? 0).toBeGreaterThanOrEqual(1);
        expect(losses.get(upperChampion) ?? 0).toBeLessThanOrEqual(1);
      }),
      { numRuns: 200 },
    );
  });

  it("verlangt mindestens vier Teilnehmer", () => {
    expect(() => planDoubleElimination({ participants: participants(3), bracketSize: 4 })).toThrow(TournamentValidationError);
  });

  it("lehnt ein Tableau mit leerer Erstrundenpaarung ab", () => {
    expect(() => planDoubleElimination({ participants: participants(4), bracketSize: 16 })).toThrow(TournamentValidationError);
  });
});

describe("previewDoubleElimination", () => {
  it("zählt 2n−2 Spiele und die Byes", () => {
    expect(previewDoubleElimination({ participantCount: 13, knockoutSize: 16 })).toEqual({
      groups: [],
      groupMatchCount: 0,
      knockoutSize: 16,
      knockoutMatchCount: 24,
      byes: 3,
      totalMatches: 24,
      warnings: [],
    });
  });

  it("warnt statt zu werfen, wenn die Struktur nicht passt", () => {
    const preview = previewDoubleElimination({ participantCount: 20, knockoutSize: 16 });
    expect(preview.totalMatches).toBe(0);
    expect(preview.warnings).toContain("Das K.-o.-Tableau bietet nicht genug Plätze für alle Teilnehmer.");
  });
});

const played = (overrides: Partial<DoubleEliminationMatchResult> & Pick<DoubleEliminationMatchResult, "key" | "stageType" | "round">): DoubleEliminationMatchResult => ({
  status: "COMPLETED",
  resultType: "PLAYED",
  participantOneId: null,
  participantTwoId: null,
  winnerPlayerId: null,
  ...overrides,
});

describe("planGrandFinalReset", () => {
  const final = { status: "COMPLETED", resultType: "PLAYED", participantOneId: "upper", participantTwoId: "lower" } as const;

  it("legt das Rückspiel an, wenn der Sieger der Verliererrunde gewinnt", () => {
    expect(planGrandFinalReset({ ...final, winnerPlayerId: "lower" })).toMatchObject({
      key: GRAND_FINAL_RESET_KEY,
      stageType: "GRAND_FINAL",
      round: 2,
      position: 1,
      participantOne: { type: "PLAYER", playerId: "upper" },
      participantTwo: { type: "PLAYER", playerId: "lower" },
      state: "READY",
    });
  });

  it("kein Rückspiel, wenn der Sieger der Gewinnerrunde gewinnt", () => {
    expect(planGrandFinalReset({ ...final, winnerPlayerId: "upper" })).toBeNull();
  });

  it("kein Rückspiel nach Walkover oder vor Abschluss", () => {
    expect(planGrandFinalReset({ ...final, resultType: "WALKOVER", winnerPlayerId: "lower" })).toBeNull();
    expect(planGrandFinalReset({ ...final, status: "IN_PROGRESS", resultType: null, winnerPlayerId: null })).toBeNull();
  });
});

describe("doubleEliminationPlacements", () => {
  // 4 Teilnehmer: a gewinnt oben, d scheidet in Verliererrunde 1 aus, c in Runde 2, b verliert das Final.
  const base: DoubleEliminationMatchResult[] = [
    played({ key: "upper:r1:m1", stageType: "DOUBLE_ELIMINATION_UPPER", round: 1, participantOneId: "a", participantTwoId: "d", winnerPlayerId: "a" }),
    played({ key: "upper:r1:m2", stageType: "DOUBLE_ELIMINATION_UPPER", round: 1, participantOneId: "b", participantTwoId: "c", winnerPlayerId: "b" }),
    played({ key: "upper:r2:m1", stageType: "DOUBLE_ELIMINATION_UPPER", round: 2, participantOneId: "a", participantTwoId: "b", winnerPlayerId: "a" }),
    played({ key: "lower:r1:m1", stageType: "DOUBLE_ELIMINATION_LOWER", round: 1, participantOneId: "d", participantTwoId: "c", winnerPlayerId: "c" }),
    played({ key: "lower:r2:m1", stageType: "DOUBLE_ELIMINATION_LOWER", round: 2, participantOneId: "c", participantTwoId: "b", winnerPlayerId: "b" }),
  ];

  it("ist leer, solange kein Sieger feststeht", () => {
    expect(doubleEliminationPlacements({ playerIds: ["a", "b", "c", "d"], matches: base })).toEqual([]);
  });

  it("rangiert nach Ausscheiderunde", () => {
    const matches = [...base, played({ key: "grand-final:r1:m1", stageType: "GRAND_FINAL", round: 1, participantOneId: "a", participantTwoId: "b", winnerPlayerId: "a" })];
    expect(doubleEliminationChampion(matches)).toBe("a");
    expect(doubleEliminationPlacements({ playerIds: ["a", "b", "c", "d"], matches })).toEqual([
      { rank: 1, playerId: "a" },
      { rank: 2, playerId: "b" },
      { rank: 3, playerId: "c" },
      { rank: 4, playerId: "d" },
    ]);
  });

  it("wartet nach gewonnenem erstem Final der Verliererseite auf das Rückspiel", () => {
    const matches = [...base, played({ key: "grand-final:r1:m1", stageType: "GRAND_FINAL", round: 1, participantOneId: "a", participantTwoId: "b", winnerPlayerId: "b" })];
    expect(doubleEliminationChampion(matches)).toBeNull();
    const withReset = [...matches, played({ key: GRAND_FINAL_RESET_KEY, stageType: "GRAND_FINAL", round: 2, participantOneId: "a", participantTwoId: "b", winnerPlayerId: "a" })];
    expect(doubleEliminationChampion(withReset)).toBe("a");
    expect(doubleEliminationPlacements({ playerIds: ["a", "b", "c", "d"], matches: withReset }).slice(0, 2)).toEqual([
      { rank: 1, playerId: "a" },
      { rank: 2, playerId: "b" },
    ]);
  });

  it("teilt Ränge bei gleicher Ausscheiderunde", () => {
    const matches: DoubleEliminationMatchResult[] = [
      played({ key: "lower:r1:m1", stageType: "DOUBLE_ELIMINATION_LOWER", round: 1, participantOneId: "e", participantTwoId: "f", winnerPlayerId: "f" }),
      played({ key: "lower:r1:m2", stageType: "DOUBLE_ELIMINATION_LOWER", round: 1, participantOneId: "g", participantTwoId: "h", winnerPlayerId: "h" }),
      played({ key: "grand-final:r1:m1", stageType: "GRAND_FINAL", round: 1, participantOneId: "a", participantTwoId: "f", winnerPlayerId: "a" }),
    ];
    const ranks = doubleEliminationPlacements({ playerIds: ["a", "e", "f", "g", "h"], matches });
    expect(ranks.filter((entry) => entry.playerId === "e" || entry.playerId === "g").map((entry) => entry.rank)).toEqual([3, 3]);
  });
});
