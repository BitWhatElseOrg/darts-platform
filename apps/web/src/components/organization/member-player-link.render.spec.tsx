// @vitest-environment happy-dom
//
// Haelt fest, welche Profile die Zuordnung ueberhaupt anbietet und dass das
// Loesen eine Rueckfrage verlangt.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OrganizationMember, PlayerResponse } from "@darts-platform/schemas";

vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));

import { MemberPlayerLink } from "./member-player-link";

afterEach(() => {
  cleanup();
});

function player(overrides: Partial<PlayerResponse>): PlayerResponse {
  return {
    id: "spieler-1",
    organizationId: "organisation-1",
    publicId: "oeffentlich-1",
    firstName: null,
    lastName: null,
    displayName: "Freies Profil",
    nickname: null,
    email: null,
    externalReference: null,
    status: "ACTIVE",
    hasAccount: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function member(overrides: Partial<OrganizationMember> = {}): OrganizationMember {
  return {
    userId: "konto-1",
    email: "mitglied@example.test",
    displayName: "Mitglied",
    role: "MEMBER",
    status: "ACTIVE",
    player: null,
    ...overrides,
  };
}

const players = [
  player({ id: "frei", displayName: "Freies Profil" }),
  player({ id: "vergeben", displayName: "Vergebenes Profil", hasAccount: true }),
  player({ id: "archiviert", displayName: "Archiviertes Profil", status: "INACTIVE" }),
  player({ id: "meines", displayName: "Mein Profil", hasAccount: true }),
];

function renderLink(current: OrganizationMember) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemberPlayerLink, {
        member: current,
        organizationId: "organisation-1",
        players,
      }),
    ),
  );
}

describe("MemberPlayerLink", () => {
  it("bietet nur freie, aktive Profile an", () => {
    renderLink(member());

    expect(screen.getByRole("option", { name: "Freies Profil" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Vergebenes Profil" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Archiviertes Profil" })).toBeNull();
  });

  it("zeigt das eigene zugeordnete Profil, obwohl es ein Konto hat", () => {
    renderLink(member({ player: { id: "meines", displayName: "Mein Profil" } }));

    expect(screen.getByRole("option", { name: "Mein Profil" })).toBeTruthy();
    expect(screen.getByLabelText(/Spielerprofil/u)).toHaveProperty("value", "meines");
  });

  it("bietet das Loesen nur bei bestehender Zuordnung und fragt zurueck", () => {
    const { unmount } = renderLink(member());
    expect(screen.queryByText("Zuordnung lösen")).toBeNull();
    unmount();

    renderLink(member({ player: { id: "meines", displayName: "Mein Profil" } }));
    fireEvent.click(screen.getByText("Zuordnung lösen"));

    expect(screen.getByText("Zuordnung wirklich lösen")).toBeTruthy();
    expect(screen.getByText("Abbrechen")).toBeTruthy();
  });
});
