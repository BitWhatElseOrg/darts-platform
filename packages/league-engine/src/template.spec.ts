import { describe, expect, it } from "vitest";

import { LeagueValidationError } from "./errors.js";
import { validateEncounterTemplate, type TemplateSlot } from "./template.js";

const singles = (sequence: number, homePosition: number, awayPosition: number): TemplateSlot => ({
  sequence,
  role: "REGULAR",
  discipline: "SINGLES",
  label: `Einzel ${homePosition} gegen ${awayPosition}`,
  homePosition,
  awayPosition,
  startingScore: 501,
  inRule: "DOUBLE",
  outRule: "DOUBLE",
  maxRounds: null,
  bestOfLegs: 3,
  legsToWinSet: 2,
  setsToWin: 1,
});

const doubles = (sequence: number, role: TemplateSlot["role"] = "REGULAR"): TemplateSlot => ({
  sequence,
  role,
  discipline: "DOUBLES",
  label: role === "DECIDER" ? "Entscheidungsdoppel" : `Doppel ${sequence}`,
  homePosition: null,
  awayPosition: null,
  startingScore: 701,
  inRule: "DOUBLE",
  outRule: "DOUBLE",
  maxRounds: null,
  bestOfLegs: 3,
  legsToWinSet: 2,
  setsToWin: 1,
});

/**
 * Die Vorlage des Auslösers: Slot 1 bis 8 Einzel, 9 und 10 Doppel, 11 bis 18
 * Einzel, 19 Entscheidungsdoppel.
 */
const leagueTemplate = (): TemplateSlot[] => {
  const pairings: [number, number][] = [];
  for (let home = 1; home <= 4; home += 1) {
    for (let away = 1; away <= 4; away += 1) {
      pairings.push([home, away]);
    }
  }
  const slots: TemplateSlot[] = [];
  for (let index = 0; index < 8; index += 1) {
    const pairing = pairings[index]!;
    slots.push(singles(index + 1, pairing[0], pairing[1]));
  }
  slots.push(doubles(9), doubles(10));
  for (let index = 8; index < 16; index += 1) {
    const pairing = pairings[index]!;
    slots.push(singles(index + 3, pairing[0], pairing[1]));
  }
  slots.push(doubles(19, "DECIDER"));
  return slots;
};

const resequence = (slots: readonly TemplateSlot[]): TemplateSlot[] =>
  slots.map((slot, index) => ({ ...slot, sequence: index + 1 }));

const expectCode = (act: () => void, code: string): void => {
  expect(act).toThrow(LeagueValidationError);
  expect(act).toThrow(expect.objectContaining({ code }));
};

