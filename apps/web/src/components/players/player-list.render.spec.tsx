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
        "Dieser Spieler hat bereits gespielt oder steht in einem Turnier, Team oder einer Begegnung. Er lässt sich nur archivieren.",
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
        "Dieser Spieler hat bereits gespielt oder steht in einem Turnier, Team oder einer Begegnung. Er lässt sich nur archivieren.",
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

  it("verwendet je Zeile eindeutige IDs, damit aria-/Label-Referenzen bei mehreren Spielern auf die offene Instanz zeigen (Fix-Runde 1, Befund 1)", () => {
    const carla = player({ id: "c", displayName: "Carla Muster", firstName: "Carla" });
    renderList([anna, carla], new Map(), { canEdit: true });

    // Ursprünglich (Fix-Runde 1) galt hier: zwei Zeilen, zwei dauerhaft
    // gemountete `PlayerEditDialog`-Instanzen, die sich vor dem Fix dieselben
    // statischen IDs teilten. Seit Fix-Runde 2 mountet `player-list.tsx`
    // `PlayerEditDialog` nur noch waehrend sie offen ist (siehe dort) --
    // Duplikate koennen strukturell nicht mehr auftreten, da nie mehr als
    // eine Instanz gleichzeitig existiert. Der Test bleibt trotzdem
    // sinnvoll: er haelt fest, dass beim Oeffnen der ZWEITEN Zeile
    // `aria-labelledby`/`aria-describedby` und ein `<label for>` auf die
    // tatsaechlich gemountete Instanz zeigen und deren Werte die von Carla
    // sind (nicht etwa ein Reststand von Anna). Aufloesung bewusst ueber das
    // ungescopte `document.getElementById`, wie `aria-labelledby`/
    // `aria-describedby`/`<label for>` es auch im echten Browser tun (IDs
    // sind dokumentweit eindeutig gemeint) -- `within(dialog).getByLabelText`
    // allein wuerde das nicht zeigen, da @testing-library/dom `<label for>`
    // ueber ein bereits auf `dialog` gescoptes `querySelector` aufloest.
    const [, secondEditButton] = screen.getAllByRole("button", { name: "Bearbeiten" });
    if (secondEditButton === undefined) throw new Error("Erwartete zwei 'Bearbeiten'-Buttons.");
    fireEvent.click(secondEditButton);

    const dialog = screen.getByRole("dialog");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(labelledBy).not.toBeNull();
    expect(describedBy).not.toBeNull();
    expect(dialog.contains(document.getElementById(labelledBy ?? ""))).toBe(true);
    expect(dialog.contains(document.getElementById(describedBy ?? ""))).toBe(true);

    const firstNameLabel = within(dialog).getByText("Vorname");
    const firstNameInputId = firstNameLabel.getAttribute("for");
    const firstNameInput = document.getElementById(firstNameInputId ?? "") as HTMLInputElement | null;
    expect(dialog.contains(firstNameInput)).toBe(true);
    expect(firstNameInput?.value).toBe("Carla");
  });

  it("PlayerEditDialog behaelt ungespeicherte Eingaben bei einem Hintergrund-Refetch (gleiche Werte, neue player-Referenz) (Fix-Runde 1, Befund 2)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const buildTree = (players: readonly PlayerResponse[]) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(PlayerList, {
          canArchive: false,
          canDelete: false,
          canEdit: true,
          isPending: false,
          organizationId: "organisation-1",
          players,
          teamsByPlayer: new Map(),
        }),
      );

    const { rerender } = render(buildTree([anna]));

    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const dialog = screen.getByRole("dialog");
    const nicknameInput = within(dialog).getByLabelText("Spitzname") as HTMLInputElement;
    fireEvent.change(nicknameInput, { target: { value: "Getippt" } });
    expect(nicknameInput.value).toBe("Getippt");

    // Simuliert einen Hintergrund-Refetch von ["players", organizationId]:
    // ein neues Objekt mit denselben Werten, wie TanStack Query es nach
    // `staleTime`/Fokuswechsel liefert -- keine Nutzeraktion. Seit Fix-Runde 2
    // (Mount-on-open) greift dieser Schutz "von selbst": `defaultValues`
    // liest `player` nur einmal, im Moment des Mountens: es gibt keinen
    // Reset-Effekt mehr, der auf eine neue `player`-Referenz reagieren
    // koennte, waehrend die (seit Fix-Runde 1 unveraendert bestehende)
    // dieselbe Dialog-Instanz weiterlebt.
    rerender(buildTree([{ ...anna }]));

    expect(
      (within(screen.getByRole("dialog")).getByLabelText("Spitzname") as HTMLInputElement).value,
    ).toBe("Getippt");
  });

  it("'Stattdessen archivieren' deaktiviert sich waehrend pending und zeigt einen Fehlschlag im offenen Loesch-Dialog (Fix-Runde 1, Befund 3)", async () => {
    client.apiRequest.mockRejectedValueOnce(
      new client.ApiClientError(
        "Dieser Spieler hat bereits gespielt oder steht in einem Turnier, Team oder einer Begegnung. Er lässt sich nur archivieren.",
        "PLAYER_HAS_HISTORY",
        null,
        undefined,
        409,
      ),
    );
    renderList([anna], new Map(), { canArchive: true, canDelete: true });

    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Endgültig löschen" }));

    const archiveInstead = (await waitFor(() =>
      within(dialog).getByRole("button", { name: "Stattdessen archivieren" }),
    )) as HTMLButtonElement;

    let rejectArchive: (reason: unknown) => void = () => {};
    client.apiRequest.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectArchive = reject;
        }),
    );
    fireEvent.click(archiveInstead);

    await waitFor(() => {
      expect(archiveInstead.disabled).toBe(true);
    });

    rejectArchive(new Error("kaputt"));

    await waitFor(() => {
      const alerts = within(dialog).getAllByRole("alert").map((element) => element.textContent);
      expect(alerts).toContain("Fehler");
    });
    expect(archiveInstead.disabled).toBe(false);
  });

  it("zeigt kein 'Anzeigename'-Feld, solange kein Bearbeiten-Dialog offen ist (Fix-Runde 2)", () => {
    // Vor Fix-Runde 2 mountete `PlayerRow` `PlayerEditDialog` dauerhaft und
    // schaltete nur `open` um -- ein geschlossener Dialog liess dabei sein
    // `<label>Anzeigename</label>`/`<input>`-Paar im DOM stehen. `queryBy-
    // LabelText` filtert (anders als eine `ByRole`-Abfrage) nicht nach
    // `display: none`, haette diesen Reststand also gefunden. Das war exakt
    // der Fund aus Task 4s E2E-Lauf: `page.getByLabel("Anzeigename", {
    // exact: true })` traf in Playwrights Strict Mode auf zwei Elemente.
    renderList([anna], new Map(), { canEdit: true });

    expect(screen.queryByLabelText("Anzeigename")).toBeNull();

    // Und nach dem Schliessen (Abbrechen) wieder weg.
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    expect(screen.getByLabelText("Anzeigename")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByLabelText("Anzeigename")).toBeNull();
  });
});
