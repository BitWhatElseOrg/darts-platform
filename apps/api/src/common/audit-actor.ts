import { isDevicePrincipal, type Principal } from "../auth/auth.types.js";

/** Spalten des handelnden Akteurs fuer `audit_events` (genau einer ist gesetzt). */
export function auditActor(principal: Principal): { readonly actorUserId: string | null; readonly actorDeviceId: string | null } {
  return isDevicePrincipal(principal)
    ? { actorUserId: null, actorDeviceId: principal.device.id }
    : { actorUserId: principal.user.id, actorDeviceId: null };
}

/** Spalten des Halters einer Controller-Lease. */
export function leaseActor(principal: Principal): { readonly userId: string | null; readonly deviceId: string | null } {
  return isDevicePrincipal(principal)
    ? { userId: null, deviceId: principal.device.id }
    : { userId: principal.user.id, deviceId: null };
}
