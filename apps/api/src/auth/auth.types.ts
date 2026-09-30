export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface AuthenticatedSession {
  readonly id: string;
  readonly expiresAt: Date;
}

export interface AuthContext {
  readonly user: AuthenticatedUser;
  readonly session: AuthenticatedSession;
}

export interface AuthenticatedDevice {
  readonly id: string;
  readonly organizationId: string;
  readonly boardId: string;
}

/** Ein Scheiben-Tablet (Spec 2026-09-30-scheiben-tablet). */
export interface DeviceAuthContext {
  readonly device: AuthenticatedDevice;
}

/**
 * Wer eine Anfrage stellt. `AuthContext` bleibt der Benutzer-Kontext: alle
 * bestehenden Handler und Tests arbeiten weiter damit. Nur Handler mit
 * `@AllowDevice()` nehmen `Principal` entgegen.
 */
export type Principal = AuthContext | DeviceAuthContext;

export function isDevicePrincipal(principal: Principal): principal is DeviceAuthContext {
  return "device" in principal;
}

declare module "fastify" {
  interface FastifyRequest {
    authContext?: AuthContext;
    deviceContext?: DeviceAuthContext;
  }
}
