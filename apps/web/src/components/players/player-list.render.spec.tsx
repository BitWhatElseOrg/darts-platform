// @vitest-environment happy-dom
//
// Haelt fest, dass die Spielerliste Team und Kontostatus als Text zeigt und
// dass die Filter greifen, ohne die Liste neu zu laden. Ausserdem: Bearbeiten
// oeffnet einen `PlayerEditDialog`, Archivieren und Loeschen oeffnen einen
// `ConfirmDialog` statt sofort zu senden, Reaktivieren sendet direkt, und ein
// 409 PLAYER_HAS_HISTORY beim Loeschen bietet "Stattdessen archivieren" an.
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, createRef, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { playerListSchema, type PlayerResponse } from "@darts-platform/schemas";

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

import { apiRequest } from "@/lib/api-client";

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
  // `headingRef` ist seit Task 4 ein Pflicht-Prop (der einzige Aufrufer
  // uebergibt ihn immer); die meisten Tests hier pruefen keinen Fokus, daher
  // reicht ein formloser Platzhalter-Ref ohne echtes Ueberschriftselement.
  const headingRef = { current: null } as RefObject<HTMLElement | null>;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(PlayerList, {
        canArchive: false,
        canDelete: false,
        canEdit: false,
        headingRef,
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

  it("haelt die Statusregion fuer 'Geloescht' dauerhaft im DOM, auch leer (Whole-Branch-Review, Befund 2)", () => {
    // Eine `role="status"`-Region, die erst NACH dem Einhaengen befuellt
    // wird, kuendigt Screenreadern nicht zuverlaessig an. Vor jeder Aktion
    // muss sie also schon existieren, nur eben leer.
    renderList([anna, bruno], new Map());

    expect(screen.getByRole("status").textContent).toBe("");
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
    const headingRef = { current: null } as RefObject<HTMLElement | null>;
    const buildTree = (players: readonly PlayerResponse[]) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(PlayerList, {
          canArchive: false,
          canDelete: false,
          canEdit: true,
          headingRef,
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

  it("'Abbrechen' im Loeschen-Dialog bleibt gesperrt, waehrend 'Stattdessen archivieren' noch laeuft (Fix-Runde 1, Task-Review-Befund 1)", async () => {
    // `archiveMutation` ist jetzt fuer die ganze Liste geteilt. Vor diesem
    // Fix band das Loeschen-Dialog sein `pending` nur an
    // `deleteMutation.isPending`: waehrend die vom "Stattdessen
    // archivieren"-Knopf ausgeloeste `archiveMutation` noch lief, liessen
    // sich Abbrechen und Escape trotzdem benutzen. Ein danach fuer eine
    // ANDERE Person geoeffnetes Dialog haette die verspaetet eintreffende
    // Antwort (Erfolg ODER Fehlschlag) faelschlich uebernommen. Mit
    // gesperrtem Abbrechen kann dieses zweite Dialog gar nicht erst
    // aufgehen, bevor die Antwort da ist.
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

    const archiveInstead = await waitFor(() =>
      within(dialog).getByRole("button", { name: "Stattdessen archivieren" }),
    );

    let resolveArchive: (value: unknown) => void = () => {};
    client.apiRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveArchive = resolve;
        }),
    );
    fireEvent.click(archiveInstead);

    const abbrechen = (await waitFor(() =>
      within(dialog).getByRole("button", { name: "Abbrechen" }),
    )) as HTMLButtonElement;
    expect(abbrechen.disabled).toBe(true);

    // Der native `cancel`-Event (Escape) muss ebenso wirkungslos bleiben --
    // `confirm-dialog.tsx` prueft dafuer selbst `pending`.
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog")).toBe(dialog);

    resolveArchive({ ...anna, status: "INACTIVE" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("zeigt beim erneuten Oeffnen des Loesch-Dialogs keinen veralteten Archivieren-Fehlschlag mehr (Whole-Branch-Review, Befund 4)", async () => {
    // Ablauf: 1) Loeschen -> 409 PLAYER_HAS_HISTORY -> "Stattdessen
    // archivieren" erscheint. 2) Dieser Archivierungsversuch schlaegt
    // seinerseits fehl -> archiveMutation.isError wird wahr, der Dialog
    // zeigt den Fehlschlag. 3) Abbrechen schliesst den Dialog, OHNE
    // archiveMutation zurueckzusetzen (vor dem Fix). 4) Erneut "Löschen",
    // wieder 409 -> "Stattdessen archivieren" erscheint erneut, und zwar
    // OHNE den Fehlschlag aus Schritt 2 sofort wieder anzuzeigen.
    const historyError = new client.ApiClientError(
      "Dieser Spieler hat bereits gespielt oder steht in einem Turnier, Team oder einer Begegnung. Er lässt sich nur archivieren.",
      "PLAYER_HAS_HISTORY",
      null,
      undefined,
      409,
    );
    client.apiRequest.mockRejectedValueOnce(historyError);
    renderList([anna], new Map(), { canArchive: true, canDelete: true });

    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    let dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Endgültig löschen" }));

    const archiveInstead = await waitFor(() =>
      within(dialog).getByRole("button", { name: "Stattdessen archivieren" }),
    );
    client.apiRequest.mockRejectedValueOnce(new Error("archivieren kaputt"));
    fireEvent.click(archiveInstead);

    await waitFor(() => {
      expect(within(dialog).getAllByRole("alert").map((element) => element.textContent)).toContain(
        "Fehler",
      );
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    client.apiRequest.mockRejectedValueOnce(historyError);
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Endgültig löschen" }));

    await waitFor(() => {
      expect(
        within(dialog).getByRole("button", { name: "Stattdessen archivieren" }),
      ).toBeTruthy();
    });
    expect(within(dialog).queryAllByRole("alert").map((element) => element.textContent)).not.toContain(
      "Fehler",
    );
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

  it("haelt genau einen Dialog fuer die ganze Liste: Loeschen fuer einen anderen Spieler schliesst ein offenes Archivieren-Dialog (Task 1)", () => {
    // Vor Task 1 registrierte jede Zeile ihren eigenen Dialogzustand: das
    // Archivieren-Dialog von Anna und das Loeschen-Dialog von Bruno konnten
    // gleichzeitig offen sein. Mit einem einzigen Listenzustand schliesst das
    // Oeffnen einer zweiten Absicht die erste automatisch.
    renderList([anna, bruno], new Map(), { canArchive: true, canDelete: true });

    const archiveButtons = screen.getAllByRole("button", { name: "Archivieren" });
    const annaArchiveButton = archiveButtons[0];
    if (annaArchiveButton === undefined) throw new Error("Erwartete einen Archivieren-Button.");
    fireEvent.click(annaArchiveButton);
    expect(within(screen.getByRole("dialog")).getByText("Spieler archivieren")).toBeTruthy();

    const deleteButtons = screen.getAllByRole("button", { name: "Löschen" });
    const brunoDeleteButton = deleteButtons[1];
    if (brunoDeleteButton === undefined) throw new Error("Erwartete zwei Löschen-Buttons.");
    fireEvent.click(brunoDeleteButton);

    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(within(dialogs[0] as HTMLElement).getByText("Spieler endgültig löschen")).toBeTruthy();
  });

  it("nennt bei verknuepftem Konto im Loeschen-Dialog die Aufhebung der Verknuepfung (Task 1)", () => {
    renderList([anna], new Map(), { canDelete: true });
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    expect(
      within(screen.getByRole("dialog")).getByText(
        "Die Verknüpfung mit dem Benutzerkonto wird dabei aufgehoben; das Konto selbst bleibt bestehen.",
        { exact: false },
      ),
    ).toBeTruthy();

    cleanup();
    renderList([bruno], new Map(), { canDelete: true });
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    expect(
      within(screen.getByRole("dialog")).queryByText(
        "Die Verknüpfung mit dem Benutzerkonto wird dabei aufgehoben",
        { exact: false },
      ),
    ).toBeNull();
  });

  it("fokussiert nach erfolgreichem endgueltigem Loeschen die Ueberschrift und zeigt eine Statusmeldung (Task 1)", async () => {
    // Heute verschwindet mit der Zeile auch das Fokus-Rueckgabeziel des
    // Loeschen-Buttons -- der Fokus landet auf <body>. Neu soll er auf eine
    // von aussen uebergebene Ueberschrift wandern, und eine role="status"
    // Meldung soll den Spielernamen nennen.
    const headingRef = createRef<HTMLHeadingElement>();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          "div",
          null,
          createElement("h2", { ref: headingRef, tabIndex: -1 }, "Spieler"),
          createElement(PlayerList, {
            canArchive: false,
            canDelete: true,
            canEdit: false,
            headingRef,
            isPending: false,
            organizationId: "organisation-1",
            players: [anna],
            teamsByPlayer: new Map(),
          }),
        ),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    const dialog = screen.getByRole("dialog");
    client.apiRequest.mockResolvedValueOnce(undefined);
    fireEvent.click(within(dialog).getByRole("button", { name: "Endgültig löschen" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(document.activeElement).toBe(headingRef.current);
    expect(screen.getByRole("status").textContent).toBe("Anna Müller wurde gelöscht.");
  });

  describe("Fokus nach Archivieren/Reaktivieren (Whole-Branch-Review, Befund 1)", () => {
    /**
     * Anders als die Loeschen-Faelle oben braucht dieser Test eine echte
     * Rueckkopplung: nach erfolgreichem Archivieren/Reaktivieren ruft
     * `player-list.tsx` `invalidateQueries` auf, und erst der dadurch
     * ausgeloeste Refetch liefert den geaenderten Status, der ueber
     * sichtbar/ausgeblendet entscheidet. Ein statisches `players`-Array wie
     * in `renderList` wuerde das nicht abbilden -- dieser Harness haelt
     * darum eine kleine, ueber `apiRequest` erreichbare "Datenbank" und
     * bindet sie ueber `useQuery` mit demselben Query-Key wie
     * `roster-route.tsx` ein.
     */
    function renderRosterLikeHarness(
      initialPlayers: readonly PlayerResponse[],
      permissions: Partial<{ canArchive: boolean; canEdit: boolean; canDelete: boolean }>,
    ) {
      let database = initialPlayers.map((entry) => ({ ...entry }));
      client.apiRequest.mockImplementation(
        ({ path, method }: { readonly path: string; readonly method?: string }) => {
          if ((method === undefined || method === "GET") && path === "/organizations/organisation-1/players") {
            return Promise.resolve(database);
          }
          const match = /^\/organizations\/organisation-1\/players\/([^/]+)$/.exec(path);
          if (match && method === "DELETE") {
            const id = match[1];
            database = database.map((entry) => (entry.id === id ? { ...entry, status: "INACTIVE" as const } : entry));
            return Promise.resolve(database.find((entry) => entry.id === id));
          }
          if (match && method === "PATCH") {
            const id = match[1];
            database = database.map((entry) => (entry.id === id ? { ...entry, status: "ACTIVE" as const } : entry));
            return Promise.resolve(database.find((entry) => entry.id === id));
          }
          return Promise.reject(new Error(`Unerwarteter Aufruf in der Testfixtur: ${method ?? "GET"} ${path}`));
        },
      );

      const headingRef = createRef<HTMLHeadingElement>();
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      function Harness() {
        const query = useQuery({
          queryKey: ["players", "organisation-1"],
          queryFn: () =>
            apiRequest({
              path: "/organizations/organisation-1/players",
              schema: playerListSchema,
            }),
        });
        return createElement(
          "div",
          null,
          createElement("h2", { ref: headingRef, tabIndex: -1 }, "Spieler"),
          createElement(PlayerList, {
            canArchive: false,
            canDelete: false,
            canEdit: false,
            headingRef,
            isPending: query.isPending,
            organizationId: "organisation-1",
            players: query.data ?? [],
            teamsByPlayer: new Map(),
            ...permissions,
          }),
        );
      }

      render(createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)));
      return { headingRef };
    }

    it("fokussiert nach erfolgreichem Archivieren den Reaktivieren-Button in derselben Zeile, wenn sie sichtbar bleibt", async () => {
      renderRosterLikeHarness([anna], { canArchive: true, canEdit: true });

      const archiveButton = await screen.findByRole("button", { name: "Archivieren" });
      fireEvent.click(archiveButton);
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Archivieren" }));

      const reactivateButton = await waitFor(() =>
        screen.getByRole("button", { name: "Reaktivieren" }),
      );
      expect(document.activeElement).toBe(reactivateButton);
      expect(reactivateButton.closest("[data-player-id]")?.getAttribute("data-player-id")).toBe("a");
    });

    it("fokussiert nach erfolgreichem Archivieren die Ueberschrift, wenn der Statusfilter die Zeile danach ausblendet", async () => {
      const { headingRef } = renderRosterLikeHarness([anna], { canArchive: true, canEdit: true });

      await screen.findByRole("button", { name: "Archivieren" });
      fireEvent.change(screen.getByLabelText("Status"), { target: { value: "ACTIVE" } });

      const archiveButton = screen.getByRole("button", { name: "Archivieren" });
      fireEvent.click(archiveButton);
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Archivieren" }));

      await waitFor(() => {
        expect(screen.queryByText("Anna Müller")).toBeNull();
      });
      expect(document.activeElement).toBe(headingRef.current);
    });

    it("fokussiert nach erfolgreichem Reaktivieren den Archivieren-Button in derselben Zeile, wenn sie sichtbar bleibt", async () => {
      const archived = player({ id: "a", displayName: "Anna Müller", status: "INACTIVE" });
      renderRosterLikeHarness([archived], { canArchive: true, canEdit: true });

      const reactivateButton = await screen.findByRole("button", { name: "Reaktivieren" });
      fireEvent.click(reactivateButton);

      const archiveButton = await waitFor(() => screen.getByRole("button", { name: "Archivieren" }));
      expect(document.activeElement).toBe(archiveButton);
      expect(archiveButton.closest("[data-player-id]")?.getAttribute("data-player-id")).toBe("a");
    });

    it("fokussiert nach erfolgreichem Reaktivieren die Ueberschrift, wenn der Statusfilter die Zeile danach ausblendet", async () => {
      const archived = player({ id: "a", displayName: "Anna Müller", status: "INACTIVE" });
      const { headingRef } = renderRosterLikeHarness([archived], { canArchive: true, canEdit: true });

      await screen.findByRole("button", { name: "Reaktivieren" });
      fireEvent.change(screen.getByLabelText("Status"), { target: { value: "INACTIVE" } });

      const reactivateButton = screen.getByRole("button", { name: "Reaktivieren" });
      fireEvent.click(reactivateButton);

      await waitFor(() => {
        expect(screen.queryByText("Anna Müller")).toBeNull();
      });
      expect(document.activeElement).toBe(headingRef.current);
    });
  });
});
