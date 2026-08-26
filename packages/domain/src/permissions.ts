import type { OrganizationRole } from "./membership";

export const organizationPermissions = [
  "organization:read",
  "organization:update",
  "organization:manage_members",
  "organization:manage_roles",
  "player:read",
  "player:create",
  "player:update",
  "player:archive",
  "board:read",
  "board:manage",
  "match:read",
  "match:create",
  "match:score",
  "match:undo",
  "tournament:read",
  "tournament:create",
  "tournament:update",
  "board:assign",
] as const;

export type OrganizationPermission =
  (typeof organizationPermissions)[number];

const allPermissions = new Set<OrganizationPermission>(organizationPermissions);

const rolePermissions = {
  OWNER: allPermissions,
  ADMIN: new Set<OrganizationPermission>(organizationPermissions),
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
    "tournament:read",
    "tournament:create",
    "tournament:update",
    "board:assign",
  ]),
  SCORER: new Set<OrganizationPermission>([
    "organization:read",
    "player:read",
    "board:read",
    "match:read",
    "match:score",
    "match:undo",
    "tournament:read",
  ]),
  MEMBER: new Set<OrganizationPermission>([
    "organization:read",
    "player:read",
    "board:read",
    "match:read",
    "tournament:read",
  ]),
  VIEWER: new Set<OrganizationPermission>([
    "organization:read",
    "player:read",
    "board:read",
    "match:read",
    "tournament:read",
  ]),
} as const satisfies Record<OrganizationRole, ReadonlySet<OrganizationPermission>>;

export function hasOrganizationPermission(
  role: OrganizationRole,
  permission: OrganizationPermission,
): boolean {
  return rolePermissions[role].has(permission);
}
