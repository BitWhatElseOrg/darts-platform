// @vitest-environment happy-dom
//
// Konvention aus Tier 1: Komponenten-Tests mit echtem DOM holen sich die
// Umgebung ueber die Pragma-Zeile (siehe `share-panel.render.spec.tsx`).
//
// Befund A (Folgereview oeffentliche-turnier-ids): `LiveEncounter` hatte
// dasselbe Problem, das `live-tournament.render.spec.tsx` fuer die
// Turnieransicht festhaelt (siehe `live-tournament.tsx`, Commit f8c8812).
// Nach dem ersten Erfolg blieb `query.isError` ungelesen; ein ausgefallener
// Hintergrund-Refetch blieb unsichtbar, waehrend eine Hallenwand stundenlang
// den letzten Spielstand zeigte. Dieser Test haelt fest, dass eine
// ausgefallene Aktualisierung textlich sichtbar wird (AGENTS.md §18/§19).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/api-client", () => client);

// `connectEncounterRealtime` liest beim Import die oeffentliche
// Client-Umgebung (`realtime.ts` -> `environment.ts`); dieser Test prueft die
// Verbindungsanzeige aus `query.isError`, nicht die Socket-Verbindung selbst
// -- ein Mock, der nie meldet, haelt `connection` auf dem Ausgangswert
// "verbindet" und damit dieselbe Anzeige wie vor der Realtime-Anbindung.
vi.mock("@/lib/realtime", () => ({ connectEncounterRealtime: () => () => undefined }));

import { LiveEncounter } from "./live-encounter";

const encounter = {
  publicId: "p1",
  competitionName: "Kreisliga 1",
  matchday: 3,
  homeTeamName: "SC Bahnhof",
  awayTeamName: "DC Waldsee",
  scheduledAt: new Date("2026-09-08T18:00:00.000Z"),
  venue: "Turnhalle Bahnhof",
  status: "RUNNING",
  homePoints: 4,
  awayPoints: 2,
  homeGames: 3,
  awayGames: 1,
  homeLegs: 6,
  awayLegs: 4,
  result: null,
  resultType: null,
  completedAt: null,
  slots: [],
  generatedAt: new Date("2026-09-08T18:30:00.000Z"),
};

function renderLiveEncounter(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(LiveEncounter, { publicId: "p1" }),
    ),
  );
  return queryClient;
}

beforeEach(() => {
  client.apiRequest.mockReset();
});

describe("LiveEncounter", () => {
  it("macht eine ausgefallene Aktualisierung sichtbar", async () => {
    client.apiRequest.mockResolvedValueOnce(encounter);
    const queryClient = renderLiveEncounter();
    await screen.findByText(/aktualisiert alle 15 sekunden/i);

    client.apiRequest.mockRejectedValueOnce(new Error("network down"));
    void queryClient.refetchQueries({ queryKey: ["public-encounter", "p1"] });

    await waitFor(() => {
      expect(screen.queryByText(/aktualisiert alle 15 sekunden/i)).toBeNull();
      expect(screen.getByText(/aktualisierung fehlgeschlagen/i)).toBeTruthy();
    });
  });
});
