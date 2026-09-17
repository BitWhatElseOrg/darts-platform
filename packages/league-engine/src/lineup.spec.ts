import { describe, expect, it } from "vitest";

import { LeagueValidationError } from "./errors.js";
import {
  resolveSlotOccupancy,
  validateDoublesPairings,
  validateNominations,
  validateSubstitution,
  type NominationEntry,
  type OccupancySlot,
  type SubstitutionRecord,
} from "./lineup.js";

const rules = {
  lineupPositions: 4,
  minNominations: 4,
  minNominationsShorthanded: 3,
};

const squad = ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8"];

const nominate = (
  entries: readonly (readonly [string, number | null])[],
  origin: NominationEntry["origin"] = "SQUAD",
): NominationEntry[] =>
  entries.map(([playerId, position]) => ({ playerId, position, origin }));

const fullLineup = (): NominationEntry[] =>
  nominate([
    ["h1", 1],
    ["h2", 2],
    ["h3", 3],
    ["h4", 4],
    ["h5", null],
    ["h6", null],
  ]);

const singlesSlot = (sequence: number, homePosition: number, awayPosition: number): OccupancySlot => ({
  sequence,
  discipline: "SINGLES",
  homePosition,
  awayPosition,
});

const doublesSlot = (sequence: number): OccupancySlot => ({
  sequence,
  discipline: "DOUBLES",
  homePosition: null,
  awayPosition: null,
});

const substitution = (
  overrides: Partial<SubstitutionRecord> = {},
): SubstitutionRecord => ({
  side: "HOME",
  position: 2,
  outPlayerId: "h2",
  inPlayerId: "h5",
  effectiveFromSequence: 5,
  ...overrides,
});

const expectCode = (act: () => void, code: string): void => {
  expect(act).toThrow(LeagueValidationError);
  expect(act).toThrow(expect.objectContaining({ code }));
};

describe("validateNominations", () => {
  const validate = (
    nominations: readonly NominationEntry[],
    opposingPlayerIds: readonly string[] = [],
  ) =>
    validateNominations({
      side: "HOME",
      nominations,
      squadPlayerIds: squad,
      opposingPlayerIds,
      rules,
    });

  it("lehnt eine Person ab, welche die Gegenseite bereits gemeldet hat", () => {
    // DRA 6.10.3: Kein Spieler darf in einem Darts-Event fuer mehr als ein
    // Team spielen. Die Kaderpruefung greift dagegen nicht — eine Aushilfe
    // (`origin: "GUEST"`) ist an keinen Kader gebunden, und dieselbe Person
    // kann in zwei Mannschaften aktiv sein.
    expectCode(
      () => validate(fullLineup(), ["h3"]),
      "PLAYER_ON_BOTH_SIDES",
    );
  });

  it("akzeptiert vier besetzte Positionen mit zwei Ersatzpersonen", () => {
    expect(() => validate(fullLineup())).not.toThrow();
  });

  it("lehnt eine doppelt gemeldete Person ab", () => {
    expectCode(
      () => validate(nominate([["h1", 1], ["h2", 2], ["h3", 3], ["h1", 4]])),
      "DUPLICATE_NOMINATION",
    );
  });

  it("lehnt eine doppelt besetzte Aufstellungsposition ab", () => {
    expectCode(
      () => validate(nominate([["h1", 1], ["h2", 2], ["h3", 2], ["h4", 4]])),
      "DUPLICATE_LINEUP_POSITION",
    );
  });

  it("lehnt eine Position ausserhalb der Aufstellung ab", () => {
    expectCode(
      () => validate(nominate([["h1", 1], ["h2", 2], ["h3", 3], ["h4", 5]])),
      "INVALID_LINEUP_POSITION",
    );
  });

  it("lehnt eine Person ausserhalb des Kaders ab", () => {
    expectCode(
      () => validate(nominate([["h1", 1], ["h2", 2], ["h3", 3], ["x9", 4]])),
      "PLAYER_NOT_IN_SQUAD",
    );
  });

  it("akzeptiert dieselbe Person als Aushilfe", () => {
    expect(() =>
      validate([
        ...nominate([["h1", 1], ["h2", 2], ["h3", 3]]),
        ...nominate([["x9", 4]], "GUEST"),
      ]),
    ).not.toThrow();
  });

  it("akzeptiert drei besetzte Positionen nach Reglement 2.2.5", () => {
    expect(() => validate(nominate([["h1", 1], ["h2", 2], ["h3", 3]]))).not.toThrow();
  });

  it("akzeptiert eine Lücke an beliebiger Position", () => {
    expect(() => validate(nominate([["h1", 1], ["h2", 2], ["h4", 4]]))).not.toThrow();
  });

  it("lehnt zwei besetzte Positionen ab", () => {
    expectCode(() => validate(nominate([["h1", 1], ["h2", 2]])), "NOT_ENOUGH_NOMINATIONS");
  });

  it("lehnt eine vollständige Aufstellung unter der Mindestmeldung ab", () => {
    expect(() =>
      validateNominations({
        side: "HOME",
        nominations: fullLineup(),
        squadPlayerIds: squad,
        opposingPlayerIds: [],
        rules: { ...rules, minNominations: 7 },
      }),
    ).toThrow(expect.objectContaining({ code: "NOT_ENOUGH_NOMINATIONS" }));
  });

  it("lehnt eine leere Personenkennung ab", () => {
    expectCode(
      () => validate(nominate([["h1", 1], ["h2", 2], ["h3", 3], ["", 4]])),
      "INVALID_NOMINATION",
    );
  });
});

