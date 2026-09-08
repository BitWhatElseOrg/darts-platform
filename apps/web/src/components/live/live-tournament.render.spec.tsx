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
import { render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
};

function renderLiveTournament(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(LiveTournament, { mode: "tv", publicId: "p1" }),
    ),
  );
  return queryClient;
}

beforeEach(() => {
  client.apiRequest.mockReset();
});

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
