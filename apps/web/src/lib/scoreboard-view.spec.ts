import { describe, expect, it } from "vitest";
import { currentRoundNumber, liveHref, threeDartAverage } from "./scoreboard-view";

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

  it("führt bei einem Turnier mit Board auf die Board-Ansicht", () => {
    expect(liveHref({ boardId: "b1", liveTarget: { kind: "TOURNAMENT", tournamentId: "t1" } }))
      .toBe("/live/t1/board/b1");
  });

  it("führt bei einem Turnier ohne Board auf die Turnieransicht", () => {
    expect(liveHref({ boardId: null, liveTarget: { kind: "TOURNAMENT", tournamentId: "t1" } }))
      .toBe("/live/t1");
  });

  it("führt bei einer Begegnung auf die öffentliche Begegnung", () => {
    expect(liveHref({ boardId: null, liveTarget: { kind: "ENCOUNTER", publicId: "e1" } }))
      .toBe("/live/begegnungen/e1");
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
