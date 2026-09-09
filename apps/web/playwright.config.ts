import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 3_100);
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 3_101);
const webOrigin = `http://localhost:${webPort}`;
const apiOrigin = `http://localhost:${apiPort}`;

export default defineConfig({
  testDir: "./tests",
  // Prueft speziell den Produktivbuild (kein 'unsafe-eval') und laeuft
  // eigenstaendig ueber `playwright.prod.config.ts` / `test:e2e:prod`; gegen
  // `next dev` waeren 4 von 5 Faellen falsch rot, weil der Entwicklungsmodus
  // 'unsafe-eval' legitim erlaubt.
  testIgnore: /production-csp\.spec\.ts/u,
  fullyParallel: true,
  // Beide Server laufen im Entwicklungsmodus; `next dev` übersetzt jede Route
  // beim ersten Aufruf und ist dabei ein einzelner Prozess. Sobald zwei lange
  // Fälle gleichzeitig Seiten anfordern, wartet einer von beiden in der
  // Übersetzungswarteschlange, bis sein Zeitbudget reisst — mal beim
  // Board-Lease, mal beim Laden einer Kaderliste. Ein Worker kostet rund eine
  // Minute Laufzeit und nimmt der Aussage des Laufs die Zufälligkeit.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Im CI zusaetzlich der HTML-Bericht: die Annotationen des
  // `github`-Reporters stehen in der Job-Zusammenfassung, aber ein
  // sporadisch roter Lauf laesst sich erst mit Bericht und Trace aufklaeren
  // (`.github/workflows/ci.yml` hebt beides als Artefakt auf). `open: never`,
  // damit der Lauf nicht auf einen Browser wartet, den es dort nicht gibt.
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : "list",
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
        // Die E2E-Suite legt ihre Mandanten ueber die Oberflaeche an; in
        // Production bleibt die Selbstbedienung aus (ADR 0012).
        ALLOW_SELF_SERVICE_ORGANIZATIONS: "true",
        API_PORT: String(apiPort),
        BETTER_AUTH_URL: apiOrigin,
        PORT: String(apiPort),
        // Der Lauf kommt von einer einzigen Adresse und registriert mehrere
        // Konten; die Produktionsgrenzen wuerden ihn abwuergen.
        RATE_LIMIT_MAX_PER_MINUTE: "100000",
        RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: "100000",
        RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: "100000",
        // Der Entwicklungsserver baut den Socket bei jedem Neuladen neu auf;
        // die Handshake-Bremse soll den Lauf nicht treffen.
        RATE_LIMIT_SOCKET_MAX_PER_MINUTE: "100000",
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
