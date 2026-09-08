import { describe, expect, it } from "vitest";
import { currentRoundNumber, dartKeypadLabel, dartLabel, liveHref, pendingLegDecision, quickScoresSourceLabel, threeDartAverage } from "./scoreboard-view";

describe("currentRoundNumber", () => {
  it("beginnt bei eins ohne Aufnahme im Leg", () => {
    expect(currentRoundNumber({ currentLegNumber: 2, visits: [] })).toBe(1);
  });

  it("zählt die Runde aus den Aufnahmen des laufenden Legs", () => {
    expect(currentRoundNumber({
      currentLegNumber: 2,
      visits: [
        { legNumber: 2, playerId: "p1", reverted: false },
        { legNumber: 2, playerId: "p2", reverted: false },
        { legNumber: 2, playerId: "p1", reverted: false },
        { legNumber: 1, playerId: "p1", reverted: false },
      ],
    })).toBe(2);
  });

  it("übergeht zurückgenommene Aufnahmen", () => {
    expect(currentRoundNumber({
      currentLegNumber: 2,
      visits: [
        { legNumber: 2, playerId: "p1", reverted: true },
        { legNumber: 2, playerId: "p2", reverted: true },
      ],
    })).toBe(1);
  });
});

describe("liveHref", () => {
  it("führt ohne Wettbewerbsbezug nirgendwohin", () => {
    expect(liveHref({ boardId: "b1", liveTarget: null })).toBeNull();
  });

  it("führt bei einem Turnier mit Board auf die Board-Ansicht unter der öffentlichen ID", () => {
    expect(liveHref({ boardId: "b1", liveTarget: { kind: "TOURNAMENT", tournamentId: "t1", publicId: "p1" } }))
      .toBe("/live/p1/board/b1");
  });

  it("führt bei einem Turnier ohne Board auf die Turnieransicht unter der öffentlichen ID", () => {
    expect(liveHref({ boardId: null, liveTarget: { kind: "TOURNAMENT", tournamentId: "t1", publicId: "p1" } }))
      .toBe("/live/p1");
  });

  it("führt bei einer Begegnung auf die öffentliche Begegnung", () => {
    expect(liveHref({ boardId: null, liveTarget: { kind: "ENCOUNTER", publicId: "e1" } }))
      .toBe("/live/begegnungen/e1");
  });
});

describe("dartLabel", () => {
  it("beschriftet einen Fehlwurf mit einem Gedankenstrich", () => {
    expect(dartLabel({ segment: 0, multiplier: 1 })).toBe("—");
  });

  it("beschriftet einen Single mit der reinen Zahl", () => {
    expect(dartLabel({ segment: 20, multiplier: 1 })).toBe("20");
  });

  it("beschriftet ein Doppel mit D", () => {
    expect(dartLabel({ segment: 20, multiplier: 2 })).toBe("D 20");
  });

  it("beschriftet ein Triple mit T", () => {
    expect(dartLabel({ segment: 5, multiplier: 3 })).toBe("T 5");
  });

  it("beschriftet Bull (Segment 25, Multiplikator 1) als Bull", () => {
    expect(dartLabel({ segment: 25, multiplier: 1 })).toBe("Bull");
  });

  /**
   * Bekannter Fehler vor dieser Zusammenführung: die alte Fassung in
   * scoreboard-sides.tsx behandelte Segment 25 nicht gesondert und zeigte
   * fuer den Bullseye-Treffer faelschlich "D 25" statt "Bullseye".
   */
  it("beschriftet Bullseye (Segment 25, Multiplikator 2) als Bullseye, nicht als D 25", () => {
    expect(dartLabel({ segment: 25, multiplier: 2 })).toBe("Bullseye");
  });
});

