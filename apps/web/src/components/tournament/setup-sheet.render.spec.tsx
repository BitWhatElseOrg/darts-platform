// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function renderSheet() {
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
        players,
        boards,
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
