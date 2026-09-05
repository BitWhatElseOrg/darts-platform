import { describe, expect, it } from "vitest";
import type { BracketMatch } from "@darts-platform/schemas";

import { buildBracketRounds, knockoutLeadsLiveView } from "./bracket-tree";

/**
 * Das K.-o.-Tableau kommt vom Server als flache Liste. Erst `round` und
 * `position` machen daraus einen Baum — die Ansicht darf diese Ordnung nicht
 * selbst erfinden, sondern nur ablesen.
 */

function match(overrides: Partial<BracketMatch> & Pick<BracketMatch, "round" | "position">): BracketMatch {
  return {
    matchId: `r${overrides.round}p${overrides.position}`,
    stageLabel: `K.-o. · Runde ${overrides.round}`,
    status: "WAITING",
    resultType: null,
    participantNames: ["Noch offen", "Noch offen"],
    winnerDisplayName: null,
    ...overrides,
  };
}

describe("K.-o.-Baum", () => {
  it("gibt für ein leeres Tableau keine Runden zurück", () => {
    expect(buildBracketRounds([])).toEqual([]);
  });

  it("gruppiert nach Runde und ordnet innerhalb der Runde nach Position", () => {
    const rounds = buildBracketRounds([
      match({ round: 2, position: 1 }),
      match({ round: 1, position: 2 }),
      match({ round: 1, position: 1 }),
    ]);

    expect(rounds.map((entry) => entry.round)).toEqual([1, 2]);
    expect(rounds[0]?.matches.map((entry) => entry.position)).toEqual([1, 2]);
    expect(rounds[1]?.matches).toHaveLength(1);
  });

  it("benennt die Runden vom Final her rückwärts", () => {
    const rounds = buildBracketRounds([
      match({ round: 1, position: 1 }),
      match({ round: 1, position: 2 }),
      match({ round: 1, position: 3 }),
      match({ round: 1, position: 4 }),
      match({ round: 1, position: 5 }),
      match({ round: 1, position: 6 }),
      match({ round: 1, position: 7 }),
      match({ round: 1, position: 8 }),
      match({ round: 2, position: 1 }),
      match({ round: 2, position: 2 }),
      match({ round: 2, position: 3 }),
      match({ round: 2, position: 4 }),
      match({ round: 3, position: 1 }),
      match({ round: 3, position: 2 }),
      match({ round: 4, position: 1 }),
    ]);

    expect(rounds.map((entry) => entry.label)).toEqual([
      "Achtelfinal",
      "Viertelfinal",
      "Halbfinal",
      "Final",
    ]);
  });

  it("nummeriert Runden weiter vorne durch, wenn kein Name mehr passt", () => {
    const rounds = buildBracketRounds([
      match({ round: 1, position: 1 }),
      match({ round: 2, position: 1 }),
      match({ round: 3, position: 1 }),
      match({ round: 4, position: 1 }),
      match({ round: 5, position: 1 }),
    ]);

    expect(rounds[0]?.label).toBe("Runde 1");
    expect(rounds[1]?.label).toBe("Achtelfinal");
  });

  it("markiert Siegerin und Verliererin eines entschiedenen Matches", () => {
    const [round] = buildBracketRounds([
      match({
        round: 1,
        position: 1,
        status: "COMPLETED",
        resultType: "PLAYED",
        participantNames: ["Alex", "Bea"],
        winnerDisplayName: "Bea",
      }),
    ]);

    expect(round?.matches[0]?.slots).toEqual([
      { displayName: "Alex", state: "LOSER" },
      { displayName: "Bea", state: "WINNER" },
    ]);
  });

  it("lässt beide Seiten offen, solange das Match nicht entschieden ist", () => {
    const [round] = buildBracketRounds([
      match({ round: 1, position: 1, status: "IN_PROGRESS", participantNames: ["Alex", "Bea"] }),
    ]);

    expect(round?.matches[0]?.slots.map((slot) => slot.state)).toEqual(["UNDECIDED", "UNDECIDED"]);
  });

  it("kennzeichnet noch nicht besetzte Plätze als offen", () => {
    const [round] = buildBracketRounds([
      match({ round: 1, position: 1, participantNames: ["Alex", "Noch offen"] }),
    ]);

    expect(round?.matches[0]?.slots[1]).toEqual({ displayName: "Noch offen", state: "OPEN" });
    expect(round?.matches[0]?.slots[0]?.state).toBe("UNDECIDED");
  });

  it("beschriftet Freilos, Walkover, laufende und abgesagte Matches", () => {
    const rounds = buildBracketRounds([
      match({ round: 1, position: 1, status: "BYE", resultType: "BYE" }),
      match({ round: 1, position: 2, status: "COMPLETED", resultType: "WALKOVER" }),
      match({ round: 1, position: 3, status: "IN_PROGRESS" }),
      match({ round: 1, position: 4, status: "CANCELLED" }),
      match({ round: 1, position: 5, status: "COMPLETED", resultType: "PLAYED" }),
      match({ round: 2, position: 1 }),
    ]);

    expect(rounds[0]?.matches.map((entry) => entry.note)).toEqual([
      "Freilos",
      "Walkover",
      "Läuft",
      "Entfällt",
      null,
    ]);
  });
});

/**
 * Welche Tabelle die Live-Ansicht anführt, entscheidet der Turnierzustand vom
 * Server — nicht die Ansicht selbst (AGENTS.md §4).
 */
describe("Vorrang in der Live-Ansicht", () => {
  it("lässt die Gruppenranglisten führen, solange die Gruppenphase läuft", () => {
    expect(knockoutLeadsLiveView("GROUP_STAGE")).toBe(false);
  });

  it("stellt das Tableau nach vorne, sobald die K.-o.-Phase begonnen hat", () => {
    expect(knockoutLeadsLiveView("KNOCKOUT")).toBe(true);
  });

  it("lässt das Tableau auch nach Turnierende vorne stehen", () => {
    expect(knockoutLeadsLiveView("COMPLETED")).toBe(true);
  });

  it("führt vor dem Start mit den Gruppen", () => {
    expect(knockoutLeadsLiveView("DRAFT")).toBe(false);
    expect(knockoutLeadsLiveView("READY")).toBe(false);
  });
});
