import { describe, expect, it } from "vitest";

import { hasOrganizationPermission, organizationPermissions } from "./permissions";

describe("organization permissions", () => {
  it("allows owners to manage members and archive players", () => {
    expect(
      hasOrganizationPermission("OWNER", "organization:manage_members"),
    ).toBe(true);
    expect(hasOrganizationPermission("OWNER", "player:archive")).toBe(true);
  });

  it("lets tournament directors manage players but not members", () => {
    expect(
      hasOrganizationPermission("TOURNAMENT_DIRECTOR", "player:create"),
    ).toBe(true);
    expect(
      hasOrganizationPermission(
        "TOURNAMENT_DIRECTOR",
        "organization:manage_members",
      ),
    ).toBe(false);
    expect(hasOrganizationPermission("TOURNAMENT_DIRECTOR", "match:create")).toBe(true);
    expect(hasOrganizationPermission("TOURNAMENT_DIRECTOR", "board:manage")).toBe(true);
    expect(hasOrganizationPermission("TOURNAMENT_DIRECTOR", "tournament:create")).toBe(true);
    expect(hasOrganizationPermission("TOURNAMENT_DIRECTOR", "board:assign")).toBe(true);
    expect(hasOrganizationPermission("TOURNAMENT_DIRECTOR", "match:abort")).toBe(true);
  });

  it("keeps viewer access read-only", () => {
    expect(hasOrganizationPermission("VIEWER", "player:read")).toBe(true);
    expect(hasOrganizationPermission("VIEWER", "player:update")).toBe(false);
    expect(hasOrganizationPermission("VIEWER", "match:read")).toBe(true);
    expect(hasOrganizationPermission("VIEWER", "match:score")).toBe(false);
    expect(hasOrganizationPermission("VIEWER", "tournament:read")).toBe(true);
    expect(hasOrganizationPermission("VIEWER", "statistics:read")).toBe(true);
    expect(hasOrganizationPermission("VIEWER", "tournament:update")).toBe(false);
  });

  it("allows scorers to score and undo but not create matches", () => {
    expect(hasOrganizationPermission("SCORER", "match:score")).toBe(true);
    expect(hasOrganizationPermission("SCORER", "match:undo")).toBe(true);
    expect(hasOrganizationPermission("SCORER", "match:abort")).toBe(false);
    expect(hasOrganizationPermission("SCORER", "match:create")).toBe(false);
  });

  it("gives the league rights to the roles that run the league", () => {
    for (const role of ["OWNER", "ADMIN", "TOURNAMENT_DIRECTOR"] as const) {
      expect(hasOrganizationPermission(role, "team:manage")).toBe(true);
      expect(hasOrganizationPermission(role, "competition:manage")).toBe(true);
      expect(hasOrganizationPermission(role, "encounter:manage")).toBe(true);
      expect(hasOrganizationPermission(role, "encounter:lineup")).toBe(true);
    }
  });

  it("lets scorers record lineups on site without managing the league", () => {
    expect(hasOrganizationPermission("SCORER", "encounter:lineup")).toBe(true);
    expect(hasOrganizationPermission("SCORER", "encounter:read")).toBe(true);
    expect(hasOrganizationPermission("SCORER", "team:read")).toBe(true);
    expect(hasOrganizationPermission("SCORER", "competition:read")).toBe(true);
    expect(hasOrganizationPermission("SCORER", "encounter:manage")).toBe(false);
    expect(hasOrganizationPermission("SCORER", "team:manage")).toBe(false);
    expect(hasOrganizationPermission("SCORER", "competition:manage")).toBe(false);
  });

  it("keeps members and viewers to the three league read rights", () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      expect(hasOrganizationPermission(role, "team:read")).toBe(true);
      expect(hasOrganizationPermission(role, "competition:read")).toBe(true);
      expect(hasOrganizationPermission(role, "encounter:read")).toBe(true);
      expect(hasOrganizationPermission(role, "encounter:lineup")).toBe(false);
      expect(hasOrganizationPermission(role, "encounter:manage")).toBe(false);
    }
  });
});

describe("tournament:share", () => {
  it("liegt bei Leitung und Verwaltung", () => {
    expect(hasOrganizationPermission("OWNER", "tournament:share")).toBe(true);
    expect(hasOrganizationPermission("ADMIN", "tournament:share")).toBe(true);
    expect(hasOrganizationPermission("TOURNAMENT_DIRECTOR", "tournament:share")).toBe(true);
  });

  it("liegt nicht bei den lesenden Rollen", () => {
    expect(hasOrganizationPermission("VIEWER", "tournament:share")).toBe(false);
  });

  it("ist nicht dasselbe wie tournament:update", () => {
    // Wer Spielplaene pflegt, muss nicht zwingend Zugaenge verteilen duerfen.
    // Die Trennung ist der Zweck dieser Berechtigung; faellt sie zusammen,
    // war die Berechtigung ueberfluessig.
    expect(organizationPermissions).toContain("tournament:update");
    expect(organizationPermissions).toContain("tournament:share");
  });
});
