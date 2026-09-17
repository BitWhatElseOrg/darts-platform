// @vitest-environment happy-dom
//
// Der gemeldete Fehler: ueber einen Link ohne `?organisation=` — die
// „Uebersicht" etwa — sprang die Flaeche auf die erste Organisation der Liste
// zurueck. Die Aufloesung selbst ist in `organization-selection.spec.ts`
// abgedeckt; hier haengt sie am Hook, den jede Arbeitsflaeche benutzt.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { organizationSelectionStorageKey } from "@/lib/organization-selection";
import { useTournamentOrganization } from "./use-tournament-organization";

const alpha = { id: "11111111-1111-4111-8111-111111111111", name: "Alpha", slug: "alpha", role: "OWNER", playerId: null };
const beta = { id: "22222222-2222-4222-8222-222222222222", name: "Beta", slug: "beta", role: "OWNER", playerId: null };

const client = vi.hoisted(() => ({ apiRequest: vi.fn(), userFacingErrorMessage: vi.fn(() => "Fehler") }));
vi.mock("@/lib/api-client", () => client);

function wrapper({ children }: { readonly children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
  client.apiRequest.mockResolvedValue([alpha, beta]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useTournamentOrganization", () => {
  it("bleibt ohne Parameter bei der zuletzt gewaehlten Organisation", async () => {
    window.localStorage.setItem(organizationSelectionStorageKey, beta.id);

    const { result } = renderHook(() => useTournamentOrganization(undefined), { wrapper });

    await waitFor(() => { expect(result.current.organization).not.toBeNull(); });
    expect(result.current.organization?.id).toBe(beta.id);
  });

  it("merkt sich eine ausdruecklich angefragte Organisation", async () => {
    const { result } = renderHook(() => useTournamentOrganization(beta.id), { wrapper });

    await waitFor(() => { expect(result.current.organization?.id).toBe(beta.id); });
    await waitFor(() => {
      expect(window.localStorage.getItem(organizationSelectionStorageKey)).toBe(beta.id);
    });
  });

  it("nimmt beim ersten Besuch die erste zugaengliche Organisation", async () => {
    const { result } = renderHook(() => useTournamentOrganization(undefined), { wrapper });

    await waitFor(() => { expect(result.current.organization).not.toBeNull(); });
    expect(result.current.organization?.id).toBe(alpha.id);
  });
});
