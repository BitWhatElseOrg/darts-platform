import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.WEB_PORT ?? 3_000);
const apiPort = Number(process.env.API_PORT ?? 3_001);
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
        BETTER_AUTH_URL: apiOrigin,
        WEB_ORIGIN: webOrigin,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @darts-platform/web dev",
      url: webOrigin,
      env: {
        NEXT_PUBLIC_API_URL: `${apiOrigin}/api/v1`,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
