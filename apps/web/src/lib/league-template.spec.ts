import { describe, expect, it } from "vitest";

import { buildEncounterTemplate, vfcTemplateOptions } from "./league-template";

describe("buildEncounterTemplate", () => {
  const slots = buildEncounterTemplate(vfcTemplateOptions);

  it("baut den Modus aus Reglement 2.2.8", () => {
    expect(slots).toHaveLength(19);
    expect(slots.map((slot) => slot.sequence)).toEqual(
      Array.from({ length: 19 }, (_, index) => index + 1),
    );
    const disciplines = slots.map((slot) => slot.discipline);
    expect(disciplines.slice(0, 8)).toEqual(Array.from({ length: 8 }, () => "SINGLES"));
    expect(disciplines.slice(8, 10)).toEqual(["DOUBLES", "DOUBLES"]);
    expect(disciplines.slice(10, 18)).toEqual(Array.from({ length: 8 }, () => "SINGLES"));
    expect(disciplines[18]).toBe("DOUBLES");
  });

  it("spielt jede Heimposition genau einmal gegen jede Gastposition", () => {
    const pairings = slots
      .filter((slot) => slot.discipline === "SINGLES")
      .map((slot) => `${slot.homePosition}-${slot.awayPosition}`);
    expect(pairings).toHaveLength(16);
    expect(new Set(pairings).size).toBe(16);
  });

  it("gibt jeder Person vier Einzel", () => {
    for (let position = 1; position <= 4; position += 1) {
      expect(slots.filter((slot) => slot.homePosition === position)).toHaveLength(4);
      expect(slots.filter((slot) => slot.awayPosition === position)).toHaveLength(4);
    }
  });

  it("traegt genau einen Entscheidungsslot, als Doppel mit hoechster Sequenz", () => {
    const deciders = slots.filter((slot) => slot.role === "DECIDER");
    expect(deciders).toHaveLength(1);
    expect(deciders[0]).toMatchObject({
      sequence: 19,
      discipline: "DOUBLES",
      startingScore: 701,
      homePosition: null,
      awayPosition: null,
    });
  });

  it("setzt Startscore und Variante je Disziplin", () => {
    expect(slots[0]).toMatchObject({
      startingScore: 501,
      inRule: "DOUBLE",
      outRule: "DOUBLE",
      bestOfLegs: 3,
      legsToWinSet: 2,
      setsToWin: 1,
      maxRounds: null,
    });
    expect(slots[8]).toMatchObject({ startingScore: 701, discipline: "DOUBLES" });
  });

  it("beschriftet die Spiele so, wie der Spielrapport sie fuehrt", () => {
    expect(slots[0]?.label).toBe("Einzel 1 · Heim 1 gegen Gast 1");
    expect(slots[8]?.label).toBe("Doppel 1");
    expect(slots[18]?.label).toBe("Entscheidungsdoppel");
  });

  it("kommt auch ohne Entscheidungsdoppel und mit anderer Groesse aus", () => {
    const small = buildEncounterTemplate({
      ...vfcTemplateOptions,
      lineupPositions: 2,
      regularDoubles: 1,
      withDecider: false,
    });
    expect(small).toHaveLength(5);
    expect(small.filter((slot) => slot.discipline === "SINGLES")).toHaveLength(4);
    expect(small.filter((slot) => slot.role === "DECIDER")).toHaveLength(0);
    expect(small.map((slot) => slot.sequence)).toEqual([1, 2, 3, 4, 5]);
  });
});
