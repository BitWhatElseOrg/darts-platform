export const organizationRoles = [
  "OWNER",
  "ADMIN",
  "TOURNAMENT_DIRECTOR",
  "SCORER",
  "MEMBER",
  "VIEWER",
] as const;

export type OrganizationRole = (typeof organizationRoles)[number];

export function isOrganizationRole(value: string): value is OrganizationRole {
  return organizationRoles.some((role) => role === value);
}

export const membershipStatuses = ["INVITED", "ACTIVE", "SUSPENDED"] as const;

export type MembershipStatus = (typeof membershipStatuses)[number];

export const playerStatuses = ["ACTIVE", "INACTIVE"] as const;

export type PlayerStatus = (typeof playerStatuses)[number];
