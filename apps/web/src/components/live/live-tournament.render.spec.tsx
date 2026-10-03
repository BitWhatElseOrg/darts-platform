// @vitest-environment happy-dom
//
// Konvention aus Tier 1: Komponenten-Tests mit echtem DOM holen sich die
// Umgebung ueber die Pragma-Zeile (siehe `share-panel.render.spec.tsx`).
//
// Befund 3 (Abschlussreview oeffentliche-turnier-ids): Mit dem Realtime-Weg
// verschwand die Verbindungsanzeige; uebrig blieb ein `aria-hidden` grauer
// Punkt und ein statischer Text. Faellt die API aus, waehrend der TV-Modus
// an der Hallenwand laeuft, zeigt die Flaeche den letzten Stand weiter, ohne
// das kenntlich zu machen -- entgegen AGENTS.md §18/§19 (sichtbarer
// Verbindungsstatus, keine Information allein ueber Farbe). Dieser Test haelt
// fest, dass eine ausgefallene Aktualisierung textlich sichtbar wird.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { ClubDuelDashboard } from "@darts-platform/schemas";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/api-client", () => client);

// `live-tournament.tsx` ruft seit Befund B (Folgereview
// oeffentliche-turnier-ids) im Fehlerfall `resolvePublicId` auf, dessen Modul
// beim Import die oeffentliche Client-Umgebung liest. Dieser Test prueft die
// Verbindungsanzeige, nicht den Uebergangsweg (siehe
// `live-tournament.legacy-redirect.spec.tsx`) -- beide Module bleiben deshalb
// gemockt.
vi.mock("@/lib/live-address", () => ({ resolvePublicId: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
// `connectTournamentRealtime` liest beim Import die oeffentliche
// Client-Umgebung (`realtime.ts` -> `environment.ts`); dieser Test prueft die
// Verbindungsanzeige aus `query.isError`, nicht die Socket-Verbindung selbst
// -- ein Mock, der nie meldet, haelt `connection` auf dem Ausgangswert
// "verbindet" und damit dieselbe Anzeige wie vor der Realtime-Anbindung.
vi.mock("@/lib/realtime", () => ({ connectTournamentRealtime: () => () => undefined }));

import { LiveTournament } from "./live-tournament";

const dashboard = {
  tournament: {
    name: "Herbstcup",
    stageLabel: "Gruppenphase",
    playedMatches: 1,
    totalMatches: 4,
    status: "GROUP_STAGE",
  },
  boards: [],
  groups: [],
  bracket: [],
  participants: [],
  clubDuel: null,
  doubleElimination: null,
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const roundMatch = (matchId: string, playerAId: string, playerBId: string, status: "READY" | "IN_PROGRESS" | "COMPLETED", legs: [number, number] | null) => ({
  matchId, position: 1, playerAId, playerBId, status, resultType: status === "COMPLETED" ? "PLAYED" as const : null, winnerPlayerId: status === "COMPLETED" ? playerAId : null, legs, boardName: null,
});
const clubDuel: ClubDuelDashboard = {
  sideAName: "VFC", sideBName: "DC Musterdorf", qualifyingRounds: 2, finalRoundSize: 2, thirdPlaceMatch: false, currentRound: 2,
  rounds: [
    { round: 1, matchIds: [id(10)], pausedPlayerIds: [], matches: [roundMatch(id(10), id(1), id(3), "COMPLETED", [2, 0])] },
    { round: 2, matchIds: [id(12), id(13)], pausedPlayerIds: [], matches: [
      roundMatch(id(12), id(1), id(4), "IN_PROGRESS", [1, 0]),
      roundMatch(id(13), id(2), id(3), "READY", null),
    ] },
  ],
  standings: { overall: [], sideA: [], sideB: [] },
  finalRound: { sideA: [], sideB: [], matches: [] },
  finals: { final: null, thirdPlace: null },
  score: { pointsA: 1, pointsB: 0, legDifferenceA: 2, leader: "A" },
};
const clubDuelDashboard = {
  ...dashboard,
  tournament: { ...dashboard.tournament, name: "Vereinsduell VFC", stageLabel: "Qualifikation · Runde 2" },
  participants: [
    { playerId: id(1), displayName: "Anna", status: "ACTIVE", side: "A" },
    { playerId: id(2), displayName: "Aron", status: "ACTIVE", side: "A" },
    { playerId: id(3), displayName: "Beat", status: "ACTIVE", side: "B" },
    { playerId: id(4), displayName: "Bia", status: "ACTIVE", side: "B" },
  ],
  clubDuel,
};

function renderLiveTournament(mode: "publikum" | "tv" | "board" = "tv", boardId?: string): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(LiveTournament, boardId === undefined ? { mode, publicId: "p1" } : { boardId, mode, publicId: "p1" }),
    ),
  );
  return queryClient;
}

beforeEach(() => {
  client.apiRequest.mockReset();
});
afterEach(cleanup);

describe("LiveTournament", () => {
  it("macht eine ausgefallene Aktualisierung sichtbar", async () => {
    client.apiRequest.mockResolvedValueOnce(dashboard);
    const queryClient = renderLiveTournament();
    await screen.findByText("Aktualisiert alle 5 Sekunden");

    client.apiRequest.mockRejectedValueOnce(new Error("network down"));
    void queryClient.refetchQueries({ queryKey: ["public-live", "p1"] });

    await waitFor(() => {
      expect(screen.queryByText("Aktualisiert alle 5 Sekunden")).toBeNull();
      expect(screen.getByText(/aktualisierung/i)).toBeTruthy();
    });
  });
});

describe("LiveTournament – Vereinsduell", () => {
  it("zeigt im Publikumsmodus Vereinswertung und das Vereinsduell mit Tabs", async () => {
    client.apiRequest.mockResolvedValueOnce(clubDuelDashboard);
    renderLiveTournament("publikum");
    const banner = await screen.findByRole("region", { name: "Vereinswertung" });
    expect(banner.textContent).toContain("VFC 1 : 0 DC Musterdorf");
    expect(screen.getByRole("heading", { name: "Vereinsduell" })).toBeTruthy();
    for (const tab of ["Runden", "Rangliste", "Finalrunde"]) {
      expect(screen.getByRole("tab", { name: tab })).toBeTruthy();
    }
    expect(screen.getAllByRole("heading", { name: "Vereinswertung" })).toHaveLength(1);
  });

  it("zeigt im Beamer-Modus die Vereinswertung gross, laufende und nächste Spiele, keine Tabs", async () => {
    client.apiRequest.mockResolvedValueOnce(clubDuelDashboard);
    renderLiveTournament("tv");
    const banner = await screen.findByRole("region", { name: "Vereinswertung" });
    expect(banner.querySelector(".text-display")).not.toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);

    const running = screen.getByRole("heading", { name: "Laufende Spiele" }).closest("section") as HTMLElement;
    expect(within(running).getByText("Anna – Bia")).toBeTruthy();
    // Die Namen brechen um statt abgeschnitten zu werden (Beamer bei 1280px).
    expect(within(running).getByText("Anna – Bia").className).not.toContain("truncate");
    expect(within(running).getByRole("list").className).not.toContain("grid-cols-3");
    expect(within(running).getByText("läuft")).toBeTruthy();
    expect(within(running).queryByText("Aron – Beat")).toBeNull();

    const next = screen.getByRole("heading", { name: "Nächste Spiele" }).closest("section") as HTMLElement;
    expect(within(next).getByText("Aron – Beat")).toBeTruthy();
    expect(within(next).getByText("Aron – Beat").className).not.toContain("truncate");
    expect(within(next).getByText("bereit")).toBeTruthy();
    expect(within(next).queryByText("Anna – Bia")).toBeNull();
    expect(screen.queryByText("Anna – Beat")).toBeNull();
  });

  it("zeigt im Beamer-Modus auch Spiele der Finalrunde und des Finals", async () => {
    const finalRoundDuel: ClubDuelDashboard = {
      ...clubDuel,
      rounds: clubDuel.rounds.map((round) => ({ ...round, matches: round.matches.map((match) => ({ ...match, status: "COMPLETED" as const, legs: [2, 1] as [number, number] })) })),
      finalRound: { sideA: [], sideB: [], matches: [
        { matchId: id(20), round: 1, rankA: 1, rankB: 1, playerAId: id(1), playerBId: id(3), status: "IN_PROGRESS", winnerPlayerId: null, legs: [0, 1] },
      ] },
      finals: { final: { ...roundMatch(id(30), id(2), id(4), "READY", null) }, thirdPlace: null },
    };
    client.apiRequest.mockResolvedValueOnce({ ...clubDuelDashboard, tournament: { ...clubDuelDashboard.tournament, status: "FINAL_ROUND" }, clubDuel: finalRoundDuel });
    renderLiveTournament("tv");
    const running = (await screen.findByRole("heading", { name: "Laufende Spiele" })).closest("section") as HTMLElement;
    expect(within(running).getByText("Anna – Beat")).toBeTruthy();
    const next = screen.getByRole("heading", { name: "Nächste Spiele" }).closest("section") as HTMLElement;
    expect(within(next).getByText("Aron – Bia")).toBeTruthy();
  });
});

