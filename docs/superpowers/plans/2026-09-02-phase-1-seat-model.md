# Phase 1: Seitenmodell im Match — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `match_participants` wird von „Spieler" zu „Seite", damit ein Doppel
überhaupt gespeichert werden kann — ohne dass sich am Verhalten bestehender
Einzelmatches irgendetwas ändert.

**Architecture:** Die Scoring-Engine nimmt zwei Seiten mit je einer Liste von
Personen entgegen; `matches`, `legs` und `visits` verweisen auf den Sitz statt
auf den Spieler. Die Personen einer Seite stehen in der neuen Tabelle
`match_participant_players`. Der Umbau läuft additiv mit Backfill, danach
folgt der Drop der Altspalten, damit jeder Commit grün ist.

**Tech Stack:** TypeScript strict, Drizzle ORM, PostgreSQL, Vitest,
Testcontainers-artige Wegwerf-Datenbanken über `createTemporaryDatabase`.

**Spec:** `docs/superpowers/specs/2026-09-02-team-encounter-league-design.md`,
Abschnitte „Seitenmodell im Match", „match_participant_players", „Migration",
„Engines → scoring-engine".

**Roadmap:** `docs/superpowers/plans/2026-09-02-team-encounter-roadmap.md`

## Global Constraints

- `strict: true`, kein `any`, `unknown` statt `any`.
- Jede tenant-bezogene Query bleibt nach `organization_id` eingeschränkt.
- Keine bestehende Migration wird verändert; nur neue Dateien.
- Einzelmatches müssen nach der Migration inhaltlich identisch sein. Das ist
  das Abnahmekriterium, nicht ein Nebenziel.
- Nach jedem Task ist `pnpm --filter <paket> typecheck` grün und es wird
  committet.
- Commit-Messages: Conventional Commits, **ohne** `Co-Authored-By`-Zeile.
- Testbefehl je Paket, nie im Root:
  `pnpm --filter @darts-platform/scoring-engine test`
- Integrationstests brauchen `pnpm infra:up` und eine `.env` mit
  `DATABASE_URL`.

## Abweichung von der Spec, die vor Beginn zu bestätigen ist

Die Spec verlangt in „Migration" **eine** Migration, die additiv anlegt,
backfillt und die Altspalten im selben Schritt entfernt. Dieser Plan teilt das
in **zwei** Migrationen:

- `0014` legt an und backfillt, lässt die Altspalten stehen.
- `0015` benennt `visits.player_id` um und entfernt die Altspalten.

Grund: mit einer einzigen Migration müsste der gesamte Code-Umbau in einem
einzigen Commit landen, weil `pnpm typecheck` sonst zwischen Migration und
Codeanpassung rot ist. Das wären über 1.000 Zeilen in einem Commit ohne
Zwischenprüfung — gegen die Prioritäten Korrektheit und Datenintegrität aus
AGENTS.md. Zwei Vorwärtsmigrationen verletzen AGENTS.md §21 nicht, weil keine
bestehende Migration umgeschrieben wird, und erlauben zusätzlich ein Deployment
ohne Schreibsperre.

**Wird die Abweichung angenommen, ist der Abschnitt „Migration" der Spec
entsprechend zu aktualisieren.**

## File Structure

| Datei | Verantwortung | Task |
| --- | --- | --- |
| `packages/scoring-engine/src/x01.ts` | Seitenmodell, Wurfreihenfolge, Werferprüfung | 1 |
| `packages/scoring-engine/src/x01.spec.ts` | Engine-Tests inkl. Doppel | 1 |
| `packages/scoring-engine/src/index.ts` | Export der neuen Typen | 1 |
| `packages/database/src/schema.ts` | `matchParticipantPlayers`, Sitzspalten | 2, 5 |
| `packages/database/drizzle/0014_*.sql` | additiv + Backfill | 2 |
| `packages/database/drizzle/0015_*.sql` | Rename + Drop | 5 |
| `apps/api/src/matches/migration-seat-backfill.integration.spec.ts` | Beweis der Verlustfreiheit | 2 |
| `apps/api/src/matches/matches.repository.ts` | Aggregat aus Sitzen bauen und schreiben | 3, 5 |
| `apps/api/src/statistics/statistics.repository.ts` | Visits über `thrower_player_id` | 4, 5 |
| `apps/api/src/tournaments/*.ts` | Gewinner über Sitz auflösen | 4 |
| `apps/worker/src/main.ts` | Projektion über Sitze | 4 |
| `apps/api/src/seeding/seed-fixtures.ts` | Seed schreibt Seiten | 4 |

