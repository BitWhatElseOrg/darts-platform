// @vitest-environment happy-dom
//
// Befund B (Folgereview oeffentliche-turnier-ids): `resolvePublicId` durfte
// nur noch dann eine Rundreise gegen `/address` zahlen, wenn die oeffentliche
// Live-Abfrage mit der uebergebenen ID scheitert -- vorher lief sie
// unbedingt vor dem Rendern in der Server-Komponente und zahlte diese
// Rundreise bei JEDEM Aufruf mit einer echten `public_id`, obwohl `/address`
// dafuer garantiert mit 404 antwortet (`live-address.ts`). Diese Tests halten
// drei Dinge fest: der Normalfall loest nicht mehr auf, ein scheiternder
// Erstload loest auf und leitet um (fuer alle drei Modi), und der
// Fehlertext "Turnier nicht gefunden." blitzt dabei nicht auf, bevor die
// Umleitung greift.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/api-error";

const client = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/api-client", () => client);

const liveAddress = vi.hoisted(() => ({ resolvePublicId: vi.fn() }));
vi.mock("@/lib/live-address", () => liveAddress);

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { LiveTournament } from "./live-tournament";

const dashboard = {
  tournament: {
    name: "Herbstcup",
    stageLabel: "Gruppenphase",
    playedMatches: 1,
    totalMatches: 4,
    status: "GROUP_STAGE",
  },
  boards: [],
  groups: [],
  bracket: [],
  participants: [],
};

function renderLiveTournament(props: {
  readonly publicId: string;
  readonly mode: "publikum" | "tv" | "board";
  readonly boardId?: string;
}): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(LiveTournament, props),
    ),
  );
}

beforeEach(() => {
  client.apiRequest.mockReset();
  liveAddress.resolvePublicId.mockReset();
  router.replace.mockReset();
});

afterEach(cleanup);

describe("LiveTournament – Uebergangsweg fuer alte Adressen", () => {
  it("loest im Erfolgsfall nicht auf", async () => {
    client.apiRequest.mockResolvedValueOnce(dashboard);
    renderLiveTournament({ mode: "publikum", publicId: "echte-public-id" });

    await screen.findByText("Herbstcup");
    expect(liveAddress.resolvePublicId).not.toHaveBeenCalled();
  });

  it("loest bei einem scheiternden Erstload auf und leitet um, ohne den Fehlertext aufblitzen zu lassen", async () => {
    client.apiRequest.mockRejectedValueOnce(
      new ApiClientError("Nicht gefunden.", "NOT_FOUND", null, undefined, 404),
    );
    let resolveAddress: ((value: string | null) => void) | undefined;
    liveAddress.resolvePublicId.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          resolveAddress = resolve;
        }),
    );

    renderLiveTournament({ mode: "tv", publicId: "interne-id" });

    await waitFor(() => expect(liveAddress.resolvePublicId).toHaveBeenCalledWith("interne-id"));
    // Aufloesung laeuft noch: der Fehlertext darf jetzt nicht stehen.
    expect(screen.queryByText("Turnier nicht gefunden.")).toBeNull();

    resolveAddress?.("neue-public-id");
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/live/neue-public-id/tv"),
    );
    expect(screen.queryByText("Turnier nicht gefunden.")).toBeNull();
  });

  it("leitet im Board-Modus auf die Board-Adresse um", async () => {
    client.apiRequest.mockRejectedValueOnce(
      new ApiClientError("Nicht gefunden.", "NOT_FOUND", null, undefined, 404),
    );
    liveAddress.resolvePublicId.mockResolvedValueOnce("neue-public-id");

    renderLiveTournament({ boardId: "board-1", mode: "board", publicId: "interne-id" });

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/live/neue-public-id/board/board-1"),
    );
  });

  it("zeigt den Fehlertext, wenn die Aufloesung keine oeffentliche ID liefert", async () => {
    client.apiRequest.mockRejectedValueOnce(
      new ApiClientError("Nicht gefunden.", "NOT_FOUND", null, undefined, 404),
    );
    liveAddress.resolvePublicId.mockResolvedValueOnce(null);

    renderLiveTournament({ mode: "publikum", publicId: "unbekannte-id" });

    await screen.findByText("Turnier nicht gefunden.");
    expect(router.replace).not.toHaveBeenCalled();
  });

  // Befund (PR-Agent, oeffentliche-turnier-ids): jeder Fehlschlag der
  // Live-Abfrage loeste bisher gleich behandelt die Aufloesung ueber
  // `/address` aus und endete ohne Treffer als "Turnier nicht gefunden." --
  // ununterscheidbar von einem privaten oder unbekannten Turnier. Ein
  // Serverausfall ist aber kein alter Link: nur eine echte 404 der
  // Live-Abfrage rechtfertigt den Uebergangsweg.
  it("loest bei einem Serverfehler NICHT ueber /address auf und zeigt eine unterscheidbare Meldung", async () => {
    client.apiRequest.mockRejectedValueOnce(
      new ApiClientError("Die API hat mit HTTP 500 geantwortet.", "REQUEST_FAILED", null, undefined, 500),
    );

    renderLiveTournament({ mode: "publikum", publicId: "echte-public-id" });

    await screen.findByText("Diese Ansicht konnte nicht geladen werden. Versuche es später erneut.");
    expect(liveAddress.resolvePublicId).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.queryByText("Turnier nicht gefunden.")).toBeNull();
  });

  it("loest auch bei einem Netzwerkfehler (kein ApiClientError) NICHT ueber /address auf", async () => {
    client.apiRequest.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    renderLiveTournament({ mode: "publikum", publicId: "echte-public-id" });

    await screen.findByText("Diese Ansicht konnte nicht geladen werden. Versuche es später erneut.");
    expect(liveAddress.resolvePublicId).not.toHaveBeenCalled();
  });
});
