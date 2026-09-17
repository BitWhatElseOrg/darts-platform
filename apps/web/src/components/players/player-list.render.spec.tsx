// @vitest-environment happy-dom
//
// Haelt fest, dass die Spielerliste Team und Kontostatus als Text zeigt und
// dass die Filter greifen, ohne die Liste neu zu laden.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlayerResponse } from "@darts-platform/schemas";

// Wie in `api-client.spec.ts`: haelt den Test unabhaengig davon, ob
// NEXT_PUBLIC_API_URL in der Umgebung gesetzt ist.
vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));

import { PlayerList } from "./player-list";

afterEach(() => {
  cleanup();
});

function player(overrides: Partial<PlayerResponse>): PlayerResponse {
  return {
    id: "spieler-1",
    organizationId: "organisation-1",
    publicId: "oeffentlich-1",
    firstName: null,
    lastName: null,
    displayName: "Anna Müller",
    nickname: null,
    email: null,
    externalReference: null,
    status: "ACTIVE",
    hasAccount: false,
    avatarChecksum: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

const anna = player({ id: "a", displayName: "Anna Müller", hasAccount: true });
const bruno = player({ id: "b", displayName: "Bruno Beispiel" });

function renderList(players: readonly PlayerResponse[], teams: ReadonlyMap<string, readonly string[]>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(PlayerList, {
        canArchive: false,
        canEdit: false,
        isPending: false,
        organizationId: "organisation-1",
        players,
        teamsByPlayer: teams,
      }),
    ),
  );
}

describe("PlayerList", () => {
  it("zeigt Team und Kontostatus als Text, nicht nur als Farbe", () => {
    renderList([anna, bruno], new Map([["a", ["Adler 1 (C)"]]]));

    // Anna: Captain-Kuerzel und verknuepftes Konto; Bruno: ohne beides.
    expect(
      screen.getByText("Kein Spitzname · Aktiv · Adler 1 (C) · Konto verknüpft"),
    ).toBeTruthy();
    expect(
      screen.getByText("Kein Spitzname · Aktiv · Ohne Team · Kein Konto verknüpft"),
    ).toBeTruthy();
  });

  it("nennt die Trefferzahl in einer aria-live-Region", () => {
    const { container } = renderList([anna, bruno], new Map());
    const live = container.querySelector("[aria-live='polite']");

    expect(live?.textContent).toBe("2 von 2 Spielern");
  });

  it("filtert ueber die Suche und meldet den Leerzustand", () => {
    const { container } = renderList([anna, bruno], new Map());

    fireEvent.change(screen.getByLabelText("Spieler suchen"), {
      target: { value: "Muller" },
    });

    expect(screen.queryByText("Bruno Beispiel")).toBeNull();
    expect(container.querySelector("[aria-live='polite']")?.textContent).toBe(
      "1 von 2 Spielern",
    );

    fireEvent.change(screen.getByLabelText("Spieler suchen"), {
      target: { value: "gibt es nicht" },
    });
    expect(screen.getByText("Kein Spieler passt zu diesen Filtern.")).toBeTruthy();
  });

  it("bietet erst bei gesetztem Filter das Zuruecksetzen an", () => {
    renderList([anna, bruno], new Map());

    expect(screen.queryByText("Filter zurücksetzen")).toBeNull();

    fireEvent.change(screen.getByLabelText("Konto"), { target: { value: "WITH" } });

    expect(screen.getByText("Filter zurücksetzen")).toBeTruthy();
    expect(screen.queryByText("Bruno Beispiel")).toBeNull();
  });
});
