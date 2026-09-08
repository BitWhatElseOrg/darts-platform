import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.PLAYWRIGHT_PROD_WEB_PORT ?? 3_200);
const webOrigin = `http://localhost:${webPort}`;

/**
 * Eigenstaendige Konfiguration gegen den echten Produktivbuild statt
 * `next dev` (siehe `playwright.config.ts`). Deckt zwei Luecken, die die
 * Haupt-E2E-Suite strukturell nicht abdecken kann: kein vorgerendertes
 * Statisches mehr (Task 4 aus `2026-09-08-csp-nonce.md`) und `'strict-dynamic'`
 * bricht das Chunk-Nachladen bei clientseitiger Navigation nicht (Task 1
 * dieses Plans). Braucht keinen API-Server -- die geprüften Seiten
 * (Startseite, `/offline`, `/liga/begegnungen`, `/live/begegnungen`) rufen
 * keine authentifizierten Daten ab.
 *
 * `NODE_ENV=production` ist hier explizit gesetzt und nicht optional: das
 * Wurzel-`.env` traegt `NODE_ENV=development` (fuer `next dev`), und Next.js
 * uebernimmt einen bereits gesetzten `NODE_ENV` unveraendert (siehe
 * `node_modules/next/dist/bin/next:84`, `process.env.NODE_ENV =
 * process.env.NODE_ENV || defaultEnv`). Ohne diese Ueberschreibung bricht
 * `next build` reproduzierbar beim Prerender von `/_global-error` ab
 * (`TypeError: Cannot read properties of null (reading 'useContext')`,
 * verifiziert beim Schreiben dieser Config) -- derselbe Bestandsdefekt, den
 * das Wurzelskript `pnpm build` fuer den normalen Produktivbuild bereits
 * durch ein vorangestelltes `NODE_ENV=production` umgeht.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: /production-csp\.spec\.ts/u,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: {
    baseURL: webOrigin,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm --filter @darts-platform/web... build && npx next start --port ${webPort}`,
    url: webOrigin,
    env: {
      NODE_ENV: "production",
      // Ohne diese explizite Vorgabe wirft `next start` bei jedem Request
      // `EnvironmentValidationError` (Variable fehlt), der Server wird nie
      // gesund, und Playwright scheitert nach 180s mit einer Fehlermeldung,
      // die nicht auf die eigentliche Ursache zeigt. Gleiches Muster wie in
      // `playwright.config.ts`; der Wert selbst ist hier beliebig, da die
      // geprueften Seiten keine authentifizierten Daten abrufen.
      NEXT_PUBLIC_API_URL:
        process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1",
    },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
