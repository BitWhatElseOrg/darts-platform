// @vitest-environment happy-dom
//
// Die Organisationsseite zeigt Stammdaten (Name, Zeitzone, Sprache) und,
// nur fuer OWNER, den Gefahrenbereich zum endgueltigen Loeschen. Beides
// haengt von der Rolle in der jeweiligen Organisation ab (Spec
// 2026-09-24-bearbeiten-loeschen, Task 8): `organization:update` fuer das
// Formular, `organization:delete` fuer das Loeschen. ADMIN hat ersteres,
// nicht aber letzteres.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/organisation",
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

const server = vi.hoisted(() => ({
  organizations: [] as unknown[],
  updateRejection: null as unknown,
  deleteRejection: null as unknown,
}));

const client = vi.hoisted(() => ({
  apiRequest: vi.fn(
    ({ path, method, body }: { readonly path: string; readonly method?: string; readonly body?: unknown }) => {
      if (path === "/organizations" && (method === undefined || method === "GET")) {
        return Promise.resolve(server.organizations);
      }
      if (path.startsWith("/organizations/") && method === "PATCH") {
        if (server.updateRejection !== null) return Promise.reject(server.updateRejection);
        const id = path.slice("/organizations/".length);
        const current = (server.organizations as Array<Record<string, unknown>>).find(
          (candidate) => candidate.id === id,
        );
        // Spiegelt den echten Endpunkt: die Antwort trägt die uebermittelten
        // Felder, nicht bloss den alten Stand — sonst wuerde ein
        // anschliessendes `form.reset(saved)` die Eingabe unbemerkt
        // zuruecksetzen.
        return Promise.resolve({ ...current, ...(body as Record<string, unknown> | undefined) });
      }
      if (path.startsWith("/organizations/") && method === "DELETE") {
        if (server.deleteRejection !== null) return Promise.reject(server.deleteRejection);
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

import { OrganizationSettingsRoute } from "./organization-settings-route";

function renderRoute() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(OrganizationSettingsRoute, { requestedOrganizationId: organization.id }),
    ),
  );
}

type ApiRequestCall = [{ readonly path: string; readonly method?: string; readonly body?: unknown }];

/**
 * `client.apiRequest.mock.calls` sammelt fuer den ganzen Dateilauf, nicht nur
 * pro Test (kein `mockClear` in `beforeEach`). `.find(...)` griffe deshalb bei
 * mehreren PATCH-Faellen den aeltesten Treffer aus einem frueheren Test ab —
 * hier zaehlt immer der juengste.
 */
function patchCalls(): ApiRequestCall[] {
  return (client.apiRequest.mock.calls as ApiRequestCall[]).filter(
    ([input]) => input.method === "PATCH",
  );
}

function lastPatchCall(): ApiRequestCall | undefined {
  return patchCalls().at(-1);
}

function countPatchCalls(): number {
  return patchCalls().length;
}

beforeEach(() => {
  server.organizations = [organization];
  server.updateRejection = null;
  server.deleteRejection = null;
  push.mockReset();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("OrganizationSettingsRoute", () => {
  it("zeigt das Stammdaten-Formular fuer eine Rolle mit organization:update", async () => {
    renderRoute();

    expect((await screen.findByLabelText("Name") as HTMLInputElement).value).toBe("VFC Musterstadt");
    const timezoneSelect = screen.getByLabelText("Zeitzone") as HTMLSelectElement;
    expect(timezoneSelect.tagName).toBe("SELECT");
    expect(timezoneSelect.value).toBe("Europe/Zurich");
    const localeSelect = screen.getByLabelText("Sprache") as HTMLSelectElement;
    expect(localeSelect.tagName).toBe("SELECT");
    expect(localeSelect.value).toBe("de-CH");
    expect(screen.getByText("vfc-musterstadt")).not.toBeNull();
    expect(
      screen.getByText("Der Kurzname steht in Links und Einladungen und lässt sich nicht ändern."),
    ).not.toBeNull();
  });

  it("bietet Zeitzonen aus Intl.supportedValuesOf sowie UTC zur Auswahl an", async () => {
    renderRoute();

    const timezoneSelect = await screen.findByLabelText("Zeitzone") as HTMLSelectElement;
    const options = [...timezoneSelect.options].map((option) => option.value);
    expect(options).toContain("UTC");
    expect(options).toContain("Europe/Zurich");
    expect(options).toContain("Pacific/Auckland");
  });

  it("bietet die vier Amtssprachen-Gebietsschemas zur Auswahl an", async () => {
    renderRoute();

    const localeSelect = await screen.findByLabelText("Sprache") as HTMLSelectElement;
    const options = [...localeSelect.options].map((option) => option.value);
    expect(options).toEqual(["de-CH", "fr-CH", "it-CH", "en-GB"]);
  });

  it("ergaenzt einen gespeicherten, aber nicht gelisteten Zeitzonen- oder Sprachwert als zusaetzliche Option", async () => {
    server.organizations = [
      { ...organization, timezone: "US/Pacific", locale: "de-DE" },
    ];
    renderRoute();

    const timezoneSelect = await screen.findByLabelText("Zeitzone") as HTMLSelectElement;
    expect(timezoneSelect.value).toBe("US/Pacific");
    expect([...timezoneSelect.options].map((option) => option.value)).toContain("US/Pacific");

    const localeSelect = screen.getByLabelText("Sprache") as HTMLSelectElement;
    expect(localeSelect.value).toBe("de-DE");
    expect([...localeSelect.options].map((option) => option.value)).toContain("de-DE");
  });

  it("zeigt die Stammdaten nur lesend ohne organization:update", async () => {
    server.organizations = [{ ...organization, role: "MEMBER" }];
    renderRoute();

    await screen.findByText("VFC Musterstadt");
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Speichern" })).toBeNull();
  });

  it("speichert nur das geaenderte Feld und zeigt eine Erfolgsmeldung", async () => {
    // PATCH-Semantik: unveraenderte Felder werden nicht mitgeschickt (siehe
    // "sendet nur die geaenderte Zeitzone" weiter unten fuer die Begruendung).
    renderRoute();

    const nameInput = await screen.findByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "VFC Neustadt" } });
    fireEvent.submit(screen.getByRole("button", { name: "Speichern" }).closest("form")!);

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Gespeichert.");
    const patchCall = lastPatchCall();
    expect(patchCall?.[0]).toMatchObject({
      path: `/organizations/${organization.id}`,
      body: { name: "VFC Neustadt" },
    });
    expect(patchCall?.[0].body).not.toHaveProperty("timezone");
    expect(patchCall?.[0].body).not.toHaveProperty("locale");
  });

  it("sendet nur die geaenderte Zeitzone, auch wenn Name und Sprache unveraendert bleiben", async () => {
    renderRoute();

    const timezoneSelect = await screen.findByLabelText("Zeitzone");
    fireEvent.change(timezoneSelect, { target: { value: "Europe/Berlin" } });
    fireEvent.submit(screen.getByRole("button", { name: "Speichern" }).closest("form")!);

    await screen.findByRole("status");
    expect(lastPatchCall()?.[0].body).toEqual({ timezone: "Europe/Berlin" });
  });

  it("erlaubt eine Namensaenderung, obwohl die gespeicherte Zeitzone die neue Pruefung nicht mehr besteht", async () => {
    // Bestandsdaten: die Spalte hat keinen DB-Check, eine historische
    // Zeitzone kann daher ungueltig geworden sein. Eine reine
    // Namensaenderung darf trotzdem funktionieren, ohne die unveraenderte
    // Zeitzone erneut zu validieren oder mitzuschicken.
    server.organizations = [{ ...organization, timezone: "Legacy/Invalid" }];
    renderRoute();

    const nameInput = await screen.findByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "VFC Neustadt" } });
    fireEvent.submit(screen.getByRole("button", { name: "Speichern" }).closest("form")!);

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Gespeichert.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(lastPatchCall()?.[0].body).toEqual({ name: "VFC Neustadt" });
  });

  it("sendet bei unveraenderten Feldern kein PATCH", async () => {
    renderRoute();
    await screen.findByLabelText("Name");
    const patchCallsBefore = countPatchCalls();

    fireEvent.submit(screen.getByRole("button", { name: "Speichern" }).closest("form")!);

    await Promise.resolve();
    expect(countPatchCalls()).toBe(patchCallsBefore);
  });

  it("zeigt den Gefahrenbereich nur fuer OWNER, nicht fuer ADMIN", async () => {
    renderRoute();
    await screen.findByLabelText("Name");
    expect(screen.getByRole("heading", { name: "Organisation löschen" })).not.toBeNull();

    cleanup();
    server.organizations = [{ ...organization, role: "ADMIN" }];
    renderRoute();
    await screen.findByLabelText("Name");
    expect(screen.queryByRole("heading", { name: "Organisation löschen" })).toBeNull();
  });

  it("sperrt den Loeschen-Button im Dialog, bis der Name exakt passt", async () => {
    renderRoute();
    await screen.findByLabelText("Name");

    fireEvent.click(screen.getAllByRole("button", { name: "Organisation löschen" })[0]!);

    expect(screen.getByRole("dialog", { name: "Organisation löschen" })).not.toBeNull();
    const confirmInput = screen.getByLabelText('Zur Bestätigung den Namen „VFC Musterstadt" eintippen');
    const confirmBtn = screen.getAllByRole("button", { name: "Organisation löschen" }).slice(-1)[0]!;
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(confirmInput, { target: { value: "Falscher Name" } });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(confirmInput, { target: { value: "VFC Musterstadt" } });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("zeigt 400 ORGANIZATION_NAME_MISMATCH als Fehler im Dialog", async () => {
    server.deleteRejection = { message: "Der eingegebene Name stimmt nicht mit dem Namen der Organisation überein." };
    renderRoute();
    await screen.findByLabelText("Name");

    fireEvent.click(screen.getAllByRole("button", { name: "Organisation löschen" })[0]!);
    const confirmInput = screen.getByLabelText('Zur Bestätigung den Namen „VFC Musterstadt" eintippen');
    fireEvent.change(confirmInput, { target: { value: "VFC Musterstadt" } });
    const confirmBtn = screen.getAllByRole("button", { name: "Organisation löschen" }).slice(-1)[0]!;
    fireEvent.click(confirmBtn);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "Der eingegebene Name stimmt nicht mit dem Namen der Organisation überein.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("loescht die Organisation und leitet zur Startseite weiter", async () => {
    renderRoute();
    await screen.findByLabelText("Name");

    fireEvent.click(screen.getAllByRole("button", { name: "Organisation löschen" })[0]!);
    const confirmInput = screen.getByLabelText('Zur Bestätigung den Namen „VFC Musterstadt" eintippen');
    fireEvent.change(confirmInput, { target: { value: "VFC Musterstadt" } });
    const confirmBtn = screen.getAllByRole("button", { name: "Organisation löschen" }).slice(-1)[0]!;
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/");
    });
    const deleteCall = client.apiRequest.mock.calls.find(
      ([input]: [{ readonly method?: string }]) => input.method === "DELETE",
    );
    expect(deleteCall?.[0]).toMatchObject({
      path: `/organizations/${organization.id}`,
      body: { confirmName: "VFC Musterstadt" },
    });
  });

  it("haelt das Eingabefeld des Loeschdialogs nicht dauerhaft im DOM", async () => {
    // Sonst kollidiert ein Label wie "Namen" mit dem Stammdaten-Feld "Name"
    // in einem strikten Locator (bereits einmal in dieser Spec passiert).
    renderRoute();
    await screen.findByLabelText("Name");

    expect(screen.queryByLabelText('Zur Bestätigung den Namen „VFC Musterstadt" eintippen')).toBeNull();
  });

  it("zeigt nach einem Organisationswechsel ohne Neumontage der Seite sofort die neuen Stammdaten", async () => {
    // `WorkspaceShell` bietet ohne Seitenwechsel eine Organisationsauswahl
    // an (`<select>`); dabei aendert sich nur die `organization`-Prop, nicht
    // der Komponentenbaum. Ohne `key={organization.id}` auf
    // `OrganizationDetails`/`DangerZone` bliebe `useForm` bei den
    // Defaultwerten der zuerst gemounteten Organisation stehen.
    const otherOrganization = {
      ...organization,
      id: "22222222-2222-4222-8222-222222222222",
      name: "VFC Andernorts",
      slug: "vfc-andernorts",
      timezone: "Europe/Berlin",
      locale: "de-DE",
    };
    server.organizations = [organization, otherOrganization];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(OrganizationSettingsRoute, { requestedOrganizationId: organization.id }),
      ),
    );

    expect((await screen.findByLabelText("Name") as HTMLInputElement).value).toBe("VFC Musterstadt");

    rerender(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(OrganizationSettingsRoute, { requestedOrganizationId: otherOrganization.id }),
      ),
    );

    await waitFor(() => {
      expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("VFC Andernorts");
    });
    expect((screen.getByLabelText("Zeitzone") as HTMLInputElement).value).toBe("Europe/Berlin");
  });

  it("blendet «Gespeichert.» aus, sobald danach weiter bearbeitet wird", async () => {
    renderRoute();

    const nameInput = (await screen.findByLabelText("Name")) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "VFC Neustadt" } });
    fireEvent.submit(screen.getByRole("button", { name: "Speichern" }).closest("form")!);

    await screen.findByRole("status");

    fireEvent.change(nameInput, { target: { value: "VFC Neustadt II" } });

    expect(screen.queryByRole("status")).toBeNull();
  });
});
