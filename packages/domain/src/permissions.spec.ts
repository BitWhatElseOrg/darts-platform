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
  });

  it("keeps viewer access read-only", () => {
    expect(hasOrganizationPermission("VIEWER", "player:read")).toBe(true);
    expect(hasOrganizationPermission("VIEWER", "player:update")).toBe(false);
  });
});
