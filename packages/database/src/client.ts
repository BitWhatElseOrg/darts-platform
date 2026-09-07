import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

/** Eine offene Transaktion derselben Verbindung. */
export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

/**
 * Alles, worauf sich eine Anweisung absetzen laesst — die Verbindung selbst
 * oder eine offene Transaktion. Schreibvorgaenge, die wahlweise eigenstaendig
 * oder innerhalb einer laufenden Transaktion laufen, nehmen diesen Typ.
 */
export type DatabaseExecutor = Database | DatabaseTransaction;

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
