import { describe, expect, it } from "vitest";

import {
  competitionStatusLabel,
  disciplineLabel,
  encounterOutcomeLabel,
  encounterStatusLabel,
  encounterTone,
  originLabel,
  sideLabel,
  slotOutcomeLabel,
  slotStatusLabel,
  slotTone,
  variantLabel,
} from "./league-format";

describe("league-format", () => {
  it("spricht die Reglementssprache statt der Tabellennamen", () => {
    expect(encounterStatusLabel("LINEUPS_OPEN")).toBe("Meldung offen");
    expect(encounterStatusLabel("RUNNING")).toBe("läuft");
    expect(slotStatusLabel("WAITING")).toBe("wartet");
    expect(slotStatusLabel("WALKOVER")).toBe("kampflos");
    expect(competitionStatusLabel("DRAFT")).toBe("Entwurf");
    expect(disciplineLabel("DOUBLES")).toBe("Doppel");
    expect(sideLabel("HOME")).toBe("Heim");
    expect(originLabel("GUEST")).toBe("Aushilfe");
  });

  it("benennt jeden Ausgang, nicht nur den regulären", () => {
    expect(slotOutcomeLabel({ winnerSide: "HOME", resultType: "PLAYED" })).toBe("Heim gewinnt");
    expect(slotOutcomeLabel({ winnerSide: "AWAY", resultType: "WALKOVER" })).toBe(
      "Gast gewinnt kampflos",
    );
    expect(slotOutcomeLabel({ winnerSide: null, resultType: null })).toBe("offen");
    expect(encounterOutcomeLabel({ result: "DRAW", resultType: "PLAYED" })).toBe("Unentschieden");
    expect(encounterOutcomeLabel({ result: "HOME_WIN", resultType: "DECIDER" })).toBe(
      "Heim gewinnt nach Entscheidungsdoppel",
    );
    expect(encounterOutcomeLabel({ result: "AWAY_WIN", resultType: "FORFEIT" })).toBe(
      "Gast gewinnt nach Nichtantritt",
    );
    expect(encounterOutcomeLabel({ result: null, resultType: null })).toBe("offen");
  });

  it("nennt die Spielvariante beim Namen, den das Reglement benutzt", () => {
    expect(variantLabel({ startingScore: 501, inRule: "DOUBLE", outRule: "DOUBLE" })).toBe(
      "501 Double In / Double Out",
    );
    expect(variantLabel({ startingScore: 701, inRule: "STRAIGHT", outRule: "MASTER" })).toBe(
      "701 Straight In / Master Out",
    );
    expect(variantLabel({ startingScore: 301, inRule: "STRAIGHT", outRule: "SINGLE" })).toBe(
      "301 Straight In / Single Out",
    );
  });

  it("paart jeden Zustand mit einem Tonwert, der eine Marke traegt", () => {
    expect(slotTone("IN_PROGRESS")).toBe("live");
    expect(slotTone("COMPLETED")).toBe("finish");
    expect(slotTone("WAITING")).toBe("waiting");
    expect(slotTone("WALKOVER")).toBe("blocked");
    expect(slotTone("CANCELLED")).toBe("blocked");
    expect(slotTone("READY")).toBe("free");
    expect(encounterTone("RUNNING")).toBe("live");
    expect(encounterTone("COMPLETED")).toBe("finish");
    expect(encounterTone("CANCELLED")).toBe("conflict");
  });
});