---

### Task 1: Scoring-Engine auf Seiten umstellen

Reine Domänenarbeit, keine Datenbank. Muss zuerst kommen, weil das Repository
gegen diese Signatur baut.

**Files:**
- Modify: `packages/scoring-engine/src/x01.ts`
- Modify: `packages/scoring-engine/src/index.ts`
- Modify: `apps/api/src/matches/matches.repository.ts:763-790` (nur Aufrufstelle, damit der Baum grün bleibt)
- Test: `packages/scoring-engine/src/x01.spec.ts`

**Interfaces:**
- Consumes: nichts.
- Produces:

```ts
export interface X01Side {
  readonly seat: 1 | 2;
  readonly playerIds: readonly string[];
}
export interface SubmitVisitCommand {
  readonly type: "SUBMIT_VISIT";
  readonly commandId: string;
  readonly seat: 1 | 2;
  readonly throwerPlayerId: string;
  readonly points: number;
  readonly dartsThrown: 1 | 2 | 3;
  readonly checkoutDouble?: number;
  readonly checkoutAttempts?: number;
}
export interface X01SideState {
  readonly seat: 1 | 2;
  readonly playerIds: readonly string[];
  readonly remaining: number;
  readonly legsWonInSet: number;
  readonly totalLegsWon: number;
  readonly setsWon: number;
}
export interface X01MatchState {
  readonly status: "IN_PROGRESS" | "COMPLETED";
  readonly winnerSeat: 1 | 2 | null;
  readonly activeSeat: 1 | 2 | null;
  readonly activeThrowerPlayerId: string | null;
  readonly legStartingSeat: 1 | 2;
  readonly legNumber: number;
  readonly setNumber: number;
  readonly sides: readonly [X01SideState, X01SideState];
  readonly visits: readonly AppliedVisit[];
  readonly revertedCommandIds: readonly string[];
}
export function createX01Match(input: {
  readonly sides: readonly [X01Side, X01Side];
  readonly startingSeat?: 1 | 2;
  readonly rules?: X01Rules;
}): X01Match;
```

`AppliedVisit.playerId` entfällt und wird ersetzt durch
`readonly seat: 1 | 2` und `readonly throwerPlayerId: string`.

- [ ] **Step 1: Die neuen Tests schreiben**

An `packages/scoring-engine/src/x01.spec.ts` anhängen. Die bestehende
Hilfsfunktion `visit(...)` wird ersetzt, weil sich die Kommandoform ändert:

```ts
function visit(
  commandId: string,
  seat: 1 | 2,
  throwerPlayerId: string,
  points: number,
  dartsThrown: 1 | 2 | 3 = 3,
  checkoutDouble?: number,
) {
  return {
    type: "SUBMIT_VISIT" as const,
    commandId,
    seat,
    throwerPlayerId,
    points,
    dartsThrown,
    ...(checkoutDouble === undefined ? {} : { checkoutDouble }),
  };
}

function singles(one: string, two: string): readonly [X01Side, X01Side] {
  return [
    { seat: 1, playerIds: [one] },
    { seat: 2, playerIds: [two] },
  ];
}

describe("X01 sides", () => {
  it("treats a singles match as a side with one player", () => {
    const match = createX01Match({ sides: singles("a", "b") });
    const result = executeX01Command(match, visit("1", 1, "a", 100));
    expect(result.state.sides[0].remaining).toBe(401);
    expect(result.state.activeSeat).toBe(2);
    expect(result.state.activeThrowerPlayerId).toBe("b");
  });

  it("rotates the thrower inside a doubles side and alternates per leg", () => {
    let match = createX01Match({
      sides: [
        { seat: 1, playerIds: ["a1", "a2"] },
        { seat: 2, playerIds: ["b1", "b2"] },
      ],
      rules: { startingScore: 40, doubleOut: true, legsToWinSet: 2, setsToWin: 1 },
    });
    // Leg 1: Seite 1 wirft a1, danach a2, ...
    expect(projectX01Match(match).activeThrowerPlayerId).toBe("a1");
    let result = executeX01Command(match, visit("1", 1, "a1", 0));
    match = result.match;
    result = executeX01Command(match, visit("2", 2, "b1", 0));
    match = result.match;
    expect(projectX01Match(match).activeThrowerPlayerId).toBe("a2");
    result = executeX01Command(match, visit("3", 1, "a2", 40, 1, 20));
    match = result.match;
    expect(result.outcome).toBe("LEG_WON");
    // Leg 2 beginnt Seite 2, und innerhalb der Seiten rückt die Reihenfolge weiter.
    expect(result.state.legNumber).toBe(2);
    expect(result.state.activeSeat).toBe(2);
    expect(result.state.activeThrowerPlayerId).toBe("b2");
  });

  it("rejects a visit from the wrong person of the active side", () => {
    const match = createX01Match({
      sides: [
        { seat: 1, playerIds: ["a1", "a2"] },
        { seat: 2, playerIds: ["b1", "b2"] },
      ],
    });
    expect(() => executeX01Command(match, visit("1", 1, "a2", 60))).toThrow(
      ScoringValidationError,
    );
    try {
      executeX01Command(match, visit("2", 1, "a2", 60));
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("INVALID_THROWER");
    }
  });

  it("rejects a visit for the side that is not active", () => {
    const match = createX01Match({ sides: singles("a", "b") });
    try {
      executeX01Command(match, visit("1", 2, "b", 60));
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("NOT_ACTIVE_SEAT");
    }
  });

  it("rejects an empty side and a person on both sides", () => {
    expect(() =>
      createX01Match({ sides: [{ seat: 1, playerIds: [] }, { seat: 2, playerIds: ["b"] }] }),
    ).toThrow(ScoringValidationError);
    expect(() =>
      createX01Match({ sides: [{ seat: 1, playerIds: ["a"] }, { seat: 2, playerIds: ["a"] }] }),
    ).toThrow(ScoringValidationError);
  });
});
```

