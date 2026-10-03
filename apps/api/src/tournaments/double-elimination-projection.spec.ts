import { describe, expect, it } from "vitest";

import { bracketSectionOf, projectDoubleElimination } from "./double-elimination-projection.js";

describe("bracketSectionOf", () => {
  it.each([
    ["DOUBLE_ELIMINATION_UPPER", "Gewinnerrunde · Runde 1", "UPPER"],
    ["DOUBLE_ELIMINATION_LOWER", "Verliererrunde · Runde 2", "LOWER"],
    ["GRAND_FINAL", "Final", "GRAND_FINAL"],
    ["SINGLE_ELIMINATION", "K.-o. · Runde 1", "MAIN"],
    ["SINGLE_ELIMINATION", "Final", null],
    ["GROUP", "Gruppe A", null],
  ] as const)("%s/%s -> %s", (type, label, expected) => {
    expect(bracketSectionOf(type, label)).toBe(expected);
  });
});

describe("projectDoubleElimination", () => {
  const stageTypeById = new Map([["s-upper", "DOUBLE_ELIMINATION_UPPER"], ["s-lower", "DOUBLE_ELIMINATION_LOWER"], ["s-final", "GRAND_FINAL"]]);
  const row = (key: string, stageId: string, round: number, one: string, two: string, winner: string | null, status = "COMPLETED") => ({
    key, stageId, round, status, resultType: status === "COMPLETED" ? "PLAYED" : null,
    participantOneId: one, participantTwoId: two, winnerPlayerId: winner,
  });
  const participants = ["a", "b", "c", "d"].map((playerId) => ({ playerId, displayName: playerId.toUpperCase() }));

  it("meldet ein mögliches Rückspiel, solange das erste Final offen ist", () => {
    const result = projectDoubleElimination({ participants, stageTypeById, matches: [row("grand-final:r1:m1", "s-final", 1, "a", "b", null, "READY")] });
    expect(result).toEqual({ placements: [], resetPossible: true });
  });

  it("liefert die Platzierung mit Namen nach Turnierende", () => {
    const result = projectDoubleElimination({
      participants,
      stageTypeById,
      matches: [
        row("lower:r1:m1", "s-lower", 1, "d", "c", "c"),
        row("lower:r2:m1", "s-lower", 2, "c", "b", "b"),
        row("grand-final:r1:m1", "s-final", 1, "a", "b", "a"),
      ],
    });
    expect(result.resetPossible).toBe(false);
    expect(result.placements.map((entry) => [entry.rank, entry.displayName])).toEqual([[1, "A"], [2, "B"], [3, "C"], [4, "D"]]);
  });
});
