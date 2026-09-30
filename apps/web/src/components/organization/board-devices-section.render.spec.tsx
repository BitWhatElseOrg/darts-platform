// @vitest-environment happy-dom
//
// Scheiben-Tablets in der Organisationsverwaltung einrichten und entkoppeln
// (Spec 2026-09-30-scheiben-tablet, Task 10). Muster:
// `organization-settings-route.render.spec.tsx` -- `apiRequest` gemockt,
// keine echte Netzwerkschicht.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerReplace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace }),
}));

// Eigenes Modul statt `window.matchMedia`/`navigator.standalone` zu
// faelschen: `isStandaloneDisplay` hat eine eigene Spec
// (`standalone-display.spec.ts`), hier zaehlt nur, ob die Sektion sich danach
// richtig verhaelt.
const environment = vi.hoisted(() => ({ standalone: false }));
vi.mock("@/lib/standalone-display", () => ({
  isStandaloneDisplay: () => environment.standalone,
}));

const signOut = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: () => signOut() },
}));

// `recallBoardDevice` liest per Default zurueck, was `rememberBoardDevice`
// zuletzt "gespeichert" hat -- simuliert erfolgreiches `localStorage`. Der
// Task-Review-Fix (Speicherung vor dem Abmelden gegenpruefen) braucht einen
// Weg, genau das scheitern zu lassen: `deviceKeyStorage.recallBoardDevice`
// bleibt dafuer direkt ueberschreibbar (`mockReturnValueOnce`).
const deviceKeyStorage = vi.hoisted(() => {
  let stored: { readonly secret: string; readonly boardName: string; readonly organizationName: string } | null =
    null;
  return {
    rememberBoardDevice: vi.fn(
      (device: { readonly secret: string; readonly boardName: string; readonly organizationName: string }) => {
        stored = device;
      },
    ),
    recallBoardDevice: vi.fn(() => stored),
    reset: () => {
      stored = null;
    },
  };
});
vi.mock("@/lib/device-key-storage", () => ({
  rememberBoardDevice: deviceKeyStorage.rememberBoardDevice,
  recallBoardDevice: deviceKeyStorage.recallBoardDevice,
}));
const rememberBoardDevice = deviceKeyStorage.rememberBoardDevice;

const server = vi.hoisted(() => ({
  boards: [] as unknown[],
  devices: [] as unknown[],
  pairSecret: "bd_secret-123",
  pairRejection: null as unknown,
  revokeRejection: null as unknown,
}));

