import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

import { pickRealIp } from "../common/client-address.js";

const RATE_LIMIT_WINDOW_MS = 60_000;
const UNKNOWN_ADDRESS = "unknown";

/**
 * Client-Adresse eines Handshakes. Socket.IO haengt am HTTP-Server und laeuft
 * damit nicht durch Fastify — `request.ip` und dessen `trustProxy`-Auswertung
 * stehen hier nicht zur Verfuegung, die Hop-Zaehlung muss also dieselbe
 * Entscheidung noch einmal treffen.
 *
 * Dieselbe Praeferenz wie `resolveClientAddress` (`common/client-address.ts`,
 * Plan 2026-09-17-go-live-testprogramm, Task 3, Befund D3-1): mit einem
 * vertrauten Hop zuerst ein gueltiges `X-Real-IP` (von Railway ueberschrieben,
 * `pickRealIp`), sonst die `X-Forwarded-For`-Kette nach der Semantik von
 * `resolveTrustProxyOption` — bei `hops = n` der n-te Eintrag vom Ende, bei
 * `hops = 1` also der, den der eigene Reverse Proxy selbst angehaengt hat.
 * Ohne vertrauten Hop zaehlt allein die direkte Verbindung; vom Client
 * mitgeschickte Header werden dann ignoriert.
 */
export function resolveHandshakeAddress(input: {
  readonly headers: IncomingHttpHeaders;
  readonly remoteAddress?: string | undefined;
  readonly trustProxyHops: number;
}): string {
  const direct = input.remoteAddress ?? UNKNOWN_ADDRESS;
  if (input.trustProxyHops <= 0) return direct;

  const realIp = pickRealIp(input.headers);
  if (realIp !== undefined) return realIp;

  const header = input.headers["x-forwarded-for"];
  const chain = (Array.isArray(header) ? header.join(",") : header ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const candidate = chain[chain.length - input.trustProxyHops];
  return candidate ?? direct;
}

export type HandshakeGate = (
  request: IncomingMessage,
  callback: (error: string | null | undefined, success: boolean) => void,
) => void;

interface Bucket {
  count: number;
  expiresAt: number;
}

/**
 * Bremse fuer den Socket.IO-Handshake, je Client-Adresse und Zeitfenster.
 *
 * Bewusste Grenze wie bei `common/rate-limit.ts`: der Zaehler liegt im
 * Prozessspeicher, greift hinter mehreren Instanzen also je Instanz. Fuer den
 * Handshake genuegt das — er kostet die Anwendung wenig, die Grenze soll nur
 * das Aufbauen tausender Verbindungen aus einer Quelle verhindern. Ein
 * Verbindungsaufbau, den diese Bremse abweist, kommt als HTTP 403 zurueck;
 * Socket.IO-Clients versuchen es danach mit ihrem eigenen Backoff erneut.
 *
 * Die Eimer werden beim Zugriff erneuert und einmal je Fenster vollstaendig
 * durchgesehen, damit die Karte nicht mit einmaligen Adressen volllaeuft.
 */
export function createHandshakeGate(options: {
  readonly max: number;
  readonly trustProxyHops: number;
  readonly windowMs?: number;
  readonly now?: () => number;
  readonly onRejected?: (address: string) => void;
}): HandshakeGate {
  const windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS;
  const now = options.now ?? ((): number => Date.now());
  const buckets = new Map<string, Bucket>();
  let nextPrune = now() + windowMs;

  return (request, callback) => {
    const currentTime = now();
    if (currentTime >= nextPrune) {
      for (const [address, bucket] of buckets) {
        if (bucket.expiresAt <= currentTime) buckets.delete(address);
      }
      nextPrune = currentTime + windowMs;
    }

    const address = resolveHandshakeAddress({
      headers: request.headers,
      remoteAddress: request.socket?.remoteAddress,
      trustProxyHops: options.trustProxyHops,
    });
    const bucket = buckets.get(address);
    if (bucket === undefined || bucket.expiresAt <= currentTime) {
      buckets.set(address, { count: 1, expiresAt: currentTime + windowMs });
      callback(null, true);
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      options.onRejected?.(address);
      callback("Too many connection attempts.", false);
      return;
    }
    callback(null, true);
  };
}
