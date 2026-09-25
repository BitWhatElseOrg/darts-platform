// @vitest-environment happy-dom
//
// Spec 2026-09-25-lease-karenz-turnier-loeschen (Befund 7): der Abschnitt
// "Turnier loeschen" steht nur mit tournament:delete, und sobald etwas
// gespielt wurde, ist der Knopf gesperrt und der Grund lesbar.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));
const client = vi.hoisted(() => ({ apiRequest: vi.fn(), userFacingErrorMessage: vi.fn(() => "Fehler") }));
vi.mock("@/lib/api-client", () => client);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { DeleteTournamentPanel } from "./delete-tournament-panel";

function renderPanel(blockedReason: string | null): void {
  render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(DeleteTournamentPanel, {
        blockedReason,
        organizationId: "11111111-1111-4111-8111-111111111111",
        tournamentId: "22222222-2222-4222-8222-222222222222",
        tournamentName: "Versehen Cup",
      }),
    ),
  );
}

afterEach(() => {
  cleanup();
});

describe("DeleteTournamentPanel", () => {
  it("bietet das Loeschen an, solange nichts gespielt wurde", () => {
    renderPanel(null);
    const button = screen.getByRole("button", { name: "Turnier löschen" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("sperrt den Knopf und nennt den Grund, sobald Ergebnisse vorliegen", () => {
    renderPanel("Es liegen bereits Ergebnisse vor. Ein gespieltes Turnier bleibt erhalten.");
    const button = screen.getByRole("button", { name: "Turnier löschen" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Es liegen bereits Ergebnisse vor/u)).toBeTruthy();
  });
});