describe("dartKeypadLabel", () => {
  it("beschriftet den Fehlwurf ausgeschrieben", () => {
    expect(dartKeypadLabel(0, 1)).toBe("Fehlwurf");
  });

  it("beschriftet die Bullseye-Taste unabhaengig vom Umschalter", () => {
    expect(dartKeypadLabel(50, 1)).toBe("Bullseye");
  });

  it("beschriftet die Bull-Taste unabhaengig vom Umschalter", () => {
    expect(dartKeypadLabel(25, 1)).toBe("Bull");
  });

  it("beschriftet ein Segment ohne Umschalter als Single", () => {
    expect(dartKeypadLabel(5, 1)).toBe("Single 5");
  });

  it("beschriftet ein Segment mit aktivem Doppel-Umschalter", () => {
    expect(dartKeypadLabel(5, 2)).toBe("Doppel 5");
  });

  it("beschriftet ein Segment mit aktivem Triple-Umschalter", () => {
    expect(dartKeypadLabel(5, 3)).toBe("Triple 5");
  });
});

describe("quickScoresSourceLabel", () => {
  it("beschriftet Werte aus der eigenen Historie der Person", () => {
    expect(quickScoresSourceLabel("PLAYER")).toBe("Deine Schnellwerte");
  });

  it("beschriftet Werte aus der Organisation, wenn die Person zu wenig Historie hat", () => {
    expect(quickScoresSourceLabel("ORGANIZATION")).toBe("Vereins-Schnellwerte");
  });

  it("beschriftet den festen Standardsatz", () => {
    expect(quickScoresSourceLabel("DEFAULT")).toBe("Standard-Schnellwerte");
  });
});

describe("threeDartAverage", () => {
  it("ist null ohne gewertete Aufnahme", () => {
    expect(threeDartAverage({ visits: [], playerIds: ["p1"], legNumber: 1 })).toBe(0);
  });

  it("rechnet die angerechneten Punkte auf drei Darts hoch", () => {
    expect(threeDartAverage({
      visits: [
        { legNumber: 1, playerId: "p1", appliedPoints: 60, dartsThrown: 3, reverted: false },
        { legNumber: 1, playerId: "p1", appliedPoints: 40, dartsThrown: 2, reverted: false },
      ],
      playerIds: ["p1"],
      legNumber: 1,
    })).toBeCloseTo(60, 1);
  });
});


describe("pendingLegDecision", () => {
  const laufend = {
    status: "IN_PROGRESS" as const,
    currentLegNumber: 3,
    legStartPending: false,
    roundLimitReached: false,
  };

  it("verlangt nichts, solange der Server nichts offen meldet", () => {
    expect(pendingLegDecision(laufend)).toBeNull();
  });

  it("verlangt den Anwurf mit der Legnummer", () => {
    expect(pendingLegDecision({ ...laufend, legStartPending: true })).toEqual({
      kind: "LEG_START",
      legNumber: 3,
    });
  });

  it("verlangt das Ausbullen an der Rundengrenze", () => {
    expect(pendingLegDecision({ ...laufend, roundLimitReached: true })).toEqual({
      kind: "LEG_BY_BULL",
    });
  });

  /**
   * Beide zugleich kann der Server nicht melden — die Rundengrenze setzt
   * Aufnahmen im Leg voraus, und die loeschen den offenen Anwurf. Faende sich
   * doch einmal beides, gilt das Ausbullen: es beendet das laufende Leg,
   * waehrend der Anwurf ein Leg eroeffnet, das dann schon laeuft.
   */
  it("laesst das Ausbullen vorgehen, wenn beides gemeldet waere", () => {
    expect(pendingLegDecision({ ...laufend, legStartPending: true, roundLimitReached: true })).toEqual({
      kind: "LEG_BY_BULL",
    });
  });

  it("verlangt im beendeten Match nichts", () => {
    expect(pendingLegDecision({ ...laufend, status: "COMPLETED", legStartPending: true })).toBeNull();
    expect(pendingLegDecision({ ...laufend, status: "ABORTED", roundLimitReached: true })).toBeNull();
  });
});
