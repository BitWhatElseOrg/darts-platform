import type { NextConfig } from "next";

const configuredWebOrigin = process.env.WEB_ORIGIN;
const configuredWebHostname =
  configuredWebOrigin === undefined
    ? undefined
    : new URL(configuredWebOrigin).hostname;

// Content-Security-Policy und Reporting-Endpoints werden pro Request in
// `src/proxy.ts` gesetzt (Nonce), nicht hier: `headers()` greift nur statisch
// je Pfad, nicht je Anfrage.
const securityHeaders = [
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
