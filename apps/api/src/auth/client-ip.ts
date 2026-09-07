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
 * Stattdessen entscheidet die Hop-Zaehlung, die ohnehin schon getroffen ist:
 * `AuthController` setzt diesen Header auf `request.ip` (Fastify,
 * `TRUST_PROXY_HOPS`, siehe `common/trust-proxy.ts`) und ueberschreibt damit
 * jeden vom Client mitgeschickten Wert; `createAuth` liest ueber
 * `advanced.ipAddress.ipAddressHeaders` ausschliesslich diesen Header. Beide
 * Bremsen — die von Fastify und die von Better Auth — haengen damit an
 * derselben Adresse.
 */
export const CLIENT_IP_HEADER = "x-dartbase-client-ip";
