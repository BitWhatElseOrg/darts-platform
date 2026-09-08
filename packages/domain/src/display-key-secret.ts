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
