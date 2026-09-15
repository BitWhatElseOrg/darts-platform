import { describe, expect, it } from "vitest";
import type { OrganizationMember } from "@darts-platform/schemas";

import { activeOwnerCount, assignableRoles, membershipRowActions } from "./membership-actions";

const member = (overrides: Partial<OrganizationMember> = {}): OrganizationMember => ({
  userId: "member-1",
  email: "member@example.test",
  displayName: "Mitglied",
  role: "MEMBER",
  status: "ACTIVE",
  player: null,
  ...overrides,
});

describe("assignableRoles", () => {
  it("bietet einem Inhaber die Eigentumsuebertragung an", () => {
    expect(assignableRoles("OWNER")).toContain("OWNER");
  });

  it("verschweigt sie allen anderen", () => {
    expect(assignableRoles("ADMIN")).not.toContain("OWNER");
    expect(assignableRoles("ADMIN")).toContain("TOURNAMENT_DIRECTOR");
  });
});

describe("membershipRowActions", () => {
  const base = { actorUserId: "actor", actorRole: "OWNER" as const, activeOwnerCount: 2 };

  it("laesst eine gewoehnliche Zeile aendern", () => {
    expect(membershipRowActions({ ...base, member: member() })).toEqual({
      canChangeRole: true,
      canChangeStatus: true,
      blockedReason: null,
    });
  });

  it("sperrt die eigene Zeile mit Begruendung", () => {
    const actions = membershipRowActions({ ...base, member: member({ userId: "actor" }) });
    expect(actions.canChangeRole).toBe(false);
    expect(actions.blockedReason).toBe("Die eigene Mitgliedschaft ändert eine andere Person.");
  });

  it("sperrt eine Inhaberzeile fuer eine Administration", () => {
    const actions = membershipRowActions({
      ...base,
      actorRole: "ADMIN",
      member: member({ userId: "owner-2", role: "OWNER" }),
    });
    expect(actions.canChangeStatus).toBe(false);
    expect(actions.blockedReason).toBe("Eine Inhaber-Mitgliedschaft ändert nur ein anderer Inhaber.");
  });

  it("schuetzt den letzten aktiven Inhaber", () => {
    const actions = membershipRowActions({
      ...base,
      activeOwnerCount: 1,
      member: member({ userId: "owner-2", role: "OWNER" }),
    });
    expect(actions.canChangeRole).toBe(false);
    expect(actions.blockedReason).toBe("Der letzte aktive Inhaber bleibt bestehen.");
  });

  it("laesst einen gesperrten Inhaber trotz einzigem Inhaber-Eintrag aendern", () => {
    // Er zaehlt nicht als aktiver Inhaber; ihn zu reaktivieren nimmt niemandem
    // etwas weg.
    const actions = membershipRowActions({
      ...base,
      activeOwnerCount: 1,
      member: member({ userId: "owner-2", role: "OWNER", status: "SUSPENDED" }),
    });
    expect(actions.canChangeStatus).toBe(true);
  });

  it("sperrt alles ohne Rollenberechtigung", () => {
    const actions = membershipRowActions({ ...base, actorRole: "SCORER", member: member() });
    expect(actions).toMatchObject({ canChangeRole: false, canChangeStatus: false });
    expect(actions.blockedReason).toBe("Für Rollen und Status fehlt dir die Berechtigung.");
  });
});

describe("activeOwnerCount", () => {
  it("zaehlt nur aktive Inhaber", () => {
    expect(activeOwnerCount([
      member({ userId: "a", role: "OWNER" }),
      member({ userId: "b", role: "OWNER", status: "SUSPENDED" }),
      member({ userId: "c", role: "ADMIN" }),
    ])).toBe(1);
  });
});
