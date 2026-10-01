import { describe, expect, it } from "vitest";

import { legsLabel, participantNames, roundMatchStateLabel, scoreLine, sideLabel } from "./club-duel-view";

const settings = { sideAName: "VFC", sideBName: "DC Musterdorf" };

describe("club-duel-view", () => {
  it("liefert Name und Kürzel je Seite", () => {
    expect(sideLabel(settings, "A")).toEqual({ name: "VFC", short: "VFC" });
    expect(sideLabel(settings, "B")).toEqual({ name: "DC Musterdorf", short: "DM" });
  });

  it("formatiert die Vereinswertung", () => {
    expect(scoreLine({ ...settings, score: { pointsA: 21, pointsB: 15, legDifferenceA: 4, leader: "A" } })).toBe(
      "VFC 21 : 15 DC Musterdorf",
    );
  });

  it("formatiert Legs", () => {
    expect(legsLabel([2, 1])).toBe("2:1");
    expect(legsLabel(null)).toBe("–");
  });

  it("übersetzt Matchstatus in Ton und Wort", () => {
    expect(roundMatchStateLabel("WAITING")).toEqual({ tone: "waiting", label: "offen" });
    expect(roundMatchStateLabel("READY")).toEqual({ tone: "free", label: "bereit" });
    expect(roundMatchStateLabel("IN_PROGRESS")).toEqual({ tone: "live", label: "läuft" });
    expect(roundMatchStateLabel("COMPLETED")).toEqual({ tone: "finish", label: "gespielt" });
    expect(roundMatchStateLabel("BYE")).toEqual({ tone: "finish", label: "Freilos" });
    expect(roundMatchStateLabel("CANCELLED")).toEqual({ tone: "blocked", label: "abgesagt" });
  });

  it("baut die Namens-Map", () => {
    expect(participantNames([{ playerId: "a", displayName: "Anna" }]).get("a")).toBe("Anna");
  });
});
