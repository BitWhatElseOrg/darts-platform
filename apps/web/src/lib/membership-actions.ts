import { hasOrganizationPermission, type OrganizationRole } from "@darts-platform/domain";
import type { OrganizationMember } from "@darts-platform/schemas";

/**
 * Was die Fläche für EINE Mitgliedschaftszeile anbieten darf, und warum
 * gegebenenfalls nichts. Die Regeln spiegeln den Server
 * (`organizations.service.ts`, `organizations.repository.ts`) — entschieden
 * wird dort, unter der Organisationssperre. Hier geht es allein darum, keine
 * Schaltfläche anzubieten, die ohnehin abgewiesen würde, und den Grund zu
 * benennen statt ihn zu verschweigen (AGENTS.md §13, §18).
 */
export interface MembershipRowActions {
  readonly canChangeRole: boolean;
  readonly canChangeStatus: boolean;
  /** Warum nichts geht — null, wenn etwas geht. */
  readonly blockedReason: string | null;
}

/**
 * Welche Rollen die handelnde Person vergeben darf. `OWNER` steht nur einem
 * aktiven OWNER offen: Eigentum überträgt nur Eigentum
 * (`owner-grant-requires-owner`).
 */
export function assignableRoles(actorRole: OrganizationRole): readonly OrganizationRole[] {
  const base: readonly OrganizationRole[] = [
    "ADMIN",
    "TOURNAMENT_DIRECTOR",
    "SCORER",
    "MEMBER",
    "VIEWER",
  ];
  return actorRole === "OWNER" ? ["OWNER", ...base] : base;
}

export function membershipRowActions(input: {
  readonly actorUserId: string;
  readonly actorRole: OrganizationRole;
  readonly member: OrganizationMember;
  /** Wie viele aktive OWNER die Organisation insgesamt hat. */
  readonly activeOwnerCount: number;
}): MembershipRowActions {
  const blocked = (blockedReason: string): MembershipRowActions => ({
    canChangeRole: false,
    canChangeStatus: false,
    blockedReason,
  });

  if (!hasOrganizationPermission(input.actorRole, "organization:manage_roles")) {
    return blocked("Für Rollen und Status fehlt dir die Berechtigung.");
  }
  // Die eigene Zeile bleibt aussen vor — das schliesst die Selbstaussperrung
  // vollständig aus (`SELF_MEMBERSHIP_CHANGE_FORBIDDEN`).
  if (input.member.userId === input.actorUserId) {
    return blocked("Die eigene Mitgliedschaft ändert eine andere Person.");
  }
  if (input.member.role === "OWNER" && input.actorRole !== "OWNER") {
    return blocked("Eine Inhaber-Mitgliedschaft ändert nur ein anderer Inhaber.");
  }
  if (input.member.role === "OWNER" && input.member.status === "ACTIVE" && input.activeOwnerCount <= 1) {
    return blocked("Der letzte aktive Inhaber bleibt bestehen.");
  }
  return { canChangeRole: true, canChangeStatus: true, blockedReason: null };
}

/** Zählt die aktiven Inhaber einer Mitgliederliste. */
export function activeOwnerCount(members: readonly OrganizationMember[]): number {
  return members.filter((member) => member.role === "OWNER" && member.status === "ACTIVE").length;
}
