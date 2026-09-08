import { createHash, randomBytes } from "node:crypto";

/**
 * Klartext eines Anzeige-Schluessels: 32 zufaellige Bytes, base64url — also
 * dieselbe Groessenordnung wie ein Sitzungstoken. Er steht in einer Adresse,
 * die auf einem Bildschirm im Vereinslokal geoeffnet wird; kurz und merkbar
 * waere hier das falsche Ziel.
 */
export function createDisplayKeySecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Gespeichert wird nur dieser Hash. Kein Salt und keine Schluesselstreckung:
 * der Klartext ist bereits 256 Bit Zufall, gegen den ein Woerterbuch nichts
 * ausrichtet — anders als bei einem Passwort, das ein Mensch sich ausdenkt.
 */
export function hashDisplayKeySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

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
