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
    const organizationId = randomUUID();
    const matchId = randomUUID();
    try {
      await connection.database.execute(sql`
        insert into organizations (id, name, slug, timezone, locale)
        values (${organizationId}, 'Completion Check Club', ${`completion-check-${organizationId}`}, 'Europe/Zurich', 'de-CH')
      `);

      // Ein beendetes Match ohne Sieger und Abschlusszeitpunkt ist nicht zulaessig.
      const completedWithoutResult = await connection.database
        .execute(sql`
          insert into matches (id, organization_id, status, best_of_legs, starting_seat)
          values (${matchId}, ${organizationId}, 'COMPLETED', 1, 1)
        `)
        .then(() => null, (error: unknown) => (error as { readonly cause?: unknown }).cause);
      expect(completedWithoutResult).toMatchObject({ code: "23514", constraint_name: "matches_completion_check" });

      // Gegenprobe: mit Sieger und Abschlusszeitpunkt geht der gleiche Status durch.
      await expect(
        connection.database.execute(sql`
          insert into matches (id, organization_id, status, best_of_legs, starting_seat, winner_seat, completed_at)
          values (${matchId}, ${organizationId}, 'COMPLETED', 1, 1, 1, now())
        `),
      ).resolves.toBeDefined();

      // Zweite Ablehnung: ein laufendes Match darf nicht bereits Sieger und
      // Abschlusszeitpunkt tragen -- der Check bindet in beide Richtungen.
      const inProgressWithResult = await connection.database
        .execute(sql`
          insert into matches (organization_id, status, best_of_legs, starting_seat, winner_seat, completed_at)
          values (${organizationId}, 'IN_PROGRESS', 1, 1, 1, now())
        `)
        .then(() => null, (error: unknown) => (error as { readonly cause?: unknown }).cause);
      expect(inProgressWithResult).toMatchObject({ code: "23514", constraint_name: "matches_completion_check" });

      // Leg-Pendant: ein beendetes Leg ohne Gewinner ist nicht zulaessig.
      const legId = randomUUID();
      const completedLegWithoutWinner = await connection.database
        .execute(sql`
          insert into legs (id, organization_id, match_id, leg_number, starting_seat, status)
          values (${legId}, ${organizationId}, ${matchId}, 1, 1, 'COMPLETED')
        `)
        .then(() => null, (error: unknown) => (error as { readonly cause?: unknown }).cause);
      expect(completedLegWithoutWinner).toMatchObject({ code: "23514", constraint_name: "legs_completion_check" });

      // Gegenprobe: mit Gewinner geht das beendete Leg durch.
      await expect(
        connection.database.execute(sql`
          insert into legs (id, organization_id, match_id, leg_number, starting_seat, status, winner_seat)
          values (${legId}, ${organizationId}, ${matchId}, 1, 1, 'COMPLETED', 1)
        `),
      ).resolves.toBeDefined();
    } finally {
      await connection.database.execute(sql`delete from organizations where id = ${organizationId}`);
    }
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
    const organizationId = randomUUID();
    const matchId = randomUUID();
    const tournamentId = randomUUID();
    const teamHomeId = randomUUID();
    const teamAwayId = randomUUID();
    const competitionId = randomUUID();
    const encounterId = randomUUID();
    try {
      await connection.database.execute(sql`
        insert into organizations (id, name, slug, timezone, locale)
        values (${organizationId}, 'Command Uniqueness Club', ${`command-uniqueness-${organizationId}`}, 'Europe/Zurich', 'de-CH')
      `);

      // score_commands: je Match nur eine Zielversion.
      await connection.database.execute(sql`
        insert into matches (id, organization_id, status, best_of_legs, starting_seat)
        values (${matchId}, ${organizationId}, 'IN_PROGRESS', 1, 1)
      `);
      await connection.database.execute(sql`
        insert into score_commands (command_id, organization_id, match_id, type, payload, resulting_version)
        values (${randomUUID()}, ${organizationId}, ${matchId}, 'ABORT_MATCH', '{}', 1)
      `);
      const scoreCommandDuplicate = await connection.database
        .execute(sql`
          insert into score_commands (command_id, organization_id, match_id, type, payload, resulting_version)
          values (${randomUUID()}, ${organizationId}, ${matchId}, 'ABORT_MATCH', '{}', 1)
        `)
        .then(() => null, (error: unknown) => (error as { readonly cause?: unknown }).cause);
      expect(scoreCommandDuplicate).toMatchObject({
        code: "23505",
        constraint_name: "score_commands_match_version_unique",
      });

      // tournament_commands: je Turnier nur eine Zielversion.
      await connection.database.execute(sql`
        insert into tournaments (id, organization_id, name, format, group_count, qualify_per_group, knockout_size, seeding, starts_at)
        values (${tournamentId}, ${organizationId}, 'Command Uniqueness Open', 'SINGLE_ELIMINATION', 1, 1, 8, 'RANDOM', now())
      `);
      await connection.database.execute(sql`
        insert into tournament_commands (command_id, organization_id, tournament_id, type, payload, resulting_version)
        values (${randomUUID()}, ${organizationId}, ${tournamentId}, 'RELEASE_BOARD', '{}', 1)
      `);
      const tournamentCommandDuplicate = await connection.database
        .execute(sql`
          insert into tournament_commands (command_id, organization_id, tournament_id, type, payload, resulting_version)
          values (${randomUUID()}, ${organizationId}, ${tournamentId}, 'RELEASE_BOARD', '{}', 1)
        `)
        .then(() => null, (error: unknown) => (error as { readonly cause?: unknown }).cause);
      expect(tournamentCommandDuplicate).toMatchObject({
        code: "23505",
        constraint_name: "tournament_commands_tournament_version_unique",
      });

      // encounter_commands: je Begegnung nur eine Zielversion.
      await connection.database.execute(sql`
        insert into teams (id, organization_id, name)
        values (${teamHomeId}, ${organizationId}, 'Command Uniqueness Heim')
      `);
      await connection.database.execute(sql`
        insert into teams (id, organization_id, name)
        values (${teamAwayId}, ${organizationId}, 'Command Uniqueness Gast')
      `);
      await connection.database.execute(sql`
        insert into competitions (id, organization_id, type, name, slug, status)
        values (${competitionId}, ${organizationId}, 'LEAGUE', 'Command Uniqueness Liga', ${`command-uniqueness-liga-${organizationId}`}, 'ACTIVE')
      `);
      await connection.database.execute(sql`
        insert into encounters (id, organization_id, competition_id, matchday, home_team_id, away_team_id, scheduled_at)
        values (${encounterId}, ${organizationId}, ${competitionId}, 1, ${teamHomeId}, ${teamAwayId}, now())
      `);
      await connection.database.execute(sql`
        insert into encounter_commands (command_id, organization_id, encounter_id, type, payload, resulting_version)
        values (${randomUUID()}, ${organizationId}, ${encounterId}, 'START_ENCOUNTER', '{}', 1)
      `);
      const encounterCommandDuplicate = await connection.database
        .execute(sql`
          insert into encounter_commands (command_id, organization_id, encounter_id, type, payload, resulting_version)
          values (${randomUUID()}, ${organizationId}, ${encounterId}, 'START_ENCOUNTER', '{}', 1)
        `)
        .then(() => null, (error: unknown) => (error as { readonly cause?: unknown }).cause);
      expect(encounterCommandDuplicate).toMatchObject({
        code: "23505",
        constraint_name: "encounter_commands_encounter_version_unique",
      });

      // Ergaenzend: die drei Indexe existieren unter den erwarteten Namen.
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
    } finally {
      await connection.database.execute(sql`delete from organizations where id = ${organizationId}`);
    }
  });

  it("ordnet und findet unverarbeitete Outbox-Zeilen ueber eine eigene Sequenz", async () => {
    const organizationId = randomUUID();
    try {
      await connection.database.execute(sql`
        insert into organizations (id, name, slug, timezone, locale)
        values (${organizationId}, 'Outbox Sequence Club', ${`outbox-sequence-${organizationId}`}, 'Europe/Zurich', 'de-CH')
      `);

      // Zwei nacheinander eingefuegte Ereignisse erhalten eine echt steigende Sequenz.
      const [first] = await connection.database.execute<{ readonly sequence: string }>(sql`
        insert into outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload)
        values (${organizationId}, 'MATCH', ${randomUUID()}, 'MATCH_COMPLETED', '{}')
        returning sequence
      `);
      const [second] = await connection.database.execute<{ readonly sequence: string }>(sql`
        insert into outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload)
        values (${organizationId}, 'MATCH', ${randomUUID()}, 'MATCH_COMPLETED', '{}')
        returning sequence
      `);
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(Number(second?.sequence)).toBeGreaterThan(Number(first?.sequence));

      // Dieselbe Sequenz zweimal ist ausgeschlossen.
      const duplicateSequence = await connection.database
        .execute(sql`
          insert into outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload, sequence)
          values (${organizationId}, 'MATCH', ${randomUUID()}, 'MATCH_COMPLETED', '{}', ${first?.sequence})
        `)
        .then(() => null, (error: unknown) => (error as { readonly cause?: unknown }).cause);
      expect(duplicateSequence).toMatchObject({ code: "23505", constraint_name: "outbox_events_sequence_unique" });

      // Ergaenzend: die partiellen Poll-Indexe existieren unter den erwarteten Namen.
      const indexes = await connection.database.execute<{ readonly indexname: string }>(sql`
        select indexname from pg_indexes where tablename = 'outbox_events'
      `);
      const names = indexes.map((row) => row.indexname);
      expect(names).toContain("outbox_events_pending_publication_idx");
      expect(names).toContain("outbox_events_pending_statistics_idx");
    } finally {
      await connection.database.execute(sql`delete from organizations where id = ${organizationId}`);
    }
  });
});
