// @vitest-environment happy-dom
//
// Konvention aus Tier 1: Komponenten-Tests mit echtem DOM holen sich die
// Umgebung ueber die Pragma-Zeile (siehe `use-match-scoring.hook.spec.ts`).
//
// Befund 2 (Abschlussreview oeffentliche-turnier-ids): Der Freigabe-Schalter
// war fuer jede Rolle bedienbar, die das Dashboard sehen darf, unabhaengig
// von `tournament:update`. Ein SCORER bekam beim Antippen serverseitig
// korrekt 403 -- der Schalter selbst taeuschte aber eine Handlungsmoeglichkeit
// vor, die es nicht gibt. Dieser Test haelt fest, dass der Schalter ohne
// `canShare` gesperrt ist, dem Muster von `canCorrect`/`canWithdraw` in
// `tournament-dashboard-route.tsx` folgend.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));

const client = vi.hoisted(() => ({ apiRequest: vi.fn(), userFacingErrorMessage: vi.fn(() => "Fehler") }));
vi.mock("@/lib/api-client", () => client);

import { SharePanel } from "./share-panel";

function renderPanel(canShare: boolean): HTMLButtonElement {
  const queryClient = new QueryClient();
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(SharePanel, {
        canShare,
        organizationId: "11111111-1111-4111-8111-111111111111",
        publicId: "22222222-2222-4222-8222-222222222222",
        tournamentId: "33333333-3333-4333-8333-333333333333",
        visibility: "PRIVATE",
      }),
    ),
  );
  return screen.getByRole("switch") as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
});

describe("SharePanel", () => {
  it("sperrt den Freigabe-Schalter ohne tournament:update", () => {
    expect(renderPanel(false).disabled).toBe(true);
  });

  it("laesst den Freigabe-Schalter mit tournament:update bedienen", () => {
    expect(renderPanel(true).disabled).toBe(false);
  });

  // Befund 2 des Probelaufs vom 25.09.2026: Auf 390 px drueckte der Schalter
  // den Hinweistext auf ein Wort je Zeile zusammen ("Wer / den / Link / hat").
  // Auf schmalen Flaechen stapelt die Karte Text und Schalter deshalb
  // untereinander; erst ab `sm` stehen sie nebeneinander.
  it("stapelt Text und Schalter auf schmalen Flaechen", () => {
    renderPanel(true);
    const section = screen.getByRole("region", { name: "Öffentliche Freigabe" });
    expect(section.className).toContain("flex-col");
    expect(section.className).toContain("sm:flex-row");
    expect(section.className).not.toContain("flex-wrap");
  });
});
