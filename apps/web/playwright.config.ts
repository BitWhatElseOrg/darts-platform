import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 3_100);
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 3_101);
const webOrigin = `http://localhost:${webPort}`;
const apiOrigin = `http://localhost:${apiPort}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: webOrigin,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @darts-platform/api dev",
      url: `http://localhost:${apiPort}/api/v1/health`,
      env: {
        API_PORT: String(apiPort),
        BETTER_AUTH_URL: apiOrigin,
        PORT: String(apiPort),
        WEB_ORIGIN: webOrigin,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @darts-platform/web dev",
      url: webOrigin,
      env: {
        NEXT_DIST_DIR: ".next-e2e",
        NEXT_PUBLIC_API_URL: `${apiOrigin}/api/v1`,
        WEB_PORT: String(webPort),
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