describe("validateDoublesPairings", () => {
  const nominated = ["h1", "h2", "h3", "h4", "h5"];
  const validate = (pairings: Parameters<typeof validateDoublesPairings>[0]["pairings"]) =>
    validateDoublesPairings({
      side: "HOME",
      pairings,
      nominatedPlayerIds: nominated,
      maxDoublesPerPlayer: 1,
    });

  it("akzeptiert zwei Doppel mit vier verschiedenen Personen", () => {
    expect(() =>
      validate([
        { slotSequence: 9, role: "REGULAR", playerIds: ["h1", "h2"] },
        { slotSequence: 10, role: "REGULAR", playerIds: ["h3", "h4"] },
      ]),
    ).not.toThrow();
  });

  it("akzeptiert eine Ersatzperson ohne Aufstellungsposition", () => {
    expect(() =>
      validate([{ slotSequence: 9, role: "REGULAR", playerIds: ["h5", "h1"] }]),
    ).not.toThrow();
  });

  it("lehnt dieselbe Person in beiden regulären Doppeln ab", () => {
    expectCode(
      () =>
        validate([
          { slotSequence: 9, role: "REGULAR", playerIds: ["h1", "h2"] },
          { slotSequence: 10, role: "REGULAR", playerIds: ["h1", "h3"] },
        ]),
      "DOUBLES_LIMIT_EXCEEDED",
    );
  });

  it("erlaubt im Entscheidungsdoppel jede gemeldete Person erneut", () => {
    expect(() =>
      validate([
        { slotSequence: 9, role: "REGULAR", playerIds: ["h1", "h2"] },
        { slotSequence: 10, role: "REGULAR", playerIds: ["h3", "h4"] },
        { slotSequence: 19, role: "DECIDER", playerIds: ["h1", "h3"] },
      ]),
    ).not.toThrow();
  });

  it("lehnt eine nicht gemeldete Person ab", () => {
    expectCode(
      () => validate([{ slotSequence: 9, role: "REGULAR", playerIds: ["h1", "x9"] }]),
      "PLAYER_NOT_NOMINATED",
    );
  });

  it("lehnt eine Paarung mit einer Person ab", () => {
    expectCode(
      () => validate([{ slotSequence: 9, role: "REGULAR", playerIds: ["h1"] }]),
      "INVALID_DOUBLES_SIZE",
    );
  });

  it("lehnt dieselbe Person auf beiden Plätzen ab", () => {
    expectCode(
      () => validate([{ slotSequence: 9, role: "REGULAR", playerIds: ["h1", "h1"] }]),
      "DUPLICATE_DOUBLES_PLAYER",
    );
  });

  it("lehnt zwei Paarungen für denselben Slot ab", () => {
    expectCode(
      () =>
        validate([
          { slotSequence: 9, role: "REGULAR", playerIds: ["h1", "h2"] },
          { slotSequence: 9, role: "REGULAR", playerIds: ["h3", "h4"] },
        ]),
      "DUPLICATE_DOUBLES_SLOT",
    );
  });
});