Alle bestehenden Tests in dieser Datei auf `singles(...)` und die neue
`visit(...)`-Signatur umschreiben. Ihre Erwartungen bleiben inhaltlich gleich;
`winnerPlayerId` wird zu `winnerSeat`, `players` zu `sides`.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @darts-platform/scoring-engine test`
Expected: FAIL, `X01Side` ist nicht exportiert und `sides` existiert nicht.

- [ ] **Step 3: Engine umbauen**

In `packages/scoring-engine/src/x01.ts`:

```ts
export interface X01Side {
  readonly seat: 1 | 2;
  readonly playerIds: readonly string[];
}

export interface X01Match {
  readonly sides: readonly [X01Side, X01Side];
  readonly startingSeat: 1 | 2;
  readonly rules: X01Rules;
  readonly commands: readonly X01Command[];
}

function seatOf(index: 0 | 1): 1 | 2 {
  return index === 0 ? 1 : 2;
}

function indexOfSeat(seat: 1 | 2): 0 | 1 {
  return seat === 1 ? 0 : 1;
}

function throwerFor(side: X01Side, visitsInLeg: number, legNumber: number): string {
  const position = (visitsInLeg + legNumber - 1) % side.playerIds.length;
  const playerId = side.playerIds[position];
  if (playerId === undefined) {
    throw new ScoringValidationError("EMPTY_SIDE", "A side needs at least one player.");
  }
  return playerId;
}
```

`createX01Match` prüft neu:

```ts
export function createX01Match(input: {
  readonly sides: readonly [X01Side, X01Side];
  readonly startingSeat?: 1 | 2;
  readonly rules?: X01Rules;
}): X01Match {
  const [first, second] = input.sides;
  if (first.playerIds.length === 0 || second.playerIds.length === 0) {
    throw new ScoringValidationError("EMPTY_SIDE", "A side needs at least one player.");
  }
  const all = [...first.playerIds, ...second.playerIds];
  if (new Set(all).size !== all.length) {
    throw new ScoringValidationError("DUPLICATE_PLAYER", "A person can only appear once in a match.");
  }
  const rules = input.rules ?? { startingScore: 501, doubleOut: true, legsToWinSet: 1, setsToWin: 1 };
  assertRules(rules);
  return { sides: input.sides, startingSeat: input.startingSeat ?? 1, rules, commands: [] };
}
```

In `projectX01Match` wird `initialPlayer` zu `initialSide`:

```ts
function initialSide(side: X01Side, startingScore: number): X01SideState {
  return {
    seat: side.seat,
    playerIds: side.playerIds,
    remaining: startingScore,
    legsWonInSet: 0,
    totalLegsWon: 0,
    setsWon: 0,
  };
}
```

Der Schleifenzustand führt zusätzlich die Anzahl Visits je Seite im laufenden
Leg:

```ts
let sides: [X01SideState, X01SideState] = [
  initialSide(match.sides[0], match.rules.startingScore),
  initialSide(match.sides[1], match.rules.startingScore),
];
let activeIndex: 0 | 1 = indexOfSeat(match.startingSeat);
let legStartingIndex: 0 | 1 = activeIndex;
let visitsInLeg: [number, number] = [0, 0];
let winnerSeat: 1 | 2 | null = null;
```

Die Prüfung im Schleifenkopf lautet:

```ts
if (command.seat !== seatOf(activeIndex)) {
  throw new ScoringValidationError("NOT_ACTIVE_SEAT", "The visit does not belong to the active side.");
}
const expectedThrower = throwerFor(match.sides[activeIndex], visitsInLeg[activeIndex], legNumber);
if (command.throwerPlayerId !== expectedThrower) {
  throw new ScoringValidationError("INVALID_THROWER", "The visit does not belong to the person whose turn it is.");
}
```

Nach jedem angewendeten Visit wird mitgezählt, beim Legwechsel zurückgesetzt:

```ts
visitsInLeg = activeIndex === 0
  ? [visitsInLeg[0] + 1, visitsInLeg[1]]
  : [visitsInLeg[0], visitsInLeg[1] + 1];
