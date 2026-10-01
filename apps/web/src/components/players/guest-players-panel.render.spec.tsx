// @vitest-environment happy-dom
//
// Haelt die Gastspieler-Schnellerfassung fest (Spec Vereinsduell): getrimmte
// Namen ohne Leerzeilen, Duplikate vor dem Senden abgewiesen, und eine
// Wiederholung nach einem Netzfehler mit derselben commandId (AGENTS.md §11).
import type { PlayerResponse } from "@darts-platform/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));
const client = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  userFacingErrorMessage: vi.fn((error: unknown) => (error instanceof Error ? error.message : String(error))),
}));
vi.mock("@/lib/api-client", () => client);

import { GuestPlayersPanel } from "./guest-players-panel";

const organizationId = "00000000-0000-4000-8000-000000000001";

function guest(id: string, displayName: string): PlayerResponse {
  return {
    id,
    organizationId,
    publicId: id,
    firstName: null,
    lastName: null,
    displayName,
    nickname: null,
    email: null,
    externalReference: null,
    status: "ACTIVE",
    kind: "GUEST",
    guestClubName: "DC Musterdorf",
    hasAccount: false,
    avatarChecksum: null,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    updatedAt: new Date("2026-10-01T10:00:00Z"),
  };
}

function renderPanel(onCreated = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(GuestPlayersPanel, { organizationId, clubName: "DC Musterdorf", onCreated }),
    ),
  );
  return { onCreated, invalidate };
}

type SentRequest = {
  readonly path: string;
  readonly method: string;
  readonly body: { readonly commandId: string; readonly clubName: string; readonly names: readonly string[] };
};

function sentRequests(): SentRequest[] {
  return client.apiRequest.mock.calls.map((call) => call[0] as SentRequest);
}

afterEach(() => {
  cleanup();
  client.apiRequest.mockReset();
});

describe("GuestPlayersPanel", () => {
  it("schickt getrimmte Namen mit derselben commandId und meldet den Erfolg", async () => {
    const created = [
      guest("00000000-0000-4000-8000-000000000010", "Anna Muster"),
      guest("00000000-0000-4000-8000-000000000011", "Beat Beispiel"),
    ];
    client.apiRequest.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(created);
    const { onCreated, invalidate } = renderPanel();

    const names = screen.getByLabelText("Gastspieler (ein Name pro Zeile)") as HTMLTextAreaElement;
    fireEvent.change(names, { target: { value: " Anna Muster \n\nBeat Beispiel" } });
    fireEvent.click(screen.getByRole("button", { name: "Gastspieler erfassen" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("offline"));

    fireEvent.click(screen.getByRole("button", { name: "Gastspieler erfassen" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));

    const [first, second] = sentRequests();
    expect(first?.path).toBe(`/organizations/${organizationId}/players/guests`);
    expect(first?.method).toBe("POST");
    expect(first?.body.names).toEqual(["Anna Muster", "Beat Beispiel"]);
    expect(first?.body.clubName).toBe("DC Musterdorf");
    expect(second?.body.commandId).toBe(first?.body.commandId);
    expect(screen.getByRole("status").textContent).toBe("2 Gastspieler erfasst.");
    expect(names.value).toBe("");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["players", organizationId] });
  });

  it("vergibt eine neue commandId, wenn die Liste nach einem Fehler geaendert wird", async () => {
    client.apiRequest
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([guest("00000000-0000-4000-8000-000000000010", "Anna Muster")]);
    renderPanel();

    const names = screen.getByLabelText("Gastspieler (ein Name pro Zeile)");
    fireEvent.change(names, { target: { value: "Anna Muster" } });
    fireEvent.click(screen.getByRole("button", { name: "Gastspieler erfassen" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("offline"));

    fireEvent.change(names, { target: { value: "Anna Muster\nBeat Beispiel" } });
    fireEvent.click(screen.getByRole("button", { name: "Gastspieler erfassen" }));
    await waitFor(() => expect(client.apiRequest).toHaveBeenCalledTimes(2));

    const [first, second] = sentRequests();
    expect(second?.body.names).toEqual(["Anna Muster", "Beat Beispiel"]);
    expect(second?.body.commandId).not.toBe(first?.body.commandId);
  });

  it("erzeugt nach einem Erfolg eine neue commandId und uebernimmt einen geaenderten Verein", async () => {
    client.apiRequest
      .mockResolvedValueOnce([guest("00000000-0000-4000-8000-000000000010", "Anna Muster")])
      .mockResolvedValueOnce([guest("00000000-0000-4000-8000-000000000011", "Beat Beispiel")]);
    const { onCreated } = renderPanel();

    const names = screen.getByLabelText("Gastspieler (ein Name pro Zeile)");
    fireEvent.change(names, { target: { value: "Anna Muster" } });
    fireEvent.click(screen.getByRole("button", { name: "Gastspieler erfassen" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Verein der Gäste"), { target: { value: "DC Beispielwil" } });
    fireEvent.change(names, { target: { value: "Beat Beispiel" } });
    fireEvent.click(screen.getByRole("button", { name: "Gastspieler erfassen" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(2));

    const [first, second] = sentRequests();
    expect(second?.body.commandId).not.toBe(first?.body.commandId);
    expect(second?.body.clubName).toBe("DC Beispielwil");
  });

  it("folgt dem Gastverein der Elternansicht, bis der Verein hier geaendert wird", () => {
    const queryClient = new QueryClient();
    const panel = (club: string) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(GuestPlayersPanel, { organizationId, clubName: club, onCreated: vi.fn() }),
      );
    const { rerender } = render(panel("DC Musterdorf"));
    const club = screen.getByLabelText("Verein der Gäste") as HTMLInputElement;

    rerender(panel("DC Beispielwil"));
    expect(club.value).toBe("DC Beispielwil");

    fireEvent.change(club, { target: { value: "Eigener Verein" } });
    rerender(panel("DC Anderswo"));
    expect(club.value).toBe("Eigener Verein");
  });

  it("weist doppelte Namen vor dem Senden ab", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Gastspieler (ein Name pro Zeile)"), { target: { value: "Anna\nanna" } });
    fireEvent.click(screen.getByRole("button", { name: "Gastspieler erfassen" }));
    expect(await screen.findByText("Jeder Name darf nur einmal vorkommen.")).toBeTruthy();
    expect(client.apiRequest).not.toHaveBeenCalled();
  });

  it("verlangt mindestens einen Namen", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Gastspieler (ein Name pro Zeile)"), { target: { value: " \n\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Gastspieler erfassen" }));
    expect(await screen.findByText("Mindestens einen Namen eingeben.")).toBeTruthy();
    expect(client.apiRequest).not.toHaveBeenCalled();
  });
});
