// @vitest-environment happy-dom
//
// Haelt fest, dass die Spielerliste Team und Kontostatus als Text zeigt und
// dass die Filter greifen, ohne die Liste neu zu laden. Ausserdem: Bearbeiten
// oeffnet einen `PlayerEditDialog`, Archivieren und Loeschen oeffnen einen
// `ConfirmDialog` statt sofort zu senden, Reaktivieren sendet direkt, und ein
// 409 PLAYER_HAS_HISTORY beim Loeschen bietet "Stattdessen archivieren" an.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerResponse } from "@darts-platform/schemas";

// Wie in `api-client.spec.ts`: haelt den Test unabhaengig davon, ob
// NEXT_PUBLIC_API_URL in der Umgebung gesetzt ist.
vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));

// Voller Modul-Mock (statt nur `fetch`): `player-list.tsx` und
// `player-edit-dialog.tsx` importieren `apiRequest`/`ApiClientError`/
// `userFacingErrorMessage` aus genau diesem Modul, und der 409-Fall braucht
// eine `instanceof`-Pruefung auf `ApiClientError` mit passendem `code`.
const client = vi.hoisted(() => {
  class ApiClientError extends Error {
    public readonly code: string;
    public readonly correlationId: string | null;
    public readonly details: unknown;
    public readonly status: number | null;

    public constructor(
      message: string,
      code = "REQUEST_FAILED",
      correlationId: string | null = null,
      details?: unknown,
      status: number | null = null,
    ) {
      super(message);
      this.name = "ApiClientError";
      this.code = code;
      this.correlationId = correlationId;
      this.details = details;
      this.status = status;
    }
  }
  const userFacingErrorMessage = vi.fn((error: unknown) =>
    error instanceof ApiClientError ? error.message : "Fehler",
  );
  return { apiRequest: vi.fn(), userFacingErrorMessage, ApiClientError };
});
vi.mock("@/lib/api-client", () => client);

import { PlayerList } from "./player-list";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  client.apiRequest.mockReset();
  client.userFacingErrorMessage.mockClear();
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

function renderList(
  players: readonly PlayerResponse[],
  teams: ReadonlyMap<string, readonly string[]>,
  permissions: Partial<{ canArchive: boolean; canEdit: boolean; canDelete: boolean }> = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(PlayerList, {
        canArchive: false,
        canDelete: false,
        canEdit: false,
        isPending: false,
        organizationId: "organisation-1",
        players,
        teamsByPlayer: teams,
        ...permissions,
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

  it("zeigt 'Löschen' nur mit canDelete", () => {
    renderList([anna], new Map(), { canDelete: false });
    expect(screen.queryByRole("button", { name: "Löschen" })).toBeNull();

    cleanup();
    renderList([anna], new Map(), { canDelete: true });
    expect(screen.getByRole("button", { name: "Löschen" })).toBeTruthy();
  });

  it("zeigt 'Reaktivieren' nur bei archivierten Spielern mit canEdit", () => {
    const archived = player({ id: "c", status: "INACTIVE" });

    renderList([anna], new Map(), { canEdit: true });
    expect(screen.queryByRole("button", { name: "Reaktivieren" })).toBeNull();

    cleanup();
    renderList([archived], new Map(), { canEdit: false });
    expect(screen.queryByRole("button", { name: "Reaktivieren" })).toBeNull();

    cleanup();
    renderList([archived], new Map(), { canEdit: true });
    expect(screen.getByRole("button", { name: "Reaktivieren" })).toBeTruthy();
  });

  it("sendet Reaktivieren direkt, ohne Dialog", async () => {
    const archived = player({ id: "c", status: "INACTIVE" });
    client.apiRequest.mockResolvedValueOnce({ ...archived, status: "ACTIVE" });
    renderList([archived], new Map(), { canEdit: true });

    fireEvent.click(screen.getByRole("button", { name: "Reaktivieren" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(client.apiRequest).toHaveBeenCalledWith({
        path: "/organizations/organisation-1/players/c",
        method: "PATCH",
        body: { status: "ACTIVE" },
        schema: expect.anything(),
      });
    });
  });

  it("'Archivieren' oeffnet einen Dialog statt sofort zu senden", async () => {
    renderList([anna], new Map(), { canArchive: true });

    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Spieler archivieren")).toBeTruthy();
    expect(client.apiRequest).not.toHaveBeenCalled();

    client.apiRequest.mockResolvedValueOnce({ ...anna, status: "INACTIVE" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Archivieren" }));

    await waitFor(() => {
      expect(client.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/organizations/organisation-1/players/a", method: "DELETE" }),
      );
    });
  });

  it("'Löschen' oeffnet einen Dialog; ein 409 PLAYER_HAS_HISTORY bietet 'Stattdessen archivieren' an", async () => {
    client.apiRequest.mockRejectedValueOnce(
      new client.ApiClientError(
        "Dieser Spieler hat bereits gespielt oder steht in einem Team. Er lässt sich nur archivieren.",
        "PLAYER_HAS_HISTORY",
        null,
        undefined,
        409,
      ),
    );
    renderList([anna], new Map(), { canArchive: true, canDelete: true });

    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Spieler endgültig löschen")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Endgültig löschen" }));

    await waitFor(() => {
      expect(within(dialog).getByRole("alert").textContent).toBe(
        "Dieser Spieler hat bereits gespielt oder steht in einem Team. Er lässt sich nur archivieren.",
      );
    });

    const archiveInstead = within(dialog).getByRole("button", { name: "Stattdessen archivieren" });
    client.apiRequest.mockResolvedValueOnce({ ...anna, status: "INACTIVE" });
    fireEvent.click(archiveInstead);

    await waitFor(() => {
      expect(client.apiRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({ path: "/organizations/organisation-1/players/a", method: "DELETE" }),
      );
    });
  });

  it("Bearbeiten oeffnet einen Dialog mit allen sechs Feldern, vorbelegt", () => {
    const carla = player({
      id: "c",
      firstName: "Carla",
      lastName: "Muster",
      displayName: "Carla Muster",
      nickname: "Carly",
      email: "carla@example.com",
      externalReference: "EXT-1",
    });
    renderList([carla], new Map(), { canEdit: true });

    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Spieler bearbeiten")).toBeTruthy();
    expect((within(dialog).getByLabelText("Vorname") as HTMLInputElement).value).toBe("Carla");
    expect((within(dialog).getByLabelText("Nachname") as HTMLInputElement).value).toBe("Muster");
    expect((within(dialog).getByLabelText("Anzeigename") as HTMLInputElement).value).toBe("Carla Muster");
    expect((within(dialog).getByLabelText("Spitzname") as HTMLInputElement).value).toBe("Carly");
    expect((within(dialog).getByLabelText("E-Mail") as HTMLInputElement).value).toBe("carla@example.com");
    expect((within(dialog).getByLabelText("Externe Referenz") as HTMLInputElement).value).toBe("EXT-1");
  });
});