describe("validateSubstitution", () => {
  const validate = (
    overrides: Partial<Parameters<typeof validateSubstitution>[0]> = {},
  ) =>
    validateSubstitution({
      substitution: substitution(),
      nominations: fullLineup(),
      existingSubstitutions: [],
      startedSlotSequences: [1, 2, 3, 4],
      lineupPositions: 4,
      maxSubstitutionsPerEncounter: 4,
      ...overrides,
    });

  it("akzeptiert eine Auswechslung vor dem nächsten Slot", () => {
    expect(() => validate()).not.toThrow();
  });

  it("lehnt eine Auswechslung während einer laufenden Paarung ab", () => {
    expectCode(
      () => validate({ substitution: substitution({ effectiveFromSequence: 4 }) }),
      "SUBSTITUTION_DURING_RUNNING_SLOT",
    );
  });

  it("lehnt die fünfte Auswechslung derselben Seite ab", () => {
    const existing: SubstitutionRecord[] = [
      substitution({ position: 1, outPlayerId: "h1", inPlayerId: "h5", effectiveFromSequence: 2 }),
      substitution({ position: 2, outPlayerId: "h2", inPlayerId: "h6", effectiveFromSequence: 2 }),
      substitution({ position: 3, outPlayerId: "h3", inPlayerId: "h7", effectiveFromSequence: 3 }),
      substitution({ position: 4, outPlayerId: "h4", inPlayerId: "h8", effectiveFromSequence: 3 }),
    ];
    expectCode(
      () =>
        validate({
          substitution: substitution({ position: 1, outPlayerId: "h5", inPlayerId: "h9" }),
          existingSubstitutions: existing,
        }),
      "SUBSTITUTION_LIMIT_EXCEEDED",
    );
  });

  it("zählt das Kontingent je Seite und lässt die Gegenseite unberührt", () => {
    const existing: SubstitutionRecord[] = [1, 2, 3, 4].map((position) =>
      substitution({
        side: "AWAY",
        position,
        outPlayerId: `a${position}`,
        inPlayerId: `a${position + 4}`,
        effectiveFromSequence: 2,
      }),
    );
    expect(() => validate({ existingSubstitutions: existing })).not.toThrow();
  });

  it("lehnt die Einwechslung einer zuvor ausgewechselten Person ab", () => {
    expectCode(
      () =>
        validate({
          substitution: substitution({ position: 3, outPlayerId: "h3", inPlayerId: "h1" }),
          existingSubstitutions: [
            substitution({ position: 1, outPlayerId: "h1", inPlayerId: "h5", effectiveFromSequence: 3 }),
          ],
        }),
      "PLAYER_SUBSTITUTED_OUT",
    );
  });

  it("lehnt eine falsche ausgewechselte Person ab", () => {
    expectCode(
      () => validate({ substitution: substitution({ outPlayerId: "h3" }) }),
      "SUBSTITUTION_OUT_PLAYER_MISMATCH",
    );
  });

  it("lehnt die Einwechslung einer Person ab, die bereits eine Position besetzt", () => {
    expectCode(
      () => validate({ substitution: substitution({ inPlayerId: "h4" }) }),
      "PLAYER_ALREADY_IN_LINEUP",
    );
  });

  it("lehnt eine nicht gemeldete einwechselnde Person ab", () => {
    expectCode(
      () => validate({ substitution: substitution({ inPlayerId: "h7" }) }),
      "PLAYER_NOT_NOMINATED",
    );
  });

  it("lehnt dieselbe Person auf beiden Seiten der Auswechslung ab", () => {
    expectCode(
      () => validate({ substitution: substitution({ inPlayerId: "h2" }) }),
      "INVALID_SUBSTITUTION",
    );
  });

  it("lehnt eine Position ausserhalb der Aufstellung ab", () => {
    expectCode(
      () => validate({ substitution: substitution({ position: 5 }) }),
      "INVALID_LINEUP_POSITION",
    );
  });

  it("lehnt eine zweite Auswechslung derselben Position ab derselben Sequenz ab", () => {
    expectCode(
      () =>
        validate({
          substitution: substitution({ position: 2, outPlayerId: "h6", inPlayerId: "h5" }),
          existingSubstitutions: [
            substitution({ position: 2, outPlayerId: "h2", inPlayerId: "h6", effectiveFromSequence: 5 }),
          ],
        }),
      "DUPLICATE_SUBSTITUTION",
    );
  });
});

