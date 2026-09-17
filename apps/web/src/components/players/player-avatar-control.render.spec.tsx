// @vitest-environment happy-dom
//
// Pinnt den Vertrag zwischen den beiden Mutationen und dem Query-Cache, den
// der E2E-Fall (`tests/player-avatar.spec.ts`) nur im echten Browser
// beobachten kann: nach Hochladen ODER Entfernen werden GENAU die beiden
// Schlüssel ["players", organizationId] und ["player-avatar", organizationId,
// playerId] invalidiert — sonst zeigt eine der beiden Flächen (Spielerliste,
// Profilkopf) das alte Bild weiter (siehe player-profile.tsx, player-list.tsx).
//
// Die Bildverarbeitung selbst (`prepareAvatarUpload`, Canvas/`createImageBitmap`)
// kennt happy-dom nicht; dafür bürgt der E2E-Fall im echten Browser. Hier wird
// sie gemockt, damit dieser Test sich ausschliesslich auf den Cache-Vertrag
// konzentriert.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));

const client = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  userFacingErrorMessage: vi.fn(() => "Fehler"),
}));
vi.mock("@/lib/api-client", () => client);

const upload = vi.hoisted(() => ({ prepareAvatarUpload: vi.fn() }));
vi.mock("@/lib/avatar-upload", () => upload);

import { PlayerAvatarControl } from "./player-avatar-control";

const organizationId = "organisation-1";
const playerId = "spieler-1";

function avatarPlayer(avatarChecksum: string | null) {
  return { id: playerId, displayName: "Anna Müller", avatarChecksum };
}

function renderControl(queryClient: QueryClient, avatarChecksum: string | null) {
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(PlayerAvatarControl, {
        organizationId,
        player: avatarPlayer(avatarChecksum),
      }),
    ),
  );
}

function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  client.apiRequest.mockReset();
  client.userFacingErrorMessage.mockReset().mockReturnValue("Fehler");
  upload.prepareAvatarUpload.mockReset();
  // happy-dom kennt weder Objekt-URLs noch reale Bildverarbeitung.
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlayerAvatarControl", () => {
  it("zeigt 'Bild entfernen' nur, wenn schon ein Bild hinterlegt ist", () => {
    renderControl(newQueryClient(), null);

    expect(screen.queryByRole("button", { name: "Bild entfernen" })).toBeNull();
  });

  it("invalidiert nach dem Hochladen genau die Spielerliste und den Profilkopf", async () => {
    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const blob = new Blob(["fake"], { type: "image/webp" });
    upload.prepareAvatarUpload.mockResolvedValue(blob);
    client.apiRequest.mockResolvedValue(avatarPlayer("frisch-123"));

    renderControl(queryClient, null);

    const file = new File(["bytes"], "avatar.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Bild auswählen"), { target: { files: [file] } });

    const saveButton = await waitFor(() => screen.getByRole("button", { name: "Bild speichern" }));
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(client.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: `/organizations/${organizationId}/players/${playerId}/avatar`,
          method: "PUT",
          rawBody: blob,
        }),
      );
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["players", organizationId] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["player-avatar", organizationId, playerId] });
  });

  it("invalidiert nach dem Entfernen dieselben zwei Schlüssel", async () => {
    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    client.apiRequest.mockResolvedValue(avatarPlayer(null));

    renderControl(queryClient, "vorher-123");

    fireEvent.click(screen.getByRole("button", { name: "Bild entfernen" }));

    await waitFor(() => {
      expect(client.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: `/organizations/${organizationId}/players/${playerId}/avatar`,
          method: "DELETE",
        }),
      );
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["players", organizationId] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["player-avatar", organizationId, playerId] });
  });

  it("meldet einen fehlgeschlagenen Upload ueber role=alert", async () => {
    upload.prepareAvatarUpload.mockResolvedValue(new Blob(["fake"], { type: "image/webp" }));
    client.apiRequest.mockRejectedValue(new Error("kaputt"));

    renderControl(newQueryClient(), null);

    const file = new File(["bytes"], "avatar.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Bild auswählen"), { target: { files: [file] } });
    const saveButton = await waitFor(() => screen.getByRole("button", { name: "Bild speichern" }));
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Fehler");
    });
  });
});