// im Zweig für den gewonnenen Leg, direkt neben legNumber += 1:
visitsInLeg = [0, 0];
```

Der `AppliedVisit` trägt `seat: command.seat` und
`throwerPlayerId: command.throwerPlayerId` statt `playerId`. Der Rückgabewert
lautet:

```ts
return {
  status: winnerSeat === null ? "IN_PROGRESS" : "COMPLETED",
  winnerSeat,
  activeSeat: winnerSeat === null ? seatOf(activeIndex) : null,
  activeThrowerPlayerId:
    winnerSeat === null
      ? throwerFor(match.sides[activeIndex], visitsInLeg[activeIndex], legNumber)
      : null,
  legStartingSeat: seatOf(legStartingIndex),
  legNumber,
  setNumber,
  sides,
  visits,
  revertedCommandIds: active.reverted,
};
```

`index.ts` exportiert zusätzlich `type X01Side` und `type X01SideState`,
`X01PlayerState` entfällt.

- [ ] **Step 4: Aufrufstelle im Repository minimal anpassen**

Nur damit der Baum grün bleibt; die richtige Umstellung folgt in Task 3. In
`apps/api/src/matches/matches.repository.ts`, Methode `aggregate`:

```ts
const base = createX01Match({
  sides: [
    { seat: 1, playerIds: [first.playerId] },
    { seat: 2, playerIds: [second.playerId] },
  ],
  startingSeat: match.startingPlayerId === first.playerId ? 1 : 2,
  rules: { ... unverändert ... },
});
```

Jede Stelle, die `state.winnerPlayerId` liest, wird abgebildet auf:

```ts
const winnerPlayerId =
  state.winnerSeat === null
    ? null
    : (state.sides.find((side) => side.seat === state.winnerSeat)?.playerIds[0] ?? null);
```

Jede Stelle mit `state.activePlayerId` wird zu `state.activeThrowerPlayerId`.
In `persist` wird über `state.sides` statt `state.players` iteriert und der
Sitz statt der `playerId` als Filter benutzt.

Das HTTP-Kommando bleibt in dieser Phase unverändert: `submitVisit` nimmt
weiterhin `playerId` entgegen. Das Repository leitet Sitz und Werfer daraus ab
— bei einem Einzel eindeutig, weil eine Seite genau eine Person hat. Erst
Phase 4 erweitert den Vertrag um `seat` und `throwerPlayerId`. So bleiben
`apps/web` und die E2E-Tests in dieser Phase unberührt.

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @darts-platform/scoring-engine test`
Expected: PASS, alle Tests inklusive der neuen Doppeltests.

Run: `pnpm --filter @darts-platform/api typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/scoring-engine apps/api/src/matches/matches.repository.ts
git commit -m "refactor: model match participants as sides in the scoring engine"
```

---

### Task 2: Schema additiv erweitern und backfillen

**Files:**
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/drizzle/0014_seat_model.sql` (Name folgt aus `db:generate`)
- Create: `apps/api/src/matches/migration-seat-backfill.integration.spec.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: Tabelle `match_participant_players`, Spalten
  `matches.starting_seat|current_seat|winner_seat`,
  `legs.starting_seat|winner_seat`, `visits.seat`.

- [ ] **Step 1: Den Backfill-Test schreiben**

Er beweist das Abnahmekriterium der Spec: bestehende Einzelmatches bleiben
inhaltlich identisch. Dafür wird bis `0013` migriert, Altdaten eingefügt und
erst dann `0014` angewendet.

