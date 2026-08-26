import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const databaseDirectory = fileURLToPath(
  new URL("../packages/database/", import.meta.url),
);
const apiDirectory = fileURLToPath(new URL("../apps/api/", import.meta.url));

function log(level, event, details = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "api-deployment",
      event,
      ...details,
    })}\n`,
  );
}

function runMigration() {
  return new Promise((resolve, reject) => {
    const migration = spawn(process.execPath, ["dist/migrate.js"], {
      cwd: databaseDirectory,
      stdio: "inherit",
    });

    migration.once("error", reject);
    migration.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Database migration failed with ${signal === null ? `exit code ${String(code)}` : `signal ${signal}`}.`,
        ),
      );
    });
  });
}

async function start() {
  await runMigration();

  const api = spawn(process.execPath, ["dist/main.js"], {
    cwd: apiDirectory,
    env: process.env,
    stdio: "inherit",
  });
  let shuttingDown = false;

  const forwardSignal = (signal) => {
    shuttingDown = true;
    log("log", "shutdown_signal_received", { signal });
    api.kill(signal);
  };

  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));

  api.once("error", (error) => {
    log("error", "api_process_failed", { message: error.message });
    process.exitCode = 1;
  });
  api.once("exit", (code, signal) => {
    log("log", "api_process_exited", { code, signal });
    process.exitCode = code ?? (shuttingDown ? 0 : 1);
  });
}

start().catch((error) => {
  log("error", "deployment_start_failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
