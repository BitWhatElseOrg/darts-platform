// @vitest-environment happy-dom
//
// Die Neuanlage einer Organisation ist ein seltener Betriebsvorgang und in
// Production ueberdies gesperrt (`ALLOW_SELF_SERVICE_ORGANIZATIONS`). Das
// Panel darf dafuer also weder dauerhaft Platz belegen noch einen Weg zeigen,
// den der Server anschliessend mit 403 abweist.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
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

// Der Server ist die einzige Quelle fuer beides: welche Organisationen es
// gibt und ob die Selbstbedienung offensteht.
const server = vi.hoisted(() => ({
  selfServiceEnabled: true,
  organizations: [] as unknown[],
}));

const client = vi.hoisted(() => ({
  apiRequest: vi.fn(({ path }: { readonly path: string }) => {
    if (path === "/organizations/capabilities")
      return Promise.resolve({ selfServiceEnabled: server.selfServiceEnabled });
    if (path === "/organizations") return Promise.resolve(server.organizations);
    if (path === "/invitations") return Promise.resolve([]);
    if (path.endsWith("/matches")) return Promise.resolve([]);
    return Promise.reject(new Error(`Unerwarteter Pfad: ${path}`));
  }),
  userFacingErrorMessage: vi.fn(() => "Fehler"),
}));
vi.mock("@/lib/api-client", () => client);

import { TenantDashboard } from "./tenant-dashboard";

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(TenantDashboard, {
        userName: "Fabienne Beispiel",
        userEmail: "fabienne@example.test",
        onSignOut: () => Promise.resolve(),
      }),
    ),
  );
}

beforeEach(() => {
  server.selfServiceEnabled = true;
  server.organizations = [organization];
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Organisationen anlegen", () => {
  it("haelt das Formular eingeklappt, bis jemand danach fragt", async () => {
    renderDashboard();

    const trigger = await screen.findByRole("button", {
      name: "Neue Organisation",
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Organisationsname")).toBeNull();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Organisationsname")).not.toBeNull();
    expect(screen.getByLabelText("Organisationskürzel")).not.toBeNull();
  });

  it("bietet den Weg gar nicht an, wenn der Server die Selbstbedienung sperrt", async () => {
    server.selfServiceEnabled = false;
    renderDashboard();

    await screen.findByRole("heading", { name: "Organisationen" });

    expect(
      screen.queryByRole("button", { name: "Neue Organisation" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Organisationsname")).toBeNull();
  });

  it("verweist ohne Mitgliedschaft und ohne Selbstbedienung an den Betrieb", async () => {
    server.selfServiceEnabled = false;
    server.organizations = [];
    renderDashboard();

    expect(
      await screen.findByText(/wende dich an die Plattformverwaltung/u),
    ).not.toBeNull();
  });

  it("laedt ohne Mitgliedschaft, aber mit offener Selbstbedienung zur Anlage ein", async () => {
    server.organizations = [];
    renderDashboard();

    expect(
      await screen.findByText(/Erstelle eine Organisation/u),
    ).not.toBeNull();
  });
});