Create `apps/api/src/matches/migration-seat-backfill.integration.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, migrateDatabase } from "@darts-platform/database";

const environment = parseApplicationEnvironment(process.env);
const migrationsFolder = new URL("../../../../packages/database/drizzle", import.meta.url).pathname;

interface Journal { readonly entries: { readonly idx: number; readonly tag: string }[] }

async function folderUpTo(tag: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dartbase-migrations-"));
  await cp(migrationsFolder, directory, { recursive: true });
  const journalPath = join(directory, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal & Record<string, unknown>;
  const cutoff = journal.entries.findIndex((entry) => entry.tag === tag);
  expect(cutoff).toBeGreaterThanOrEqual(0);
  await writeFile(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, cutoff + 1) }, null, 2),
  );
  return directory;
}
```

Der Aufbau schreibt die Altdaten mit rohem SQL, weil die Drizzle-Schemaobjekte
bereits den Endzustand beschreiben und gegen ein Schema auf Stand `0013` nicht
passen:

```ts
const organizationId = randomUUID();
const playerOneId = randomUUID();
const playerTwoId = randomUUID();
const matchId = randomUUID();
let connection: Awaited<ReturnType<typeof createDatabaseConnection>>;
let databaseName: string;

beforeAll(async () => {
  const admin = createDatabaseConnection(adminUrl(environment.DATABASE_URL));
  databaseName = `dartbase_seat_${randomUUID().replaceAll("-", "")}`;
  await admin.database.execute(sql.raw(`create database "${databaseName}"`));
  await admin.close();
  const url = urlWithDatabase(environment.DATABASE_URL, databaseName);

  await migrateDatabase(url, await folderUpTo("0013_youthful_gideon"));
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
  const legId = randomUUID();
  await connection.database.execute(sql`
    insert into legs (id, organization_id, match_id, leg_number, starting_player_id,
                      winner_player_id, status, completed_at)
    values (${legId}, ${organizationId}, ${matchId}, 1, ${playerOneId},
            ${playerOneId}, 'COMPLETED', now())`);
  for (const [sequence, playerId, points] of [
    [1, playerOneId, 100], [2, playerTwoId, 60], [3, playerOneId, 140], [4, playerTwoId, 45],
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
});

afterAll(async () => {
  await connection.close();
  const admin = createDatabaseConnection(adminUrl(environment.DATABASE_URL));
  await admin.database.execute(sql.raw(`drop database "${databaseName}" with (force)`));
  await admin.close();
});
```

`adminUrl` und `urlWithDatabase` sind zwei Zeilen über `new URL(...)`, analog
zu `databaseUrlWithPath` in `apps/api/src/testing/temporary-database.ts`.

Der Treiber ist `postgres-js`, `database.execute(...)` liefert also die Zeilen
direkt als Array zurück, nicht in einem `rows`-Feld. Die Zeilen sind
untypisiert; unter `strict` braucht jede Abfrage eine schmale Zielform, zum
Beispiel:

```ts
const rows = (await connection.database.execute(
  sql`select starting_seat, winner_seat from matches where id = ${matchId}`,
)) as unknown as readonly { starting_seat: number; winner_seat: number | null }[];
```

Die Prüfung selbst:

```ts
it("keeps existing singles matches intact across the seat backfill", async () => {
  const [match] = await connection.database.execute(
    sql`select starting_seat, current_seat, winner_seat, starting_player_id, winner_player_id from matches where id = ${matchId}`,
  );
  expect(match.starting_seat).toBe(1);
  expect(match.winner_seat).toBe(1);

  const participants = await connection.database.execute(
    sql`select mpp.player_id, mpp.position, mp.seat
        from match_participant_players mpp
        join match_participants mp on mp.id = mpp.participant_id
        where mp.match_id = ${matchId} order by mp.seat`,
  );
  expect(participants).toHaveLength(2);
  expect(participants[0].position).toBe(1);
  expect(participants[0].player_id).toBe(playerOneId);

  const visitSeats = await connection.database.execute(
    sql`select seat, player_id from visits where match_id = ${matchId} order by sequence`,
  );
  expect(visitSeats.map((row) => row.seat)).toEqual([1, 2, 1, 2]);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm infra:up && pnpm --filter @darts-platform/api test -- migration-seat-backfill`
Expected: FAIL, Spalte `starting_seat` existiert nicht.

- [ ] **Step 3: Schema erweitern**

In `packages/database/src/schema.ts`, additiv und zunächst nullable:

```ts
// in matches
startingSeat: integer("starting_seat"),
currentSeat: integer("current_seat"),
winnerSeat: integer("winner_seat"),
// in legs
startingSeat: integer("starting_seat"),
winnerSeat: integer("winner_seat"),
// in visits
seat: integer("seat"),
```

