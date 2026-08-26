import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseConnection {
  readonly database: Database;
  check(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabaseConnection(databaseUrl: string): DatabaseConnection {
  const client = postgres(databaseUrl, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 10,
  });

  return {
    database: drizzle(client, { schema }),
    async check(): Promise<void> {
      await client`select 1`;
    },
    async close(): Promise<void> {
      await client.end({ timeout: 5 });
    },
  };
}