describe("resolveSlotOccupancy", () => {
  const homeLineup = {
    nominations: fullLineup(),
    substitutions: [substitution()],
  };
  const awayLineup = {
    nominations: nominate([
      ["a1", 1],
      ["a2", 2],
      ["a3", 3],
      ["a4", 4],
    ]),
    substitutions: [],
  };

  it("behält vor der Auswechslung die gemeldete Person", () => {
    const occupancy = resolveSlotOccupancy({
      slot: singlesSlot(2, 2, 1),
      home: homeLineup,
      away: awayLineup,
    });
    expect(occupancy.home).toEqual({ side: "HOME", playerIds: ["h2"], complete: true });
    expect(occupancy.away).toEqual({ side: "AWAY", playerIds: ["a1"], complete: true });
    expect(occupancy.playable).toBe(true);
    expect(occupancy.walkoverWinner).toBeNull();
  });

  it("trägt ab der Auswechslung die eingewechselte Person", () => {
    const occupancy = resolveSlotOccupancy({
      slot: singlesSlot(6, 2, 3),
      home: homeLineup,
      away: awayLineup,
    });
    expect(occupancy.home.playerIds).toEqual(["h5"]);
  });

  it("nimmt bei zwei Auswechslungen derselben Position die jüngste wirksame", () => {
    const lineup = {
      nominations: fullLineup(),
      substitutions: [
        substitution({ effectiveFromSequence: 5 }),
        substitution({ outPlayerId: "h5", inPlayerId: "h6", effectiveFromSequence: 12 }),
      ],
    };
    expect(
      resolveSlotOccupancy({ slot: singlesSlot(11, 2, 1), home: lineup, away: awayLineup })
        .home.playerIds,
    ).toEqual(["h5"]);
    expect(
      resolveSlotOccupancy({ slot: singlesSlot(13, 2, 2), home: lineup, away: awayLineup })
        .home.playerIds,
    ).toEqual(["h6"]);
  });

  it("besetzt einen Doppelslot aus den gemeldeten Paarungen", () => {
    const occupancy = resolveSlotOccupancy({
      slot: doublesSlot(9),
      home: { ...homeLineup, doublesPlayerIds: ["h1", "h5"] },
      away: { ...awayLineup, doublesPlayerIds: ["a1", "a2"] },
    });
    expect(occupancy.home.playerIds).toEqual(["h1", "h5"]);
    expect(occupancy.playable).toBe(true);
  });

  it("wertet einen Doppelslot ohne Paarung der Gegenseite als offen", () => {
    const occupancy = resolveSlotOccupancy({
      slot: doublesSlot(9),
      home: { ...homeLineup, doublesPlayerIds: ["h1", "h5"] },
      away: awayLineup,
    });
    expect(occupancy.playable).toBe(false);
    expect(occupancy.walkoverWinner).toBe("HOME");
  });

  it("meldet die Gegenseite als kampflosen Sieger einer fehlenden Position", () => {
    const shorthanded = {
      nominations: nominate([["h1", 1], ["h2", 2], ["h3", 3]]),
      substitutions: [],
    };
    const occupancy = resolveSlotOccupancy({
      slot: singlesSlot(4, 4, 1),
      home: shorthanded,
      away: awayLineup,
    });
    expect(occupancy.home).toEqual({ side: "HOME", playerIds: [], complete: false });
    expect(occupancy.playable).toBe(false);
    expect(occupancy.walkoverWinner).toBe("AWAY");
  });

  it("meldet keinen kampflosen Sieger, wenn beide Seiten unvollständig sind", () => {
    const shorthanded = {
      nominations: nominate([["h1", 1], ["h2", 2], ["h3", 3]]),
      substitutions: [],
    };
    const occupancy = resolveSlotOccupancy({
      slot: singlesSlot(4, 4, 4),
      home: shorthanded,
      away: { nominations: nominate([["a1", 1], ["a2", 2], ["a3", 3]]), substitutions: [] },
    });
    expect(occupancy.walkoverWinner).toBeNull();
    expect(occupancy.playable).toBe(false);
  });

  it("lehnt einen widersprüchlichen Slot ab", () => {
    expectCode(
      () =>
        resolveSlotOccupancy({
          slot: { sequence: 9, discipline: "DOUBLES", homePosition: 1, awayPosition: 1 },
          home: homeLineup,
          away: awayLineup,
        }),
      "INVALID_SLOT_POSITIONS",
    );
  });
});
