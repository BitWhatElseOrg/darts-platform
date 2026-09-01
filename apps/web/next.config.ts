import type { NextConfig } from "next";

const configuredWebOrigin = process.env.WEB_ORIGIN;
const configuredWebHostname =
  configuredWebOrigin === undefined
    ? undefined
    : new URL(configuredWebOrigin).hostname;

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: [
    "host.docker.internal",
    ...(configuredWebHostname === undefined ? [] : [configuredWebHostname]),
  ],
  experimental: {
    useTypeScriptCli: false,
  },
  reactStrictMode: true,
  transpilePackages: [
    "@darts-platform/config",
    "@darts-platform/schemas",
    "@darts-platform/ui",
  ],
};

export default nextConfig;
