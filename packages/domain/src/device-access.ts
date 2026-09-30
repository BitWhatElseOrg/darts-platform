import type { OrganizationPermission } from "./permissions";

/**
 * Was ein Scheiben-Tablet darf (Spec 2026-09-30-scheiben-tablet, Abschnitt 3).
 * Bewusst ein fester Katalog und keine Rolle: ein Geraet ist kein Mitglied,
 * und ein neues Recht soll nicht still mitwandern, nur weil es einer Rolle
 * hinzugefuegt wird. Kein `match:abort` – wie bei der Rolle SCORER bleibt
 * der Abbruch bei der Leitung.
 */
export const devicePermissions = [
  "match:read",
  "match:score",
  "match:undo",
  "statistics:read",
] as const satisfies readonly OrganizationPermission[];

export type DevicePermission = (typeof devicePermissions)[number];

const devicePermissionSet: ReadonlySet<OrganizationPermission> = new Set(devicePermissions);

export function isDevicePermission(permission: OrganizationPermission): permission is DevicePermission {
  return devicePermissionSet.has(permission);
}

export type DeviceMatchAction = "read" | "write";
export type DeviceMatchAccess = "ALLOWED" | "BOARD_MISMATCH" | "MATCH_NOT_ACTIVE";

/**
 * Bindung eines Geraets an das Match seiner Scheibe. `write` umfasst Wurf,
 * Undo, Leg-Entscheid und Controller-Lease und gilt nur im laufenden Match:
 * ein Undo nach Match-Ende liesse einen Liga-Slot auf COMPLETED stehen und
 * waere am offenen Tablet ohne Zeitgrenze moeglich. Korrekturen nach
 * Match-Ende bleiben bei der Leitung (Spec 2026-09-30-scheiben-tablet).
 */
export function decideDeviceMatchAccess(input: {
  readonly action: DeviceMatchAction;
  readonly deviceBoardId: string;
  readonly matchBoardId: string | null;
  readonly matchStatus: string;
}): DeviceMatchAccess {
  if (input.matchBoardId === null || input.matchBoardId !== input.deviceBoardId) return "BOARD_MISMATCH";
  switch (input.action) {
    case "read":
      return "ALLOWED";
    case "write":
      return input.matchStatus === "IN_PROGRESS" ? "ALLOWED" : "MATCH_NOT_ACTIVE";
    default: {
      const exhaustive: never = input.action;
      return exhaustive;
    }
  }
}
