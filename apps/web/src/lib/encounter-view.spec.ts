import { describe, expect, it } from "vitest";
import type { EncounterDetail, EncounterSlotView } from "@darts-platform/schemas";

import {
  deciderNotice,
  encounterTally,
  openDoublesSlots,
  slotAvailability,
  substitutionContext,
} from "./encounter-view";

function player(id: string, name: string) {
  return { playerId: id, displayName: name };
}

function slot(
  overrides: Partial<EncounterSlotView> & { readonly sequence: number },
): EncounterSlotView {
  return {
    id: `00000000-0000-4000-8000-${String(overrides.sequence).padStart(12, "0")}`,
    role: "REGULAR",
    discipline: "SINGLES",
    label: `Spiel ${overrides.sequence}`,
    homePosition: 1,
    awayPosition: 1,
    startingScore: 501,
    inRule: "DOUBLE",
    outRule: "DOUBLE",
    maxRounds: null,
    bestOfLegs: 3,
    legsToWinSet: 2,
    setsToWin: 1,
    status: "WAITING",
    boardId: null,
    boardName: null,
    matchId: null,
    winnerSide: null,
    resultType: null,
    homeLegs: 0,
    awayLegs: 0,
    version: 0,
    completedAt: null,
    home: { players: [player("h1", "Heim Eins")], complete: true },
    away: { players: [player("a1", "Gast Eins")], complete: true },
    ...overrides,
  };
}

function encounter(overrides: Partial<EncounterDetail> = {}): EncounterDetail {
  return {
    id: "00000000-0000-4000-8000-00000000000e",
    publicId: "00000000-0000-4000-8000-00000000000f",
    organizationId: "00000000-0000-4000-8000-000000000001",
    competitionId: "00000000-0000-4000-8000-000000000002",
    competitionName: "Gruppe STSO S 2",
    matchday: 3,
    homeTeamId: "00000000-0000-4000-8000-000000000003",
    homeTeamName: "Bulls Ost",
    awayTeamId: "00000000-0000-4000-8000-000000000004",
    awayTeamName: "Oche West",
    scheduledAt: new Date("2026-09-10T18:30:00.000Z"),
    venue: "Clublokal",
    status: "RUNNING",
    version: 7,
    homePoints: 0,
    awayPoints: 0,
    homeGames: 0,
    awayGames: 0,
    homeLegs: 0,
    awayLegs: 0,
    result: null,
    resultType: null,
    completedAt: null,
    deciderRule: "EXTRA_SLOT",
    lineupPositions: 4,
    minNominations: 4,
    minNominationsShorthanded: 3,
    maxSubstitutionsPerEncounter: 4,
    maxDoublesPerPlayer: 1,
    decider: { status: "REGULAR_SLOTS_PENDING", required: false, slotSequence: 19 },
    home: {
      side: "HOME",
      teamId: "00000000-0000-4000-8000-000000000003",
      teamName: "Bulls Ost",
      submitted: true,
      revealed: true,
      nominations: [
        { playerId: "h1", displayName: "Heim Eins", position: 1, origin: "SQUAD" },
        { playerId: "h2", displayName: "Heim Zwei", position: 2, origin: "SQUAD" },
        { playerId: "h5", displayName: "Heim Fünf", position: null, origin: "SQUAD" },
      ],
      substitutions: [],
    },
    away: {
      side: "AWAY",
      teamId: "00000000-0000-4000-8000-000000000004",
      teamName: "Oche West",
      submitted: true,
      revealed: true,
      nominations: [{ playerId: "a1", displayName: "Gast Eins", position: 1, origin: "SQUAD" }],
      substitutions: [],
    },
    slots: [slot({ sequence: 1 })],
    ...overrides,
  };
}

describe("slotAvailability", () => {
  it("gibt ein wartendes, beidseitig besetztes Spiel einer laufenden Begegnung frei", () => {
    expect(slotAvailability(encounter(), slot({ sequence: 1 }))).toEqual({
      assignable: true,
      reason: null,
    });
  });

  it("nennt die fehlende Seite beim Namen", () => {
    const result = slotAvailability(
      encounter(),
      slot({
        sequence: 9,
        discipline: "DOUBLES",
        homePosition: null,
        awayPosition: null,
        away: { players: [], complete: false },
      }),
    );
    expect(result.assignable).toBe(false);
    expect(result.reason).toBe("Gast hat die Doppelpaarung noch nicht gemeldet.");
  });

  it("laesst vor dem Anwurf kein Spiel zu", () => {
    const result = slotAvailability(encounter({ status: "READY" }), slot({ sequence: 1 }));
    expect(result.assignable).toBe(false);
    expect(result.reason).toBe("Die Begegnung ist noch nicht gestartet.");
  });

  it("gibt ein laufendes oder entschiedenes Spiel nicht erneut frei", () => {
    expect(slotAvailability(encounter(), slot({ sequence: 1, status: "IN_PROGRESS" })).reason).toBe(
      "Das Spiel läuft bereits.",
    );
    expect(slotAvailability(encounter(), slot({ sequence: 1, status: "COMPLETED" })).reason).toBe(
      "Das Spiel ist entschieden.",
    );
    expect(slotAvailability(encounter(), slot({ sequence: 1, status: "WALKOVER" })).reason).toBe(
      "Das Spiel ist entschieden.",
    );
  });

  it("haelt den Entscheidungsslot zurueck, solange er nicht gebraucht wird", () => {
    const decider = slot({
      sequence: 19,
      role: "DECIDER",
      discipline: "DOUBLES",
      homePosition: null,
      awayPosition: null,
    });
    const result = slotAvailability(encounter(), decider);
    expect(result.assignable).toBe(false);
    expect(result.reason).toBe("Das Entscheidungsdoppel wird erst bei Gleichstand gebraucht.");
  });

  it("gibt den Entscheidungsslot frei, sobald der Server ihn verlangt", () => {
    const decider = slot({
      sequence: 19,
      role: "DECIDER",
      discipline: "DOUBLES",
      homePosition: null,
      awayPosition: null,
    });
    const result = slotAvailability(
      encounter({ decider: { status: "REQUIRED", required: true, slotSequence: 19 } }),
      decider,
    );
    expect(result).toEqual({ assignable: true, reason: null });
  });
});

