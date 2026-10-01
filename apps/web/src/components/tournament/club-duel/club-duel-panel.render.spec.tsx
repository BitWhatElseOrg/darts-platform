// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ClubDuelDashboard } from "@darts-platform/schemas";

import { ClubDuelPanel, clubDuelTabForStatus } from "./club-duel-panel";
import { ClubScoreBanner } from "./club-score-banner";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const participants = [
  { playerId: id(1), displayName: "Anna", status: "ACTIVE" as const, side: "A" as const },
  { playerId: id(2), displayName: "Aron", status: "ACTIVE" as const, side: "A" as const },
  { playerId: id(3), displayName: "Beat", status: "ACTIVE" as const, side: "B" as const },
  { playerId: id(4), displayName: "Bia", status: "WITHDRAWN" as const, side: "B" as const },
];
const row = (position: number, playerId: string, displayName: string, side: "A" | "B", won: number) => ({
  position, playerId, displayName, side, played: 1, won, lost: 1 - won, legsFor: won * 2, legsAgainst: (1 - won) * 2,
  winRate: won, legDifferencePerMatch: won === 1 ? 2 : -2, withdrawn: playerId === id(4), qualified: true,
});
const clubDuel: ClubDuelDashboard = {
  sideAName: "VFC", sideBName: "DC Musterdorf", qualifyingRounds: 2, finalRoundSize: 2, thirdPlaceMatch: true, currentRound: 2,
  rounds: [
    { round: 1, matchIds: [id(10), id(11)], pausedPlayerIds: [], matches: [
      { matchId: id(10), position: 1, playerAId: id(1), playerBId: id(3), status: "COMPLETED", resultType: "PLAYED", winnerPlayerId: id(1), legs: [2, 0] },
      { matchId: id(11), position: 2, playerAId: id(2), playerBId: id(4), status: "COMPLETED", resultType: "PLAYED", winnerPlayerId: id(4), legs: [1, 2] },
    ] },
    { round: 2, matchIds: [id(12), id(13)], pausedPlayerIds: [], matches: [
      { matchId: id(12), position: 1, playerAId: id(1), playerBId: id(4), status: "READY", resultType: null, winnerPlayerId: null, legs: null },
      { matchId: id(13), position: 2, playerAId: id(2), playerBId: id(3), status: "READY", resultType: null, winnerPlayerId: null, legs: null },
    ] },
  ],
  standings: {
    overall: [row(1, id(1), "Anna", "A", 1), row(2, id(4), "Bia", "B", 1), row(3, id(2), "Aron", "A", 0), row(4, id(3), "Beat", "B", 0)],
    sideA: [row(1, id(1), "Anna", "A", 1), row(2, id(2), "Aron", "A", 0)],
    sideB: [row(1, id(4), "Bia", "B", 1), row(2, id(3), "Beat", "B", 0)],
  },
  finalRound: { sideA: [], sideB: [], matches: [
    { matchId: id(20), round: 1, rankA: 1, rankB: 1, playerAId: null, playerBId: null, status: "WAITING", winnerPlayerId: null, legs: null },
    { matchId: id(21), round: 1, rankA: 2, rankB: 2, playerAId: null, playerBId: null, status: "WAITING", winnerPlayerId: null, legs: null },
    { matchId: id(22), round: 2, rankA: 1, rankB: 2, playerAId: null, playerBId: null, status: "WAITING", winnerPlayerId: null, legs: null },
    { matchId: id(23), round: 2, rankA: 2, rankB: 1, playerAId: null, playerBId: null, status: "WAITING", winnerPlayerId: null, legs: null },
  ] },
  finals: { final: { matchId: id(30), position: 1, playerAId: null, playerBId: null, status: "WAITING", resultType: null, winnerPlayerId: null, legs: null }, thirdPlace: null },
  score: { pointsA: 1, pointsB: 1, legDifferenceA: 1, leader: "A" },
};

afterEach(cleanup);

