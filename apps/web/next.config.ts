import type { NextConfig } from "next";

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
const websocketOrigin = apiOrigin.replace(/^http/u, "ws");

/**
 * Erste Stufe: nur berichten, nicht erzwingen. `script-src` erlaubt vorerst
 * `'unsafe-inline'`, weil Next.js seinen Bootstrap inline ausliefert und eine
 * Nonce eine eigene Middleware auf jeder Anfrage voraussetzen wuerde. Alle
 * uebrigen Direktiven sind bereits scharf gestellt und liefern damit ab
 * sofort brauchbare Verstoss-Meldungen.
 *
 * Umstellungskriterium (M5): Report-Only bleibt bestehen, bis entweder ein
 * Report-Endpunkt existiert, der die Verstoss-Meldungen tatsaechlich
 * entgegennimmt, oder zwei Wochen Betrieb ohne Konsolen-Verletzungen auf den
 * Hauptseiten dokumentiert sind. Danach erfolgt die Umstellung auf
 * erzwingend in einem eigenen PR, nicht stillschweigend hier.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // QR-Codes der Board-Ansicht sind `data:`-URLs.
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin} ${websocketOrigin}`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
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
