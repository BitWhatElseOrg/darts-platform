import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["host.docker.internal"],
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
