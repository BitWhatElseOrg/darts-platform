import { describe, expect, it } from "vitest";

import { expectedMatchMinutes, isMatchOverrunning } from "./match-overrun.js";

// Befund 4 des Probelaufs vom 25.09.2026: `overrunning` stand im Board-Slot
// fest auf `false`, obwohl das Schema einen vom Server abgeleiteten Wert
// verspricht. Die Erwartung ist bewusst grob: ein 501-Leg dauert im Verein
// rund sieben Minuten; ueberzogen ist ein Match, das anderthalb Mal so lange
// laeuft wie alle Legs zusammen brauchen duerften.
describe("isMatchOverrunning", () => {
  const startedAt = new Date("2026-09-25T12:00:00.000Z");

  it("rechnet die erwartete Dauer aus Legs mal Saetzen", () => {
    expect(expectedMatchMinutes({ bestOfLegs: 3, bestOfSets: 1 })).toBe(21);
    expect(expectedMatchMinutes({ bestOfLegs: 3, bestOfSets: 3 })).toBe(63);
  });

  it("meldet ein Best-of-3 nach 20 Minuten nicht als ueberzogen", () => {
    expect(
      isMatchOverrunning({ startedAt, now: new Date("2026-09-25T12:20:00.000Z"), bestOfLegs: 3, bestOfSets: 1 }),
    ).toBe(false);
  });

  it("meldet ein Best-of-3 nach 32 Minuten als ueberzogen", () => {
    expect(
      isMatchOverrunning({ startedAt, now: new Date("2026-09-25T12:32:00.000Z"), bestOfLegs: 3, bestOfSets: 1 }),
    ).toBe(true);
  });

  it("gibt einem Best-of-1 mehr als die Haelfte der Toleranz", () => {
    expect(
      isMatchOverrunning({ startedAt, now: new Date("2026-09-25T12:10:00.000Z"), bestOfLegs: 1, bestOfSets: 1 }),
    ).toBe(false);
    expect(
      isMatchOverrunning({ startedAt, now: new Date("2026-09-25T12:11:00.000Z"), bestOfLegs: 1, bestOfSets: 1 }),
    ).toBe(true);
  });
});
