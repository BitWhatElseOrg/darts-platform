import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Next.js regeneriert `next-env.d.ts` sowohl bei `next dev` als auch bei
// `next build` (siehe `verifyAndRunTypeScript` in
// `node_modules/next/dist/lib/verify-typescript-setup.js`) und richtet die
// Imports darin auf das aktive `distDir` aus. Die E2E-Web-Server nutzen
// `.next-e2e` (`playwright.config.ts`) bzw. `.next-e2e-prod`
// (`playwright.prod.config.ts`), wodurch die versionierte Datei nach dem
// Lauf veraendert zurueckbliebe. Der Rewrite passiert erst beim
// Herunterfahren des Web-Servers, also nach Playwrights `globalTeardown` —
// die Wiederherstellung muss deshalb ausserhalb des Playwright-Prozesses
// erfolgen. Dieses Skript wird deshalb von beiden `test:e2e*`-Skripten in
// `package.json` verwendet, nicht nur vom Dev-Lauf.
const webDirectory = fileURLToPath(new URL("../", import.meta.url));
const nextEnvPath = fileURLToPath(new URL("../next-env.d.ts", import.meta.url));

function runPlaywright() {
  return new Promise((resolve, reject) => {
    const playwright = spawn("playwright", ["test", ...process.argv.slice(2)], {
      cwd: webDirectory,
      env: process.env,
      stdio: "inherit",
    });

    playwright.once("error", reject);
    playwright.once("exit", (code, signal) => {
      resolve(signal === null ? (code ?? 1) : 1);
    });
  });
}

async function restoreNextEnv(original) {
  const current = await readFile(nextEnvPath, "utf8");

  if (current !== original) {
    await writeFile(nextEnvPath, original);
  }
}

const original = await readFile(nextEnvPath, "utf8");
const exitCode = await runPlaywright();

await restoreNextEnv(original);

process.exitCode = exitCode;
