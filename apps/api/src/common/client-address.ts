import { isIP } from "node:net";
import type { IncomingHttpHeaders } from "node:http";
import type { FastifyRequest } from "fastify";

/**
 * Rohe Adress-Header, die die Anwendung protokolliert und fuer die
 * Client-Adresse auswertet — siehe `pickRealIp`/`resolveClientAddress`
 * unten und `api-logging.interceptor.ts`.
 */
export const RAW_ADDRESS_HEADERS = ["x-real-ip", "x-forwarded-for"] as const;

/**
 * Liest `X-Real-IP` aus rohen Headern und validiert den Wert als IP-Adresse
 * (`node:net.isIP`), bevor er verwendet wird — `undefined`, wenn der Header
 * fehlt oder keine gueltige Adresse enthaelt. `audit_events.ip` ist Postgres
 * `inet` (`packages/database/src/schema.ts`): eine ungueltige Zeichenkette
 * wuerde die auditierte Mutation mit einem 500 abbrechen statt nur eine
 * falsche Adresse zu speichern.
 *
 * Railway schickt genau einen Wert. Kommt der Header trotzdem als Array
 * (mehrfach gesetzt) oder als eine bereits zusammengefuehrte, kommagetrennte
 * Zeichenkette an, gilt nur der erste Eintrag — anders als bei
 * `X-Forwarded-For` bedeutet hier kein weiterer Eintrag einen zusaetzlichen
 * vertrauten Hop, ein zweiter Wert waere schlicht ein doppelt gesetzter
 * Header.
 *
 * Gemeinsam genutzt von `resolveClientAddress` (Fastify-Anfragen) und
 * `resolveHandshakeAddress` (Socket.IO-Handshake, `realtime/handshake-guard.ts`):
 * beide sitzen hinter demselben Railway-Proxy und muessen deshalb denselben
 * Header gleich behandeln.
 */
export function pickRealIp(headers: IncomingHttpHeaders): string | undefined {
  const raw = headers["x-real-ip"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;

  const candidate = value.split(",")[0]?.trim() ?? "";
  return isIP(candidate) !== 0 ? candidate : undefined;
}

/**
 * Railway setzt `X-Real-IP` auf die Adresse des Clients
 * (docs.railway.com/networking/public-networking/specs-and-limits) und
 * ueberschreibt einen vom Client mitgeschickten Wert. Belegt gegen Staging
 * am 18.09.2026 (`LOG_CLIENT_ADDRESS=true`, 12 Anfragen von einer Maschine
 * mit fester, oeffentlicher Adresse, sechs davon mit gefaelschtem
 * `X-Real-IP: 198.51.100.7` und `X-Forwarded-For: 198.51.100.8`):
 * `x-real-ip` war in allen 12 Anfragen die eigene oeffentliche Adresse (in
 * allen 12 Anfragen identisch) — die gefaelschte Adresse kam nie durch.
 * `request.ip` (Fastify, `TRUST_PROXY_HOPS=1`, aus `X-Forwarded-For`) war
 * dagegen `212.102.36.193` oder `212.102.36.194` — zwei abwechselnde
 * Railway-Proxy-Adressen statt der Client-Adresse (Befund D3-1: zwei
 * Rate-Limit-Eimer fuer einen einzigen Client). Railways eigene interne
 * Probe schickt weder `x-real-ip` noch `x-forwarded-for` (beide `null`) —
 * deshalb bleibt der Rueckfall auf `request.ip` bestehen.
 *
 * Verworfene Alternative: `TRUST_PROXY_HOPS` auf 2 setzen und weiterhin
 * `X-Forwarded-For` lesen. Die Kettenlaenge ist kein von Railway
 * zugesichertes Verhalten (heute zwei Eintraege, ohne Vorwarnung vielleicht
 * mehr), die interne Probe schickt gar keine Kette, und `X-Real-IP` ist
 * Railways dokumentierter Vertrag fuer genau diesen Zweck — `X-Forwarded-For`
 * ist es dort nicht.
 *
 * Ohne vertrauten Hop (`TRUST_PROXY_HOPS=0`, lokal ohne Proxy davor) gilt
 * der Header nicht: ein direkt verbundener Client koennte ihn sonst selbst
 * setzen und einen fremden Rate-Limit-Eimer treffen. Ein vom Client
 * mitgeschickter, aber ungueltiger Wert (z. B. `"nicht-eine-adresse"`) faellt
 * ueber `pickRealIp` ebenfalls auf `request.ip` zurueck statt eine kaputte
 * Zeichenkette in ein Postgres-`inet`-Feld zu schreiben.
 */
export function resolveClientAddress(
  request: FastifyRequest,
  trustProxyHops: number,
): string {
  if (trustProxyHops > 0) {
    return pickRealIp(request.headers) ?? request.ip;
  }

  return request.ip;
}
