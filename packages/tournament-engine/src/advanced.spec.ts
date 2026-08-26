import { describe, expect, it } from "vitest";
import { allocateAdvancedSeeds, generateDoubleElimination, pairSwissRound, validateCompetitors, validateStageComposition } from "./advanced.js";

describe("erweiterte Turnierformate", () => {
  it("erzeugt Double Elimination ohne ungültige Abhängigkeiten", () => {
    const matches = generateDoubleElimination(8);
    expect(matches).toHaveLength(14);
    const seen = new Set<string>();
    for (const match of matches) {
      expect(match.sources.every((source) => seen.has(source.matchKey))).toBe(true);
      seen.add(match.key);
    }
    expect(matches.at(-1)?.key).toBe("grand-final");
  });

  it("paart Schweizer Runden ohne Wiederholung und mit einmaligem Bye", () => {
    const pairings = pairSwissRound([
      { competitorId: "a", points: 4, buchholz: 5, seed: 1, opponentIds: ["b"], hadBye: false },
      { competitorId: "b", points: 4, buchholz: 4, seed: 2, opponentIds: ["a"], hadBye: false },
      { competitorId: "c", points: 2, buchholz: 3, seed: 3, opponentIds: [], hadBye: false },
      { competitorId: "d", points: 2, buchholz: 2, seed: 4, opponentIds: [], hadBye: false },
      { competitorId: "e", points: 0, buchholz: 1, seed: 5, opponentIds: [], hadBye: false },
    ]);
    expect(pairings).toContainEqual(expect.objectContaining({ competitorOneId: "a", competitorTwoId: "c" }));
    expect(pairings.filter((pairing) => pairing.bye)).toHaveLength(1);
    expect(new Set(pairings.flatMap((pairing) => [pairing.competitorOneId, pairing.competitorTwoId].filter(Boolean))).size).toBe(5);
  });

  it("validiert Paare, Setzung und kombinierbare Stages", () => {
    const competitors = [
      { id: "p1", kind: "PAIR" as const, memberIds: ["a", "b"], seed: 1, region: "Ost" },
      { id: "p2", kind: "PAIR" as const, memberIds: ["c", "d"], seed: 2, region: "West" },
      { id: "p3", kind: "PAIR" as const, memberIds: ["e", "f"], seed: 3, region: "Ost" },
      { id: "p4", kind: "PAIR" as const, memberIds: ["g", "h"], seed: 4, region: "West" },
    ];
    expect(() => validateCompetitors(competitors)).not.toThrow();
    expect(allocateAdvancedSeeds(competitors, 2).map((group) => group.length)).toEqual([2, 2]);
    expect(() => validateStageComposition([
      { key: "swiss", type: "SWISS", rounds: 4, advance: 4 },
      { key: "ko", type: "DOUBLE_ELIMINATION", advance: 1 },
      { key: "rang-3", type: "PLACEMENT", places: [3, 4] },
    ])).not.toThrow();
  });
});
