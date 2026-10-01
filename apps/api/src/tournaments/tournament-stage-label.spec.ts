import { describe, expect, it } from "vitest";

import { tournamentStageLabel } from "./tournament-stage-label.js";

describe("tournamentStageLabel", () => {
  describe("klassische Formate (unveraendert)", () => {
    it.each([
      ["GROUP_STAGE", "GROUPS_THEN_KNOCKOUT", "Gruppenphase"],
      ["GROUP_STAGE", "ROUND_ROBIN", "Jeder gegen jeden"],
      ["KNOCKOUT", "GROUPS_THEN_KNOCKOUT", "K.-o.-Runde"],
      ["KNOCKOUT", "SINGLE_ELIMINATION", "K.-o.-Runde"],
      ["COMPLETED", "ROUND_ROBIN", "Turnier beendet"],
      ["READY", "GROUPS_THEN_KNOCKOUT", "Startbereit"],
      ["DRAFT", "SINGLE_ELIMINATION", "Startbereit"],
    ] as const)("%s/%s -> %s", (status, format, expected) => {
      expect(tournamentStageLabel({ status, format, clubDuelRound: null })).toBe(expected);
    });
  });

  describe("Vereinsduell", () => {
    it("nennt in der Qualifikation die laufende Runde", () => {
      expect(tournamentStageLabel({ status: "GROUP_STAGE", format: "CLUB_DUEL", clubDuelRound: 2 })).toBe(
        "Qualifikation · Runde 2",
      );
    });

    it("faellt ohne Projektion (Ruling R11) auf «Qualifikation» zurueck", () => {
      expect(tournamentStageLabel({ status: "GROUP_STAGE", format: "CLUB_DUEL", clubDuelRound: null })).toBe(
        "Qualifikation",
      );
    });

    it.each([
      ["FINAL_ROUND", "Finalrunde"],
      ["KNOCKOUT", "Final"],
      ["COMPLETED", "Turnier beendet"],
      ["READY", "Startbereit"],
    ] as const)("%s -> %s", (status, expected) => {
      expect(tournamentStageLabel({ status, format: "CLUB_DUEL", clubDuelRound: 3 })).toBe(expected);
    });
  });
});
