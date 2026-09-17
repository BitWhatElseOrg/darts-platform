import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.PLAYWRIGHT_PROD_WEB_PORT ?? 3_200);
const apiPort = Number(process.env.PLAYWRIGHT_PROD_API_PORT ?? 3_201);
const webOrigin = `http://localhost:${webPort}`;
const apiOrigin = `http://localhost:${apiPort}`;

/**
 * Eigenstaendige Konfiguration gegen den echten Produktivbuild statt
 * `next dev` (siehe `playwright.config.ts`). Deckt Luecken, die die
 * Haupt-E2E-Suite strukturell nicht abdecken kann: kein vorgerendertes
 * Statisches mehr (Task 4 aus `2026-09-08-csp-nonce.md`), `'strict-dynamic'`
 * bricht das Chunk-Nachladen bei clientseitiger Navigation nicht (Task 1
 * dieses Plans), und die komplette Suite laeuft zusaetzlich einmal gegen
 * `next build`/`next start` statt `next dev` (Spec C3). API und Web laufen
 * auf eigenen Ports (`PLAYWRIGHT_PROD_API_PORT`/`PLAYWRIGHT_PROD_WEB_PORT`),
 * damit ein gleichzeitiger Dev-E2E-Lauf nicht kollidiert.
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
 * durch ein vorangestelltes `NODE_ENV=production` umgeht. Der API-Server
 * uebernimmt `TRUST_PROXY_HOPS` nicht aus der Umgebung des Aufrufers: unter
 * `NODE_ENV=production` ist die Variable Pflicht (siehe API-Validierung),
 * und hier laeuft alles lokal ohne Proxy davor.
 */
export default defineConfig({
  testDir: "./tests",
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
  webServer: [
    {
      command: "pnpm --filter @darts-platform/api... build && node ../../scripts/start-api.mjs",
      url: `${apiOrigin}/api/v1/health`,
      env: {
        NODE_ENV: "production",
        TRUST_PROXY_HOPS: "0",
        // Die E2E-Suite legt ihre Mandanten ueber die Oberflaeche an; in
        // Production bleibt die Selbstbedienung aus (ADR 0012).
        ALLOW_SELF_SERVICE_ORGANIZATIONS: "true",
        API_PORT: String(apiPort),
        PORT: String(apiPort),
        BETTER_AUTH_URL: apiOrigin,
        WEB_ORIGIN: webOrigin,
        // Der Lauf kommt von einer einzigen Adresse und registriert mehrere
        // Konten; die Produktionsgrenzen wuerden ihn abwuergen (siehe
        // `playwright.config.ts`).
        RATE_LIMIT_MAX_PER_MINUTE: "100000",
        RATE_LIMIT_PUBLIC_MAX_PER_MINUTE: "100000",
        RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: "100000",
        RATE_LIMIT_SOCKET_MAX_PER_MINUTE: "100000",
      },
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      command: `pnpm --filter @darts-platform/web... build && npx next start --port ${webPort}`,
      url: webOrigin,
      env: {
        NODE_ENV: "production",
        NEXT_PUBLIC_API_URL: `${apiOrigin}/api/v1`,
        // Eigenes Verzeichnis, damit dieser Produktivbuild nicht denselben
        // `.next`-Ordner wie `pnpm build`/`next dev` (`.next-e2e`) trifft.
        NEXT_DIST_DIR: ".next-e2e-prod",
      },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
