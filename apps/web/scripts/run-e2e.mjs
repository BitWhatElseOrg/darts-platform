import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Next.js regeneriert `next-env.d.ts` bei jedem Dev-Lauf und richtet die Imports
// darin auf das aktive `distDir` aus. Der E2E-Web-Server nutzt `.next-e2e`,
// wodurch die versionierte Datei nach dem Lauf verändert zurückbliebe. Der
// Rewrite passiert erst beim Herunterfahren des Web-Servers, also nach
// Playwrights `globalTeardown` — die Wiederherstellung muss deshalb ausserhalb
// des Playwright-Prozesses erfolgen.
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