const client = vi.hoisted(() => ({
  apiRequest: vi.fn(
    ({ path, method, body }: { readonly path: string; readonly method?: string; readonly body?: unknown }) => {
      if (path.endsWith("/boards") && (method === undefined || method === "GET")) {
        return Promise.resolve(server.boards);
      }
      if (path.endsWith("/board-devices") && (method === undefined || method === "GET")) {
        return Promise.resolve(server.devices);
      }
      if (path.includes("/devices") && method === "POST") {
        if (server.pairRejection !== null) return Promise.reject(server.pairRejection);
        const boardId = path.split("/boards/")[1]!.split("/devices")[0]!;
        return Promise.resolve({
          device: {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            boardId,
            label: (body as { readonly label: string }).label,
            createdAt: new Date(),
            lastSeenAt: null,
          },
          secret: server.pairSecret,
        });
      }
      if (path.includes("/devices/") && method === "DELETE") {
        if (server.revokeRejection !== null) return Promise.reject(server.revokeRejection);
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unerwarteter Aufruf: ${method ?? "GET"} ${path}`));
    },
  ),
  userFacingErrorMessage: vi.fn((error: unknown) =>
    error !== null && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "Fehler",
  ),
}));
vi.mock("@/lib/api-client", () => client);

import { BoardDevicesSection } from "./board-devices-section";

const organizationId = "11111111-1111-4111-8111-111111111111";
const organizationName = "VFC Musterstadt";
const boardA = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId,
  name: "Scheibe 1",
  status: "AVAILABLE",
  // Echte `Date`-Objekte statt ISO-Strings: `apiRequest` ist hier komplett
  // gemockt (siehe `client` oben), die echte Schema-Koerzierung
  // (`z.coerce.date()`) laeuft also NICHT -- ein ISO-String bliebe einer,
  // und `lastSeenLabel` riefe `.getTime()` auf einem String auf.
  createdAt: new Date(),
  updatedAt: new Date(),
};
const boardB = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  organizationId,
  name: "Scheibe 2",
  status: "AVAILABLE",
  createdAt: new Date(),
  updatedAt: new Date(),
};
const existingDevice = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  boardId: boardB.id,
  label: "Tablet Scheibe 2",
  createdAt: new Date(),
  lastSeenAt: new Date(Date.now() - 5 * 60_000),
};

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(BoardDevicesSection, { organizationId, organizationName, role: "OWNER" }),
    ),
  );
}

beforeEach(() => {
  environment.standalone = false;
  server.boards = [boardA, boardB];
  server.devices = [existingDevice];
  server.pairRejection = null;
  server.revokeRejection = null;
  routerReplace.mockReset();
  signOut.mockClear();
  rememberBoardDevice.mockClear();
  deviceKeyStorage.recallBoardDevice.mockClear();
  deviceKeyStorage.reset();
  // `client.apiRequest.mock.calls` sammelt sonst fuer den ganzen Dateilauf
  // (wie in `organization-settings-route.render.spec.tsx`): die
  // Entkoppeln-Spec prueft "noch kein DELETE passiert" -- ohne `mockClear`
  // wuerde sie an einem DELETE aus einem fruehreren Testfall scheitern (hier
  // dem Best-effort-Widerruf bei gescheiterter Speicherung).
  client.apiRequest.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("BoardDevicesSection", () => {
  it("zeigt fuer jede Scheibe den Koppelstatus", async () => {
    renderSection();

    await screen.findByText("Scheibe 1");
    expect(screen.getByText("Kein Gerät")).not.toBeNull();
    expect(screen.getByText(/Gekoppelt · zuletzt gesehen/)).not.toBeNull();
  });

  it("deaktiviert das Einrichten ausserhalb der installierten App und zeigt den Hinweis", async () => {
    environment.standalone = false;
    renderSection();

    const setupButtons = await screen.findAllByRole("button", { name: "Dieses Gerät einrichten" });
    for (const button of setupButtons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getAllByText("Öffne DartBase zuerst als App vom Home-Bildschirm").length).toBeGreaterThan(0);
  });

  it("richtet in der installierten App ein Geraet ein und wechselt in den Kiosk", async () => {
    environment.standalone = true;
    renderSection();

    const setupButton = await screen.findByRole("button", { name: "Dieses Gerät einrichten" });
    expect((setupButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(setupButton);

    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith("/scheibe");
    });

    expect(client.apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/organizations/${organizationId}/boards/${boardA.id}/devices`,
        method: "POST",
        body: { label: `Tablet ${boardA.name}` },
      }),
    );
    expect(rememberBoardDevice).toHaveBeenCalledWith({
      secret: server.pairSecret,
      boardName: boardA.name,
      organizationName,
    });

    const rememberOrder = rememberBoardDevice.mock.invocationCallOrder[0]!;
    const signOutOrder = signOut.mock.invocationCallOrder[0]!;
    const replaceOrder = routerReplace.mock.invocationCallOrder[0]!;
    expect(rememberOrder).toBeLessThan(signOutOrder);
    expect(signOutOrder).toBeLessThan(replaceOrder);
  });

  it("bricht ab und meldet sichtbar, wenn die Kopplung nicht lokal gespeichert werden konnte", async () => {
    // Task-Review-Befund: `rememberBoardDevice` schluckt Schreibfehler
    // intern (privates Fenster, gesperrte Website-Daten). Ungeprueft
    // weiterzufahren wuerde die Person abmelden und in den Kiosk schicken,
    // obwohl das Tablet den Schluessel nie hatte -- waehrend der Server das
    // neue Geraet schon gekoppelt haette. `recallBoardDevice` liefert hier
    // `null`, um genau das zu simulieren.
    environment.standalone = true;
    deviceKeyStorage.recallBoardDevice.mockReturnValueOnce(null);
    renderSection();

    const setupButton = await screen.findByRole("button", { name: "Dieses Gerät einrichten" });
    fireEvent.click(setupButton);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "Dieses Tablet konnte die Kopplung nicht speichern. Erlaube Website-Daten für DartBase und richte das Tablet erneut ein.",
    );
    expect(signOut).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(
        client.apiRequest.mock.calls.some(
          ([input]: [{ readonly path: string; readonly method?: string }]) =>
            input.method === "DELETE" &&
            input.path ===
              `/organizations/${organizationId}/boards/${boardA.id}/devices/dddddddd-dddd-4ddd-8ddd-dddddddddddd`,
        ),
      ).toBe(true);
    });
  });

  it("entkoppelt ein Tablet erst nach Bestaetigung", async () => {
    environment.standalone = true;
    renderSection();

    await screen.findByText(/Gekoppelt · zuletzt gesehen/);
    fireEvent.click(screen.getByRole("button", { name: "Entkoppeln" }));

    const dialog = await screen.findByRole("dialog", { name: "Tablet entkoppeln" });
    expect(
      client.apiRequest.mock.calls.some(([input]: [{ readonly method?: string }]) => input.method === "DELETE"),
    ).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Entkoppeln" }));

    await waitFor(() => {
      expect(
        client.apiRequest.mock.calls.some(
          ([input]: [{ readonly path: string; readonly method?: string }]) =>
            input.method === "DELETE" &&
            input.path === `/organizations/${organizationId}/boards/${boardB.id}/devices/${existingDevice.id}`,
        ),
      ).toBe(true);
    });
  });

  it("fragt vor dem Ersatz-Einrichten eines bereits gekoppelten Boards nach", async () => {
    environment.standalone = true;
    renderSection();

    await screen.findByRole("button", { name: "Dieses Gerät als Ersatz einrichten" });
    fireEvent.click(screen.getByRole("button", { name: "Dieses Gerät als Ersatz einrichten" }));

    const dialog = await screen.findByRole("dialog", { name: "Tablet ersetzen" });
    expect(dialog.textContent).toContain("Das bisherige Tablet dieser Scheibe wird dabei entkoppelt.");

    fireEvent.click(within(dialog).getByRole("button", { name: "Als Ersatz einrichten" }));

    await waitFor(() => {
      expect(
        client.apiRequest.mock.calls.some(
          ([input]: [{ readonly path: string; readonly method?: string }]) =>
            input.method === "POST" && input.path === `/organizations/${organizationId}/boards/${boardB.id}/devices`,
        ),
      ).toBe(true);
    });
  });
});
