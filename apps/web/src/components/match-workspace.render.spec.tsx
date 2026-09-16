// @vitest-environment happy-dom
//
// Haelt fest, welche Felder der gewaehlte Spielmodus zeigt und was die
// Zusammenfassung daraus macht. Die Regel selbst liegt in der Domaene
// (`matchTargets`), die Maske darf sie nicht zweitkodieren.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OrganizationSummary, PlayerResponse } from "@darts-platform/schemas";

vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// Boards und Matches holt die Flaeche ueber TanStack Query; ohne diese
// Attrappe liefe jeder Fall gegen eine echte Anfrage und liesse beim Abbau des
// Fensters abgebrochene Verbindungen zurueck.
vi.mock("@/lib/api-client", () => ({
  apiRequest: async () => [],
  userFacingErrorMessage: (error: unknown) => String(error),
}));

import { MatchWorkspace } from "./match-workspace";

afterEach(() => {
  cleanup();
});

const organization: OrganizationSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Testverein",
  slug: "testverein",
  timezone: "Europe/Zurich",
  locale: "de-CH",
  role: "OWNER",
  playerId: null,
};

function player(id: string, displayName: string): PlayerResponse {
  return {
    id,
    organizationId: organization.id,
    publicId: `oeffentlich-${id}`,
    firstName: null,
    lastName: null,
    displayName,
    nickname: null,
    email: null,
    externalReference: null,
    status: "ACTIVE",
    hasAccount: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function renderWorkspace() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MatchWorkspace, {
        organization,
        players: [player("eins", "Spielerin Eins"), player("zwei", "Spieler Zwei")],
      }),
    ),
  );
}

describe("MatchWorkspace Spielmodus", () => {
  it("startet im Matchplay-Modus und fragt nur nach Legs", () => {
    renderWorkspace();

    expect(screen.getByRole("radio", { name: "Matchplay" })).toHaveProperty("checked", true);
    expect(screen.getByLabelText("Legs (Best of)")).toBeTruthy();
    expect(screen.queryByLabelText("Sätze (Best of)")).toBeNull();
  });

  it("nennt im Matchplay-Modus die Legs bis zum Matchgewinn", () => {
    renderWorkspace();
    fireEvent.change(screen.getByLabelText("Legs (Best of)"), { target: { value: "21" } });

    expect(screen.getByText("Best of 21 Legs – wer zuerst 11 Legs gewinnt.")).toBeTruthy();
  });

  it("fragt im Set-Modus nach Saetzen und Legs je Satz", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("radio", { name: "Sets" }));

    fireEvent.change(screen.getByLabelText("Sätze (Best of)"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Legs je Satz (Best of)"), { target: { value: "5" } });

    expect(
      screen.getByText("Best of 5 Sätze à Best of 5 Legs – Satz an 3 Legs, Match an 3 Sätzen."),
    ).toBeTruthy();
  });
});
