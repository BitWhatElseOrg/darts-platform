// @vitest-environment happy-dom
//
// Haelt fest, dass der Spitzname wirklich optional ist: weder ein nie
// beruehrtes noch ein wieder geleertes Feld darf das Anlegen blockieren.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", () => ({
  apiRequest: (input: unknown) => apiRequest(input),
  userFacingErrorMessage: () => "Fehler",
}));

import { PlayerForm } from "./player-form";

afterEach(() => {
  cleanup();
  apiRequest.mockReset();
});

function submittedBody(): Record<string, unknown> {
  const [firstCall] = apiRequest.mock.calls;
  if (!firstCall) {
    throw new Error("apiRequest wurde nicht aufgerufen.");
  }
  return (firstCall[0] as { readonly body: Record<string, unknown> }).body;
}

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(PlayerForm, { organizationId: "organisation-1" }),
    ),
  );
}

describe("PlayerForm", () => {
  it("legt einen Spieler ohne Spitzname an", async () => {
    apiRequest.mockResolvedValue({});
    renderForm();

    fireEvent.change(screen.getByLabelText("Anzeigename"), { target: { value: "Anna Beispiel" } });
    fireEvent.submit(screen.getByRole("button", { name: "Spieler hinzufügen" }).closest("form")!);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledTimes(1);
    });
    expect(submittedBody()).toMatchObject({ displayName: "Anna Beispiel" });
  });

  it("legt einen Spieler an, nachdem der Spitzname wieder geleert wurde", async () => {
    apiRequest.mockResolvedValue({});
    renderForm();

    fireEvent.change(screen.getByLabelText("Anzeigename"), { target: { value: "Bruno Beispiel" } });
    const nickname = screen.getByLabelText("Spitzname (optional)");
    fireEvent.change(nickname, { target: { value: "Bube" } });
    fireEvent.change(nickname, { target: { value: "" } });
    fireEvent.submit(screen.getByRole("button", { name: "Spieler hinzufügen" }).closest("form")!);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledTimes(1);
    });
    expect(submittedBody().nickname ?? null).toBeNull();
  });

  it("nennt den fehlenden Anzeigenamen, statt den Klick verpuffen zu lassen", async () => {
    renderForm();

    fireEvent.submit(screen.getByRole("button", { name: "Spieler hinzufügen" }).closest("form")!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Bitte einen Anzeigenamen angeben.");
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
