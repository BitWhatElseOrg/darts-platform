import type { OrganizationRole } from "./membership";

export const organizationPermissions = [
  "organization:read",
  "organization:update",
  "organization:manage_members",
  "organization:manage_roles",
  "organization:delete",
  "player:read",
  "player:create",
  "player:update",
  "player:archive",
  "player:delete",
  "board:read",
  "board:manage",
  "match:read",
  "match:create",
  "match:score",
  "match:undo",
  "match:abort",
  "tournament:read",
  "tournament:create",
  "tournament:update",
  "tournament:share",
  "tournament:delete",
  "statistics:read",
  "board:assign",
  "team:read",
  "team:manage",
  "competition:read",
  "competition:manage",
  "encounter:read",
  "encounter:manage",
  "encounter:lineup",
] as const;

export type OrganizationPermission =
  (typeof organizationPermissions)[number];

const allPermissions = new Set<OrganizationPermission>(organizationPermissions);

const rolePermissions = {
  OWNER: allPermissions,
  // Die Organisation zu loeschen bleibt der Inhaberschaft vorbehalten
  // (Spec 2026-09-24-bearbeiten-loeschen): ADMIN erhaelt sonst jede
  // Permission, diese eine nicht.
  ADMIN: new Set<OrganizationPermission>(
    organizationPermissions.filter((permission) => permission !== "organization:delete"),
  ),
  TOURNAMENT_DIRECTOR: new Set<OrganizationPermission>([
    "organization:read",
    "player:read",
    "player:create",
    "player:update",
    "board:read",
    "board:manage",
    "match:read",
    "match:create",
    "match:score",
    "match:undo",
    "match:abort",
    "tournament:read",
    "tournament:create",
    "tournament:update",
    "tournament:share",
    // Wer Turniere anlegt, darf ein versehentlich angelegtes entfernen;
    // geloescht wird nur, was keine Ergebnisse hat (Spec 2026-09-25).
    "tournament:delete",
    "statistics:read",
    "board:assign",
    "team:read",
    "team:manage",
    "competition:read",
    "competition:manage",
    "encounter:read",
    "encounter:manage",
    "encounter:lineup",
  ]),
  SCORER: new Set<OrganizationPermission>([
    "organization:read",
    "player:read",
    "board:read",
    "match:read",
    "match:score",
    "match:undo",
    "tournament:read",
    "statistics:read",
    "team:read",
    "competition:read",
    "encounter:read",
    "encounter:lineup",
  ]),
  MEMBER: new Set<OrganizationPermission>([
    "organization:read",
    "player:read",
    "board:read",
    "match:read",
    "tournament:read",
    "statistics:read",
    "team:read",
    "competition:read",
    "encounter:read",
  ]),
  VIEWER: new Set<OrganizationPermission>([
    "organization:read",
    "player:read",
    "board:read",
    "match:read",
    "tournament:read",
    "statistics:read",
    "team:read",
    "competition:read",
    "encounter:read",
  ]),
} as const satisfies Record<OrganizationRole, ReadonlySet<OrganizationPermission>>;

export function hasOrganizationPermission(
  role: OrganizationRole,
  permission: OrganizationPermission,
): boolean {
  return rolePermissions[role].has(permission);
}
