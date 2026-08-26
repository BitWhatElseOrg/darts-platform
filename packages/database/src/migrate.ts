import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;

  if (value === undefined || value.length === 0) {
    throw new Error(
      "DATABASE_URL is required. Copy .env.example to .env before running migrations.",
    );
  }

  return value;
}

const databaseUrl = requireDatabaseUrl();
const structuredLogging = process.env.NODE_ENV === "production";

function logMigration(
  level: "log" | "warn" | "error",
  event: string,
  details: Readonly<Record<string, unknown>> = {},
): void {
  if (structuredLogging) {
    const output = level === "error" ? process.stderr : process.stdout;
    output.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: "database-migration",
        event,
        ...details,
      })}\n`,
    );
    return;
  }

  if (level === "error") {
    console.error(event, details);
  } else if (level === "warn") {
    console.warn(event, details);
  } else {
    console.info(event);
  }
}

async function runMigrations(): Promise<void> {
  const migrationClient = postgres(databaseUrl, {
    max: 1,
    onnotice: (notice) => {
      logMigration("warn", "database_notice", {
        code: notice.code,
        message: notice.message,
        severity: notice.severity,
      });
    },
  });

  try {
    logMigration("log", "database_migration_started");
    await migrate(drizzle(migrationClient), {
      migrationsFolder: "./drizzle",
    });
    logMigration("log", "database_migration_completed");
  } finally {
    await migrationClient.end({ timeout: 5 });
  }
}

runMigrations().catch((error: unknown) => {
  logMigration("error", "database_migration_failed", {
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && error.stack !== undefined
      ? { stack: error.stack }
      : {}),
  });
  process.exitCode = 1;
});
