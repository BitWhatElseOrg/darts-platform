import type { FastifyRequest } from "fastify";

/**
 * Rohe Adress-Header, die die Anwendung protokolliert und fuer die
 * Client-Adresse auswertet — siehe `RAW_ADDRESS_HEADERS` unten und
 * `api-logging.interceptor.ts`.
 */
export const RAW_ADDRESS_HEADERS = ["x-real-ip", "x-forwarded-for"] as const;

/**
 * Railway setzt `X-Real-IP` auf die Adresse des Clients
 * (docs.railway.com/networking/public-networking/specs-and-limits) und
 * ueberschreibt einen vom Client mitgeschickten Wert. Belegt gegen Staging
 * am 18.09.2026 (`LOG_CLIENT_ADDRESS=true`, 12 Anfragen von einer Maschine
 * mit oeffentlicher Adresse 92.105.157.75, sechs davon mit gefaelschtem
 * `X-Real-IP: 198.51.100.7` und `X-Forwarded-For: 198.51.100.8`):
 * `x-real-ip` war in allen 12 Anfragen 92.105.157.75 — die gefaelschte
 * Adresse kam nie durch. `request.ip` (Fastify, `TRUST_PROXY_HOPS=1`, aus
 * `X-Forwarded-For`) war dagegen `212.102.36.193` oder `212.102.36.194` —
 * zwei abwechselnde Railway-Proxy-Adressen statt der Client-Adresse
 * (Befund D3-1: zwei Rate-Limit-Eimer fuer einen einzigen Client). Railways
 * eigene interne Probe schickt weder `x-real-ip` noch `x-forwarded-for`
 * (beide `null`) — deshalb bleibt der Rueckfall auf `request.ip` bestehen.
 *
 * Ohne vertrauten Hop (`TRUST_PROXY_HOPS=0`, lokal ohne Proxy davor) gilt
 * der Header nicht: ein direkt verbundener Client koennte ihn sonst selbst
 * setzen und einen fremden Rate-Limit-Eimer treffen.
 */
export function resolveClientAddress(
  request: FastifyRequest,
  trustProxyHops: number,
): string {
  if (trustProxyHops > 0) {
    const realIp = request.headers["x-real-ip"];
    const value = Array.isArray(realIp) ? realIp[0] : realIp;
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return request.ip;
}
