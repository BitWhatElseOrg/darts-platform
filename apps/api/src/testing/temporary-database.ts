import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";

import {
  createDatabaseConnection,
  migrateDatabase,
  type DatabaseConnection,
} from "@darts-platform/database";

const TEMPORARY_DATABASE_NAME_PATTERN =
  /^dartbase_bootstrap_[a-f0-9]{32}$/u;
const migrationsFolder = fileURLToPath(
  new URL("../../../../packages/database/drizzle", import.meta.url),
);

export interface TemporaryDatabase {
  readonly databaseName: string;
  readonly connection: DatabaseConnection;
  cleanup(): Promise<void>;
}

function assertTemporaryDatabaseName(databaseName: string): void {
  if (!TEMPORARY_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error("Refusing to use an invalid temporary database name.");
  }
}

function databaseUrlWithPath(databaseUrl: string, pathname: string): string {
  const url = new URL(databaseUrl);
  url.pathname = pathname;
  return url.toString();
}

export async function createTemporaryDatabase(
  databaseUrl: string,
): Promise<TemporaryDatabase> {
  const databaseName = `dartbase_bootstrap_${randomBytes(16).toString("hex")}`;
  assertTemporaryDatabaseName(databaseName);

  const adminConnection = createDatabaseConnection(
    databaseUrlWithPath(databaseUrl, "/postgres"),
  );
  const isolatedUrl = databaseUrlWithPath(databaseUrl, `/${databaseName}`);
  let databaseCreated = false;
  let connection: DatabaseConnection | undefined;

  const dropDatabase = async (): Promise<void> => {
    assertTemporaryDatabaseName(databaseName);
    await adminConnection.database.execute(
      sql.raw(`drop database "${databaseName}" with (force)`),
    );
  };

  try {
    await adminConnection.database.execute(
      sql.raw(`create database "${databaseName}"`),
    );
    databaseCreated = true;
    await migrateDatabase(isolatedUrl, migrationsFolder);
    connection = createDatabaseConnection(isolatedUrl);
  } catch (error: unknown) {
    try {
      await connection?.close();
    } finally {
      try {
        if (databaseCreated) {
          await dropDatabase();
        }
      } finally {
        await adminConnection.close();
      }
    }
    throw error;
  }

  let cleanupPromise: Promise<void> | undefined;

  return {
    databaseName,
    connection,
    cleanup(): Promise<void> {
      cleanupPromise ??= (async () => {
        try {
          await connection.close();
        } finally {
          try {
            await dropDatabase();
          } finally {
            await adminConnection.close();
          }
        }
      })();
      return cleanupPromise;
    },
  };
}
