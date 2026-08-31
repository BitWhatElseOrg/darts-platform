import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { createDatabaseConnection } from "./client.js";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    "DATABASE_URL is required for the database integration test. Start the local infrastructure and run tests from the workspace root.",
  );
}

const connection = createDatabaseConnection(databaseUrl);

afterAll(async () => {
  await connection.close();
});

describe("database connection", () => {
  it("executes a query against PostgreSQL", async () => {
    await expect(connection.check()).resolves.toBeUndefined();
  });

  it("rejects null disruption provenance for terminal tournament states", async () => {
    const definitions = await connection.database.execute<{ readonly constraint_name: string; readonly definition: string }>(sql`
      select conname as constraint_name, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname in (
        'tournament_matches_result_type_consistency',
        'tournament_participants_withdrawal_check'
      )
      order by conname
    `);
    const byName = new Map(definitions.map((row) => [row.constraint_name, row.definition.toLowerCase()]));

    expect(byName.get("tournament_matches_result_type_consistency")).toContain("result_type is not null");
    expect(byName.get("tournament_participants_withdrawal_check")).toContain("withdrawal_reason is not null");
  });

  it("allows owner role for stored bootstrap invitations", async () => {
    const definitions = await connection.database.execute<{
      readonly constraint_name: string;
      readonly definition: string;
    }>(sql`
      select conname as constraint_name, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname = 'organization_invitations_role_check'
    `);

    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.definition).toContain("OWNER");
  });
});