Und die neue Tabelle nach `matchParticipants`:

```ts
export const matchParticipantPlayers = pgTable(
  "match_participant_players",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id").notNull().references(() => matchParticipants.id, { onDelete: "cascade" }),
    playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
  },
  (table) => [
    uniqueIndex("match_participant_players_participant_position_unique").on(table.participantId, table.position),
    uniqueIndex("match_participant_players_match_player_unique").on(table.matchId, table.playerId),
    index("match_participant_players_organization_player_idx").on(table.organizationId, table.playerId),
    check("match_participant_players_position_check", sql`${table.position} in (1, 2)`),
  ],
);
```

Export in `packages/database/src/index.ts` ergänzen.

- [ ] **Step 4: Migration erzeugen und den Backfill von Hand ergänzen**

Run: `pnpm db:generate`

Die erzeugte Datei um den Backfill erweitern, **vor** den `SET NOT NULL`-Zeilen.
Die `--> statement-breakpoint`-Marker zwischen den Anweisungen beibehalten:

```sql
INSERT INTO "match_participant_players"
  ("organization_id", "match_id", "participant_id", "player_id", "position")
SELECT mp."organization_id", mp."match_id", mp."id", mp."player_id", 1
FROM "match_participants" mp;
--> statement-breakpoint
UPDATE "matches" m SET "starting_seat" = mp."seat"
FROM "match_participants" mp
WHERE mp."match_id" = m."id" AND mp."player_id" = m."starting_player_id";
--> statement-breakpoint
UPDATE "matches" m SET "current_seat" = mp."seat"
FROM "match_participants" mp
WHERE mp."match_id" = m."id" AND mp."player_id" = m."current_player_id";
--> statement-breakpoint
UPDATE "matches" m SET "winner_seat" = mp."seat"
FROM "match_participants" mp
WHERE mp."match_id" = m."id" AND mp."player_id" = m."winner_player_id";
--> statement-breakpoint
UPDATE "legs" l SET "starting_seat" = mp."seat"
FROM "match_participants" mp
WHERE mp."match_id" = l."match_id" AND mp."player_id" = l."starting_player_id";
--> statement-breakpoint
UPDATE "legs" l SET "winner_seat" = mp."seat"
FROM "match_participants" mp
WHERE mp."match_id" = l."match_id" AND mp."player_id" = l."winner_player_id";
--> statement-breakpoint
UPDATE "visits" v SET "seat" = mp."seat"
FROM "match_participants" mp
WHERE mp."match_id" = v."match_id" AND mp."player_id" = v."player_id";
--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "starting_seat" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "legs" ALTER COLUMN "starting_seat" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "visits" ALTER COLUMN "seat" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_starting_seat_check" CHECK ("starting_seat" in (1, 2));
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_current_seat_check" CHECK ("current_seat" is null or "current_seat" in (1, 2));
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_seat_check" CHECK ("winner_seat" is null or "winner_seat" in (1, 2));
--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_starting_seat_check" CHECK ("starting_seat" in (1, 2));
--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_winner_seat_check" CHECK ("winner_seat" is null or "winner_seat" in (1, 2));
--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_seat_check" CHECK ("seat" in (1, 2));
```

Die `NOT NULL`- und Check-Zeilen anschliessend auch im Schema nachziehen
(`.notNull()`, `check(...)`), damit `db:generate` beim nächsten Lauf keine
Differenz meldet.

- [ ] **Step 5: Test laufen lassen**

Run: `pnpm --filter @darts-platform/api test -- migration-seat-backfill`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/database apps/api/src/matches/migration-seat-backfill.integration.spec.ts
git commit -m "feat: add seat columns and match participant players with backfill"
```

---

### Task 3: Repository auf Sitze umstellen

**Files:**
- Modify: `apps/api/src/matches/matches.repository.ts`
- Test: `apps/api/src/matches/matches.integration.spec.ts`

**Interfaces:**
- Consumes: `X01Side`, `createX01Match` aus Task 1; Sitzspalten aus Task 2.
- Produces:

```ts
interface LoadedSide {
  readonly seat: 1 | 2;
  readonly participantId: string;
  readonly playerIds: readonly string[];
}

