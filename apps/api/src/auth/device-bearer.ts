import type { IncomingHttpHeaders } from "node:http";

import { BOARD_DEVICE_SECRET_PREFIX } from "@darts-platform/domain/board-device-secret";

const BEARER = /^bearer\s+(\S+)$/iu;

/**
 * Nur `Bearer bd_…` ist ein Geraeteschluessel. Jeder andere Authorization-
 * Header wird ignoriert: die Plattform kennt sonst keine Bearer-Anmeldung.
 */
export function readDeviceBearer(headers: IncomingHttpHeaders): string | null {
  const header = headers.authorization;
  if (typeof header !== "string") return null;
  const token = BEARER.exec(header.trim())?.[1];
  return token !== undefined && token.startsWith(BOARD_DEVICE_SECRET_PREFIX) ? token : null;
}
