import { describe, expect, it } from "vitest";

import { tournamentWinner } from "./tournament-winner";

// Befund 8 des Probelaufs vom 25.09.2026: Nach Turnierende nannte keine
// Ansicht die Siegerin; sie stand nur als Haekchen im Tableau.
const bracket = [
  { round: 1, position: 1, status: "COMPLETED" as const, winnerDisplayName: "Petra Rüegg" },
  { round: 1, position: 2, status: "COMPLETED" as const, winnerDisplayName: "Adrian Oberholzer" },
  { round: 2, position: 1, status: "COMPLETED" as const, winnerDisplayName: "Melanie Lüthi" },
];
const groups = [
  { groupLabel: "A", rows: [{ position: 2, displayName: "Reto Ammann" }, { position: 1, displayName: "Sandra Bühler" }] },
];

describe("tournamentWinner", () => {
  it("nennt vor dem Turnierende niemanden", () => {
    expect(tournamentWinner({ tournament: { status: "KNOCKOUT" }, bracket, groups })).toBeNull();
  });

  it("nimmt den Sieg aus der letzten Runde des Tableaus", () => {
    expect(tournamentWinner({ tournament: { status: "COMPLETED" }, bracket, groups })).toBe("Melanie Lüthi");
  });

  it("nimmt ohne Tableau die Spitze der einzigen Gruppe", () => {
    expect(tournamentWinner({ tournament: { status: "COMPLETED" }, bracket: [], groups })).toBe("Sandra Bühler");
  });

  it("bleibt bei mehreren Gruppen ohne Tableau unbestimmt", () => {
    expect(
      tournamentWinner({ tournament: { status: "COMPLETED" }, bracket: [], groups: [...groups, { groupLabel: "B", rows: [{ position: 1, displayName: "Luca Gasser" }] }] }),
    ).toBeNull();
  });

  it("bleibt unbestimmt, solange das letzte Match keinen Sieg traegt", () => {
    const open = bracket.map((match) => (match.round === 2 ? { ...match, status: "IN_PROGRESS" as const, winnerDisplayName: null } : match));
    expect(tournamentWinner({ tournament: { status: "COMPLETED" }, bracket: open, groups })).toBeNull();
  });
});