describe("openDoublesSlots", () => {
  it("fuehrt nur die Doppel, fuer die diese Seite noch melden muss", () => {
    const slots = [
      slot({ sequence: 1 }),
      slot({
        sequence: 9,
        discipline: "DOUBLES",
        homePosition: null,
        awayPosition: null,
        home: { players: [], complete: false },
      }),
      slot({ sequence: 10, discipline: "DOUBLES", homePosition: null, awayPosition: null }),
    ];
    expect(openDoublesSlots(encounter({ slots }), "HOME").map((entry) => entry.sequence)).toEqual([
      9,
    ]);
    expect(openDoublesSlots(encounter({ slots }), "AWAY")).toEqual([]);
  });

  it("nimmt den Entscheidungsslot erst auf, wenn er verlangt ist", () => {
    const decider = slot({
      sequence: 19,
      role: "DECIDER",
      discipline: "DOUBLES",
      homePosition: null,
      awayPosition: null,
      home: { players: [], complete: false },
    });
    expect(openDoublesSlots(encounter({ slots: [decider] }), "HOME")).toEqual([]);
    expect(
      openDoublesSlots(
        encounter({
          slots: [decider],
          decider: { status: "REQUIRED", required: true, slotSequence: 19 },
        }),
        "HOME",
      ).map((entry) => entry.sequence),
    ).toEqual([19]);
  });
});

describe("substitutionContext", () => {
  it("wechselt nie in eine laufende oder gespielte Paarung hinein", () => {
    const slots = [
      slot({ sequence: 1, status: "COMPLETED" }),
      slot({ sequence: 2, status: "IN_PROGRESS" }),
      slot({ sequence: 3 }),
    ];
    expect(substitutionContext(encounter({ slots }), "HOME").minimumSequence).toBe(3);
  });

  it("bietet die gemeldeten Ersatzpersonen an und zaehlt das Kontingent", () => {
    const context = substitutionContext(encounter(), "HOME");
    expect(context.positions).toEqual([
      { position: 1, playerId: "h1", displayName: "Heim Eins" },
      { position: 2, playerId: "h2", displayName: "Heim Zwei" },
    ]);
    expect(context.available).toEqual([{ playerId: "h5", displayName: "Heim Fünf" }]);
    expect(context.remaining).toBe(4);
  });

  it("rechnet erfolgte Auswechslungen gegen das Kontingent und die Aufstellung", () => {
    const withSubstitution = encounter({
      home: {
        ...encounter().home,
        substitutions: [
          {
            id: "00000000-0000-4000-8000-0000000000aa",
            side: "HOME",
            position: 2,
            outPlayerId: "h2",
            outDisplayName: "Heim Zwei",
            inPlayerId: "h5",
            inDisplayName: "Heim Fünf",
            effectiveFromSequence: 3,
            reason: "Verletzung",
            createdAt: new Date("2026-09-10T19:10:00.000Z"),
          },
        ],
      },
    });
    const context = substitutionContext(withSubstitution, "HOME");
    expect(context.used).toBe(1);
    expect(context.remaining).toBe(3);
    expect(context.positions).toEqual([
      { position: 1, playerId: "h1", displayName: "Heim Eins" },
      { position: 2, playerId: "h5", displayName: "Heim Fünf" },
    ]);
    expect(context.available).toEqual([]);
  });
});

describe("encounterTally und deciderNotice", () => {
  it("zaehlt entschiedene, laufende und zu spielende Spiele ohne den ungenutzten Entscheidungsslot", () => {
    const slots = [
      slot({ sequence: 1, status: "COMPLETED" }),
      slot({ sequence: 2, status: "WALKOVER" }),
      slot({ sequence: 3, status: "IN_PROGRESS" }),
      slot({ sequence: 4 }),
      slot({
        sequence: 19,
        role: "DECIDER",
        status: "CANCELLED",
        discipline: "DOUBLES",
        homePosition: null,
        awayPosition: null,
      }),
    ];
    expect(encounterTally(encounter({ slots }))).toEqual({ decided: 2, running: 1, total: 4 });
  });

  it("sagt, ob das Entscheidungsdoppel gebraucht wird", () => {
    expect(deciderNotice(encounter())).toBeNull();
    expect(
      deciderNotice(encounter({ decider: { status: "REQUIRED", required: true, slotSequence: 19 } })),
    ).toBe(
      "Gleichstand nach den regulären Spielen. Das Entscheidungsdoppel (Spiel 19) wird gebraucht; beide Seiten melden dafür eine Paarung.",
    );
    expect(
      deciderNotice(
        encounter({ decider: { status: "NOT_REQUIRED", required: false, slotSequence: 19 } }),
      ),
    ).toBe("Das Entscheidungsdoppel wird nicht gebraucht.");
  });
});
