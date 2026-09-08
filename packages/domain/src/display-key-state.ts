export type DisplayKeyState = "valid" | "expired" | "revoked";

/**
 * Der Widerruf schlaegt den Ablauf: ein zurueckgezogener Schluessel bleibt
 * zurueckgezogen, auch wenn seine Frist noch laeuft. Der Ablaufmoment selbst
 * zaehlt als abgelaufen — bei einer Frist ist die Grenze das Ende, nicht der
 * letzte gueltige Augenblick.
 */
export function decideDisplayKeyState(input: {
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly now: Date;
}): DisplayKeyState {
  if (input.revokedAt !== null) return "revoked";
  if (input.expiresAt.getTime() <= input.now.getTime()) return "expired";
  return "valid";
}
