import { createHash, randomBytes } from "node:crypto";

/** Macht den Schluessel in Logs und fuer Secret-Scanner erkennbar. */
export const BOARD_DEVICE_SECRET_PREFIX = "bd_";

/** 32 Zufallsbytes, base64url – wie der Anzeige-Schluessel (display-key-secret.ts). */
export function createBoardDeviceSecret(): string {
  return `${BOARD_DEVICE_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Kein Salt, keine Streckung: der Klartext ist bereits 256 Bit Zufall. */
export function hashBoardDeviceSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
