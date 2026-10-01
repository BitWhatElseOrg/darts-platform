// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const client = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  userFacingErrorMessage: vi.fn((error: unknown) => String(error)),
}));
vi.mock("@/lib/api-client", () => client);

import { SetupSheet } from "./setup-sheet";

afterEach(() => {
  cleanup();
  client.apiRequest.mockReset();
});

const now = new Date("2026-09-18T18:00:00.000Z");
const players = Array.from({ length: 4 }, (_, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index + 1}`,
  organizationId: "00000000-0000-4000-8000-0000000000aa",
  publicId: `00000000-0000-4000-8000-0000000000b${index + 1}`,
  firstName: null,
  lastName: null,
  displayName: `Spielerin ${index + 1}`,
  nickname: null,
  email: null,
  externalReference: null,
  status: "ACTIVE" as const,
  hasAccount: false,
  avatarChecksum: null,
  kind: "MEMBER" as const,
  guestClubName: null,
  createdAt: now,
  updatedAt: now,
}));
const boards = [
  {
    id: "00000000-0000-4000-8000-0000000000c1",
    organizationId: "00000000-0000-4000-8000-0000000000aa",
    name: "Board 1",
    status: "AVAILABLE" as const,
    createdAt: now,
    updatedAt: now,
  },
];

type PlayerFixture = Omit<(typeof players)[number], "kind" | "guestClubName"> & {
  readonly kind: "MEMBER" | "GUEST";
  readonly guestClubName: string | null;
};

function renderSheet(options: { readonly boards?: typeof boards; readonly players?: readonly PlayerFixture[]; readonly organizationName?: string } = {}) {
  client.apiRequest.mockResolvedValue({
    groups: [], groupMatchCount: 0, knockoutSize: 4, knockoutMatchCount: 3, byes: 0, totalMatches: 3, warnings: [],
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(SetupSheet, {
        organizationId: "00000000-0000-4000-8000-0000000000aa",
        players: options.players ?? players,
        boards: options.boards ?? boards,
        ...(options.organizationName !== undefined ? { organizationName: options.organizationName } : {}),
      }),
    ),
  );
}

describe("SetupSheet: Rueckmeldung bei ungueltigen Eingaben", () => {
  it("nennt die fehlenden Angaben beim Button und fokussiert das erste Feld", async () => {
    renderSheet();
    const nameInput = screen.getByLabelText("Name");
    expect(nameInput).toHaveProperty("value", "");

    fireEvent.click(screen.getByRole("button", { name: "Turnier starten" }));

    // Die Sammelmeldung steht direkt beim Button, nicht nur oben am Feld.
    const summary = await screen.findByTestId("submit-errors");
    expect(summary.textContent).toContain("Das Turnier braucht einen Namen");
    // Der Fokus springt zum ersten fehlerhaften Feld.
    await waitFor(() => expect(document.activeElement).toBe(nameInput));
    // Kein Aufruf an die API: die Anfrage wurde gar nicht erst geschickt.
    const posts = client.apiRequest.mock.calls.filter((call) => {
      const input = call[0] as { path: string; method?: string };
      return input.method === "POST" && input.path.endsWith("/tournaments");
    });
    expect(posts).toHaveLength(0);
  });

  it("scrollt bei einem Auswahlfeld ohne Eingabeelement zu dessen Meldung", async () => {
    // Boards haben kein fokussierbares Feld; der Sprung geht zur Meldung
    // `boardIds-error`, die erst mit dem naechsten Render entsteht.
    const scrolledTo: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolledTo.push(this.id);
    };
    try {
      renderSheet({ boards: [] });
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Vereinsmeisterschaft" } });
      fireEvent.click(screen.getByRole("button", { name: "Turnier starten" }));

      const summary = await screen.findByTestId("submit-errors");
      expect(summary.textContent).toContain("Wähle mindestens ein Board");
      await waitFor(() => expect(scrolledTo).toEqual(["boardIds-error"]));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("raeumt die Sammelmeldung weg, sobald die Eingaben gueltig sind", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Turnier starten" }));
    await screen.findByTestId("submit-errors");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Vereinsmeisterschaft" } });
    // `apiRequest` ist ersetzt; die Weiterleitung braucht nur die `id`.
    client.apiRequest.mockResolvedValue({ id: "00000000-0000-4000-8000-0000000000d1" });
    fireEvent.click(screen.getByRole("button", { name: "Turnier starten" }));

    await waitFor(() => expect(screen.queryByTestId("submit-errors")).toBeNull());
  });
});

const guests: PlayerFixture[] = [1, 2].map((index) => ({
  ...players[0]!,
  id: `00000000-0000-4000-8000-0000000000e${index}`,
  publicId: `00000000-0000-4000-8000-0000000000f${index}`,
  displayName: `Gast ${index}`,
  kind: "GUEST",
  guestClubName: "DC Musterdorf",
}));
const clubPreview = {
  qualifyingMatches: 8, finalRoundMatches: 4, finalMatches: 1, totalMatches: 13,
  matchesPerPlayer: { sideA: { min: 6, max: 6 }, sideB: { min: 6, max: 6 } },
  estimatedMinutes: 120, warnings: [],
};

function tournamentPosts() {
  return client.apiRequest.mock.calls
    .map((call) => call[0] as { path: string; method?: string; body?: unknown })
    .filter((input) => input.method === "POST" && input.path.endsWith("/tournaments"));
}

describe("SetupSheet: Vereinsduell", () => {
  it("zeigt im klassischen Format nur Mitglieder, keine Gastspieler", () => {
    renderSheet({ players: [...players.slice(0, 2), ...guests] });
    expect(screen.getByRole("checkbox", { name: "Spielerin 1" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Gast 1" })).toBeNull();
  });

  it("legt ein Vereinsduell mit Vereinen, Spielerseiten und Vorschau an", async () => {
    renderSheet({ players: [...players.slice(0, 2), ...guests], organizationName: "VFC Testverein" });
    client.apiRequest.mockImplementation((input: { path: string; method?: string }) => {
      if (input.path.endsWith("/club-duel-preview")) return Promise.resolve(clubPreview);
      if (input.path.endsWith("/structure-preview")) {
        return Promise.resolve({ groups: [], groupMatchCount: 0, knockoutSize: 0, knockoutMatchCount: 0, byes: 0, totalMatches: 0, warnings: [] });
      }
      if (input.method === "POST" && input.path.endsWith("/tournaments")) {
        return Promise.resolve({ id: "00000000-0000-4000-8000-0000000000d1" });
      }
      return Promise.reject(new Error(`unerwartet: ${input.path}`));
    });

    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "CLUB_DUEL" } });

    const ownClub = screen.getByLabelText("Eigener Verein");
    expect(ownClub).toHaveProperty("value", "VFC Testverein");
    expect(screen.getByLabelText("Gastverein")).toBeTruthy();
    expect(screen.getByLabelText("Quali-Runden")).toBeTruthy();
    expect(screen.getByLabelText("Spiel um Platz 3")).toHaveProperty("checked", true);
    // Ohne Gastverein-Namen stehen alle Gäste rechts, keine Mitglieder.
    const guestColumn = screen.getByRole("group", { name: "Spieler Gastverein" });
    expect(within(guestColumn).getAllByRole("checkbox").map((box) => box.closest("li")?.textContent)).toEqual([
      "Gast 1DC Musterdorf",
      "Gast 2DC Musterdorf",
    ]);
    expect(within(screen.getByRole("group", { name: "Spieler VFC Testverein" })).getAllByRole("checkbox")).toHaveLength(2);

    // Ohne Vereinsnamen geht nichts an den Server.
    fireEvent.change(ownClub, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Vereinsduell Herbst" } });
    fireEvent.click(screen.getByRole("button", { name: "Turnier starten" }));
    const summary = await screen.findByTestId("submit-errors");
    expect(summary.textContent).toContain("Trage den Namen des eigenen Vereins ein.");
    expect(summary.textContent).toContain("Trage den Namen des Gastvereins ein.");
    expect(tournamentPosts()).toHaveLength(0);

    fireEvent.change(ownClub, { target: { value: "VFC Testverein" } });
    fireEvent.change(screen.getByLabelText("Gastverein"), { target: { value: "DC Musterdorf" } });
    fireEvent.change(screen.getByLabelText("Finalrunde (Spieler je Verein)"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Spielerin 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Spielerin 2" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Gast 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Gast 2" }));

    const total = await screen.findByText("Spiele insgesamt");
    expect(total.parentElement?.textContent).toBe("Spiele insgesamt13");
    const previewBodies = client.apiRequest.mock.calls
      .map((call) => call[0] as { path: string; body?: unknown })
      .filter((input) => input.path.endsWith("/club-duel-preview"))
      .map((input) => input.body);
    expect(previewBodies.at(-1)).toEqual({
      sideACount: 2, sideBCount: 2, qualifyingRounds: 4, finalRoundSize: 2, thirdPlaceMatch: true, boardCount: 1, bestOfLegs: 3,
    });

    fireEvent.click(screen.getByRole("button", { name: "Turnier starten" }));
    await waitFor(() => expect(tournamentPosts()).toHaveLength(1));
    const body = tournamentPosts()[0]!.body as { format: string; participants: unknown[]; sideAName: string; finalRoundSize: number };
    expect(body.format).toBe("CLUB_DUEL");
    expect(body.sideAName).toBe("VFC Testverein");
    expect(body.finalRoundSize).toBe(2);
    expect(body.participants).toEqual([
      { playerId: players[0]!.id, side: "A" },
      { playerId: players[1]!.id, side: "A" },
      { playerId: guests[0]!.id, side: "B" },
      { playerId: guests[1]!.id, side: "B" },
    ]);
    expect(screen.queryByTestId("submit-errors")).toBeNull();
  });

  it("setzt neu erfasste Gastspieler auf Seite B und fuehrt jede Person nur auf einer Seite", async () => {
    renderSheet({ players: [...players.slice(0, 2), ...guests], organizationName: "VFC Testverein" });
    client.apiRequest.mockImplementation((input: { path: string; method?: string }) => {
      if (input.path.endsWith("/players/guests")) return Promise.resolve([guests[1]]);
      if (input.path.endsWith("/club-duel-preview")) return Promise.resolve(clubPreview);
      if (input.method === "POST" && input.path.endsWith("/tournaments")) {
        return Promise.resolve({ id: "00000000-0000-4000-8000-0000000000d1" });
      }
      return Promise.reject(new Error(`unerwartet: ${input.path}`));
    });

    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "CLUB_DUEL" } });
    fireEvent.change(screen.getByLabelText("Gastverein"), { target: { value: "DC Musterdorf" } });
    const counter = screen.getByLabelText(/gegen .* Spieler/u);
    expect(counter.textContent).toBe("0 : 0");

    // (a) Gast über das Panel erfassen: er ist danach auf Seite B angekreuzt.
    const guestCheckbox = screen.getByRole("checkbox", { name: "Gast 2" });
    expect(guestCheckbox).toHaveProperty("checked", false);
    fireEvent.change(screen.getByLabelText("Gastspieler (ein Name pro Zeile)"), { target: { value: "Gast 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Gastspieler erfassen" }));
    await waitFor(() => expect(guestCheckbox).toHaveProperty("checked", true));
    expect(counter.textContent).toBe("0 : 1");
    expect(tournamentPosts()).toHaveLength(0);

    // (b) Weitere Auswahl: zweimal an- und abwählen bleibt eindeutig.
    fireEvent.click(screen.getByRole("checkbox", { name: "Spielerin 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Spielerin 2" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Gast 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Gast 2" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Gast 2" }));
    expect(counter.textContent).toBe("2 : 2");
    fireEvent.change(screen.getByLabelText("Finalrunde (Spieler je Verein)"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Vereinsduell Herbst" } });
    fireEvent.click(screen.getByRole("button", { name: "Turnier starten" }));

    await waitFor(() => expect(tournamentPosts()).toHaveLength(1));
    const { participants } = tournamentPosts()[0]!.body as { participants: { playerId: string; side: string }[] };
    expect(new Set(participants.map((entry) => entry.playerId)).size).toBe(participants.length);
    expect([...participants].sort((a, b) => a.playerId.localeCompare(b.playerId))).toEqual([
      { playerId: players[0]!.id, side: "A" },
      { playerId: players[1]!.id, side: "A" },
      { playerId: guests[0]!.id, side: "B" },
      { playerId: guests[1]!.id, side: "B" },
    ]);
  });

  it("zeigt ausgewählte Gäste anderer Vereine in der Hauptspalte B, nicht nur unter «Weitere Gastspieler»", () => {
    const otherGuest: PlayerFixture = { ...guests[0]!, id: "00000000-0000-4000-8000-0000000000e3", publicId: "00000000-0000-4000-8000-0000000000f3", displayName: "Gast 3", guestClubName: "DC Mitteldorf" };
    renderSheet({ players: [...players.slice(0, 2), ...guests, otherGuest], organizationName: "VFC Testverein" });
    client.apiRequest.mockImplementation(() => Promise.resolve(clubPreview));
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "CLUB_DUEL" } });

    // Ohne Gastverein stehen alle Gäste in der Hauptspalte; Gast 3 auswählen.
    fireEvent.click(screen.getByRole("checkbox", { name: "Gast 3" }));
    fireEvent.change(screen.getByLabelText("Gastverein"), { target: { value: "DC Musterdorf" } });

    const main = screen.getByRole("group", { name: "Spieler DC Musterdorf" });
    expect(within(main).getByRole("checkbox", { name: "Gast 3" })).toHaveProperty("checked", true);
    expect(screen.queryByRole("group", { name: "Andere Vereine" })).toBeNull();

    // Abgewählt rutscht Gast 3 zurück in den ausklappbaren Bereich.
    fireEvent.click(within(main).getByRole("checkbox", { name: "Gast 3" }));
    expect(within(screen.getByRole("group", { name: "Spieler DC Musterdorf" })).queryByRole("checkbox", { name: "Gast 3" })).toBeNull();
    expect(screen.getByText("Weitere Gastspieler (1)")).toBeTruthy();
  });
});
