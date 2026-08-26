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
  ]),
  SCORER: new Set<OrganizationPermission>([
    "organization:read",
    "player:read",
  ]),
  MEMBER: new Set<OrganizationPermission>([
    "organization:read",
    "player:read",
  ]),
  VIEWER: new Set<OrganizationPermission>([
    "organization:read",
    "player:read",
  ]),
} as const satisfies Record<OrganizationRole, ReadonlySet<OrganizationPermission>>;

export function hasOrganizationPermission(
  role: OrganizationRole,
  permission: OrganizationPermission,
): boolean {
  return rolePermissions[role].has(permission);
}
