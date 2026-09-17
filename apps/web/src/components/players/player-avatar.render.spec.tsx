// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Wie in player-list.render.spec.tsx: haelt den Test unabhaengig davon, ob
// NEXT_PUBLIC_API_URL in der Umgebung gesetzt ist.
vi.mock("@/lib/environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));

import { PlayerAvatar } from "./player-avatar";

const organizationId = "11111111-1111-4111-8111-111111111111";
const player = { id: "22222222-2222-4222-8222-222222222222", displayName: "Alex Muster" };

afterEach(() => { cleanup(); });

describe("PlayerAvatar", () => {
  it("zeigt die Initialen, solange kein Bild hinterlegt ist", () => {
    render(<PlayerAvatar organizationId={organizationId} player={{ ...player, avatarChecksum: null }} />);

    expect(screen.getByText("AM")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("traegt den Namen, wenn die Initialen allein stehen", () => {
    // Ein Screenreader liest im Textfluss den Knoteninhalt ("AM"), nicht
    // `title` — die Komponente muss also einen eigenen Accessible Name
    // setzen, so wie die Bild-Variante es ueber `alt` tut.
    render(<PlayerAvatar organizationId={organizationId} player={{ ...player, avatarChecksum: null }} />);

    expect(screen.getByText("AM").getAttribute("aria-label")).toBe("Alex Muster");
  });

  it("zeigt das Bild mit der Pruefsumme in der Adresse", () => {
    render(<PlayerAvatar organizationId={organizationId} player={{ ...player, avatarChecksum: "abc123" }} />);

    const image = screen.getByRole("img", { name: "Alex Muster" });
    expect(image.getAttribute("src")).toContain(`/organizations/${organizationId}/players/${player.id}/avatar?v=abc123`);
  });

  it("bleibt neben dem Namen dekorativ", () => {
    // Steht der Name daneben, liest eine Vorlesehilfe ihn sonst zweimal.
    render(<PlayerAvatar decorative organizationId={organizationId} player={{ ...player, avatarChecksum: "abc123" }} />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(document.querySelector("img")?.getAttribute("alt")).toBe("");
  });
});
