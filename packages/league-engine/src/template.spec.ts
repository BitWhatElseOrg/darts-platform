import { describe, expect, it } from "vitest";

import { LeagueValidationError } from "./errors.js";
import { buildEncounterTemplate, vfcTemplateOptions } from "./encounter-template.js";
import { validateEncounterTemplate, type SlotRole, type TemplateSlot } from "./template.js";

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
 * Die Vorlage des Auslösers: Slot 1 bis 8 Einzel (Runde 1 und 2), 9 und 10
 * Doppel, 11 bis 18 Einzel (Runde 3 und 4), 19 Entscheidungsdoppel. Gebaut
 * über `buildEncounterTemplate`, damit sie die Rundenfolge nach Reglement
 * 2.2.8 trägt, die `validateEncounterTemplate` seit diesem Task prüft.
 */
const leagueTemplate = (): TemplateSlot[] => [...buildEncounterTemplate(vfcTemplateOptions)];

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

describe("Rundenfolge nach Reglement 2.2.8", () => {
  function singlesSlot(sequence: number, homePosition: number, awayPosition: number): TemplateSlot {
    return {
      sequence, role: "REGULAR", discipline: "SINGLES",
      label: `Einzel ${sequence}`, homePosition, awayPosition,
      startingScore: 501, inRule: "DOUBLE", outRule: "DOUBLE", maxRounds: null,
      bestOfLegs: 3, legsToWinSet: 2, setsToWin: 1,
    };
  }
  function doublesSlot(sequence: number, role: SlotRole): TemplateSlot {
    return {
      sequence, role, discipline: "DOUBLES",
      label: role === "DECIDER" ? "Entscheidungsdoppel" : `Doppel ${sequence}`,
      homePosition: null, awayPosition: null,
      startingScore: 701, inRule: "DOUBLE", outRule: "DOUBLE", maxRounds: null,
      bestOfLegs: 3, legsToWinSet: 2, setsToWin: 1,
    };
  }

  it("lehnt 16 Einzel am Stueck mit beiden Doppeln am Schluss ab", () => {
    // Genau die Vorlage, die ein fremder Client heute durchbekommt: lueckenlos,
    // vollstaendiges Rundenturnier, DECIDER zuletzt -- aber 2.2.8 verlangt die
    // Doppel nach Runde 2.
    const slots: TemplateSlot[] = [];
    let sequence = 1;
    for (let home = 1; home <= 4; home += 1) {
      for (let away = 1; away <= 4; away += 1) slots.push(singlesSlot(sequence++, home, away));
    }
    slots.push(doublesSlot(sequence++, "REGULAR"));
    slots.push(doublesSlot(sequence++, "REGULAR"));
    slots.push(doublesSlot(sequence, "DECIDER"));

    expect(() => validateEncounterTemplate(slots)).toThrowError(
      expect.objectContaining({ code: "INVALID_ROUND_ORDER" }),
    );
  });

  it("lehnt eine Runde ab, in der eine Aufstellungsposition zweimal antritt", () => {
    // 16 Einzel, vollstaendiges Rundenturnier, Doppel an der richtigen Stelle --
    // aber Runde 1 laesst Heimposition 1 zweimal spielen. Reglement 2.2.8 haelt
    // die Runden gerade deshalb sortenrein („Zwecks Zeiteinsparung").
    const pairings: readonly (readonly [number, number])[] = [
      [1, 1], [1, 2], [2, 3], [3, 4],
      [2, 1], [2, 2], [1, 3], [4, 4],
      [3, 1], [3, 2], [3, 3], [2, 4],
      [4, 1], [4, 2], [4, 3], [1, 4],
    ];
    const slots: TemplateSlot[] = [];
    let sequence = 1;
    for (const [home, away] of pairings.slice(0, 8)) slots.push(singlesSlot(sequence++, home, away));
    slots.push(doublesSlot(sequence++, "REGULAR"));
    slots.push(doublesSlot(sequence++, "REGULAR"));
    for (const [home, away] of pairings.slice(8)) slots.push(singlesSlot(sequence++, home, away));
    slots.push(doublesSlot(sequence, "DECIDER"));

    expect(() => validateEncounterTemplate(slots)).toThrowError(
      expect.objectContaining({ code: "INVALID_ROUND_ORDER" }),
    );
  });

  it("lehnt eine Vorlage ohne regulaeres Doppel ab", () => {
    // Reglement 2.2.1 und A1.1: 16 Einzel UND 2 Doppel. Ohne reguläres Doppel
    // kann ein 9:9 nach 2.2.2 nie entstehen und ein Nichtantritt waere 0:16
    // statt 0:18 (2.5.1).
    const slots: TemplateSlot[] = [];
    let sequence = 1;
    for (let round = 1; round <= 4; round += 1) {
      for (let home = 1; home <= 4; home += 1) {
        slots.push(singlesSlot(sequence++, home, ((home + round - 2) % 4) + 1));
      }
    }
    slots.push(doublesSlot(sequence, "DECIDER"));

    expect(() => validateEncounterTemplate(slots)).toThrowError(
      expect.objectContaining({ code: "MISSING_DOUBLES_SLOTS" }),
    );
  });

  it("nimmt die Vorlage der Ligagruppe an", () => {
    expect(() => validateEncounterTemplate(buildEncounterTemplate(vfcTemplateOptions))).not.toThrow();
  });
});