describe("validateEncounterTemplate", () => {
  it("akzeptiert die Ligavorlage mit 16 Einzeln, zwei Doppeln und Entscheidungsdoppel", () => {
    const slots = leagueTemplate();
    expect(slots).toHaveLength(19);
    expect(() => validateEncounterTemplate(slots)).not.toThrow();
  });

  it("akzeptiert eine Vorlage ohne Entscheidungsslot", () => {
    const slots = leagueTemplate().filter((slot) => slot.role !== "DECIDER");
    expect(() => validateEncounterTemplate(slots)).not.toThrow();
  });

  it("lehnt eine leere Vorlage ab", () => {
    expectCode(() => validateEncounterTemplate([]), "EMPTY_TEMPLATE");
  });

  it("lehnt eine doppelte Sequenz ab", () => {
    const slots = leagueTemplate();
    slots[3] = { ...slots[3]!, sequence: 3 };
    expectCode(() => validateEncounterTemplate(slots), "DUPLICATE_SLOT_SEQUENCE");
  });

  it("lehnt eine Lücke in der Sequenz ab", () => {
    const slots = leagueTemplate();
    slots[5] = { ...slots[5]!, sequence: 20 };
    expectCode(() => validateEncounterTemplate(slots), "NON_CONTIGUOUS_SLOT_SEQUENCE");
  });

  it("lehnt zwei Entscheidungsslots ab", () => {
    const slots = leagueTemplate();
    slots[9] = { ...slots[9]!, role: "DECIDER" };
    expectCode(() => validateEncounterTemplate(slots), "MULTIPLE_DECIDER_SLOTS");
  });

  it("lehnt einen Entscheidungsslot ohne höchste Sequenz ab", () => {
    const slots = leagueTemplate();
    const decider = { ...slots[18]!, sequence: 9 };
    const doubleSlot = { ...slots[8]!, sequence: 19 };
    slots[18] = doubleSlot;
    slots[8] = decider;
    expectCode(() => validateEncounterTemplate(slots), "DECIDER_NOT_LAST");
  });

  it("lehnt einen Entscheidungsslot als Einzel ab", () => {
    const slots = leagueTemplate();
    slots[18] = { ...singles(19, 1, 1), role: "DECIDER" };
    expectCode(() => validateEncounterTemplate(slots), "DECIDER_NOT_DOUBLES");
  });

  it("lehnt eine gerade Legdistanz ab", () => {
    const slots = leagueTemplate();
    slots[0] = { ...slots[0]!, bestOfLegs: 4 };
    expectCode(() => validateEncounterTemplate(slots), "INVALID_LEG_DISTANCE");
  });

  it("lehnt eine Distanz ab, die nicht zu den Gewinnlegs passt", () => {
    const slots = leagueTemplate();
    slots[0] = { ...slots[0]!, bestOfLegs: 5 };
    expectCode(() => validateEncounterTemplate(slots), "INCONSISTENT_LEG_DISTANCE");
  });

  it("lehnt einen unzulässigen Startscore ab", () => {
    const slots = leagueTemplate();
    slots[0] = { ...slots[0]!, startingScore: 400 };
    expectCode(() => validateEncounterTemplate(slots), "INVALID_STARTING_SCORE");
  });

  it("lehnt eine Rundenbegrenzung von null Runden ab", () => {
    const slots = leagueTemplate();
    slots[0] = { ...slots[0]!, maxRounds: 0 };
    expectCode(() => validateEncounterTemplate(slots), "INVALID_MAX_ROUNDS");
  });

  it("akzeptiert eine gesetzte Rundenbegrenzung", () => {
    const slots = leagueTemplate().map((slot) => ({
      ...slot,
      maxRounds: slot.discipline === "SINGLES" ? 20 : 25,
    }));
    expect(() => validateEncounterTemplate(slots)).not.toThrow();
  });

  it("lehnt einen Einzelslot ohne Aufstellungspositionen ab", () => {
    const slots = leagueTemplate();
    slots[0] = { ...slots[0]!, homePosition: null, awayPosition: null };
    expectCode(() => validateEncounterTemplate(slots), "INVALID_SLOT_POSITIONS");
  });

  it("lehnt einen Doppelslot mit Aufstellungspositionen ab", () => {
    const slots = leagueTemplate();
    slots[8] = { ...slots[8]!, homePosition: 1, awayPosition: 1 };
    expectCode(() => validateEncounterTemplate(slots), "INVALID_SLOT_POSITIONS");
  });

  it("lehnt einen Einzelslot mit nur einer Position ab", () => {
    const slots = leagueTemplate();
    slots[0] = { ...slots[0]!, awayPosition: null };
    expectCode(() => validateEncounterTemplate(slots), "INVALID_SLOT_POSITIONS");
  });

  it("lehnt eine leere Bezeichnung ab", () => {
    const slots = leagueTemplate();
    slots[0] = { ...slots[0]!, label: "   " };
    expectCode(() => validateEncounterTemplate(slots), "EMPTY_SLOT_LABEL");
  });

  it("lehnt ein unvollständiges Rundenturnier ab", () => {
    const slots = resequence(leagueTemplate().filter((slot) => slot.sequence !== 5));
    expectCode(() => validateEncounterTemplate(slots), "INCOMPLETE_ROUND_ROBIN");
  });

  it("lehnt eine doppelte Einzelpaarung ab", () => {
    const slots = leagueTemplate();
    slots[1] = { ...slots[1]!, homePosition: 1, awayPosition: 1 };
    expectCode(() => validateEncounterTemplate(slots), "DUPLICATE_SINGLES_PAIRING");
  });

  it("lehnt eine Vorlage ohne Einzelslots ab", () => {
    expectCode(() => validateEncounterTemplate([doubles(1)]), "MISSING_SINGLES_SLOTS");
  });
});