describe("ClubDuelPanel", () => {
  it("zeigt Runden mit Spielen, Legs und Status, frühere Runden aufklappbar", () => {
    render(createElement(ClubDuelPanel, { clubDuel, participants, defaultTab: "rounds" }));
    const panel = screen.getByRole("tabpanel", { name: "Runden" });
    expect(within(panel).getByRole("heading", { name: "Runde 2" })).toBeTruthy();
    expect(within(panel).getAllByText("bereit")).toHaveLength(2);
    const earlier = within(panel).getByText("Runde 1").closest("details");
    expect(earlier).not.toBeNull();
    expect(within(earlier as HTMLElement).getByText("2:0")).toBeTruthy();
  });

  it("schaltet die Rangliste zwischen Gesamt und Verein um und markiert Ausgefallene", () => {
    render(createElement(ClubDuelPanel, { clubDuel, participants, defaultTab: "standings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Rangliste" }));
    expect(screen.getAllByRole("row")).toHaveLength(5); // Kopf + 4
    fireEvent.click(screen.getByRole("radio", { name: "DC Musterdorf" }));
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText(/Bia/).closest("tr")?.textContent).toContain("Ausgefallen");
  });

  it("rendert die Finalrunde als Kreuztabelle mit Zeilen- und Spaltenköpfen", () => {
    render(createElement(ClubDuelPanel, { clubDuel, participants, defaultTab: "final" }));
    fireEvent.click(screen.getByRole("tab", { name: "Finalrunde" }));
    const table = screen.getByRole("table", { name: "Kreuztabelle" });
    expect(within(table).getAllByRole("rowheader")).toHaveLength(2);
    expect(within(table).getAllByRole("columnheader").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Final")).toBeTruthy();
  });

  it("Tabs sind per Pfeiltaste erreichbar", () => {
    render(createElement(ClubDuelPanel, { clubDuel, participants, defaultTab: "rounds" }));
    const first = screen.getByRole("tab", { name: "Runden" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Rangliste" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("ClubDuelPanel – Tastatur und Randfälle", () => {
  it("End springt auf den letzten Tab, nur der gewählte Tab liegt in der Tab-Reihenfolge", () => {
    render(createElement(ClubDuelPanel, { clubDuel, participants }));
    const first = screen.getByRole("tab", { name: "Runden" });
    fireEvent.keyDown(first, { key: "End" });
    const last = screen.getByRole("tab", { name: "Finalrunde" });
    expect(last.getAttribute("aria-selected")).toBe("true");
    expect(last.getAttribute("tabindex")).toBe("0");
    expect(first.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(last);
  });

  it("Ranglisten-Umschalter folgt den Pfeiltasten und nennt den vollen Vereinsnamen zum Kürzel", () => {
    render(createElement(ClubDuelPanel, { clubDuel, participants, defaultTab: "standings" }));
    fireEvent.keyDown(screen.getByRole("radio", { name: "Gesamt" }), { key: "ArrowRight" });
    const vfc = screen.getByRole("radio", { name: "VFC" });
    expect(vfc.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(vfc);
    const table = screen.getByRole("table");
    expect(table.querySelector("abbr")?.getAttribute("title")).toBe("VFC");
    expect(table.querySelector("tr[data-qualified='true']")).not.toBeNull();
  });

  it("zeigt bestimmte Finalrunden-Spieler als Zeilen- und Spaltenköpfe", () => {
    const seeded: ClubDuelDashboard = {
      ...clubDuel,
      finalRound: {
        ...clubDuel.finalRound,
        matches: clubDuel.finalRound.matches.map((match) => ({
          ...match,
          playerAId: match.rankA === 1 ? id(1) : id(2),
          playerBId: match.rankB === 1 ? id(4) : id(3),
        })),
      },
    };
    render(createElement(ClubDuelPanel, { clubDuel: seeded, participants, defaultTab: "final" }));
    const table = screen.getByRole("table", { name: "Kreuztabelle" });
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["Anna", "Aron"]);
    expect(within(table).getByRole("columnheader", { name: "Bia" })).toBeTruthy();
  });

  it("wählt den Tab passend zum Turnierstatus", () => {
    expect(clubDuelTabForStatus("FINAL_ROUND")).toBe("final");
    expect(clubDuelTabForStatus("KNOCKOUT")).toBe("final");
    expect(clubDuelTabForStatus("COMPLETED")).toBe("final");
    expect(clubDuelTabForStatus("IN_PROGRESS")).toBe("rounds");
  });
});

describe("ClubScoreBanner", () => {
  it("sagt Gleichstand statt einer Führung", () => {
    render(createElement(ClubScoreBanner, { clubDuel: { ...clubDuel, score: { pointsA: 1, pointsB: 1, legDifferenceA: 0, leader: "TIED" } } }));
    const banner = screen.getByRole("region", { name: "Vereinswertung" });
    expect(banner.textContent).toContain("Gleichstand");
    expect(banner.textContent).not.toContain("führt");
    expect(banner.textContent).toContain("Legs 0");
  });

  it("nennt Stand, Führung und Legdifferenz in Worten", () => {
    render(createElement(ClubScoreBanner, { clubDuel }));
    const banner = screen.getByRole("region", { name: "Vereinswertung" });
    expect(banner.textContent).toContain("VFC 1 : 1 DC Musterdorf");
    expect(banner.textContent).toContain("VFC führt");
    expect(banner.textContent).toContain("Legs +1");
  });
});
