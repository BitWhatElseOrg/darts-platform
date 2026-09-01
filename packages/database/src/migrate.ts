import { pathToFileURL } from "node:url";

import { logMigration, migrateDatabase } from "./migration-runner.js";

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;

  if (value === undefined || value.length === 0) {
    throw new Error(
      "DATABASE_URL is required. Copy .env.example to .env before running migrations.",
    );
  }

  return value;
}

async function runMigrations(): Promise<void> {
  logMigration("log", "database_migration_started");
  await migrateDatabase(requireDatabaseUrl());
  logMigration("log", "database_migration_completed");
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  runMigrations().catch((error: unknown) => {
    logMigration("error", "database_migration_failed", {
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack !== undefined
        ? { stack: error.stack }
        : {}),
    });
    process.exitCode = 1;
  });
}
