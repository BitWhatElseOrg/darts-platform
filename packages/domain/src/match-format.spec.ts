import { describe, expect, it } from "vitest";

import { matchModeOf, matchTargets } from "./match-format";

describe("matchModeOf", () => {
  it("nennt ein Match ohne Saetze Matchplay", () => {
    expect(matchModeOf({ bestOfLegs: 21, bestOfSets: 1 })).toBe("MATCHPLAY");
  });

  it("nennt ein Match mit mehreren Saetzen Set-Modus", () => {
    expect(matchModeOf({ bestOfLegs: 5, bestOfSets: 5 })).toBe("SETS");
  });
});

describe("matchTargets", () => {
  it("gewinnt Best of 21 Legs mit elf Legs", () => {
    expect(matchTargets({ bestOfLegs: 21, bestOfSets: 1 })).toEqual({ legsToWin: 11, setsToWin: 1 });
  });

  it("gewinnt Best of 5 Saetze à Best of 5 Legs mit drei und drei", () => {
    expect(matchTargets({ bestOfLegs: 5, bestOfSets: 5 })).toEqual({ legsToWin: 3, setsToWin: 3 });
  });

  it("gewinnt ein Einzelleg mit einem Leg", () => {
    expect(matchTargets({ bestOfLegs: 1, bestOfSets: 1 })).toEqual({ legsToWin: 1, setsToWin: 1 });
  });

  it("rundet auch bei gerader Vorgabe zur Mehrheit auf", () => {
    // Die Vertraege verlangen ungerade Zahlen; die Formel darf trotzdem nicht
    // kippen, wenn eine gerade Zahl aus Bestandsdaten hereinkommt.
    expect(matchTargets({ bestOfLegs: 4, bestOfSets: 1 })).toEqual({ legsToWin: 3, setsToWin: 1 });
  });
});
