// @vitest-environment happy-dom
//
// Haelt Task 2 (Follow-ups Bearbeiten/Loeschen) fest: nach erfolgreichem
// "Entfernen" verschwindet die Zeile, der Fokus wandert auf die Ueberschrift
// der Mitgliederliste (`tabIndex={-1}`, wie beim Spieler-Loeschen aus Task 1)
// und eine `role="status"`-Meldung nennt den Namen.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/mitglieder",
}));

const actorUserId = "00000000-0000-4000-8000-000000000001";
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ isPending: false, data: { user: { id: actorUserId } } }),
  },
}));

const organization = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "VFC Musterstadt",
  slug: "vfc-musterstadt",
  timezone: "Europe/Zurich",
  locale: "de-CH",
  role: "OWNER",
  playerId: null,
} as const;

function member(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: "22222222-2222-4222-8222-222222222222",
    email: "bruno@example.com",
    displayName: "Bruno Beispiel",
    role: "MEMBER",
    status: "ACTIVE",
    player: null,
    ...overrides,
  };
}

const server = vi.hoisted(() => ({
  members: [] as unknown[],
  invitations: [] as unknown[],
  role: "OWNER" as string,
  removeRejection: null as unknown,
}));

const createdInvitation = vi.hoisted(() => ({
  id: "33333333-3333-4333-8333-333333333333",
  organizationId: "11111111-1111-4111-8111-111111111111",
  email: "neu@example.com",
  role: "MEMBER",
  status: "PENDING",
  expiresAt: new Date("2026-10-02T12:00:00.000Z"),
  lastDelivery: null,
  claimToken: "claim-token-fuer-den-test-0123456789abcdefghij",
}));

const client = vi.hoisted(() => ({
  apiRequest: vi.fn(
    ({ path, method }: { readonly path: string; readonly method?: string }) => {
      if (path === "/organizations" && (method === undefined || method === "GET")) {
        return Promise.resolve([
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "VFC Musterstadt",
            slug: "vfc-musterstadt",
            timezone: "Europe/Zurich",
            locale: "de-CH",
            role: server.role,
            playerId: null,
          },
        ]);
      }
      if (path.endsWith("/members") && (method === undefined || method === "GET")) {
        return Promise.resolve(server.members);
      }
      if (path.endsWith("/players") && (method === undefined || method === "GET")) {
        return Promise.resolve([]);
      }
      if (path.endsWith("/invitations") && (method === undefined || method === "GET")) {
        return Promise.resolve(server.invitations);
      }
      if (path.endsWith("/invitations") && method === "POST") {
        server.invitations = [...server.invitations, createdInvitation];
        return Promise.resolve(createdInvitation);
      }
      if (path.includes("/members/") && method === "DELETE") {
        if (server.removeRejection !== null) return Promise.reject(server.removeRejection);
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`Unerwarteter Aufruf: ${method ?? "GET"} ${path}`));
    },
  ),
  userFacingErrorMessage: vi.fn((error: unknown) =>
    error !== null && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : "Fehler",
  ),
}));
vi.mock("@/lib/api-client", () => client);

import { MembersRoute } from "./members-route";

function renderRoute() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MembersRoute, { requestedOrganizationId: organization.id }),
    ),
  );
}

beforeEach(() => {
  server.members = [member()];
  server.invitations = [];
  server.role = "OWNER";
  server.removeRejection = null;
  client.apiRequest.mockClear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("MembersRoute", () => {
  it("haelt die Statusregion fuer 'Entfernen' dauerhaft im DOM, auch leer (Whole-Branch-Review, Befund 2)", async () => {
    // Eine `role="status"`-Region, die erst NACH dem Einhaengen befuellt
    // wird, kuendigt Screenreadern nicht zuverlaessig an. Vor jeder Aktion
    // muss sie also schon existieren, nur eben leer.
    renderRoute();

    await screen.findByText("Bruno Beispiel");

    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("fokussiert nach erfolgreichem Entfernen die Ueberschrift und zeigt eine Statusmeldung (Task 2)", async () => {
    renderRoute();

    await screen.findByText("Bruno Beispiel");
    fireEvent.click(screen.getByRole("button", { name: "Entfernen" }));

    const dialog = screen.getByRole("dialog", { name: "Mitglied entfernen" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Entfernen" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    const heading = screen.getByRole("heading", { name: "Mitglieder", level: 2 });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole("status").textContent).toBe(
      "Bruno Beispiel wurde aus der Organisation entfernt.",
    );
  });

  it("zeigt das Einladungsformular im Abschnitt 'Offene Einladungen', wenn Mitglieder verwaltet werden duerfen", async () => {
    renderRoute();

    await screen.findByText("Bruno Beispiel");

    const section = screen.getByRole("heading", { name: "Offene Einladungen" }).closest("section");
    expect(section).not.toBeNull();
    expect(within(section as HTMLElement).getByLabelText("E-Mail-Adresse für Einladung")).toBeTruthy();
    expect(screen.queryByText(/auf der Seite/u)).toBeNull();
  });

  it("zeigt ohne 'organization:manage_members' kein Einladungsformular", async () => {
    server.role = "MEMBER";
    renderRoute();

    await screen.findByText(/fehlt dir die Berechtigung/u);

    expect(screen.queryByLabelText("E-Mail-Adresse für Einladung")).toBeNull();
  });

  it("laedt die offenen Einladungen nach erfolgreichem Einladen neu", async () => {
    renderRoute();

    await screen.findByText("Keine offene Einladung.");
    fireEvent.change(screen.getByLabelText("E-Mail-Adresse für Einladung"), {
      target: { value: "neu@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Einladen" }));

    await screen.findByLabelText("Einladungslink");
    const section = screen.getByRole("heading", { name: "Offene Einladungen" }).closest("section") as HTMLElement;
    await within(section).findByText("neu@example.com");
    expect(within(section).queryByText("Keine offene Einladung.")).toBeNull();
  });
});
