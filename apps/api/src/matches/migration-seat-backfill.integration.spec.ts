import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  createDatabaseConnection,
  migrateDatabase,
  type DatabaseConnection,
} from "@darts-platform/database";

const environment = parseApplicationEnvironment(process.env);
const migrationsFolder = fileURLToPath(
  new URL("../../../../packages/database/drizzle", import.meta.url),
);

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

function databaseUrlWithPath(databaseUrl: string, pathname: string): string {
  const url = new URL(databaseUrl);
  url.pathname = pathname;
  return url.toString();
}

/**
 * Kopiert den Migrationsordner und kürzt das Journal nach `tag`, damit ein
 * Schema auf genau diesem Stand aufgebaut werden kann.
 */
async function folderUpTo(tag: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dartbase-migrations-"));
  await cp(migrationsFolder, directory, { recursive: true });
  const journalPath = join(directory, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    readonly entries: readonly JournalEntry[];
  } & Record<string, unknown>;
  const cutoff = journal.entries.findIndex((entry) => entry.tag === tag);
  expect(cutoff).toBeGreaterThanOrEqual(0);
  await writeFile(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, cutoff + 1) }, null, 2),
  );
  return directory;
}

const organizationId = randomUUID();
const playerOneId = randomUUID();
const playerTwoId = randomUUID();
const matchId = randomUUID();
const legId = randomUUID();

let connection: DatabaseConnection;
let databaseName: string;
let legacyFolder: string | undefined;

describe("seat model migration", () => {
  beforeAll(async () => {
    const adminUrl = databaseUrlWithPath(environment.DATABASE_URL, "/postgres");
    const admin = createDatabaseConnection(adminUrl);
    databaseName = `dartbase_seat_${randomUUID().replaceAll("-", "")}`;
    await admin.database.execute(sql.raw(`create database "${databaseName}"`));
    await admin.close();
    const url = databaseUrlWithPath(environment.DATABASE_URL, `/${databaseName}`);

    legacyFolder = await folderUpTo("0013_youthful_gideon");
    await migrateDatabase(url, legacyFolder);
    connection = createDatabaseConnection(url);

    await connection.database.execute(sql`
      insert into organizations (id, name, slug, timezone, locale)
      values (${organizationId}, 'Seat Backfill', ${`seat-${organizationId}`}, 'Europe/Zurich', 'de-CH')`);
    await connection.database.execute(sql`
      insert into players (id, organization_id, display_name, status)
      values (${playerOneId}, ${organizationId}, 'Alpha', 'ACTIVE'),
             (${playerTwoId}, ${organizationId}, 'Beta', 'ACTIVE')`);
    await connection.database.execute(sql`
      insert into matches (id, organization_id, status, best_of_legs, starting_player_id,
                           current_player_id, winner_player_id, completed_at)
      values (${matchId}, ${organizationId}, 'COMPLETED', 1, ${playerOneId},
              null, ${playerOneId}, now())`);
    await connection.database.execute(sql`
      insert into match_participants (organization_id, match_id, player_id, seat, legs_won)
      values (${organizationId}, ${matchId}, ${playerOneId}, 1, 1),
             (${organizationId}, ${matchId}, ${playerTwoId}, 2, 0)`);
    await connection.database.execute(sql`
      insert into legs (id, organization_id, match_id, leg_number, starting_player_id,
                        winner_player_id, status, completed_at)
      values (${legId}, ${organizationId}, ${matchId}, 1, ${playerOneId},
              ${playerOneId}, 'COMPLETED', now())`);
    for (const [sequence, playerId, points] of [
      [1, playerOneId, 100],
      [2, playerTwoId, 60],
      [3, playerOneId, 140],
      [4, playerTwoId, 45],
    ] as const) {
      await connection.database.execute(sql`
        insert into visits (organization_id, match_id, leg_id, player_id, command_id, sequence,
                            points, applied_points, darts_thrown, score_before, score_after, outcome)
        values (${organizationId}, ${matchId}, ${legId}, ${playerId}, ${randomUUID()}, ${sequence},
                ${points}, ${points}, 3, 501, ${501 - points}, 'SCORED')`);
    }

    await connection.close();
    await migrateDatabase(url, migrationsFolder);
    connection = createDatabaseConnection(url);
  }, 120_000);

  afterAll(async () => {
    await connection.close();
    const admin = createDatabaseConnection(
      databaseUrlWithPath(environment.DATABASE_URL, "/postgres"),
    );
    await admin.database.execute(sql.raw(`drop database "${databaseName}" with (force)`));
    await admin.close();
    if (legacyFolder !== undefined) await rm(legacyFolder, { recursive: true, force: true });
  });

  it("keeps existing singles matches intact across the seat backfill", async () => {
    const matchRows = (await connection.database.execute(
      sql`select starting_seat, current_seat, winner_seat from matches where id = ${matchId}`,
    )) as unknown as readonly {
      readonly starting_seat: number;
      readonly current_seat: number | null;
      readonly winner_seat: number | null;
    }[];
    expect(matchRows[0]?.starting_seat).toBe(1);
    expect(matchRows[0]?.current_seat).toBeNull();
    expect(matchRows[0]?.winner_seat).toBe(1);

    const legRows = (await connection.database.execute(
      sql`select starting_seat, winner_seat from legs where id = ${legId}`,
    )) as unknown as readonly {
      readonly starting_seat: number;
      readonly winner_seat: number | null;
    }[];
    expect(legRows[0]?.starting_seat).toBe(1);
    expect(legRows[0]?.winner_seat).toBe(1);

    const participants = (await connection.database.execute(
      sql`select mpp.player_id, mpp.position, mp.seat
          from match_participant_players mpp
          join match_participants mp on mp.id = mpp.participant_id
          where mpp.match_id = ${matchId} order by mp.seat`,
    )) as unknown as readonly {
      readonly player_id: string;
      readonly position: number;
      readonly seat: number;
    }[];
    expect(participants).toHaveLength(2);
    expect(participants[0]?.position).toBe(1);
    expect(participants[0]?.player_id).toBe(playerOneId);
    expect(participants[1]?.player_id).toBe(playerTwoId);

    const visitSeats = (await connection.database.execute(
      sql`select seat from visits where match_id = ${matchId} order by sequence`,
    )) as unknown as readonly { readonly seat: number }[];
    expect(visitSeats.map((row) => row.seat)).toEqual([1, 2, 1, 2]);
  });
  it("drops the legacy player columns and renames the visit thrower", async () => {
    const columns = (await connection.database.execute(
      sql`select table_name, column_name from information_schema.columns
          where table_name in ('matches', 'legs', 'visits', 'match_participants')`,
    )) as unknown as readonly {
      readonly table_name: string;
      readonly column_name: string;
    }[];
    const names = columns.map((row) => `${row.table_name}.${row.column_name}`);
    expect(names).toContain("visits.thrower_player_id");
    expect(names).not.toContain("visits.player_id");
    expect(names).not.toContain("matches.starting_player_id");
    expect(names).not.toContain("matches.current_player_id");
    expect(names).not.toContain("matches.winner_player_id");
    expect(names).not.toContain("legs.starting_player_id");
    expect(names).not.toContain("legs.winner_player_id");
    expect(names).not.toContain("match_participants.player_id");
  });
});
