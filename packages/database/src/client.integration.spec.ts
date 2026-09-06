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
      // `matches_completion_check` (Migration 0023) verlangt fuer COMPLETED
      // zusaetzlich Sieger und Abschlusszeitpunkt.
      await expect(
        connection.database.execute(sql`
          insert into matches (organization_id, board_id, status, best_of_legs, starting_seat, winner_seat, completed_at)
          values (${organizationId}, ${boardId}, 'COMPLETED', 1, 1, 1, now())
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

  it("bindet Sieger und Abschlusszeitpunkt eines Matches an seinen Status", async () => {
    const definitions = await connection.database.execute<{ readonly constraint_name: string; readonly definition: string }>(sql`
      select conname as constraint_name, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname in ('matches_completion_check', 'legs_completion_check')
      order by conname
    `);
    const byName = new Map(definitions.map((row) => [row.constraint_name, row.definition.toLowerCase()]));

    expect(byName.get("matches_completion_check")).toContain("completed_at");
    expect(byName.get("legs_completion_check")).toContain("winner_seat");
  });

  it("laesst keine Aufnahme zu, deren Rechnung nicht aufgeht", async () => {
    const organizationId = randomUUID();
    const matchId = randomUUID();
    const legId = randomUUID();
    const playerId = randomUUID();
    try {
      await connection.database.execute(sql`
        insert into organizations (id, name, slug, timezone, locale)
        values (${organizationId}, 'Visit Arithmetic Club', ${`visit-arithmetic-${organizationId}`}, 'Europe/Zurich', 'de-CH')
      `);
      await connection.database.execute(sql`
        insert into players (id, organization_id, display_name, status)
        values (${playerId}, ${organizationId}, 'Fiona Frei', 'ACTIVE')
      `);
      await connection.database.execute(sql`
        insert into matches (id, organization_id, status, best_of_legs, starting_seat)
        values (${matchId}, ${organizationId}, 'IN_PROGRESS', 1, 1)
      `);
      await connection.database.execute(sql`
        insert into legs (id, organization_id, match_id, leg_number, starting_seat)
        values (${legId}, ${organizationId}, ${matchId}, 1, 1)
      `);

      // Die Kernrechnung des Scorings: 501 - 100 ist 401, nicht 400.
      const wrongArithmetic = await connection.database
        .execute(sql`
          insert into visits (organization_id, match_id, leg_id, thrower_player_id, seat, command_id, sequence, points, applied_points, darts_thrown, score_before, score_after, outcome)
          values (${organizationId}, ${matchId}, ${legId}, ${playerId}, 1, ${randomUUID()}, 1, 100, 100, 3, 501, 400, 'SCORED')
        `)
        .then(() => null, (error: unknown) => (error as { readonly cause?: unknown }).cause);
      expect(wrongArithmetic).toMatchObject({ code: "23514", constraint_name: "visits_scored_arithmetic_check" });

      // Ein Bust laesst den Rest stehen und rechnet nichts an.
      const wrongBust = await connection.database
        .execute(sql`
          insert into visits (organization_id, match_id, leg_id, thrower_player_id, seat, command_id, sequence, points, applied_points, darts_thrown, score_before, score_after, outcome)
          values (${organizationId}, ${matchId}, ${legId}, ${playerId}, 1, ${randomUUID()}, 2, 60, 60, 3, 40, 40, 'BUST')
        `)
        .then(() => null, (error: unknown) => (error as { readonly cause?: unknown }).cause);
      expect(wrongBust).toMatchObject({ code: "23514", constraint_name: "visits_bust_arithmetic_check" });

      // Ein gewonnenes Leg endet auf null.
      const wrongWin = await connection.database
        .execute(sql`
          insert into visits (organization_id, match_id, leg_id, thrower_player_id, seat, command_id, sequence, points, applied_points, darts_thrown, score_before, score_after, outcome)
          values (${organizationId}, ${matchId}, ${legId}, ${playerId}, 1, ${randomUUID()}, 3, 40, 30, 3, 40, 10, 'LEG_WON')
        `)
        .then(() => null, (error: unknown) => (error as { readonly cause?: unknown }).cause);
      expect(wrongWin).toMatchObject({ code: "23514", constraint_name: "visits_won_arithmetic_check" });

      // Die richtige Rechnung geht weiterhin durch.
      await expect(
        connection.database.execute(sql`
          insert into visits (organization_id, match_id, leg_id, thrower_player_id, seat, command_id, sequence, points, applied_points, darts_thrown, score_before, score_after, outcome)
          values (${organizationId}, ${matchId}, ${legId}, ${playerId}, 1, ${randomUUID()}, 4, 100, 100, 3, 501, 401, 'SCORED')
        `),
      ).resolves.toBeDefined();
    } finally {
      await connection.database.execute(sql`delete from organizations where id = ${organizationId}`);
    }
  });

  it("laesst je Aggregat nur ein Kommando pro Zielversion zu", async () => {
    const indexes = await connection.database.execute<{ readonly indexname: string }>(sql`
      select indexname from pg_indexes
      where indexname in (
        'score_commands_match_version_unique',
        'tournament_commands_tournament_version_unique',
        'encounter_commands_encounter_version_unique'
      )
    `);
    expect(indexes.map((row) => row.indexname).sort()).toEqual([
      "encounter_commands_encounter_version_unique",
      "score_commands_match_version_unique",
      "tournament_commands_tournament_version_unique",
    ]);
  });

  it("ordnet und findet unverarbeitete Outbox-Zeilen ueber eine eigene Sequenz", async () => {
    const indexes = await connection.database.execute<{ readonly indexname: string }>(sql`
      select indexname from pg_indexes where tablename = 'outbox_events'
    `);
    const names = indexes.map((row) => row.indexname);
    expect(names).toContain("outbox_events_pending_publication_idx");
    expect(names).toContain("outbox_events_pending_statistics_idx");

    const [first] = await connection.database.execute<{ readonly sequence: string }>(sql`
      select sequence from outbox_events order by sequence desc limit 1
    `);
    expect(first === undefined || Number(first.sequence) > 0).toBe(true);
  });
});
