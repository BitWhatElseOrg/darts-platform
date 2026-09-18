/**
 * Header, in dem die Anwendung Better Auth die Client-Adresse mitteilt.
 *
 * Better Auth loest die Adresse sonst selbst aus `X-Forwarded-For` auf und
 * verwirft dabei jede mehrteilige Kette, solange keine vertrauten Proxys als
 * CIDR-Liste konfiguriert sind (`getIPFromHeader` in `@better-auth/core`):
 * alle betroffenen Anfragen zaehlen dann gemeinsam im Eimer
 * `no-trusted-ip`, und ein Client kann durch einen eigenen
 * `X-Forwarded-For`-Eintrag genau dorthin ausweichen. Railways Edge-Adressen
 * sind nicht als stabile CIDR-Liste bekannt, taugen also nicht als
 * `trustedProxies`.
 *
 * Stattdessen entscheidet dieselbe Ermittlung, die auch Rate-Limit und Audit
 * verwenden: `AuthController` setzt diesen Header auf
 * `resolveClientAddress(request, TRUST_PROXY_HOPS)` (`common/client-address.ts`)
 * und ueberschreibt damit jeden vom Client mitgeschickten Wert. Hinter einem
 * vertrauten Hop (`TRUST_PROXY_HOPS > 0`) ist das `X-Real-IP` — von Railway
 * ueberschrieben, siehe dort und Befund D3-1 (Plan
 * 2026-09-17-go-live-testprogramm, Task 3) — sonst `request.ip` (Fastify,
 * siehe `common/trust-proxy.ts`). `createAuth` liest ueber
 * `advanced.ipAddress.ipAddressHeaders` ausschliesslich diesen Header. Alle
 * drei Bremsen — Fastify-Rate-Limit, Audit und Better Auth — haengen damit an
 * derselben Adresse.
 */
export const CLIENT_IP_HEADER = "x-dartbase-client-ip";
