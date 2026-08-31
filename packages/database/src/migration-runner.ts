import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export function logMigration(
  level: "log" | "warn" | "error",
  event: string,
  details: Readonly<Record<string, unknown>> = {},
): void {
  if (process.env.NODE_ENV === "production") {
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

export async function migrateDatabase(
  databaseUrl: string,
  migrationsFolder = "./drizzle",
): Promise<void> {
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
    await migrate(drizzle(migrationClient), {
      migrationsFolder,
    });
  } finally {
    await migrationClient.end({ timeout: 5 });
  }
}
