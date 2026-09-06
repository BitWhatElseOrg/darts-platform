import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

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

  it("guards every dart of a visit with database constraints", async () => {
    const definitions = await connection.database.execute<{ readonly constraint_name: string; readonly definition: string }>(sql`
      select conname as constraint_name, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'visit_darts'::regclass
      order by conname
    `);
    const byName = new Map(definitions.map((row) => [row.constraint_name, row.definition.toLowerCase()]));

    expect(byName.get("visit_darts_index_check")).toContain("dart_index");
    expect(byName.get("visit_darts_segment_check")).toContain("25");
    expect(byName.get("visit_darts_bull_check")).toContain("multiplier");
    expect(byName.get("visit_darts_value_check")).toContain("segment");
  });

  it("lets only one running match hold a physical board", async () => {
    const organizationId = randomUUID();
    const boardId = randomUUID();
    try {
      await connection.database.execute(sql`
        insert into organizations (id, name, slug, timezone, locale)
        values (${organizationId}, 'Board Constraint Club', ${`board-constraint-${organizationId}`}, 'Europe/Zurich', 'de-CH')
      `);
      await connection.database.execute(sql`
        insert into boards (id, organization_id, name, status)
        values (${boardId}, ${organizationId}, 'Scheibe 3', 'IN_USE')
      `);
      await connection.database.execute(sql`
        insert into matches (organization_id, board_id, status, best_of_legs, starting_seat)
        values (${organizationId}, ${boardId}, 'IN_PROGRESS', 1, 1)
      `);

      // Turnier und Liga schreiben in getrennte Tabellen; erst hier greift die
      // Klammer, die zwei laufende Matches auf einer Scheibe ausschliesst.
      // Drizzle verpackt den Treiberfehler; die Kennung steht erst in `cause`.
      const conflict = await connection.database
        .execute(sql`
          insert into matches (organization_id, board_id, status, best_of_legs, starting_seat)
          values (${organizationId}, ${boardId}, 'IN_PROGRESS', 1, 1)
        `)
        .then(
          () => null,
          (error: unknown) => (error as { readonly cause?: unknown }).cause,
        );
      expect(conflict).toMatchObject({
        code: "23505",
        constraint_name: "matches_board_in_progress_unique",
      });

      // Beendete Matches bleiben erlaubt — der Index ist bewusst partiell.
      await expect(
        connection.database.execute(sql`
          insert into matches (organization_id, board_id, status, best_of_legs, starting_seat)
          values (${organizationId}, ${boardId}, 'COMPLETED', 1, 1)
        `),
      ).resolves.toBeDefined();
    } finally {
      await connection.database.execute(sql`delete from organizations where id = ${organizationId}`);
    }
  });

  it("indexes visits by thrower so frequent scores do not scan the table", async () => {
    const indexes = await connection.database.execute<{ readonly indexname: string }>(sql`
      select indexname from pg_indexes where tablename = 'visits'
    `);
    expect(indexes.map((row) => row.indexname)).toContain("visits_organization_thrower_idx");
  });
});
