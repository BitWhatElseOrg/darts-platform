import { describe, expect, it } from "vitest";

import { hasOrganizationPermission } from "./permissions";

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
});