// Der Transaktionstyp folgt dem im Repository bereits verwendeten Idiom
// (siehe matches.repository.ts:691) und wird nicht neu benannt:
private async loadSides(
  transaction: Parameters<Parameters<typeof this.databaseService.database.transaction>[0]>[0],
  organizationId: string,
  matchId: string,
): Promise<readonly [LoadedSide, LoadedSide]>;
```

- [ ] **Step 1: Test schreiben**

An `apps/api/src/matches/matches.integration.spec.ts` anhängen:

`matchParticipantPlayers` muss dem Import aus `@darts-platform/database` in
Zeile 5 der Spec-Datei hinzugefügt werden.

```ts
it("persists seats alongside the legacy player columns", async () => {
  const state = await service.create({
    organizationId,
    data: {
      playerOneId,
      playerTwoId,
      startingPlayerId: playerOneId,
      boardId: null,
      bestOfLegs: 1,
      bestOfSets: 1,
    },
    auth,
    audit,
  });

  const [row] = await databaseService.database
    .select().from(matches).where(eq(matches.id, state.id));
  expect(row?.startingSeat).toBe(1);
  expect(row?.startingPlayerId).toBe(playerOneId);

  const sideRows = await databaseService.database
    .select().from(matchParticipantPlayers)
    .where(eq(matchParticipantPlayers.matchId, state.id));
  expect(sideRows).toHaveLength(2);
  expect(sideRows.every((side) => side.position === 1)).toBe(true);
  expect(sideRows.map((side) => side.playerId).sort()).toEqual(
    [playerOneId, playerTwoId].sort(),
  );
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @darts-platform/api test -- matches.integration`
Expected: FAIL, `match_participant_players` ist beim Anlegen leer.

- [ ] **Step 3: Repository umstellen**

- `loadSides` ersetzt die bisherigen `select ... from matchParticipants`-Stellen
  (Zeilen 68, 228, 403, 671) und joint `matchParticipantPlayers` nach
  `position` sortiert.
- `aggregate` baut `sides` aus `loadSides` und `startingSeat` aus
  `match.startingSeat`.
- `createMatch` (ab Zeile 131) schreibt zusätzlich `startingSeat: 1`,
  `currentSeat: 1` und je Sitz eine Zeile in `matchParticipantPlayers`;
  `legs` bekommt `startingSeat: 1`.
- `persist` (ab Zeile 778) schreibt `currentSeat: state.activeSeat`,
  `winnerSeat: state.winnerSeat` **zusätzlich** zu den Altspalten und
  aktualisiert `legsWon` über `matchParticipants.seat` statt über `playerId`.
- `visits`-Inserts tragen `seat: applied.seat`.
- `submitVisit` und `undoVisit` übersetzen das eingehende `playerId` in Sitz und
  Werfer, bevor das Kommando an die Engine geht:

```ts
const side = sides.find((candidate) => candidate.playerIds.includes(input.data.playerId));
if (side === undefined) {
  throw new ScoringValidationError("INVALID_MATCH_PARTICIPANTS", "The player does not belong to this match.");
}
const command: SubmitVisitCommand = {
  type: "SUBMIT_VISIT",
  commandId: input.data.commandId,
  seat: side.seat,
  throwerPlayerId: input.data.playerId,
  points: input.data.points,
  dartsThrown: input.data.dartsThrown,
  ...(input.data.checkoutDouble === undefined ? {} : { checkoutDouble: input.data.checkoutDouble }),
};
```

Die Altspalten werden bewusst weitergeschrieben. Sie verschwinden erst in
Task 5.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @darts-platform/api test -- matches`
Expected: PASS, alle bestehenden Match-Tests unverändert grün.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/matches
git commit -m "refactor: read and write match sides in the matches repository"
```

---

### Task 4: Übrige Leser auf Sitze umstellen

**Files:**
- Modify: `apps/api/src/statistics/statistics.repository.ts`
- Modify: `apps/api/src/tournaments/resolve-completed-group.ts`
- Modify: `apps/api/src/tournaments/tournaments.repository.ts`
- Modify: `apps/api/src/matches/abort-match.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/api/src/seeding/seed-fixtures.ts`
- Test: bestehende Specs dieser Module

**Interfaces:**
- Consumes: `loadSides` aus Task 3.
- Produces: keine neuen Signaturen; alle Leser gehen über den Sitz.

- [ ] **Step 1: Bestehende Tests als Netz benutzen**

Run: `pnpm --filter @darts-platform/api test`
Expected: PASS vor der Änderung. Dieser Lauf ist die Referenz.

- [ ] **Step 2: Leser umstellen**

Jede Stelle, die heute `matchParticipants.playerId` liest, joint stattdessen
`matchParticipantPlayers` und nimmt bei Einzelmatches `position = 1`. Jede
Stelle, die `matches.winnerPlayerId` liest, um den Turniergewinner zu
bestimmen, löst neu über `winnerSeat` auf:

```ts
const winnerPlayerId =
  match.winnerSeat === null
    ? null
    : sides.find((side) => side.seat === match.winnerSeat)?.playerIds[0] ?? null;
```

`apps/worker/src/main.ts` projiziert über `state.sides` statt `state.players`.
`seed-fixtures.ts` schreibt beim Anlegen eines Matches zusätzlich Sitze und
`match_participant_players`.

- [ ] **Step 3: Tests laufen lassen**

Run: `pnpm --filter @darts-platform/api test`
Expected: PASS, identische Anzahl bestandener Tests wie in Step 1.

Run: `pnpm --filter @darts-platform/worker test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api apps/worker
git commit -m "refactor: resolve match winners through seats across all readers"
```

---

### Task 5: Altspalten entfernen

**Files:**
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/drizzle/0015_seat_model_cleanup.sql`
- Modify: `apps/api/src/matches/matches.repository.ts`
- Modify: `apps/api/src/statistics/statistics.repository.ts`
- Modify: `apps/api/src/statistics/statistics.service.ts`
- Modify: `packages/statistics/src/statistics.ts`
- Modify: `packages/schemas/src/match.ts`

**Interfaces:**
- Consumes: alles aus Tasks 1 bis 4.
- Produces: Endzustand des Schemas laut Spec-Abschnitt „Seitenmodell im Match".

- [ ] **Step 1: Test schreiben**

An `migration-seat-backfill.integration.spec.ts` anhängen:

```ts
it("drops the legacy player columns and renames the visit thrower", async () => {
  const columns = await connection.database.execute(
    sql`select table_name, column_name from information_schema.columns
        where table_name in ('matches', 'legs', 'visits', 'match_participants')`,
  );
  const names = columns.map((row) => `${row.table_name}.${row.column_name}`);
  expect(names).toContain("visits.thrower_player_id");
  expect(names).not.toContain("visits.player_id");
  expect(names).not.toContain("matches.starting_player_id");
  expect(names).not.toContain("legs.starting_player_id");
  expect(names).not.toContain("match_participants.player_id");
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @darts-platform/api test -- migration-seat-backfill`
Expected: FAIL, `visits.player_id` existiert noch.

- [ ] **Step 3: Schema bereinigen und Migration erzeugen**

Aus `schema.ts` entfernen: `matches.startingPlayerId`, `currentPlayerId`,
`winnerPlayerId`, `legs.startingPlayerId`, `winnerPlayerId`,
`matchParticipants.playerId` samt `match_participants_match_player_unique`.
`visits.playerId` wird zu:

```ts
throwerPlayerId: uuid("thrower_player_id").notNull().references(() => players.id, { onDelete: "restrict" }),
```

Run: `pnpm db:generate`

Drizzle erzeugt für die Umbenennung ein Drop-and-Add. Das ist Datenverlust und
muss von Hand ersetzt werden durch:

```sql
ALTER TABLE "visits" RENAME COLUMN "player_id" TO "thrower_player_id";
```

Die übrigen `DROP COLUMN`-Anweisungen bleiben, wie erzeugt.

- [ ] **Step 4: Doppelschreiben entfernen**

Alle in Task 3 bewusst beibehaltenen Schreibzugriffe auf die Altspalten
entfernen. Jede verbliebene Referenz auf `visits.playerId` auf
`visits.throwerPlayerId` umstellen — betroffen sind `statistics.repository.ts`,
`statistics.service.ts`, `packages/statistics/src/statistics.ts` und die
Antwortform in `packages/schemas/src/match.ts`.

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @darts-platform/api test`
Expected: PASS.

Run: `pnpm --filter @darts-platform/statistics test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages apps
git commit -m "refactor: drop legacy player columns in favour of seats"
```

---

### Task 6: Vollverifikation und Phasenabschluss

**Files:** keine.

- [ ] **Step 1: Gesamte Prüfkette**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: alles grün. Fehlschläge werden behoben, nicht ignoriert.

- [ ] **Step 2: Spec nachziehen**

Wurde die Abweichung mit zwei Migrationen angenommen, den Abschnitt
„Migration" der Spec auf zwei Migrationen umschreiben und die Schrittfolge
anpassen.

- [ ] **Step 3: Commit und Session beenden**

```bash
git add docs
git commit -m "docs: record the two-step seat migration in the encounter spec"
```

Danach die Session beenden. Phase 2 bekommt eine eigene Session und einen
eigenen Plan.
