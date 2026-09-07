import type { NextConfig } from "next";

import { buildContentSecurityPolicy } from "./src/lib/content-security-policy";

const configuredWebOrigin = process.env.WEB_ORIGIN;
const configuredWebHostname =
  configuredWebOrigin === undefined
    ? undefined
    : new URL(configuredWebOrigin).hostname;

// Die Seite spricht ausser mit sich selbst nur mit der API — per HTTP und per
// WebSocket. Beide Ziele stammen aus derselben konfigurierten URL, damit die
// Policy in Development, Preview und Production automatisch stimmt.
const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL;
const apiOrigin =
  configuredApiUrl === undefined
    ? "http://localhost:3001"
    : new URL(configuredApiUrl).origin;
// Ziel der Verstoss-Meldungen. Es liegt auf der API, nicht auf der Seite
// selbst: Next.js hat keinen Ort fuer einen Endpunkt, der aus der Policy
// heraus angesprochen wird, und die API traegt bereits Rate-Limiting,
// strukturiertes Logging und die einheitliche Fehlerform.
const cspReportUri = `${apiOrigin}/api/v1/csp-reports`;

/**
 * Zweite Stufe: erzwingend. Report-Only hat seine Aufgabe erfuellt.
 *
 * Umstellungskriterium war (M5), dass echte Meldungen zeigen, dass nichts
 * Notwendiges blockiert wuerde. Der Beleg kam nicht aus dem Betrieb — dort
 * besucht niemand planmaessig alle Seiten — sondern aus der E2E-Suite: die
 * Wache in `tests/fixtures.ts` horcht auf `securitypolicyviolation` und
 * meldete am 2026-09-07 ueber alle 15 Faelle hinweg ausschliesslich
 * `script-src → eval` aus dem Uebersetzer von `next dev`. Keine einzige
 * Meldung zu `img-src`, `connect-src`, `style-src`, `font-src` oder
 * `default-src`. Die Wache bleibt stehen und haelt den Beleg aufrecht.
 *
 * `'unsafe-eval'` traegt deshalb nur der Entwicklungsserver
 * (`content-security-policy.ts`), der Produktionsbuild kennt es nicht.
 * `'unsafe-inline'` bleibt in beiden: Next.js liefert seinen Bootstrap
 * inline aus.
 *
 * Gemeldet wird weiter — `report-uri` und `report-to` gelten auch unter der
 * erzwungenen Richtlinie. Was jetzt auffaellt, ist etwas, das ein Browser
 * tatsaechlich blockiert hat.
 */
const contentSecurityPolicy = buildContentSecurityPolicy({
  apiOrigin,
  reportUri: cspReportUri,
  allowEval: process.env.NODE_ENV !== "production",
});

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Benennt, wohin `report-to csp-endpoint` zeigt. Ohne diesen Header ist die
  // Direktive wirkungslos, und nur `report-uri` traegt noch.
  { key: "Reporting-Endpoints", value: `csp-endpoint="${cspReportUri}"` },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: [
    "host.docker.internal",
    ...(configuredWebHostname === undefined ? [] : [configuredWebHostname]),
  ],
  experimental: {
    useTypeScriptCli: false,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  reactStrictMode: true,
  transpilePackages: [
    "@darts-platform/config",
    "@darts-platform/schemas",
    "@darts-platform/ui",
  ],
};

export default nextConfig;