describe("LiveTournament – Vereinsduell an der Scheibe", () => {
  it("zeigt im Scheiben-Modus nur die Scheibe, weder Vereinswertung noch Spiellisten", async () => {
    client.apiRequest.mockResolvedValueOnce(clubDuelDashboard);
    renderLiveTournament("board", id(90));
    await screen.findByRole("heading", { name: "Vereinsduell VFC" });
    expect(screen.queryByRole("region", { name: "Vereinswertung" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Laufende Spiele" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Nächste Spiele" })).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});

describe("LiveTournament – Vereinsduell ohne Projektion", () => {
  const withoutProjection = {
    ...dashboard,
    tournament: { ...dashboard.tournament, format: "CLUB_DUEL", stageLabel: "Qualifikation" },
    clubDuel: null,
  };

  for (const mode of ["publikum", "tv"] as const) {
    it(`zeigt im Modus ${mode} einen Hinweis statt einer leeren Rangliste`, async () => {
      client.apiRequest.mockResolvedValueOnce(withoutProjection);
      renderLiveTournament(mode);
      expect(await screen.findByText("Vereinsduell-Ansicht derzeit nicht verfügbar.")).toBeTruthy();
      expect(screen.queryByRole("heading", { name: "Gruppenranglisten" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Tabelle" })).toBeNull();
    });
  }

  it("zeigt den Hinweis bei klassischen Formaten nicht", async () => {
    client.apiRequest.mockResolvedValueOnce({ ...dashboard, tournament: { ...dashboard.tournament, format: "GROUPS_THEN_KNOCKOUT" } });
    renderLiveTournament("publikum");
    await screen.findByRole("heading", { name: "Herbstcup" });
    expect(screen.queryByText("Vereinsduell-Ansicht derzeit nicht verfügbar.")).toBeNull();
  });
});

describe("LiveTournament – Doppel-K.-o.", () => {
  const dkoMatch = (n: number, section: "UPPER" | "LOWER" | "GRAND_FINAL") => ({
    matchId: id(100 + n), round: 1, position: 1, section, status: "READY" as const, resultType: null,
    participantNames: ["Anna", "Beat"] as [string, string], winnerDisplayName: null, boardName: null,
  });
  const dko = {
    ...dashboard,
    tournament: { ...dashboard.tournament, format: "DOUBLE_ELIMINATION", status: "KNOCKOUT", stageLabel: "Gewinnerrunde" },
    bracket: [dkoMatch(1, "UPPER"), dkoMatch(2, "LOWER"), dkoMatch(3, "GRAND_FINAL")],
    doubleElimination: { placements: [], resetPossible: true },
  };

  it("zeigt Gewinnerrunde, Verliererrunde und Final mit Rückspiel-Hinweis", async () => {
    client.apiRequest.mockResolvedValueOnce(dko);
    renderLiveTournament("publikum");
    expect(await screen.findByRole("heading", { name: "Gewinnerrunde" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Verliererrunde" })).toBeTruthy();
    // Der Abschnitt und die erste Finalrunde im Baum heissen beide «Final».
    expect(screen.getAllByRole("heading", { name: "Final", level: 2 })).toHaveLength(1);
    expect(screen.getByText("Ein Rückspiel folgt nur, falls der Sieger der Verliererrunde das Final gewinnt.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "K.-o.-Tableau" })).toBeNull();
  });

  it("zeigt nach Turnierende die Schlussrangliste", async () => {
    client.apiRequest.mockResolvedValueOnce({
      ...dko,
      tournament: { ...dko.tournament, status: "COMPLETED" },
      doubleElimination: {
        resetPossible: false,
        placements: [{ rank: 1, playerId: id(1), displayName: "Anna" }, { rank: 2, playerId: id(2), displayName: "Beat" }],
      },
    });
    renderLiveTournament("publikum");
    expect(await screen.findByRole("heading", { name: "Schlussrangliste" })).toBeTruthy();
    expect(screen.getByText("1.")).toBeTruthy();
    expect(screen.getByText("1.").nextElementSibling?.textContent).toBe("Anna");
  });
});
