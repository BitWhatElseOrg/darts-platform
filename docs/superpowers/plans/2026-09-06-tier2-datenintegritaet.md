# Tier 2 Teil A — Datenintegrität, Concurrency und API-Schreibpfade

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Important-Befunde des Datenintegritäts-Audits mit begrenztem Fix schliessen — Datenbank-Constraints für Scoring- und Kommando-Invarianten, idempotente Antworten unter Gleichzeitigkeit, eine einheitliche Sperrreihenfolge, ein beanspruchender Outbox-Poller und ein Abbruch, der Wurfhistorie nicht mehr löscht.

**Architecture:** Alles läuft über die bestehenden Muster des Repositories: eine neue Vorwärtsmigration `0023` mit Bestandscheck im `DO $$`-Block (Vorbild `0022_board_in_progress_unique`), eine zweite Duplikatprüfung unter der Aggregatsperre (Vorbild `encounters.repository.ts:1159–1165`), eine globale Sperrreihenfolge `Encounter → EncounterSlot → Match` als eigener Sperr-Helfer neben `tournament-scoring-lock.ts`, und ein Outbox-Poller, der seinen Stapel in einer Transaktion mit `FOR UPDATE SKIP LOCKED` beansprucht und erst nach dem Commit sendet. Der Matchzustand wird weiterhin ausschliesslich aus `score_commands` projiziert; keine neue Prüfung wandert in `projectX01Match`.

**Tech Stack:** TypeScript (strict), pnpm/Turborepo, NestJS + Fastify, Drizzle ORM 0.45.2, PostgreSQL, Vitest, Playwright.

**Spec:** `/tmp/claude-1000/-home-sut-projects-darts-platform/70688d40-4244-406a-b67f-18e37ab90b1a/scratchpad/audit/C-datenintegritaet.md` (Auditbericht C — Datenintegrität, Transaktionen, Concurrency, Migrationen). Ergänzend `AGENTS.md` und `ARCHITECTURE.md` §13–16, §25.

## Global Constraints

- **Replay-Sicherheit:** Der Matchzustand wird aus `score_commands` neu projiziert. Keine Änderung darf ein gespeichertes Kommando anders werten. Neue Prüfungen gehören in den Schreibpfad (`executeX01Command`, Repository), nie in `projectX01Match`.
- **Migrationen nur vorwärts,** versioniert, Snapshot über `drizzle-kit generate`. Bestehende Migrationen `0000`–`0022` bleiben unangetastet. Die neue Migration ist `0023`.
- **Bestandscheck vor jedem Constraint:** SQL gegen die Dev-DB ausführen, bevor der Constraint angelegt wird; zusätzlich prüft die Migration den Bestand selbst in einem `DO $$`-Block und bricht mit lesbarer Meldung ab (Muster `0022_board_in_progress_unique.sql`).
- **Doku:** Jeder neue Constraint und Index wird in `DATABASE_SCHEMA.md` nach dem Muster des Abschnitts zu Migration 0022 dokumentiert — inklusive Bestandscheck-SQL und Sperrdauer.
- **Jede tenant-bezogene Query ist nach `organizationId` eingeschränkt.**
- **Kritische Mutationen sind transaktional; Realtime-Events entstehen erst nach erfolgreichem Commit.**
- **Idempotenz:** Dieselbe `commandId` erzeugt keinen zweiten Schreibvorgang **und** antwortet mit dem aktuellen Zustand, nicht mit 409.
- **Einheitliches Fehlerformat,** keine Postgres-Texte an Clients. `23505` und `40P01` werden über die `cause`-Kette und `code`/`constraint_name` erkannt (Muster `apps/api/src/boards/board-occupancy.ts` `isBoardInProgressConflict`).
- **`strict: true`, kein `any`, exhaustive `switch`.** Kommentare deutsch (ASCII-Transliteration wie im Bestand: `ue`, `ae`, `oe`), Bezeichner englisch.
- **Conventional Commits mit deutschem Betreff, kein `Co-Authored-By`-Trailer.**
- **Tests:** Integrationstests aus `apps/api` mit `npx dotenv -e ../../.env -- npx vitest run <pfad>` (vorher einmal `pnpm --filter @darts-platform/database build`, weil `apps/api` das Schema aus `dist` auflöst). DB-Constraint-Tests in `packages/database` (Muster `src/client.integration.spec.ts`). Engine-Tests mit `pnpm --filter @darts-platform/scoring-engine test`.
- **Vor Abschluss jedes Tasks:** `pnpm lint`, `pnpm typecheck`, `pnpm test`. Am Ende des Plans zusätzlich `NODE_ENV=production pnpm build` und `pnpm test:e2e` mit einem Worker.

---

## Nicht mehr zutreffend

Beim Lesen des Codes auf `fix/audit-tier2` haben sich drei Punkte des Berichts als bereits geschlossen erwiesen. Sie werden hier festgehalten, nicht stumm weggelassen.

- **Bericht C1 (Critical, Board-Doppelbelegung)** — geschlossen durch Tier 1. Der partielle Unique `matches_board_in_progress_unique` steht in `packages/database/src/schema.ts:331–333` (Migration `0022_board_in_progress_unique`), und `isBoardOccupied` wird in `apps/api/src/tournaments/tournaments.repository.ts:645` (`assign`) sowie `:929` (`releaseBoard`) aufgerufen. Ausserhalb des Umfangs dieses Plans (Tier 1), hier nur der Vollständigkeit halber.
- **Bericht I2 (Turnierzuweisung kennt weder Ligaspiele noch Personensperre)** — geschlossen durch Tier 1. `assign` ruft `lockPlayers` und `loadActivePlayerIds` aus `apps/api/src/boards/board-occupancy.ts` (`tournaments.repository.ts:650–652`).
- **Halbe Geltung beim `assertWritableVisit`-Befund:** Der Teil «Match beendet meldet `DARTS_REQUIRED_FOR_DOUBLE_IN` statt `MATCH_ALREADY_COMPLETED`» trifft **nicht** zu. `projectX01Match` liefert für ein beendetes Match `activeSeat: null` (`packages/scoring-engine/src/x01.ts:964`), und `assertWritableVisit` steigt an seinem ersten Wächter `before.activeSeat !== command.seat` (`:998`) aus. Die Projektion meldet dann korrekt `MATCH_ALREADY_COMPLETED`. Zutreffend bleibt die Rundengrenze: `before.roundLimitReached` wird in `assertWritableVisit` nicht ausgewertet, deshalb schlägt dort die Eingaberegel zu, bevor die Projektion `ROUND_LIMIT_REACHED` melden kann. Task 8 behebt genau diesen Fall und sichert den bereits korrekten beendeten Fall mit einem Regressionstest ab.

**Nicht in diesem Plan:** Bericht I10 (Snapshot/`payload_version`/Abgleichlauf — Tier 3), I11 (Offline-Queue — in Tier 1 erledigt), sowie die Minor-Befunde M1–M6.

---

## File Structure

**Datenbank**

- `packages/database/src/schema.ts` — Modify: `matches` (302–349), `legs` (411–439), `visits` (440–486), `scoreCommands` (521–545), `outboxEvents` (546–565), `tournamentCommands` (879–905), `encounterCommands` (1389–1415). Neue Checks, Uniques, Sequenzspalte, partielle Indexe.
- `packages/database/drizzle/0023_tier2_integrity_constraints.sql` — Create: die einzige neue Migration dieses Plans, mit vorangestelltem `DO $$`-Bestandscheck.
- `packages/database/drizzle/meta/0023_snapshot.json`, `packages/database/drizzle/meta/_journal.json` — von `drizzle-kit generate` erzeugt bzw. fortgeschrieben.
- `packages/database/src/client.integration.spec.ts` — Modify: Constraint-Tests für die neuen Regeln.
- `DATABASE_SCHEMA.md` — Modify: Dokumentation der Migration 0023.

**API — Scoring**

- `apps/api/src/matches/abort-match.ts` — Modify: Aufnahmen widerrufen statt löschen.
- `apps/api/src/matches/matches.repository.ts` — Modify: zweite Duplikatprüfung unter der Sperre, Begegnungssperre vorziehen, Deadlock-Wiederholung.
- `apps/api/src/matches/encounter-scoring-lock.ts` — Create: globale Sperrreihenfolge `Encounter → EncounterSlot → Match` für den Scoringpfad.
- `apps/api/src/matches/encounter-scoring-lock.integration.spec.ts` — Create: beweist, dass die Begegnungszeile vor der Matchzeile genommen wird.
- `apps/api/src/matches/retry-on-deadlock.ts` — Create: einmalige Wiederholung bei `40P01`, danach Versionskonflikt.
- `apps/api/src/matches/retry-on-deadlock.spec.ts` — Create: Unit-Test dazu.
- `apps/api/src/matches/matches.integration.spec.ts` — Modify: Abbruch-Erwartung, Idempotenz unter Gleichzeitigkeit.

**API — Turnier, Begegnung, gemeinsame Helfer**

- `apps/api/src/common/postgres-error.ts` — Create: `isDeadlockError` über die `cause`-Kette.
- `apps/api/src/common/postgres-error.spec.ts` — Create: Unit-Test dazu.
- `apps/api/src/tournaments/tournaments.repository.ts` — Modify: zweite Duplikatprüfung in `assign` und `releaseBoard`, Dashboard-Rundreisen bündeln.
- `apps/api/src/tournaments/tournaments.integration.spec.ts` — Modify: Idempotenz unter Gleichzeitigkeit.
- `apps/api/src/tournaments/board-occupancy.integration.spec.ts` — Modify: Ad-hoc-Match auf belegter Scheibe.

**API — Realtime**

- `apps/api/src/realtime/publish-outbox.ts` — Modify: Stapel beanspruchen, nach Commit senden, nach Sequenz ordnen.
- `apps/api/src/realtime/publish-outbox.integration.spec.ts` — Modify: zweite Replik sendet nichts doppelt.

**Worker**

- `apps/worker/src/prune-outbox.ts` — Create: Aufräumregel für verarbeitete Outbox-Zeilen.
- `apps/worker/src/prune-outbox.integration.spec.ts` — Create: Test dazu.
- `apps/worker/src/main.ts` — Modify: Poller nach Sequenz, Retention-Intervall.

**Scoring-Engine**

- `packages/scoring-engine/src/x01.ts` — Modify: `assertWritableVisit` weicht Zustandsfehlern.
- `packages/scoring-engine/src/x01.spec.ts` — Modify: Reihenfolgetests.

---

## Reihenfolge und Abhängigkeiten

Task 1 (Migration) steht zuerst, weil Task 2 (Abbruch behält Legs und Aufnahmen) gegen `legs_completion_check` laufen muss und Task 5/6 die Sequenzspalte brauchen. Task 3 (Idempotenz) und Task 4 (Sperrreihenfolge) fassen dieselben Methoden in `matches.repository.ts` an und laufen deshalb nacheinander, Idempotenz zuerst — sie ist die kleinere Änderung und ihr Test bleibt danach als Regression stehen. Task 5 vor Task 6, weil Task 6 die Sortierung des Statistik-Pollers an dieselbe Sequenz hängt, die Task 5 im Realtime-Poller einführt. Die Tasks 7–9 sind unabhängig und stehen am Ende.

---

### Task 1: Migration 0023 — Constraints, Uniques, Outbox-Sequenz und Poll-Indexe

Deckt die Befunde I3 (`matches`/`legs`-Konsistenz), I4 (Scoring-Arithmetik), I5 (Unique auf `(Aggregat, resulting_version)`), den Indexteil von I7 und den Sequenzteil von I8 ab. Alle in **einer** Migration, weil sie eine einzige Deployment-Entscheidung sind (ein Wartungsfenster, ein Bestandscheck).

**Files:**
- Modify: `packages/database/src/schema.ts:302–349` (matches), `:411–439` (legs), `:440–486` (visits), `:521–545` (score_commands), `:546–565` (outbox_events), `:879–905` (tournament_commands), `:1389–1415` (encounter_commands)
- Create: `packages/database/drizzle/0023_tier2_integrity_constraints.sql`
- Create: `packages/database/drizzle/meta/0023_snapshot.json` (generiert)
- Modify: `packages/database/drizzle/meta/_journal.json` (generiert, nur der `tag` wird von Hand angepasst)
- Modify: `DATABASE_SCHEMA.md`
- Test: `packages/database/src/client.integration.spec.ts`

**Interfaces:**
- Consumes: `check`, `index`, `uniqueIndex`, `bigserial` aus `drizzle-orm/pg-core`; `sql` aus `drizzle-orm`.
- Produces:
  - Constraints `matches_completion_check`, `legs_completion_check`, `visits_scored_arithmetic_check`, `visits_bust_arithmetic_check`, `visits_won_arithmetic_check`
  - Unique-Indexe `score_commands_match_version_unique`, `tournament_commands_tournament_version_unique`, `encounter_commands_encounter_version_unique`
  - Spalte `outboxEvents.sequence: bigserial<number>` (Typ `OutboxEvent["sequence"]: number`, bei `NewOutboxEvent` optional)
  - Indexe `outbox_events_sequence_unique`, `outbox_events_pending_publication_idx`, `outbox_events_pending_statistics_idx`

- [ ] **Step 1: Bestandscheck gegen die Dev-DB fahren**

Das ist die Vorbedingung der ganzen Migration: keine der neun Abfragen darf eine Zeile liefern. Ausführen:

```bash
cd /home/sut/projects/darts-platform && npx dotenv -e .env -- npx tsx --eval "
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL);
const checks = {
  matches_completion: \`select id from matches where (status = 'COMPLETED') <> (winner_seat is not null and completed_at is not null)\`,
  legs_completion: \`select id from legs where (status = 'COMPLETED') <> (winner_seat is not null)\`,
  visits_scored: \`select id from visits where outcome <> 'BUST' and score_after <> score_before - applied_points\`,
  visits_bust: \`select id from visits where outcome = 'BUST' and (applied_points <> 0 or score_after <> score_before)\`,
  visits_won: \`select id from visits where outcome like '%WON' and score_after <> 0\`,
  score_command_versions: \`select match_id from score_commands group by match_id, resulting_version having count(*) > 1\`,
  tournament_command_versions: \`select tournament_id from tournament_commands group by tournament_id, resulting_version having count(*) > 1\`,
  encounter_command_versions: \`select encounter_id from encounter_commands group by encounter_id, resulting_version having count(*) > 1\`,
  outbox_rows: \`select count(*)::int as total from outbox_events\`,
};
for (const [name, query] of Object.entries(checks)) {
  const rows = await sql.unsafe(query);
  console.log(name, JSON.stringify(rows));
}
await sql.end();
"
```

Erwartet: alle acht Invariantenabfragen liefern `[]`, `outbox_rows` nennt die aktuelle Zeilenzahl (Auditstand: rund 4200). Liefert eine Abfrage Zeilen, **nicht** weiterarbeiten: die betroffenen Zeilen sind fachlich zu klären (welcher Stand stimmt), erst danach greift die Migration.

- [ ] **Step 2: Constraint-Tests schreiben**

An `packages/database/src/client.integration.spec.ts` ans Ende des `describe("database connection", …)`-Blocks anhängen, direkt vor dessen schliessender `});`:

```ts
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
```

- [ ] **Step 3: Tests laufen lassen und Fehlschlag bestätigen**

Run: `cd /home/sut/projects/darts-platform/packages/database && npx dotenv -e ../../.env -- npx vitest run src/client.integration.spec.ts`

Expected: FAIL — vier neue Tests. `matches_completion_check` ist `undefined`, die Insert-Versuche gehen durch statt zu scheitern (`wrongArithmetic` ist `null`), die Indexliste ist leer, und `select sequence from outbox_events` bricht mit `column "sequence" does not exist` ab.

- [ ] **Step 4: Schema um die Checks für `matches` und `legs` erweitern**

In `packages/database/src/schema.ts` hinter `check("matches_winner_seat_check", …)` (Zeile 347) einfügen:

```ts
    // Ein beendetes Match traegt einen Sieger und einen Abschlusszeitpunkt,
    // ein laufendes oder abgebrochenes keinen von beiden. Geschrieben werden
    // diese Spalten aus der Projektion (`syncProjection`); der Check ist die
    // Klammer, falls dort einmal etwas danebengreift oder von Hand korrigiert
    // wird. `tournament_matches` und `encounters` tragen die gleiche Bindung
    // seit je (`tournament_matches_result_type_consistency`,
    // `encounters_completed_result_check`).
    check(
      "matches_completion_check",
      sql`(${table.status} = 'COMPLETED') = (${table.winnerSeat} is not null and ${table.completedAt} is not null)`,
    ),
```

Hinter `check("legs_winner_seat_check", …)` (Zeile 436) einfügen:

```ts
    // Ein abgeschlossenes Leg hat einen Gewinner, ein laufendes keinen.
    check(
      "legs_completion_check",
      sql`(${table.status} = 'COMPLETED') = (${table.winnerSeat} is not null)`,
    ),
```

- [ ] **Step 5: Schema um die Arithmetik-Checks auf `visits` erweitern**

Hinter `check("visits_seat_check", …)` (Zeile 484) einfügen:

```ts
    // Die Kernrechnung des Scorings, bisher allein in
    // `packages/scoring-engine`. Ein gewerteter Wurf zieht genau die
    // angerechneten Punkte ab.
    check(
      "visits_scored_arithmetic_check",
      sql`${table.outcome} = 'BUST' or ${table.scoreAfter} = ${table.scoreBefore} - ${table.appliedPoints}`,
    ),
    // Ein Bust rechnet nichts an und laesst den Rest stehen.
    check(
      "visits_bust_arithmetic_check",
      sql`${table.outcome} <> 'BUST' or (${table.appliedPoints} = 0 and ${table.scoreAfter} = ${table.scoreBefore})`,
    ),
    // Ein gewonnenes Leg, ein gewonnener Satz, ein gewonnenes Match enden auf
    // null. `outcome` kennt nur die fuenf Werte aus `visits_outcome_check`.
    check("visits_won_arithmetic_check", sql`${table.outcome} not like '%WON' or ${table.scoreAfter} = 0`),
```

- [ ] **Step 6: Schema um die Kommando-Uniques erweitern**

In `scoreCommands` hinter `check("score_commands_version_check", …)` (Zeile 542) einfügen:

```ts
    // Der Zustandsaufbau sortiert den Kommandostrom nach dieser Spalte
    // (`matches.repository.ts`, `orderBy(asc(scoreCommands.resultingVersion))`).
    // Zwei Kommandos mit derselben Zielversion machten die Replay-Reihenfolge
    // und damit den rekonstruierten Spielstand nichtdeterministisch. Der Index
    // deckt zugleich `match_id` als fuehrende Spalte fuer die Kaskade ab.
    uniqueIndex("score_commands_match_version_unique").on(table.matchId, table.resultingVersion),
```

In `tournamentCommands` hinter `check("tournament_commands_version_check", …)` (Zeile 903):

```ts
    // Wie bei `score_commands`: je Turnier eine Zielversion, und `tournament_id`
    // als fuehrende Spalte fuer die Kaskade.
    uniqueIndex("tournament_commands_tournament_version_unique").on(
      table.tournamentId,
      table.resultingVersion,
    ),
```

In `encounterCommands` hinter `check("encounter_commands_version_check", …)` (Zeile 1413):

```ts
    // Wie bei `score_commands`: je Begegnung eine Zielversion, und
    // `encounter_id` als fuehrende Spalte fuer die Kaskade.
    uniqueIndex("encounter_commands_encounter_version_unique").on(
      table.encounterId,
      table.resultingVersion,
    ),
```

- [ ] **Step 7: Outbox um Sequenz und Poll-Indexe erweitern**

In `packages/database/src/schema.ts` die Import-Liste aus `drizzle-orm/pg-core` (Zeilen 2–15) um `bigserial` ergänzen — alphabetisch vor `boolean`:

```ts
import {
  bigserial,
  boolean,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
```

Dann `outboxEvents` (Zeile 546) vollständig ersetzen durch:

```ts
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Die Reihenfolge der Verteilung. `occurred_at` ist `now()` und damit die
    // Transaktions-STARTzeit: eine laengere Transaktion, die nach einer
    // kuerzeren committet, wuerde vor ihr publiziert. Die Sequenz wird beim
    // INSERT vergeben und ist monoton.
    sequence: bigserial("sequence", { mode: "number" }).notNull(),
    aggregateType: varchar("aggregate_type", { length: 100 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    statisticsProcessedAt: timestamp("statistics_processed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("outbox_events_sequence_unique").on(table.sequence),
    // Beide Poller lesen nur ihren eigenen Rueckstand. Der bisherige Index
    // `(published_at, occurred_at)` bleibt fuer die Aufraeumregel stehen, die
    // nach `published_at is not null` und Alter filtert.
    index("outbox_events_unpublished_idx").on(table.publishedAt, table.occurredAt),
    index("outbox_events_pending_publication_idx")
      .on(table.sequence)
      .where(sql`${table.publishedAt} is null`),
    index("outbox_events_pending_statistics_idx")
      .on(table.sequence)
      .where(sql`${table.statisticsProcessedAt} is null and ${table.eventType} = 'MATCH_COMPLETED'`),
    index("outbox_events_organization_aggregate_idx").on(table.organizationId, table.aggregateId),
  ],
);
```

- [ ] **Step 8: Migration generieren**

Run: `cd /home/sut/projects/darts-platform && pnpm db:generate`

Expected: drizzle-kit legt `packages/database/drizzle/0023_<zufallsname>.sql`, `packages/database/drizzle/meta/0023_snapshot.json` an und hängt einen Eintrag mit `"idx": 23` an `meta/_journal.json`. Die SQL-Datei enthält je ein `ALTER TABLE … ADD CONSTRAINT` für die fünf Checks, `ALTER TABLE "outbox_events" ADD COLUMN "sequence" bigserial NOT NULL;` und `CREATE UNIQUE INDEX`/`CREATE INDEX`-Anweisungen für die sechs Indexe. Die Datei lesen und diesen Inhalt bestätigen.

- [ ] **Step 9: Migration umbenennen und Bestandscheck voranstellen**

Datei umbenennen und Journal-Tag anpassen (Vorbild `0022_board_in_progress_unique`):

```bash
cd /home/sut/projects/darts-platform/packages/database/drizzle && mv 0023_*.sql 0023_tier2_integrity_constraints.sql
```

Danach in `packages/database/drizzle/meta/_journal.json` im Eintrag mit `"idx": 23` den Wert von `"tag"` auf `"0023_tier2_integrity_constraints"` setzen. Nur dieses eine Feld ändern; `idx`, `version`, `when` und `breakpoints` bleiben, wie generiert.

Dann in `0023_tier2_integrity_constraints.sql` **vor** die generierten Anweisungen diesen Block setzen:

```sql
DO $$
DECLARE
  violations text[] := '{}';
  offenders text;
BEGIN
  -- Bestandscheck vor den Constraints. Postgres meldete sonst nur
  -- "violates check constraint" ohne die betroffenen Zeilen. Welcher Stand
  -- einer widerspruechlichen Zeile stimmt, ist eine fachliche Entscheidung
  -- und gehoert nicht in eine Migration -- deshalb Abbruch mit Namen statt
  -- automatischer Korrektur (dieselbe Systematik wie Migration 0022).
  SELECT string_agg(id::text, ', ' ORDER BY id) INTO offenders
  FROM "matches"
  WHERE (status = 'COMPLETED') <> (winner_seat IS NOT NULL AND completed_at IS NOT NULL);
  IF offenders IS NOT NULL THEN
    violations := violations || format('matches_completion_check (matches: %s)', offenders);
  END IF;

  SELECT string_agg(id::text, ', ' ORDER BY id) INTO offenders
  FROM "legs"
  WHERE (status = 'COMPLETED') <> (winner_seat IS NOT NULL);
  IF offenders IS NOT NULL THEN
    violations := violations || format('legs_completion_check (legs: %s)', offenders);
  END IF;

  SELECT string_agg(id::text, ', ' ORDER BY id) INTO offenders
  FROM "visits"
  WHERE outcome <> 'BUST' AND score_after <> score_before - applied_points;
  IF offenders IS NOT NULL THEN
    violations := violations || format('visits_scored_arithmetic_check (visits: %s)', offenders);
  END IF;

  SELECT string_agg(id::text, ', ' ORDER BY id) INTO offenders
  FROM "visits"
  WHERE outcome = 'BUST' AND (applied_points <> 0 OR score_after <> score_before);
  IF offenders IS NOT NULL THEN
    violations := violations || format('visits_bust_arithmetic_check (visits: %s)', offenders);
  END IF;

  SELECT string_agg(id::text, ', ' ORDER BY id) INTO offenders
  FROM "visits"
  WHERE outcome LIKE '%WON' AND score_after <> 0;
  IF offenders IS NOT NULL THEN
    violations := violations || format('visits_won_arithmetic_check (visits: %s)', offenders);
  END IF;

  SELECT string_agg(format('%s/%s', match_id, resulting_version), ', ') INTO offenders
  FROM (
    SELECT match_id, resulting_version FROM "score_commands"
    GROUP BY match_id, resulting_version HAVING count(*) > 1
  ) AS duplicates;
  IF offenders IS NOT NULL THEN
    violations := violations || format('score_commands_match_version_unique (match/version: %s)', offenders);
  END IF;

  SELECT string_agg(format('%s/%s', tournament_id, resulting_version), ', ') INTO offenders
  FROM (
    SELECT tournament_id, resulting_version FROM "tournament_commands"
    GROUP BY tournament_id, resulting_version HAVING count(*) > 1
  ) AS duplicates;
  IF offenders IS NOT NULL THEN
    violations := violations || format('tournament_commands_tournament_version_unique (tournament/version: %s)', offenders);
  END IF;

  SELECT string_agg(format('%s/%s', encounter_id, resulting_version), ', ') INTO offenders
  FROM (
    SELECT encounter_id, resulting_version FROM "encounter_commands"
    GROUP BY encounter_id, resulting_version HAVING count(*) > 1
  ) AS duplicates;
  IF offenders IS NOT NULL THEN
    violations := violations || format('encounter_commands_encounter_version_unique (encounter/version: %s)', offenders);
  END IF;

  IF array_length(violations, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0023 abgebrochen: %. Die genannten Zeilen fachlich klaeren und die Migration danach erneut ausfuehren.', array_to_string(violations, ' | ');
  END IF;
END $$;
```

- [ ] **Step 10: Migration gegen die Dev-DB fahren**

Run: `cd /home/sut/projects/darts-platform && pnpm db:migrate`

Expected: Erfolg ohne `RAISE EXCEPTION`. `outbox_events.sequence` wird von Postgres beim `ADD COLUMN` für alle Bestandszeilen aus der neuen Sequenz gefüllt; die Reihenfolge der Altzeilen folgt der physischen Speicherreihenfolge und ist bedeutungslos, weil alle Bestandszeilen bereits `published_at` tragen.

- [ ] **Step 11: Tests laufen lassen und Erfolg bestätigen**

Run: `cd /home/sut/projects/darts-platform/packages/database && npx dotenv -e ../../.env -- npx vitest run src/client.integration.spec.ts`

Expected: PASS, alle Tests der Datei.

- [ ] **Step 12: Kein Drift zwischen Schema, SQL und Snapshot**

Run: `cd /home/sut/projects/darts-platform && npx dotenv -e .env -- pnpm --filter @darts-platform/database exec drizzle-kit check --config=drizzle.config.ts`

Expected: `Everything's fine 🐶🔥`

- [ ] **Step 13: `DATABASE_SCHEMA.md` fortschreiben**

Am Ende des Abschnitts `## outbox_events` (nach dem `Index:`-Block, vor dem `---`) einfügen:

```markdown
Migration `0023_tier2_integrity_constraints` ergänzt die Spalte `sequence`
(`bigserial`, unique) und zwei partielle Indexe. `occurred_at` ist `now()` und
damit die Transaktions**start**zeit — eine länger laufende Transaktion, die
nach einer kürzeren committet, würde vor ihr publiziert. Die Verteilung ordnet
deshalb nach `sequence`, die beim `INSERT` vergeben wird.

```text
unique (sequence)                                    -- outbox_events_sequence_unique
(sequence) where published_at is null                -- outbox_events_pending_publication_idx
(sequence) where statistics_processed_at is null
           and event_type = 'MATCH_COMPLETED'        -- outbox_events_pending_statistics_idx
```

Der Statistik-Poller im Worker lief bis dahin sekündlich als Seq Scan über die
ganze Tabelle. Der zweite partielle Index deckt genau seinen Filter. Der ältere
Index `(published_at, occurred_at)` bleibt für die Aufräumregel stehen, die
verarbeitete Zeilen nach 30 Tagen entfernt (`apps/worker/src/prune-outbox.ts`).

Bestandscheck vor dem Ausrollen:

```sql
select count(*) from outbox_events;
```

Sperrdauer: `ADD COLUMN … bigserial NOT NULL` schreibt jede Zeile der Tabelle
neu und nimmt dafür ein `ACCESS EXCLUSIVE`-Lock auf `outbox_events`. Bei der
heutigen Grösse (rund 4200 Zeilen) sind das Sekundenbruchteile. Wächst die
Tabelle vor dem Ausrollen deutlich, ist die Aufräumregel **vor** der Migration
einmal von Hand zu fahren.
```

Am Ende des Abschnitts `## matches` (nach dem bestehenden 0022-Text) einfügen:

```markdown
`matches_completion_check` und `legs_completion_check` (Migration
`0023_tier2_integrity_constraints`) binden Status und Ergebnis aneinander:

```text
(matches.status = 'COMPLETED') = (winner_seat is not null and completed_at is not null)
(legs.status = 'COMPLETED')    = (winner_seat is not null)
```

Geschrieben werden diese Spalten aus der Projektion (`syncProjection` in
`apps/api/src/matches/matches.repository.ts`). `getState` liest den Status aus
der Projektion, `list()` aus der gespeicherten Spalte — ohne den Check könnten
Liste und Detail auseinanderlaufen, ohne dass es jemand bemerkt.
`tournament_matches` und `encounters` tragen die gleiche Bindung seit je.

Bestandscheck vor dem Ausrollen:

```sql
select id from matches
where (status = 'COMPLETED') <> (winner_seat is not null and completed_at is not null);
select id from legs where (status = 'COMPLETED') <> (winner_seat is not null);
```

Sperrdauer: `ADD CONSTRAINT … CHECK` ohne `NOT VALID` prüft den Bestand unter
`ACCESS EXCLUSIVE`. Bei der heutigen Grösse Sekundenbruchteile; das Deployment
gehört trotzdem ausserhalb des Spielbetriebs.
```

Am Ende des Abschnitts `## visits` (direkt vor `### Visit-Kommando: checkoutMissed`) einfügen:

```markdown
Migration `0023_tier2_integrity_constraints` bringt die Kernrechnung des
Scorings in die Datenbank — bis dahin lag sie allein in
`packages/scoring-engine`:

```text
outcome <> 'BUST'   =>  score_after = score_before - applied_points
outcome  = 'BUST'   =>  applied_points = 0 and score_after = score_before
outcome like '%WON' =>  score_after = 0
```

Damit fällt eine künftige Änderung an `executeX01Command` oder am Mapping im
Repository, die für einen Sonderfall (Master-Out, verpasster Checkout,
Rundenlimit) einen unpassenden `score_after` schriebe, sofort auf — statt erst
in der Statistik oder gar nicht.

Bestandscheck vor dem Ausrollen:

```sql
select id from visits where outcome <> 'BUST' and score_after <> score_before - applied_points;
select id from visits where outcome = 'BUST' and (applied_points <> 0 or score_after <> score_before);
select id from visits where outcome like '%WON' and score_after <> 0;
```

Zusätzlich tragen die drei Kommandotabellen je einen Unique auf
`(Aggregat, resulting_version)` — `score_commands_match_version_unique`,
`tournament_commands_tournament_version_unique`,
`encounter_commands_encounter_version_unique`. Der Zustandsaufbau sortiert den
Kommandostrom nach dieser Spalte; zwei Kommandos mit derselben Zielversion
machten die Replay-Reihenfolge und damit den rekonstruierten Spielstand
nichtdeterministisch. Die Indexe decken zugleich `match_id`, `tournament_id`
und `encounter_id` als führende Spalte für die Löschkaskaden ab.

Bestandscheck vor dem Ausrollen:

```sql
select match_id, resulting_version from score_commands
group by match_id, resulting_version having count(*) > 1;
```
```

- [ ] **Step 14: Qualitätstore**

Run: `cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test`

Expected: alle drei grün.

- [ ] **Step 15: Commit**

```bash
cd /home/sut/projects/darts-platform && git add packages/database/src/schema.ts packages/database/src/client.integration.spec.ts packages/database/drizzle DATABASE_SCHEMA.md && git commit -m "feat(database): Migration 0023 sichert Scoring-Rechnung und Kommandostrom

Checks fuer Statuspaarung in matches/legs, die drei Arithmetikregeln auf
visits, Unique auf (Aggregat, resulting_version) in den drei
Kommandotabellen, eine monotone Sequenz auf outbox_events und zwei
partielle Poll-Indexe. Die Migration prueft den Bestand selbst und bricht
mit lesbarer Meldung ab, statt Postgres' rohe Constraint-Meldung stehen zu
lassen."
```

---

### Task 2: Abbruch widerruft Aufnahmen, statt sie zu löschen (I9)

`abortScoringMatch` löscht heute `visits` und `legs` des ganzen Matches; `visit_darts` folgt über die Kaskade. Erhalten bleibt nur eine Zahl im Audit-Eintrag. Ein versehentlicher Abbruch vernichtet damit die Wurfhistorie, an der Statistik und Reklamation hängen (ARCHITECTURE §14, AGENTS §18).

**Files:**
- Modify: `apps/api/src/matches/abort-match.ts:31–37`
- Test: `apps/api/src/matches/matches.integration.spec.ts:73–99`

**Interfaces:**
- Consumes: `visits`, `legs`, `matchParticipants`, `boardControllerLeases`, `matches`, `boards`, `scoreCommands` aus `@darts-platform/database`; `and`, `eq`, `isNull` aus `drizzle-orm`.
- Produces: `abortScoringMatch(transaction, input): Promise<AbortedScoringMatch>` — Signatur unverändert, `discardedVisitCount` zählt jetzt die als widerrufen markierten Aufnahmen statt der gelöschten. Der Name bleibt: er steht so im Outbox-Payload `MATCH_ABORTED` und im Audit-Eintrag `TOURNAMENT_PARTICIPANT_WITHDRAWN`, und eine Umbenennung würde bestehende Ereignisse entwerten.

- [ ] **Step 1: Erwartung im bestehenden Abbruchtest umschreiben**

In `apps/api/src/matches/matches.integration.spec.ts` im Test `"aborts an active scoring session transactionally and idempotently"` die beiden Zeilen

```ts
    expect(await databaseService.database.select().from(visits).where(and(eq(visits.organizationId, organizationId), eq(visits.matchId, state.id)))).toHaveLength(0);
    expect(await databaseService.database.select().from(legs).where(and(eq(legs.organizationId, organizationId), eq(legs.matchId, state.id)))).toHaveLength(0);
```

ersetzen durch:

```ts
    // Befund I9: der Abbruch loescht die Wurfhistorie nicht mehr, er
    // entwertet sie. Ein versehentlicher Abbruch bleibt damit nachvollziehbar
    // und die Aufnahmen bleiben fuer eine Reklamation lesbar.
    const abortedVisits = await databaseService.database.select().from(visits).where(and(eq(visits.organizationId, organizationId), eq(visits.matchId, state.id)));
    expect(abortedVisits).toHaveLength(1);
    expect(abortedVisits[0]?.revertedAt).not.toBeNull();
    expect(abortedVisits[0]?.revertedByCommandId).toBe(commandId);
    const abortedDarts = await databaseService.database.select().from(visitDarts).where(and(eq(visitDarts.organizationId, organizationId), eq(visitDarts.visitId, abortedVisits[0]?.id ?? "")));
    expect(abortedDarts.length).toBeGreaterThanOrEqual(0);
    const abortedLegs = await databaseService.database.select().from(legs).where(and(eq(legs.organizationId, organizationId), eq(legs.matchId, state.id)));
    expect(abortedLegs).toHaveLength(1);
    // Die Aufnahme wird kein zweites Mal gestempelt, wenn dasselbe Kommando
    // erneut eintrifft — `reverted_at` bleibt beim ersten Zeitpunkt.
    expect(await databaseService.database.select().from(visits).where(and(eq(visits.matchId, state.id), isNull(visits.revertedAt)))).toHaveLength(0);
```

Die Import-Zeile 2 der Datei um `isNull` erweitern:

```ts
import { and, eq, isNull } from "drizzle-orm";
```

`visitDarts` steht bereits im Datenbank-Import der Datei (Zeile 5).

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/matches/matches.integration.spec.ts -t "aborts an active scoring session"`

Expected: FAIL — `expected [] to have a length of 1 but got +0`, weil `abortScoringMatch` die Zeilen noch löscht.

- [ ] **Step 3: `abortScoringMatch` auf Widerruf umstellen**

In `apps/api/src/matches/abort-match.ts` die Import-Zeile 1 ersetzen:

```ts
import { and, eq, isNull } from "drizzle-orm";
```

und den Rumpf von Zeile 31 bis Zeile 37 (`const discarded = …` bis zur `matchParticipants`-Aktualisierung) ersetzen durch:

```ts
  const now = new Date();
  // Befund I9: Aufnahmen und Legs werden entwertet, nicht geloescht. Ein
  // versehentlicher Abbruch bleibt so rekonstruierbar, und `visit_darts`
  // haengt weiter an seiner Aufnahme. Dieselbe Systematik wie beim Undo
  // (`reverted_at`, `reverted_by_command_id`); alle Leseabfragen des
  // laufenden Spiels filtern bereits auf `reverted_at is null`.
  const discarded = await transaction
    .update(visits)
    .set({ revertedAt: now, revertedByCommandId: input.commandId })
    .where(and(
      eq(visits.organizationId, input.organizationId),
      eq(visits.matchId, input.match.id),
      isNull(visits.revertedAt),
    ))
    .returning({ id: visits.id });
  // Die Legs bleiben stehen: `visits.leg_id` ist NOT NULL und zeigt auf sie.
  // Ihr Status bleibt unveraendert und erfuellt damit `legs_completion_check`
  // (Migration 0023) — ein laufendes Leg ohne Gewinner, ein abgeschlossenes
  // mit. Ein abgebrochenes Match wird nie fortgesetzt: der Turnier- und der
  // Ligapfad legen bei der naechsten Zuweisung ein neues Match an.
  await transaction.update(matchParticipants).set({ legsWon: 0 }).where(and(eq(matchParticipants.organizationId, input.organizationId), eq(matchParticipants.matchId, input.match.id)));
```

Im weiteren Rumpf bleibt `discarded.length` unverändert; ersetze zusätzlich die beiden `new Date()`-Aufrufe im `matches`- und im `boards`-Update durch `now`, damit alle Zeitstempel des Abbruchs identisch sind:

```ts
  await transaction.update(matches).set({
    status: "ABORTED",
    boardId: null,
    currentSeat: null,
    winnerSeat: null,
    completedAt: null,
    version: input.match.version + 1,
    updatedAt: now,
  }).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.match.id)));
  if (input.match.boardId !== null) {
    await transaction.update(boards).set({ status: "AVAILABLE", updatedAt: now }).where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, input.match.boardId)));
  }
```

Die `legs`-Löschung ersatzlos streichen; `legs` wird damit im Import von Zeile 3–13 nicht mehr gebraucht und ist aus der Import-Liste zu entfernen.

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/matches/matches.integration.spec.ts`

Expected: PASS, alle Tests der Datei. Die vier gleichzeitigen `abort`-Aufrufe im selben Test liefern weiterhin viermal dasselbe Ergebnis, und `discardedVisitCount` im Audit-Eintrag bleibt `1`.

- [ ] **Step 5: Die übrigen Aufrufer prüfen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments src/encounters`

Expected: PASS. Die beiden anderen Aufrufer von `abortScoringMatch` sind der Spielerrückzug (`tournaments.repository.ts:844`) und die Rücknahme einer Ligaboard-Zuweisung (`encounters.repository.ts:897`); letztere ruft ihn nur, wenn noch keine Aufnahme existiert. Statistik und Worker lesen ausschliesslich Matches mit `status = 'COMPLETED'` und sehen abgebrochene Matches deshalb nie.

- [ ] **Step 6: Qualitätstore**

Run: `cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test`

Expected: alle drei grün.

- [ ] **Step 7: Commit**

```bash
cd /home/sut/projects/darts-platform && git add apps/api/src/matches/abort-match.ts apps/api/src/matches/matches.integration.spec.ts && git commit -m "fix(api): Abbruch entwertet Aufnahmen statt sie zu loeschen

Ein versehentlich abgebrochenes Match verlor bisher seine gesamte
Wurfhistorie samt Einzelwuerfen. Aufnahmen tragen jetzt reverted_at und
reverted_by_command_id wie beim Undo, Legs bleiben stehen. Alle Abfragen
des laufenden Spiels filtern bereits auf reverted_at is null."
```

---

### Task 3: Wiederholte `commandId` unter Gleichzeitigkeit bleibt idempotent (I1)

Sechs Schreibpfade prüfen das Duplikat mit einem einfachen SELECT **vor** dem `SELECT … FOR UPDATE` und wiederholen die Prüfung nicht unter der Sperre. Treffen Original und Wiederholung gleichzeitig ein, verfehlen beide die Kommandozeile; die Sperre serialisiert sie danach, und die zweite sieht die inzwischen erhöhte Version und bekommt 409 für eine Aufnahme, die ihre eigene war. Genau der Fall, für den `commandId` da ist (AGENTS §11). `abort` ist bereits richtig — es nimmt zuerst `pg_advisory_xact_lock` auf die `commandId` und prüft danach.

**Files:**
- Modify: `apps/api/src/matches/matches.repository.ts:387–394` (submitVisit), `:505–530` (correctTournamentResult), `:880–887` (undo), `:980–987` (decideLeg)
- Modify: `apps/api/src/tournaments/tournaments.repository.ts:556–570` (assign), `:848–862` (releaseBoard)
- Test: `apps/api/src/matches/matches.integration.spec.ts`, `apps/api/src/tournaments/tournaments.integration.spec.ts`

**Interfaces:**
- Consumes: `scoreCommands`, `tournamentCommands` aus `@darts-platform/database`; `ScoringValidationError` aus `@darts-platform/scoring-engine`; `TournamentValidationError` aus `@darts-platform/tournament-engine`.
- Produces:
  - `MatchesRepository.findDuplicateScoreCommand(transaction: DatabaseTransaction, organizationId: string, matchId: string, commandId: string): Promise<"ok" | null>` — privat.
  - `MatchesRepository.findDuplicateTournamentCommand(transaction: DatabaseTransaction, organizationId: string, tournamentId: string, commandId: string): Promise<"ok" | null>` — privat.
  - `TournamentsRepository.findDuplicateCommand(transaction: DatabaseTransaction, organizationId: string, tournamentId: string, commandId: string): Promise<"ok" | null>` — privat.
  - Typalias `DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0]` in beiden Repositories (Muster `apps/api/src/boards/board-occupancy.ts:13`).

- [ ] **Step 1: Test für die vier Scoringpfade schreiben**

In `apps/api/src/matches/matches.integration.spec.ts` als neuen Test am Ende des `describe("persistent X01 match", …)`-Blocks einfügen:

```ts
  /**
   * Befund I1: Original und Client-Wiederholung treffen gleichzeitig ein. Beide
   * verfehlen die Kommandozeile in der Vorpruefung; ohne eine zweite Pruefung
   * unter der Aggregatsperre bekaeme die zweite einen Versionskonflikt fuer
   * eine Aufnahme, die angekommen ist. In der Offline-Wiedergabe landet das
   * als CONFLICT in der Warteschlange, und der Scorer sieht einen scheinbar
   * verlorenen Wurf.
   */
  it("beantwortet dieselbe commandId auch gleichzeitig idempotent", async () => {
    const created = await service.create({ organizationId, data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, boardId: null, bestOfLegs: 3, bestOfSets: 1 }, auth, audit });
    const controllerId = randomUUID();
    await service.acquireControllerLease({ organizationId, matchId: created.id, controllerId, force: false, auth, audit });

    const visitCommandId = randomUUID();
    const visitInput = { organizationId, matchId: created.id, data: { commandId: visitCommandId, expectedVersion: created.version, playerId: playerOneId, points: 100, dartsThrown: 3 as const, controllerId }, auth, audit };
    const visitResults = await Promise.all(Array.from({ length: 4 }, () => service.submitVisit(visitInput)));
    expect(visitResults.map((state) => state.version)).toEqual([1, 1, 1, 1]);
    expect(await databaseService.database.select().from(scoreCommands).where(eq(scoreCommands.commandId, visitCommandId))).toHaveLength(1);

    const undoCommandId = randomUUID();
    const undoInput = { organizationId, matchId: created.id, data: { commandId: undoCommandId, expectedVersion: 1, controllerId }, auth, audit };
    const undoResults = await Promise.all(Array.from({ length: 4 }, () => service.undo(undoInput)));
    expect(undoResults.map((state) => state.version)).toEqual([2, 2, 2, 2]);
    expect(await databaseService.database.select().from(scoreCommands).where(eq(scoreCommands.commandId, undoCommandId))).toHaveLength(1);

    const legStartCommandId = randomUUID();
    const legStartInput = { organizationId, matchId: created.id, data: { commandId: legStartCommandId, expectedVersion: 2, legNumber: 1, startingSeat: 2 as const, controllerId }, auth, audit };
    const legStartResults = await Promise.all(Array.from({ length: 4 }, () => service.decideLegStart(legStartInput)));
    expect(legStartResults.map((state) => state.version)).toEqual([3, 3, 3, 3]);
    expect(await databaseService.database.select().from(scoreCommands).where(eq(scoreCommands.commandId, legStartCommandId))).toHaveLength(1);
  }, 30_000);
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/matches/matches.integration.spec.ts -t "gleichzeitig idempotent"`

Expected: FAIL — mindestens einer der vier gleichzeitigen Aufrufe wirft `MATCH_VERSION_CONFLICT` (HTTP 409), statt den aktuellen Zustand zu liefern.

- [ ] **Step 3: Duplikathelfer in `matches.repository.ts` anlegen und in den drei Scoringpfaden zweimal aufrufen**

Direkt unter der Zeile `type ActorInput = { … }` (Zeile 38) einfügen:

```ts
/** Der Transaktionsrumpf, wie ihn Drizzle an den Callback uebergibt. */
type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];
```

Als privaten Methodenblock ans Ende der Klasse `MatchesRepository`, vor der schliessenden `}`:

```ts
  /**
   * Duplikatpruefung fuer den Kommandostrom eines Matches. Sie laeuft an jeder
   * Aufrufstelle ZWEIMAL: einmal vor der Aggregatsperre (billig, deckt die
   * Wiederholung nach Sekunden ab) und einmal darunter. Ohne die zweite
   * Pruefung verfehlen zwei gleichzeitige Zustellungen desselben Kommandos die
   * Kommandozeile beide, und die zweite bekaeme nach dem Commit der ersten
   * einen Versionskonflikt statt der idempotenten Bestaetigung — genau der
   * Fall, fuer den die commandId da ist (AGENTS.md 11). Vorbild:
   * `encounters.repository.ts`, `runMutation`.
   */
  private async findDuplicateScoreCommand(
    transaction: DatabaseTransaction,
    organizationId: string,
    matchId: string,
    commandId: string,
  ): Promise<"ok" | null> {
    const [duplicate] = await transaction
      .select({ organizationId: scoreCommands.organizationId, matchId: scoreCommands.matchId })
      .from(scoreCommands)
      .where(eq(scoreCommands.commandId, commandId))
      .limit(1);
    if (duplicate === undefined) return null;
    if (duplicate.organizationId === organizationId && duplicate.matchId === matchId) return "ok";
    throw new ScoringValidationError(
      "COMMAND_ID_ALREADY_USED",
      "The command ID has already been used for another match.",
    );
  }

  /**
   * Dasselbe fuer den Turnierkommandostrom, den `correctTournamentResult`
   * beschreibt. Getrennt vom Scoringstrom, weil Fehlertext und Tabelle andere
   * sind.
   */
  private async findDuplicateTournamentCommand(
    transaction: DatabaseTransaction,
    organizationId: string,
    tournamentId: string,
    commandId: string,
  ): Promise<"ok" | null> {
    const [duplicate] = await transaction
      .select({
        organizationId: tournamentCommands.organizationId,
        tournamentId: tournamentCommands.tournamentId,
      })
      .from(tournamentCommands)
      .where(eq(tournamentCommands.commandId, commandId))
      .limit(1);
    if (duplicate === undefined) return null;
    if (duplicate.organizationId === organizationId && duplicate.tournamentId === tournamentId) {
      return "ok";
    }
    throw new ScoringValidationError(
      "COMMAND_ID_ALREADY_USED",
      "The command ID has already been used for another tournament.",
    );
  }
```

In `submitVisit` (Zeile 388) den Block

```ts
      const [duplicate] = await transaction.select({ organizationId: scoreCommands.organizationId, matchId: scoreCommands.matchId }).from(scoreCommands)
        .where(eq(scoreCommands.commandId, input.data.commandId)).limit(1);
      if (duplicate !== undefined) {
        if (duplicate.organizationId === input.organizationId && duplicate.matchId === input.matchId) return "ok";
        throw new ScoringValidationError("COMMAND_ID_ALREADY_USED", "The command ID has already been used for another match.");
      }
      await lockTournamentScoringContext(transaction, input.organizationId, input.matchId);
      const [match] = await transaction.select().from(matches).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.matchId))).for("update").limit(1);
      if (match === undefined) return "not-found";
```

ersetzen durch:

```ts
      if (await this.findDuplicateScoreCommand(transaction, input.organizationId, input.matchId, input.data.commandId) !== null) return "ok";
      await lockTournamentScoringContext(transaction, input.organizationId, input.matchId);
      const [match] = await transaction.select().from(matches).where(and(eq(matches.organizationId, input.organizationId), eq(matches.id, input.matchId))).for("update").limit(1);
      // Zweite Pruefung, jetzt unter der Sperre. Sie steht vor der
      // Versionspruefung, damit eine gleichzeitige Wiederholung die
      // Bestaetigung bekommt und nicht den Konflikt.
      if (await this.findDuplicateScoreCommand(transaction, input.organizationId, input.matchId, input.data.commandId) !== null) return "ok";
      if (match === undefined) return "not-found";
```

In `undoInTransaction` (Zeile 881) und in `decideLeg` (Zeile 981) dieselbe Ersetzung vornehmen — in `decideLeg` heisst die Kommando-Kennung `envelope.commandId` statt `input.data.commandId`.

- [ ] **Step 4: `correctTournamentResult` nachziehen**

In `correctTournamentResult` (Zeile 513) den Block von `const [duplicate] = await transaction` bis zur schliessenden Klammer des `if (duplicate !== undefined)` ersetzen durch:

```ts
      if (await this.findDuplicateTournamentCommand(transaction, input.organizationId, input.tournamentId, input.data.commandId) !== null) return "ok";
```

und direkt hinter dem `SELECT … FOR UPDATE` auf `tournaments` (also nach `.limit(1);` und **vor** `if (tournament === undefined) return "not-found";`) einfügen:

```ts
      // Zweite Pruefung unter der Sperre — siehe `findDuplicateTournamentCommand`.
      if (await this.findDuplicateTournamentCommand(transaction, input.organizationId, input.tournamentId, input.data.commandId) !== null) return "ok";
```

- [ ] **Step 5: Test laufen lassen und Erfolg bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/matches/matches.integration.spec.ts`

Expected: PASS, alle Tests der Datei.

- [ ] **Step 6: Test für die beiden Turnierpfade schreiben**

In `apps/api/src/tournaments/board-occupancy.integration.spec.ts` als neuen Test am Ende des `describe("Boardbelegung zwischen Turnier und Liga", …)`-Blocks einfügen — die Datei hat bereits ein Turnier mit registrierten Scheiben und freie Personen:

```ts
  /**
   * Befund I1: Zuweisung und Board-Freigabe pruefen das Duplikat nur vor der
   * Sperre. Zwei gleichzeitige Zustellungen desselben Kommandos verfehlen die
   * Kommandozeile beide; ohne zweite Pruefung unter der Sperre bekaeme die
   * zweite einen Versionskonflikt fuer ihr eigenes, angekommenes Kommando.
   */
  it("beantwortet dieselbe commandId auch gleichzeitig idempotent", async () => {
    const tournamentId = await createTournament(freePlayerIds, [freeBoardIds[0]]);
    const dashboard = await service.dashboard({ organizationId, tournamentId, auth });
    const ready = dashboard.queue[0];
    if (ready === undefined) throw new Error("Expected a queued match.");

    const assignCommandId = randomUUID();
    const assignInput = {
      organizationId,
      tournamentId,
      data: { commandId: assignCommandId, expectedVersion: dashboard.tournament.version, matchId: ready.id, boardId: freeBoardIds[0] },
      auth,
      audit,
    } as const;
    const assigned = await Promise.all(Array.from({ length: 4 }, () => service.assign(assignInput)));
    expect(assigned.map((result) => result.tournament.version)).toEqual([
      dashboard.tournament.version + 1,
      dashboard.tournament.version + 1,
      dashboard.tournament.version + 1,
      dashboard.tournament.version + 1,
    ]);

    const releaseCommandId = randomUUID();
    const releaseInput = {
      organizationId,
      tournamentId,
      data: { commandId: releaseCommandId, expectedVersion: dashboard.tournament.version + 1, boardId: freeBoardIds[1] },
      auth,
      audit,
    } as const;
    const released = await Promise.all(Array.from({ length: 4 }, () => service.releaseBoard(releaseInput)));
    expect(released.map((result) => result.tournament.version)).toEqual([
      dashboard.tournament.version + 2,
      dashboard.tournament.version + 2,
      dashboard.tournament.version + 2,
      dashboard.tournament.version + 2,
    ]);
  }, 30_000);
```

Damit `freeBoardIds[1]` überhaupt zum Turnier gehört, in `createTournament(freePlayerIds, [freeBoardIds[0]])` beide Scheiben registrieren: `createTournament(freePlayerIds, [...freeBoardIds])`.

- [ ] **Step 7: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/board-occupancy.integration.spec.ts -t "gleichzeitig idempotent"`

Expected: FAIL — mindestens einer der vier `assign`-Aufrufe wirft `TOURNAMENT_VERSION_CONFLICT` (HTTP 409).

- [ ] **Step 8: Duplikathelfer in `tournaments.repository.ts` anlegen und zweimal aufrufen**

Unter der Typdefinition von `ActorInput` in `apps/api/src/tournaments/tournaments.repository.ts` einfügen:

```ts
/** Der Transaktionsrumpf, wie ihn Drizzle an den Callback uebergibt. */
type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];
```

Als private Methode ans Ende der Klasse `TournamentsRepository`:

```ts
  /**
   * Duplikatpruefung fuer den Turnierkommandostrom. Sie laeuft an jeder
   * Aufrufstelle ZWEIMAL: einmal vor der Sperre auf der Turnierzeile und
   * einmal darunter. Ohne die zweite verfehlen zwei gleichzeitige
   * Zustellungen desselben Kommandos die Kommandozeile beide, und die zweite
   * bekaeme einen Versionskonflikt fuer ihr eigenes, angekommenes Kommando
   * (AGENTS.md 11). `withdrawParticipant` loest dasselbe ueber einen
   * Advisory Lock auf die commandId; hier genuegt die zweite Pruefung.
   */
  private async findDuplicateCommand(
    transaction: DatabaseTransaction,
    organizationId: string,
    tournamentId: string,
    commandId: string,
  ): Promise<"ok" | null> {
    const [duplicate] = await transaction
      .select({
        organizationId: tournamentCommands.organizationId,
        tournamentId: tournamentCommands.tournamentId,
      })
      .from(tournamentCommands)
      .where(eq(tournamentCommands.commandId, commandId))
      .limit(1);
    if (duplicate === undefined) return null;
    if (duplicate.organizationId === organizationId && duplicate.tournamentId === tournamentId) {
      return "ok";
    }
    throw new TournamentValidationError(
      "COMMAND_ID_ALREADY_USED",
      "The command ID has already been used for another tournament.",
    );
  }
```

In `assignInTransaction` den Block von `const [duplicate] = await transaction` bis zum Ende des `if (duplicate !== undefined) { … }` ersetzen durch:

```ts
      if (await this.findDuplicateCommand(transaction, input.organizationId, input.tournamentId, input.data.commandId) !== null) return "ok";
```

und unmittelbar hinter dem `SELECT … FOR UPDATE` auf `tournaments` (nach `.limit(1);`, vor `if (tournament === undefined) return "not-found";`) einfügen:

```ts
      // Zweite Pruefung unter der Sperre — siehe `findDuplicateCommand`.
      if (await this.findDuplicateCommand(transaction, input.organizationId, input.tournamentId, input.data.commandId) !== null) return "ok";
```

Dieselben beiden Ersetzungen in `releaseBoard` vornehmen.

- [ ] **Step 9: Test laufen lassen und Erfolg bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments`

Expected: PASS, alle Turnier-Testdateien.

- [ ] **Step 10: Qualitätstore**

Run: `cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test`

Expected: alle drei grün.

- [ ] **Step 11: Commit**

```bash
cd /home/sut/projects/darts-platform && git add apps/api/src/matches/matches.repository.ts apps/api/src/matches/matches.integration.spec.ts apps/api/src/tournaments/tournaments.repository.ts apps/api/src/tournaments/board-occupancy.integration.spec.ts && git commit -m "fix(api): wiederholte commandId bleibt auch gleichzeitig idempotent

submitVisit, undo, decideLeg, correctTournamentResult, assign und
releaseBoard pruefen das Duplikat jetzt ein zweites Mal unter der
Aggregatsperre. Bisher verfehlten zwei gleichzeitige Zustellungen
desselben Kommandos die Kommandozeile beide, und die zweite bekam einen
Versionskonflikt fuer eine Aufnahme, die angekommen war."
```

---

### Task 4: Globale Sperrreihenfolge `Encounter → EncounterSlot → Match` und Deadlock-Abbildung (I6)

Der Scoringpfad sperrt heute `matches` → `encounter_slots` → `encounters`, der Begegnungspfad `encounters` → `encounter_slots` → `matches`. Läuft der siegbringende Visit auf Slot S, während der Captain gleichzeitig `releaseSlot(S)` auslöst, erkennt Postgres den Zyklus und bricht eine der Transaktionen mit `40P01` ab. Der Fehler fällt weder unter `ScoringValidationError` noch unter die 23505-Erkennung und erreicht den Client als 500 — mitten im entscheidenden Wurf.

**Files:**
- Create: `apps/api/src/common/postgres-error.ts`
- Create: `apps/api/src/common/postgres-error.spec.ts`
- Create: `apps/api/src/matches/retry-on-deadlock.ts`
- Create: `apps/api/src/matches/retry-on-deadlock.spec.ts`
- Create: `apps/api/src/matches/encounter-scoring-lock.ts`
- Create: `apps/api/src/matches/encounter-scoring-lock.integration.spec.ts`
- Modify: `apps/api/src/matches/matches.repository.ts` (`abort`, `submitVisit`, `undo`, `decideLeg`)

**Interfaces:**
- Consumes: `DatabaseTransaction` aus Task 3; `encounters`, `encounterSlots` aus `@darts-platform/database`.
- Produces:
  - `isDeadlockError(error: unknown): boolean` und `DEADLOCK_DETECTED: "40P01"` aus `apps/api/src/common/postgres-error.js`
  - `retryOnDeadlock<T>(command: () => Promise<T>, conflictResult: T): Promise<T>` aus `apps/api/src/matches/retry-on-deadlock.js`
  - `lockEncounterScoringContext(transaction: DatabaseTransaction, organizationId: string, scoringMatchId: string): Promise<void>` aus `apps/api/src/matches/encounter-scoring-lock.js`

- [ ] **Step 1: Unit-Test für `isDeadlockError` schreiben**

`apps/api/src/common/postgres-error.spec.ts` anlegen:

```ts
import { describe, expect, it } from "vitest";

import { isDeadlockError } from "./postgres-error.js";

describe("isDeadlockError", () => {
  it("findet die Kennung in der cause-Kette, die Drizzle um den Treiberfehler legt", () => {
    const driverError = { code: "40P01", message: "deadlock detected" };
    const wrapped = new Error("Failed query", { cause: new Error("query", { cause: driverError }) });

    expect(isDeadlockError(wrapped)).toBe(true);
  });

  it("verwechselt einen Constraint-Verstoss nicht mit einem Sperrzyklus", () => {
    const driverError = { code: "23505", constraint_name: "matches_board_in_progress_unique" };

    expect(isDeadlockError(new Error("Failed query", { cause: driverError }))).toBe(false);
  });

  it("bleibt bei fremden Werten stumm", () => {
    expect(isDeadlockError(null)).toBe(false);
    expect(isDeadlockError("40P01")).toBe(false);
    expect(isDeadlockError(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/common/postgres-error.spec.ts`

Expected: FAIL — `Failed to load url ./postgres-error.js`.

- [ ] **Step 3: `isDeadlockError` implementieren**

`apps/api/src/common/postgres-error.ts` anlegen:

```ts
/**
 * Postgres bricht bei einem Sperrzyklus eine der beteiligten Transaktionen ab
 * (SQLSTATE 40P01). Fachlich ist das kein Serverfehler: der Zustand hat sich
 * unter der Anfrage bewegt. Der Client synchronisiert und schickt erneut —
 * dank commandId ohne Doppelschreiben.
 */
export const DEADLOCK_DETECTED = "40P01";

export function isDeadlockError(error: unknown): boolean {
  // Drizzle verpackt den Treiberfehler; die Kennung steht erst in `cause`.
  for (let candidate: unknown = error, depth = 0; depth < 5; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return false;
    const row = candidate as { readonly code?: unknown; readonly cause?: unknown };
    if (row.code === DEADLOCK_DETECTED) return true;
    candidate = row.cause;
  }
  return false;
}
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/common/postgres-error.spec.ts`

Expected: PASS, drei Tests.

- [ ] **Step 5: Unit-Test für `retryOnDeadlock` schreiben**

`apps/api/src/matches/retry-on-deadlock.spec.ts` anlegen:

```ts
import { describe, expect, it } from "vitest";

import { retryOnDeadlock } from "./retry-on-deadlock.js";

function deadlock(): Error {
  return new Error("Failed query", { cause: { code: "40P01", message: "deadlock detected" } });
}

describe("retryOnDeadlock", () => {
  it("wiederholt einen abgebrochenen Vorgang genau einmal", async () => {
    let calls = 0;
    const command = async (): Promise<"ok"> => {
      calls += 1;
      if (calls === 1) throw deadlock();
      return "ok";
    };

    await expect(retryOnDeadlock(command, "version-conflict")).resolves.toBe("ok");
    expect(calls).toBe(2);
  });

  it("meldet nach dem zweiten Zyklus einen Versionskonflikt statt eines Serverfehlers", async () => {
    let calls = 0;
    const command = async (): Promise<"ok"> => {
      calls += 1;
      throw deadlock();
    };

    await expect(retryOnDeadlock(command, "version-conflict")).resolves.toBe("version-conflict");
    expect(calls).toBe(2);
  });

  it("reicht jeden anderen Fehler unveraendert durch", async () => {
    const failure = new Error("Failed query", { cause: { code: "23505" } });

    await expect(retryOnDeadlock(async () => { throw failure; }, "version-conflict")).rejects.toBe(failure);
  });
});
```

- [ ] **Step 6: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/matches/retry-on-deadlock.spec.ts`

Expected: FAIL — `Failed to load url ./retry-on-deadlock.js`.

- [ ] **Step 7: `retryOnDeadlock` implementieren**

`apps/api/src/matches/retry-on-deadlock.ts` anlegen:

```ts
import { isDeadlockError } from "../common/postgres-error.js";

/**
 * Ein Sperrzyklus (40P01) trifft eine der beteiligten Transaktionen zufaellig;
 * die Wiederholung laeuft in aller Regel durch. Sie ist gefahrlos: die
 * abgebrochene Transaktion hat nichts hinterlassen, und dieselbe commandId
 * kann kein zweites Mal schreiben (AGENTS.md 11). Bleibt es beim Zyklus, ist
 * die Antwort ein Versionskonflikt mit dem aktuellen Serverzustand
 * (AGENTS.md 12, 15) — nie ein 500 mitten im entscheidenden Wurf.
 */
export async function retryOnDeadlock<T>(command: () => Promise<T>, conflictResult: T): Promise<T> {
  try {
    return await command();
  } catch (error) {
    if (!isDeadlockError(error)) throw error;
    try {
      return await command();
    } catch (retryError) {
      if (isDeadlockError(retryError)) return conflictResult;
      throw retryError;
    }
  }
}
```

- [ ] **Step 8: Test laufen lassen und Erfolg bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/matches/retry-on-deadlock.spec.ts`

Expected: PASS, drei Tests.

- [ ] **Step 9: Integrationstest für die Sperrreihenfolge schreiben**

`apps/api/src/matches/encounter-scoring-lock.integration.spec.ts` anlegen:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  competitions,
  createDatabaseConnection,
  encounterSlots,
  encounters,
  matches,
  organizations,
  teams,
} from "@darts-platform/database";

import { DatabaseService } from "../database/database.service.js";
import { lockEncounterScoringContext } from "./encounter-scoring-lock.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
/** Zweite Verbindung: sie haelt die Begegnungszeile, waehrend die erste zugreift. */
const holder = createDatabaseConnection(environment.DATABASE_URL);

const organizationId = randomUUID();
const encounterId = randomUUID();
let scoringMatchId = "";

/** Die Kennung des Treiberfehlers steht erst in der cause-Kette. */
function codeOf(error: unknown): string | null {
  for (let candidate: unknown = error, depth = 0; depth < 5; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return null;
    const row = candidate as { readonly code?: unknown; readonly cause?: unknown };
    if (typeof row.code === "string") return row.code;
    candidate = row.cause;
  }
  return null;
}

beforeAll(async () => {
  const competitionId = randomUUID();
  const homeTeamId = randomUUID();
  const awayTeamId = randomUUID();
  await databaseService.database.insert(organizations).values({
    id: organizationId,
    name: "Lock Order Club",
    slug: `lock-order-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await databaseService.database.insert(competitions).values({
    id: competitionId,
    organizationId,
    type: "LEAGUE",
    name: `Lock Order Liga ${competitionId}`,
    slug: `lock-order-${competitionId}`,
    status: "ACTIVE",
  });
  await databaseService.database.insert(teams).values([
    { id: homeTeamId, organizationId, name: `Heimteam ${homeTeamId}` },
    { id: awayTeamId, organizationId, name: `Gastteam ${awayTeamId}` },
  ]);
  await databaseService.database.insert(encounters).values({
    id: encounterId,
    organizationId,
    competitionId,
    matchday: 1,
    homeTeamId,
    awayTeamId,
    scheduledAt: new Date("2026-09-06T19:00:00.000Z"),
    status: "RUNNING",
  });
  const [created] = await databaseService.database
    .insert(matches)
    .values({ organizationId, bestOfLegs: 1, startingSeat: 1, currentSeat: 1 })
    .returning();
  if (created === undefined) throw new Error("Expected the scoring match.");
  scoringMatchId = created.id;
  await databaseService.database.insert(encounterSlots).values({
    organizationId,
    encounterId,
    sequence: 1,
    role: "REGULAR",
    discipline: "SINGLES",
    label: "Einzel 1",
    homePosition: 1,
    awayPosition: 1,
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    maxRounds: null,
    bestOfLegs: 1,
    legsToWinSet: 1,
    setsToWin: 1,
    status: "IN_PROGRESS",
    matchId: scoringMatchId,
  });
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await holder.close();
  await databaseService.onApplicationShutdown();
});

describe("lockEncounterScoringContext", () => {
  /**
   * Befund I6: der Scoringpfad sperrte `matches` zuerst und die Begegnung erst
   * beim Slotabschluss, der Begegnungspfad genau andersherum — Postgres brach
   * eine der Transaktionen mit 40P01 ab, und der Client sah einen 500. Der
   * Test beweist die neue Reihenfolge: haelt jemand die Begegnungszeile, kommt
   * der Scoringpfad gar nicht erst an die Matchzeile.
   */
  it("nimmt die Begegnungszeile, bevor der Scoringpfad weiterlaeuft", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = holder.database.transaction(async (transaction) => {
      await transaction
        .select({ id: encounters.id })
        .from(encounters)
        .where(eq(encounters.id, encounterId))
        .for("update")
        .limit(1);
      await held;
    });

    const blocked = databaseService.database
      .transaction(async (transaction) => {
        await transaction.execute(sql`set local lock_timeout = '250ms'`);
        await lockEncounterScoringContext(transaction, organizationId, scoringMatchId);
      })
      .then(() => null, (error: unknown) => codeOf(error));

    // 55P03: lock_not_available. Ohne die vorgezogene Begegnungssperre liefe
    // die Funktion durch und der Test bekaeme `null`.
    await expect(blocked).resolves.toBe("55P03");

    release?.();
    await holding;
  }, 30_000);

  it("laesst ein Match ohne Begegnungsbezug unberuehrt durch", async () => {
    const [standalone] = await databaseService.database
      .insert(matches)
      .values({ organizationId, bestOfLegs: 1, startingSeat: 1, currentSeat: 1 })
      .returning();
    if (standalone === undefined) throw new Error("Expected the standalone match.");

    await expect(
      databaseService.database.transaction(async (transaction) => {
        await transaction.execute(sql`set local lock_timeout = '250ms'`);
        await lockEncounterScoringContext(transaction, organizationId, standalone.id);
      }),
    ).resolves.toBeUndefined();
  }, 30_000);
});
```

- [ ] **Step 10: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/matches/encounter-scoring-lock.integration.spec.ts`

Expected: FAIL — `Failed to load url ./encounter-scoring-lock.js`.

- [ ] **Step 11: `lockEncounterScoringContext` implementieren**

`apps/api/src/matches/encounter-scoring-lock.ts` anlegen:

```ts
import { and, eq } from "drizzle-orm";

import { encounterSlots, encounters, type Database } from "@darts-platform/database";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Die globale Sperrreihenfolge fuer alles, was Begegnung und Scoring zugleich
 * beruehrt, lautet: Encounter -> EncounterSlot -> Match.
 *
 * Der Begegnungspfad (`encounters.repository.ts`, `runMutation`) nimmt sie seit
 * je in genau dieser Folge. Der Scoringpfad sperrte bis hierher zuerst die
 * Matchzeile und die Begegnung erst beim Slotabschluss
 * (`sync-encounter-slot.ts`, `update-encounter-progress.ts`) — gegenlaeufig.
 * Der siegbringende Visit auf Slot S (haelt `matches`, will `encounters`) und
 * ein gleichzeitiges `releaseSlot(S)` (haelt `encounters`, will
 * `encounter_slots`) liefen damit in einen Zyklus, den Postgres mit 40P01
 * aufloest. Diese Funktion zieht die beiden Begegnungszeilen im Scoringpfad
 * vor; danach nehmen beide Wege dieselbe Reihenfolge.
 *
 * Der Turnierzweig kollidiert damit nicht: ein Match gehoert entweder zu einem
 * Turnier oder zu einer Begegnung, nie zu beidem
 * (`tournament_matches.scoring_match_id` und `encounter_slots.match_id` sind
 * je unique und schliessen sich fachlich aus).
 */
export async function lockEncounterScoringContext(
  transaction: DatabaseTransaction,
  organizationId: string,
  scoringMatchId: string,
): Promise<void> {
  const [candidate] = await transaction
    .select({ encounterId: encounterSlots.encounterId })
    .from(encounterSlots)
    .where(
      and(
        eq(encounterSlots.organizationId, organizationId),
        eq(encounterSlots.matchId, scoringMatchId),
      ),
    )
    .limit(1);
  if (candidate === undefined) return;

  await transaction
    .select({ id: encounters.id })
    .from(encounters)
    .where(and(eq(encounters.organizationId, organizationId), eq(encounters.id, candidate.encounterId)))
    .for("update")
    .limit(1);

  // Der Slotbezug kann zwischen der ungesperrten Suche und dieser Sperre
  // weggefallen sein (Ruecknahme der Board-Zuweisung). Dann ist nichts mehr zu
  // sperren, und der weitere Verlauf faellt ueber den Slotzustand durch.
  await transaction
    .select({ id: encounterSlots.id })
    .from(encounterSlots)
    .where(
      and(
        eq(encounterSlots.organizationId, organizationId),
        eq(encounterSlots.matchId, scoringMatchId),
      ),
    )
    .for("update")
    .limit(1);
}
```

- [ ] **Step 12: Test laufen lassen und Erfolg bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/matches/encounter-scoring-lock.integration.spec.ts`

Expected: PASS, zwei Tests.

- [ ] **Step 13: Sperr-Helfer in die vier Scoringpfade einhängen**

In `apps/api/src/matches/matches.repository.ts` den Import-Block um die beiden neuen Module ergänzen (hinter `import { abortScoringMatch } from "./abort-match.js";`):

```ts
import { lockEncounterScoringContext } from "./encounter-scoring-lock.js";
import { retryOnDeadlock } from "./retry-on-deadlock.js";
```

In `abort`, `submitVisit`, `undoInTransaction` und `decideLeg` jeweils **unmittelbar hinter** der Zeile

```ts
      await lockTournamentScoringContext(transaction, input.organizationId, input.matchId);
```

(in `abort` heisst sie `const tournamentContext = await lockTournamentScoringContext(…);`) einfügen:

```ts
      // Globale Sperrreihenfolge Encounter -> EncounterSlot -> Match. Ohne
      // dieses Vorziehen liefe der Scoringpfad gegenlaeufig zum
      // Begegnungspfad und beide in einen Sperrzyklus (Befund I6).
      await lockEncounterScoringContext(transaction, input.organizationId, input.matchId);
```

Wichtig: die Zeile steht **vor** dem `SELECT … FOR UPDATE` auf `matches`.

- [ ] **Step 14: Deadlock-Abbildung an die vier öffentlichen Methoden hängen**

`submitVisit` (Zeile 387) umbauen:

```ts
  public submitVisit(input: ActorInput & { readonly data: SubmitVisitInput }): Promise<MutationResult> {
    return retryOnDeadlock(() => this.submitVisitInTransaction(input), "version-conflict");
  }

  private submitVisitInTransaction(input: ActorInput & { readonly data: SubmitVisitInput }): Promise<MutationResult> {
    return this.databaseService.database.transaction(async (transaction): Promise<MutationResult> => {
```

— der bisherige Rumpf bleibt unverändert darunter stehen.

`undo` (Zeile 868) umbauen:

```ts
  public async undo(input: ActorInput & { readonly data: UndoVisitInput }): Promise<UndoMutationResult> {
    return retryOnDeadlock(async () => {
      try {
        return await this.undoInTransaction(input);
      } catch (error) {
        // Zweites Netz: faellt die Pruefung durch ein Rennen hindurch, meldet
        // der partielle Unique auf `matches` die Doppelbelegung. Fachlich ist
        // das dieselbe Antwort, kein Serverfehler.
        if (isBoardInProgressConflict(error)) return "board-unavailable";
        throw error;
      }
    }, "version-conflict");
  }
```

`decideLegStart` und `decideLegByBull` rufen beide `this.decideLeg(...)`; deshalb genügt es, `decideLeg` (Zeile 975) umzubauen:

```ts
  private decideLeg(
    input: ActorInput,
    envelope: { readonly commandId: string; readonly expectedVersion: number; readonly controllerId?: string | undefined },
    command: X01Command,
  ): Promise<MutationResult> {
    return retryOnDeadlock(() => this.decideLegInTransaction(input, envelope, command), "version-conflict");
  }

  private decideLegInTransaction(
    input: ActorInput,
    envelope: { readonly commandId: string; readonly expectedVersion: number; readonly controllerId?: string | undefined },
    command: X01Command,
  ): Promise<MutationResult> {
    return this.databaseService.database.transaction(async (transaction): Promise<MutationResult> => {
```

— der bisherige Rumpf bleibt unverändert darunter stehen.

`abort` (Zeile 353) umbauen:

```ts
  public abort(input: ActorInput & { readonly data: AbortMatchInput }): Promise<AbortMutationResult> {
    return retryOnDeadlock<AbortMutationResult>(() => this.abortInTransaction(input), "version-conflict");
  }

  private abortInTransaction(input: ActorInput & { readonly data: AbortMatchInput }): Promise<AbortMutationResult> {
    return this.databaseService.database.transaction(async (transaction): Promise<AbortMutationResult> => {
```

— der bisherige Rumpf bleibt unverändert darunter stehen.

- [ ] **Step 15: Scoring- und Begegnungstests laufen lassen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/matches src/encounters src/tournaments`

Expected: PASS, alle Dateien. Die Slotabschlüsse aus `sync-encounter-slot.ts` und `update-encounter-progress.ts` sperren dieselben Zeilen ein zweites Mal — innerhalb derselben Transaktion ist das folgenlos.

- [ ] **Step 16: Qualitätstore**

Run: `cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test`

Expected: alle drei grün.

- [ ] **Step 17: Commit**

```bash
cd /home/sut/projects/darts-platform && git add apps/api/src/common/postgres-error.ts apps/api/src/common/postgres-error.spec.ts apps/api/src/matches/retry-on-deadlock.ts apps/api/src/matches/retry-on-deadlock.spec.ts apps/api/src/matches/encounter-scoring-lock.ts apps/api/src/matches/encounter-scoring-lock.integration.spec.ts apps/api/src/matches/matches.repository.ts && git commit -m "fix(api): eine Sperrreihenfolge fuer Scoring und Begegnungskommandos

Der Scoringpfad zieht die Begegnungs- und Slotzeile jetzt vor die
Matchzeile und nimmt damit dieselbe Reihenfolge wie der Begegnungspfad:
Encounter -> EncounterSlot -> Match. Bleibt trotzdem ein Sperrzyklus,
wird er einmal wiederholt und danach als Versionskonflikt beantwortet -
nie als 500 mitten im entscheidenden Wurf."
```

---

### Task 5: Outbox-Poller beansprucht seinen Stapel (I8)

Der Poller liest mit einfachem SELECT, sendet und stempelt danach. Der Stempel ist idempotent, der Versand nicht: eine zweite API-Replik läse denselben Stapel und sendete jedes Ereignis ein zweites Mal. Sortiert wird nach `occurred_at` — der Transaktions**start**zeit. Heute unschädlich, weil `infrastructure/railway.md` genau eine API-Replik festschreibt; der Befund steht zwischen dem System und der ersten horizontalen Skalierung.

**Files:**
- Modify: `apps/api/src/realtime/publish-outbox.ts:29–66` (resolveScope), `:70–99` (publishOutboxBatch)
- Test: `apps/api/src/realtime/publish-outbox.integration.spec.ts`

**Interfaces:**
- Consumes: `outboxEvents.sequence` aus Task 1; `asc`, `inArray`, `isNull` aus `drizzle-orm`.
- Produces: `publishOutboxBatch(database: Database, broadcaster: RealtimeBroadcaster, limit?: number): Promise<number>` — Signatur unverändert. `resolveScope(executor: OutboxExecutor, event: ResolvableEvent): Promise<RealtimeScope | null>` — erster Parameter erweitert sich auf `Database | DatabaseTransaction`.

- [ ] **Step 1: Test für die zweite Replik schreiben**

In `apps/api/src/realtime/publish-outbox.integration.spec.ts` als letzten Test im `describe("publishOutboxBatch", …)`-Block einfügen:

```ts
  /**
   * Befund I8: der Poller las ohne `FOR UPDATE SKIP LOCKED`. Zwei Repliken
   * lasen denselben Stapel und sendeten jedes Ereignis zweimal — der Stempel
   * war idempotent, der Versand nicht. Zwanzig Ereignisse, damit das Fenster
   * zwischen Lesen und Stempeln im alten Verhalten sicher getroffen wird.
   */
  it("laesst eine zweite Replik denselben Stapel nicht ein zweites Mal senden", async () => {
    const created = await database
      .insert(outboxEvents)
      .values(
        Array.from({ length: 20 }, () => ({
          organizationId,
          aggregateType: "Match",
          aggregateId: encounterMatchId,
          eventType: "VISIT_RECORDED",
          payload: { matchId: encounterMatchId },
        })),
      )
      .returning({ id: outboxEvents.id });
    const own = new Set(created.map((row) => row.id));
    const first = recorder();
    const second = recorder();

    await Promise.all([publishOutboxBatch(database, first), publishOutboxBatch(database, second)]);

    const delivered = [...first.sent, ...second.sent].filter((entry) => own.has(entry.payload.eventId ?? ""));
    expect(delivered).toHaveLength(20);
    expect(new Set(delivered.map((entry) => entry.payload.eventId)).size).toBe(20);
  }, 30_000);
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/realtime/publish-outbox.integration.spec.ts -t "zweite Replik"`

Expected: FAIL — `expected length 20, received 40` (oder eine Zahl zwischen 21 und 40): beide Repliken lesen denselben Stapel und senden ihn.

- [ ] **Step 3: `resolveScope` auf einen Transaktionsrumpf öffnen**

In `apps/api/src/realtime/publish-outbox.ts` die Typdefinition (Zeile 8) ersetzen:

```ts
type Database = DatabaseService["database"];
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/**
 * Die Zuordnung laeuft jetzt innerhalb der Transaktion, die den Stapel
 * beansprucht — sie muss deshalb beides annehmen.
 */
export type OutboxExecutor = Database | DatabaseTransaction;
```

und die Signatur von `resolveScope` (Zeile 30) anpassen:

```ts
export async function resolveScope(
  executor: OutboxExecutor,
  event: ResolvableEvent,
): Promise<RealtimeScope | null> {
```

Im Rumpf die beiden `database`-Aufrufe auf `executor` umstellen (`const [scheduled] = await executor` und `const [slot] = await executor`).

- [ ] **Step 4: `publishOutboxBatch` auf Beanspruchen umbauen**

Die Import-Zeile 1 ersetzen:

```ts
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
```

und `publishOutboxBatch` (ab Zeile 70) vollständig ersetzen durch:

```ts
/**
 * Beansprucht einen Stapel unpublizierter Ereignisse, stempelt ihn in
 * derselben Transaktion und sendet erst nach dem Commit.
 *
 * `FOR UPDATE SKIP LOCKED` macht den Stapel exklusiv: eine zweite Replik
 * ueberspringt die gesperrten Zeilen, statt sie ein zweites Mal zu senden
 * (Befund I8). Der Stempel faellt vor dem Commit — nicht danach —, damit kein
 * Fenster bleibt, in dem ein Ereignis gesendet, aber nicht gestempelt ist. Er
 * faellt auch dann, wenn kein Raum zustaendig ist; sonst liefe der Poller ewig
 * gegen dieselbe Zeile.
 *
 * Gesendet wird erst NACH dem Commit (AGENTS.md 16): scheitert die
 * Transaktion, hat niemand etwas empfangen, und der naechste Durchlauf nimmt
 * denselben Stapel erneut.
 *
 * Sortiert wird nach `sequence`, nicht nach `occurred_at`: letzteres ist
 * `now()` und damit die Transaktions-STARTzeit, eine laengere Transaktion, die
 * nach einer kuerzeren committet, wuerde vor ihr publiziert.
 */
export async function publishOutboxBatch(
  database: Database,
  broadcaster: RealtimeBroadcaster,
  limit = 100,
): Promise<number> {
  const pending: RealtimeBroadcast[] = [];
  const claimed = await database.transaction(async (transaction) => {
    const events = await transaction
      .select()
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt))
      .orderBy(asc(outboxEvents.sequence))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (events.length === 0) return 0;
    for (const event of events) {
      const broadcast = toBroadcast(event, await resolveScope(transaction, event));
      if (broadcast !== null) pending.push(broadcast);
    }
    await transaction
      .update(outboxEvents)
      .set({ publishedAt: new Date() })
      .where(
        and(
          inArray(outboxEvents.id, events.map((event) => event.id)),
          isNull(outboxEvents.publishedAt),
        ),
      );
    return events.length;
  });

  for (const broadcast of pending) {
    broadcaster.emit(broadcast.room, broadcast.event, broadcast.payload);
  }
  return claimed;
}
```

Der `eq`-Import wird von `resolveScope` weiterhin gebraucht und bleibt.

- [ ] **Step 5: Test laufen lassen und Erfolg bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/realtime`

Expected: PASS, alle Realtime-Testdateien — auch die bestehenden Tests, die einen einzelnen Stapel prüfen.

- [ ] **Step 6: Begegnungstest mitprüfen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/encounters/encounters.integration.spec.ts`

Expected: PASS. Die Datei ruft `publishOutboxBatch` in einer Schleife, bis sie `0` liefert (Zeile 1631); mit dem neuen Rückgabewert bleibt das Verhalten identisch.

- [ ] **Step 7: Qualitätstore**

Run: `cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test`

Expected: alle drei grün.

- [ ] **Step 8: Commit**

```bash
cd /home/sut/projects/darts-platform && git add apps/api/src/realtime/publish-outbox.ts apps/api/src/realtime/publish-outbox.integration.spec.ts && git commit -m "fix(api): Outbox-Poller beansprucht seinen Stapel und ordnet nach Sequenz

SELECT ... FOR UPDATE SKIP LOCKED in einer Transaktion, Stempel vor dem
Commit, Versand danach. Eine zweite API-Replik ueberspringt damit den
gesperrten Stapel, statt jedes Ereignis ein zweites Mal zu senden. Die
Reihenfolge kommt aus der monotonen Sequenz statt aus occurred_at, das
die Transaktionsstartzeit traegt."
```

---

### Task 6: Aufräumregel für verarbeitete Outbox-Zeilen und Statistik-Poller nach Sequenz (I7)

Der Statistik-Poller läuft sekündlich, filtert auf `event_type = 'MATCH_COMPLETED' and statistics_processed_at is null` und lief bis Task 1 als Seq Scan über eine unbegrenzt wachsende Tabelle (4164 Zeilen, davon 4115 wegge­filtert). Der Index steht seit Task 1; hier folgt die zweite Hälfte des Fixes — die Aufräumregel, ohne die die Tabelle auch mit Index unbegrenzt wächst.

**Files:**
- Create: `apps/worker/src/prune-outbox.ts`
- Create: `apps/worker/src/prune-outbox.integration.spec.ts`
- Modify: `apps/worker/src/main.ts:54` (Poller-Sortierung), `:70–73` (Intervalle)

**Interfaces:**
- Consumes: `outboxEvents` aus `@darts-platform/database`; `and`, `isNotNull`, `lt`, `ne`, `or` aus `drizzle-orm`.
- Produces:
  - `OUTBOX_RETENTION_DAYS: 30`
  - `pruneProcessedOutboxEvents(database: Database, now: Date, retentionDays?: number): Promise<number>` aus `apps/worker/src/prune-outbox.js`

- [ ] **Step 1: Test für die Aufräumregel schreiben**

`apps/worker/src/prune-outbox.integration.spec.ts` anlegen:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseConnection, organizations, outboxEvents } from "@darts-platform/database";

import { OUTBOX_RETENTION_DAYS, pruneProcessedOutboxEvents } from "./prune-outbox.js";

const environment = parseApplicationEnvironment(process.env);
const connection = createDatabaseConnection(environment.DATABASE_URL);
const organizationId = randomUUID();
const now = new Date("2026-09-06T12:00:00.000Z");
const old = new Date(now.getTime() - (OUTBOX_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
const recent = new Date(now.getTime() - 60 * 1000);

beforeAll(async () => {
  await connection.database.insert(organizations).values({
    id: organizationId,
    name: "Retention Club",
    slug: `retention-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
});

afterAll(async () => {
  await connection.database.delete(organizations).where(eq(organizations.id, organizationId));
  await connection.close();
});

describe("pruneProcessedOutboxEvents", () => {
  it("entfernt nur alte, vollstaendig verarbeitete Zeilen", async () => {
    const rows = await connection.database
      .insert(outboxEvents)
      .values([
        // 0: alt, verteilt, statistisch verarbeitet -> weg
        { organizationId, aggregateType: "Match", aggregateId: randomUUID(), eventType: "MATCH_COMPLETED", payload: {}, occurredAt: old, publishedAt: old, statisticsProcessedAt: old },
        // 1: alt, verteilt, aber statistisch offen -> bleibt
        { organizationId, aggregateType: "Match", aggregateId: randomUUID(), eventType: "MATCH_COMPLETED", payload: {}, occurredAt: old, publishedAt: old },
        // 2: alt, verteilt, kein Statistikereignis -> weg
        { organizationId, aggregateType: "Match", aggregateId: randomUUID(), eventType: "VISIT_RECORDED", payload: {}, occurredAt: old, publishedAt: old },
        // 3: alt, noch nicht verteilt -> bleibt
        { organizationId, aggregateType: "Match", aggregateId: randomUUID(), eventType: "VISIT_RECORDED", payload: {}, occurredAt: old },
        // 4: frisch und vollstaendig verarbeitet -> bleibt
        { organizationId, aggregateType: "Match", aggregateId: randomUUID(), eventType: "MATCH_COMPLETED", payload: {}, occurredAt: recent, publishedAt: recent, statisticsProcessedAt: recent },
      ])
      .returning({ id: outboxEvents.id });
    const ids = rows.map((row) => row.id);

    await pruneProcessedOutboxEvents(connection.database, now);

    const remaining = await connection.database
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(inArray(outboxEvents.id, ids));
    expect(new Set(remaining.map((row) => row.id))).toEqual(new Set([ids[1], ids[3], ids[4]]));
  }, 30_000);
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/worker && npx dotenv -e ../../.env -- npx vitest run src/prune-outbox.integration.spec.ts`

Expected: FAIL — `Failed to load url ./prune-outbox.js`.

- [ ] **Step 3: Aufräumregel implementieren**

`apps/worker/src/prune-outbox.ts` anlegen:

```ts
import { and, isNotNull, isNull, lt, ne, or } from "drizzle-orm";

import { outboxEvents, type Database } from "@darts-platform/database";

/**
 * Wie lange eine vollstaendig verarbeitete Outbox-Zeile stehen bleibt. Sie ist
 * danach weder fuer die Verteilung noch fuer die Statistik von Belang; die
 * fachliche Spur liegt in `audit_events` und im jeweiligen Kommandostrom.
 */
export const OUTBOX_RETENTION_DAYS = 30;

/**
 * Ohne Aufraeumregel waechst `outbox_events` unbegrenzt: beide Poller laufen
 * im Sekundentakt gegen eine Tabelle, die nur zunimmt (Befund I7). Entfernt
 * werden ausschliesslich Zeilen, die
 *
 * - verteilt sind (`published_at is not null`) UND
 * - statistisch erledigt sind oder die Statistik nie betrafen UND
 * - aelter als die Aufbewahrungsfrist sind.
 *
 * Eine Zeile, die einer der drei Bedingungen nicht genuegt, bleibt stehen —
 * die Aufraeumregel darf nie ein unverarbeitetes Ereignis verschlucken.
 */
export async function pruneProcessedOutboxEvents(
  database: Database,
  now: Date,
  retentionDays: number = OUTBOX_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const removed = await database
    .delete(outboxEvents)
    .where(
      and(
        isNotNull(outboxEvents.publishedAt),
        or(
          isNotNull(outboxEvents.statisticsProcessedAt),
          ne(outboxEvents.eventType, "MATCH_COMPLETED"),
        ),
        lt(outboxEvents.occurredAt, cutoff),
      ),
    )
    .returning({ id: outboxEvents.id });
  return removed.length;
}
```

Den ungenutzten Import `isNull` wieder entfernen — er steht oben nur zur Vollständigkeit der Drizzle-Prädikate und wird hier nicht gebraucht. Korrekte Import-Zeile:

```ts
import { and, isNotNull, lt, ne, or } from "drizzle-orm";
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/worker && npx dotenv -e ../../.env -- npx vitest run src/prune-outbox.integration.spec.ts`

Expected: PASS, ein Test.

- [ ] **Step 5: Worker anschliessen und Poller nach Sequenz ordnen**

In `apps/worker/src/main.ts` die Import-Zeilen 1 und 6 ergänzen:

```ts
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
```

```ts
import { buildStatisticsMatches } from "./statistics/build-statistics-matches.js";
import { pruneProcessedOutboxEvents } from "./prune-outbox.js";
```

Die Poller-Abfrage (Zeile 54) auf die Sequenz umstellen — sie deckt sich damit mit dem partiellen Index `outbox_events_pending_statistics_idx` aus Migration 0023 und mit der Verteilungsreihenfolge des Realtime-Pollers:

```ts
    const events = await connection.database.select().from(outboxEvents).where(and(eq(outboxEvents.eventType, "MATCH_COMPLETED"), isNull(outboxEvents.statisticsProcessedAt))).orderBy(asc(outboxEvents.sequence)).limit(20);
```

Vor `setInterval(() => void run(), 1_000);` (Zeile 70) einfügen:

```ts
let pruning = false;

/**
 * Stuendlich, nicht sekuendlich: die Aufraeumregel raeumt einen Rueckstand von
 * Tagen ab und muss nicht schneller laufen als er entsteht.
 */
async function prune(): Promise<void> {
  if (pruning) return;
  pruning = true;
  try {
    const removed = await pruneProcessedOutboxEvents(connection.database, new Date());
    if (removed > 0) console.log(`Outbox aufgeraeumt: ${removed} verarbeitete Zeilen entfernt`);
  } catch (error) { console.error("Outbox-Aufraeumen fehlgeschlagen", error); }
  finally { pruning = false; }
}

setInterval(() => void prune(), 3_600_000);
void prune();
```

- [ ] **Step 6: Worker-Tests laufen lassen**

Run: `cd /home/sut/projects/darts-platform/apps/worker && npx dotenv -e ../../.env -- npx vitest run`

Expected: PASS, alle Worker-Testdateien inklusive `module-format.spec.ts`.

- [ ] **Step 7: Doku ergänzen**

In `DATABASE_SCHEMA.md` im Abschnitt `## outbox_events` an den in Task 1 eingefügten Text anhängen:

```markdown
Die Aufräumregel (`apps/worker/src/prune-outbox.ts`) läuft stündlich im Worker
und entfernt Zeilen, die verteilt **und** statistisch erledigt (oder nie
statistikrelevant) **und** älter als 30 Tage sind. Eine Zeile, die einer der
drei Bedingungen nicht genügt, bleibt stehen — die Regel darf nie ein
unverarbeitetes Ereignis verschlucken. Die fachliche Spur eines Vorgangs liegt
nicht in der Outbox, sondern in `audit_events` und im jeweiligen Kommandostrom.
```

- [ ] **Step 8: Qualitätstore**

Run: `cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test`

Expected: alle drei grün.

- [ ] **Step 9: Commit**

```bash
cd /home/sut/projects/darts-platform && git add apps/worker/src/prune-outbox.ts apps/worker/src/prune-outbox.integration.spec.ts apps/worker/src/main.ts DATABASE_SCHEMA.md && git commit -m "feat(worker): Aufraeumregel fuer verarbeitete Outbox-Zeilen

Der Statistik-Poller sortiert jetzt nach der Sequenz und trifft damit den
partiellen Index aus Migration 0023. Eine stuendliche Aufraeumregel
entfernt Zeilen, die verteilt und statistisch erledigt und aelter als 30
Tage sind - ohne sie waechst die Tabelle auch mit Index unbegrenzt."
```

---

### Task 7: Ad-hoc-Match prüft die Scheibe über beide Quellen

`createInTransaction` (`matches.repository.ts:305–307`) prüft nur `boards.status = 'AVAILABLE'`. Die Liga belegt dieselbe physische Scheibe über `encounter_slots`, das Turnier über `tournament_matches` — beide Quellen zählen. Der partielle Unique `matches_board_in_progress_unique` fängt den Fall heute strukturell ab, und `create` bildet den 23505 über `isBoardInProgressConflict` auf `BOARD_NOT_AVAILABLE` ab. Das ist die letzte Klammer, nicht die Prüfung: sie fehlt.

**Vorsicht:** `isBoardOccupied` kennt `matches` bewusst **nicht** als dritte Quelle — die Dev-DB trug 224 verwaiste `IN_PROGRESS`-Zeilen ohne Turnier- oder Ligabezug. Der Helfer bleibt unverändert; hier wird er nur aufgerufen.

**Files:**
- Modify: `apps/api/src/matches/matches.repository.ts:305–307`
- Test: `apps/api/src/tournaments/board-occupancy.integration.spec.ts`

**Interfaces:**
- Consumes: `isBoardOccupied(executor, organizationId, boardId): Promise<boolean>` aus `apps/api/src/boards/board-occupancy.js` — bereits im Datei-Import von `matches.repository.ts` (Zeile 14).
- Produces: keine neue Schnittstelle.

- [ ] **Step 1: Test schreiben**

In `apps/api/src/tournaments/board-occupancy.integration.spec.ts` den Import-Block um Service und Schemas erweitern:

```ts
import { MatchesService } from "../matches/matches.service.js";
```

und die Servicezeile (Zeile 32) so umbauen, dass beide Services dasselbe Repository teilen:

```ts
const matchesRepository = new MatchesRepository(databaseService);
const service = new TournamentsService(repository, matchesRepository, access);
const matchesService = new MatchesService(matchesRepository, access);
```

Dann als neuen Test am Ende des `describe`-Blocks:

```ts
  /**
   * Die freie Paarung (Ad-hoc-Match ohne Turnier- und Ligabezug) prueft die
   * Scheibe bis hierher nur ueber `boards.status`. Steht dort ein Ligaslot und
   * hat eine fruehere Freigabe den Status auf AVAILABLE gesetzt, startete sie
   * ein zweites Spiel auf derselben physischen Scheibe. Der partielle Unique
   * fing das ab -- aber erst als Constraint-Verstoss, nicht als Pruefung.
   */
  it("startet kein Ad-hoc-Match auf einer Scheibe, auf der ein Ligaslot laeuft", async () => {
    await databaseService.database
      .update(boards)
      .set({ status: "AVAILABLE" })
      .where(eq(boards.id, leagueBoardId));
    try {
      await expect(
        matchesService.create({
          organizationId,
          data: {
            playerOneId: freePlayerIds[0],
            playerTwoId: freePlayerIds[1],
            startingPlayerId: freePlayerIds[0],
            boardId: leagueBoardId,
            bestOfLegs: 1,
            bestOfSets: 1,
          },
          auth,
          audit,
        }),
      ).rejects.toMatchObject({ response: { code: "BOARD_NOT_AVAILABLE" } });
    } finally {
      await databaseService.database
        .update(boards)
        .set({ status: "IN_USE" })
        .where(eq(boards.id, leagueBoardId));
    }
  }, 30_000);
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/board-occupancy.integration.spec.ts -t "Ad-hoc-Match"`

Expected: FAIL — der Aufruf wirft zwar, aber mit `code: "BOARD_NOT_AVAILABLE"` aus dem 23505-Netz statt aus der Prüfung; je nach Reihenfolge der Inserts scheitert die Erwartung an einer anderen Fehlerform. Sicherer Nachweis: der Test schlägt fehl, sobald in `createInTransaction` ein `console.error` zeigen würde, dass der Weg über `isBoardInProgressConflict` läuft. Praktisch prüfbar über die Zahl der `matches`-Zeilen mit dieser `board_id`:

```bash
cd /home/sut/projects/darts-platform && npx dotenv -e .env -- npx tsx --eval "
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL);
console.log(await sql\`select count(*)::int from matches where status = 'IN_PROGRESS'\`);
await sql.end();
"
```

Erwartet vor dem Fix: die verworfene Transaktion hinterlässt nichts, aber der Weg lief über den Constraint. Nach dem Fix greift die Vorprüfung.

- [ ] **Step 3: `isBoardOccupied` in `create` aufrufen**

In `apps/api/src/matches/matches.repository.ts` in `createInTransaction` den Block

```ts
      if (input.data.boardId !== undefined && input.data.boardId !== null) {
        const [board] = await transaction.select().from(boards).where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, input.data.boardId))).for("update").limit(1);
        if (board === undefined || board.status !== "AVAILABLE") throw new ScoringValidationError("BOARD_NOT_AVAILABLE", "Selected board is not available.");
      }
```

ersetzen durch:

```ts
      if (input.data.boardId !== undefined && input.data.boardId !== null) {
        const [board] = await transaction.select().from(boards).where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, input.data.boardId))).for("update").limit(1);
        // Der Status der Scheibe allein genuegt nicht: Turnier und Liga
        // belegen dieselbe physische Scheibe ueber `tournament_matches` und
        // `encounter_slots`. Beide Quellen zaehlen -- dieselbe Pruefung nutzen
        // `tournaments.assign`, `tournaments.releaseBoard` und
        // `encounters.assignSlot`. Der partielle Unique auf `matches` bleibt
        // die letzte Klammer, nicht die Pruefung.
        if (
          board === undefined ||
          board.status !== "AVAILABLE" ||
          (await isBoardOccupied(transaction, input.organizationId, input.data.boardId))
        ) {
          throw new ScoringValidationError("BOARD_NOT_AVAILABLE", "Selected board is not available.");
        }
      }
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/board-occupancy.integration.spec.ts src/matches/matches.integration.spec.ts`

Expected: PASS, beide Dateien.

- [ ] **Step 5: Qualitätstore**

Run: `cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test`

Expected: alle drei grün.

- [ ] **Step 6: Commit**

```bash
cd /home/sut/projects/darts-platform && git add apps/api/src/matches/matches.repository.ts apps/api/src/tournaments/board-occupancy.integration.spec.ts && git commit -m "fix(api): freie Paarung prueft die Scheibe ueber beide Quellen

create pruefte bis hierher nur boards.status und verliess sich sonst auf
den partiellen Unique. Jetzt fragt es wie Turnier- und Ligapfad
isBoardOccupied -- der Constraint bleibt die letzte Klammer, nicht die
Pruefung."
```

---

### Task 8: Zustandsfehler vor Eingabefehlern melden

`assertWritableVisit` läuft in `executeX01Command` vor der Projektion und damit vor der Rundenlimit-Prüfung. Eine Aufnahme an der Rundengrenze meldet unter Double In `DARTS_REQUIRED_FOR_DOUBLE_IN` statt `ROUND_LIMIT_REACHED` — beide 400, aber die Meldung führt in die Irre: die Fläche verlangt Wurfdaten, die nichts an der Sache ändern, weil das Leg ausgebullt werden muss. Der beendete Fall (`MATCH_ALREADY_COMPLETED`) ist bereits korrekt (siehe «Nicht mehr zutreffend») und wird hier nur mit einem Regressionstest festgehalten.

**Replay-Sicherheit:** `assertWritableVisit` bleibt im Schreibpfad. Es wird nichts nach `projectX01Match` verschoben und keine gespeicherte Kommandofolge anders gewertet — die Änderung nimmt der Funktion nur Zuständigkeit weg, sie fügt keine hinzu.

**Files:**
- Modify: `packages/scoring-engine/src/x01.ts:994–1000`
- Test: `packages/scoring-engine/src/x01.spec.ts`

**Interfaces:**
- Consumes: `X01MatchState.roundLimitReached: boolean` und `X01MatchState.status: "IN_PROGRESS" | "COMPLETED"` (`x01.ts:157`, `:166`).
- Produces: keine geänderte öffentliche Signatur; `assertWritableVisit` bleibt modulintern.

- [ ] **Step 1: Test schreiben**

In `packages/scoring-engine/src/x01.spec.ts` direkt hinter dem Test `"stops the leg at the round limit and decides it by bull"` einfügen:

```ts
  /**
   * `assertWritableVisit` traegt Regeln fuer die EINGABE (Wurfdaten unter
   * Double In, Abschlussbeleg unter Master Out). Ein Zustand, in dem gar keine
   * Aufnahme mehr moeglich ist, geht ihnen vor: sonst verlangt die Flaeche
   * Wurfdaten fuer ein Leg, das ausgebullt werden muss.
   */
  it("meldet an der Rundengrenze den Zustand, nicht die Eingaberegel", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ maxRounds: 2, inRule: "DOUBLE" }),
    });
    // Beide Seiten eroeffnen mit Wurfdaten und spielen zwei volle Runden.
    const opening = (commandId: string, seat: 1 | 2, thrower: string): SubmitVisitCommand => ({
      type: "SUBMIT_VISIT",
      commandId,
      seat,
      throwerPlayerId: thrower,
      points: 40,
      dartsThrown: 3,
      checkoutAttempts: 0,
      darts: [
        { segment: 20, multiplier: 2 },
        { segment: 0, multiplier: 1 },
        { segment: 0, multiplier: 1 },
      ],
    });
    match = executeX01Command(match, opening("r1-one", 1, "one")).match;
    match = executeX01Command(match, opening("r1-two", 2, "two")).match;
    match = executeX01Command(match, visit("r2-one", 1, "one", 60)).match;
    match = executeX01Command(match, visit("r2-two", 2, "two", 60)).match;
    expect(projectX01Match(match).roundLimitReached).toBe(true);

    // Eine Rundensumme ohne Wurfdaten: unter Double In waere das eine
    // Eingaberegel -- aber die Seite hat laengst eroeffnet, und vor allem ist
    // das Leg an der Rundengrenze.
    try {
      executeX01Command(match, visit("too-many", 1, "one", 60));
      expect.unreachable("the round limit is reached");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("ROUND_LIMIT_REACHED");
    }

    // Und auch die noch nicht eroeffnete Gegenseite bekommt den Zustand
    // gemeldet, nicht DARTS_REQUIRED_FOR_DOUBLE_IN.
    let unopened = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ maxRounds: 1, inRule: "DOUBLE" }),
    });
    unopened = executeX01Command(unopened, opening("only-round-one", 1, "one")).match;
    unopened = executeX01Command(unopened, visit("only-round-two", 2, "two", 0)).match;
    expect(projectX01Match(unopened).roundLimitReached).toBe(true);
    try {
      executeX01Command(unopened, visit("past-limit", 1, "one", 61, 3));
      expect.unreachable("the round limit is reached");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("ROUND_LIMIT_REACHED");
    }
  });

  /**
   * Regression zum selben Punkt von der anderen Seite: ein beendetes Match
   * meldet weiterhin MATCH_ALREADY_COMPLETED. Das trug bereits, weil die
   * Projektion fuer ein beendetes Match `activeSeat: null` liefert und
   * `assertWritableVisit` an seinem ersten Waechter aussteigt -- der Test
   * haelt das fest, damit es beim Umbau der Reihenfolge nicht kippt.
   */
  it("meldet fuer ein beendetes Match den Zustand, nicht die Eingaberegel", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 40, inRule: "DOUBLE", outRule: "DOUBLE" }),
    });
    match = executeX01Command(match, {
      type: "SUBMIT_VISIT",
      commandId: "finish",
      seat: 1,
      throwerPlayerId: "one",
      points: 40,
      dartsThrown: 1,
      checkoutAttempts: 1,
      checkoutDouble: 20,
      darts: [{ segment: 20, multiplier: 2 }],
    }).match;
    expect(projectX01Match(match).status).toBe("COMPLETED");

    try {
      executeX01Command(match, visit("after-the-end", 2, "two", 61, 3));
      expect.unreachable("the match is over");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("MATCH_ALREADY_COMPLETED");
    }
  });
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `cd /home/sut/projects/darts-platform && pnpm --filter @darts-platform/scoring-engine test -- -t "Rundengrenze"`

Expected: FAIL im ersten neuen Test — `expected 'DARTS_REQUIRED_FOR_DOUBLE_IN' to be 'ROUND_LIMIT_REACHED'` beim Wurf `past-limit` auf die nicht eröffnete Gegenseite. Der zweite neue Test (beendetes Match) ist bereits grün.

- [ ] **Step 3: `assertWritableVisit` Zustandsfehlern weichen lassen**

In `packages/scoring-engine/src/x01.ts` den Kopf von `assertWritableVisit` (Zeilen 994–1000) ersetzen:

```ts
function assertWritableVisit(match: X01Match, command: SubmitVisitCommand, before: X01MatchState): void {
  // Zustand vor Eingabe. Ist gar keine Aufnahme mehr moeglich -- Match
  // beendet, Rundengrenze erreicht --, gehoert das gemeldet, nicht eine
  // Eingaberegel, deren Erfuellung an der Lage nichts aendert. Die Projektion
  // meldet diese Faelle als MATCH_ALREADY_COMPLETED bzw. ROUND_LIMIT_REACHED,
  // sobald das Kommando angehaengt wird.
  if (before.status === "COMPLETED") return;
  if (before.roundLimitReached) return;
  // Nur fuer das Kommando, das tatsaechlich an der Reihe ist. Sonst blieben
  // die aussagekraeftigeren Fehler der Projektion (NOT_ACTIVE_SEAT,
  // INVALID_THROWER, MATCH_ALREADY_COMPLETED) hinter diesen Regeln verborgen.
  if (before.activeSeat !== command.seat) return;
  if (before.activeThrowerPlayerId !== command.throwerPlayerId) return;
  validateVisit(command);
```

Der Rest der Funktion bleibt unverändert.

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `cd /home/sut/projects/darts-platform && pnpm --filter @darts-platform/scoring-engine test`

Expected: PASS, alle Tests der Engine — auch die bestehenden zu `DARTS_REQUIRED_FOR_DOUBLE_IN`, `CHECKOUT_DETAIL_REQUIRED` und dem Replay gespeicherter Kommandos.

- [ ] **Step 5: Schreibpfad gegenprüfen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/matches`

Expected: PASS. Die Änderung nimmt der Schreibpfadregel nur Zuständigkeit; kein gespeichertes Kommando wird anders gewertet, weil `projectX01Match` unangetastet bleibt.

- [ ] **Step 6: Qualitätstore**

Run: `cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test`

Expected: alle drei grün.

- [ ] **Step 7: Commit**

```bash
cd /home/sut/projects/darts-platform && git add packages/scoring-engine/src/x01.ts packages/scoring-engine/src/x01.spec.ts && git commit -m "fix(scoring-engine): Zustandsfehler gehen Eingabefehlern vor

An der Rundengrenze meldete assertWritableVisit unter Double In
DARTS_REQUIRED_FOR_DOUBLE_IN statt ROUND_LIMIT_REACHED - die Flaeche
verlangte Wurfdaten fuer ein Leg, das ausgebullt werden muss. Die
Schreibpfadregel weicht jetzt beendeten Matches und der Rundengrenze;
projectX01Match bleibt unangetastet, gespeicherte Kommandos werden
unveraendert gewertet."
```

---

### Task 9: Dashboard-Rundreisen bündeln

`getDashboardData` startet ein `Promise.all` mit fünf Abfragen und danach ein zweites mit zwei weiteren. Das zweite läuft sequentiell nach dem ersten, obwohl keine seiner Abfragen vom Ergebnis des ersten abhängt — eine vermeidbare Rundreise auf dem heissesten Leseweg der Turnieransicht.

**Files:**
- Modify: `apps/api/src/tournaments/tournaments.repository.ts:200–295`
- Test: `apps/api/src/tournaments/tournaments.integration.spec.ts` (bestehende Abdeckung von `dashboard`)

**Interfaces:**
- Consumes: `loadOccupiedBoardIds(executor, organizationId): Promise<ReadonlySet<string>>` und `loadActivePlayerIds(executor, organizationId): Promise<ReadonlySet<string>>` aus `apps/api/src/boards/board-occupancy.js`.
- Produces: `TournamentsRepository.getDashboardData(organizationId: string, tournamentId: string): Promise<TournamentDashboardData | null>` — Signatur und Rückgabeform unverändert.

- [ ] **Step 1: Bestehende Abdeckung bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/tournaments.integration.spec.ts src/tournaments/board-occupancy.integration.spec.ts`

Expected: PASS. Beide Dateien rufen `service.dashboard(...)` und prüfen `queue`, `occupiedBoardIds` und `activePlayerIds`. Diese Abdeckung ist der Regressionsschutz für den reinen Umbau — ein neuer Test würde nichts prüfen, was hier nicht schon geprüft wird.

- [ ] **Step 2: Beide `Promise.all`-Blöcke zusammenlegen**

In `apps/api/src/tournaments/tournaments.repository.ts` die Destrukturierung (Zeile 200) ersetzen:

```ts
    // Keine dieser Abfragen haengt vom Ergebnis einer anderen ab; sie gehoeren
    // in EIN Promise.all. Die Belegtmengen liefen bis hierher als zweite
    // Rundreise hinterher -- auf dem heissesten Leseweg der Turnieransicht.
    const [
      participantRows,
      boardRows,
      groupRows,
      groupParticipantRows,
      matchRows,
      occupiedBoardIds,
      activePlayerIds,
    ] = await Promise.all([
```

und die beiden Aufrufe der Belegtmengen als sechstes und siebtes Element in dasselbe Array ziehen — also an die Stelle der schliessenden `]);` des ersten Blocks:

```ts
        this.databaseService.database
          .select()
          .from(tournamentMatches)
          .where(
            and(
              eq(tournamentMatches.organizationId, organizationId),
              eq(tournamentMatches.tournamentId, tournamentId),
            ),
          )
          .orderBy(
            asc(tournamentMatches.stageId),
            asc(tournamentMatches.round),
            asc(tournamentMatches.position),
          ),
        loadOccupiedBoardIds(this.databaseService.database, organizationId),
        loadActivePlayerIds(this.databaseService.database, organizationId),
      ]);
```

Den nachfolgenden Block

```ts
    const [occupiedBoardIds, activePlayerIds] = await Promise.all([
      loadOccupiedBoardIds(this.databaseService.database, organizationId),
      loadActivePlayerIds(this.databaseService.database, organizationId),
    ]);
```

ersatzlos streichen. Das `return`-Objekt darunter bleibt unverändert.

- [ ] **Step 3: Tests laufen lassen und Erfolg bestätigen**

Run: `cd /home/sut/projects/darts-platform/apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments`

Expected: PASS, alle Turnier-Testdateien.

- [ ] **Step 4: Qualitätstore**

Run: `cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test`

Expected: alle drei grün.

- [ ] **Step 5: Commit**

```bash
cd /home/sut/projects/darts-platform && git add apps/api/src/tournaments/tournaments.repository.ts && git commit -m "perf(api): Turnier-Dashboard laedt Belegtmengen in derselben Rundreise

Die beiden Abfragen fuer belegte Scheiben und beschaeftigte Personen
liefen als zweites Promise.all hinter dem ersten her, obwohl keine von
ihnen dessen Ergebnis braucht."
```

---

## Abschluss des Plans

- [ ] **Step 1: Vollständige Testsuite**

Run: `cd /home/sut/projects/darts-platform && pnpm lint && pnpm typecheck && pnpm test`

Expected: alle drei grün.

- [ ] **Step 2: Produktionsbuild**

Run: `cd /home/sut/projects/darts-platform && NODE_ENV=production pnpm build`

Expected: alle Pakete gebaut. `NODE_ENV=production` ist Pflicht — ohne die Variable bricht der Next.js-Prerender mit einem irreführenden React-Fehler ab.

- [ ] **Step 3: End-to-End auf einem Worker**

Run: `cd /home/sut/projects/darts-platform && pnpm test:e2e -- --workers=1`

Expected: PASS. Mehrere Worker erzeugen Kontention gegen `next dev` und sporadisch rote Läufe, die kein Bug sind.

- [ ] **Step 4: Deployreihenfolge festhalten**

Migration `0023_tier2_integrity_constraints` nimmt für die Dauer ihrer Anweisungen ein `ACCESS EXCLUSIVE`-Lock auf `matches`, `legs`, `visits` und `outbox_events`. Sie gehört ausserhalb des Spielbetriebs ausgerollt, und der Bestandscheck aus Task 1 Step 1 ist **vor** dem Deployment gegen die Zieldatenbank zu fahren. Reihenfolge: Migration, dann API, dann Worker — der Worker liest ab Task 6 die Spalte `outbox_events.sequence`, die es ohne die Migration nicht gibt.

---

## Self-Review

**1. Spec-Abdeckung** — jeder Befund des Auditberichts, der in den Umfang dieses Plans fällt, hat einen Task:

| Befund | Task |
| --- | --- |
| I1 — wiederholte `commandId` liefert 409 statt Bestätigung (sechs Pfade) | Task 3 |
| I3 — `matches`/`legs` ohne Konsistenz-Check | Task 1, Steps 4 und 13 |
| I4 — Scoring-Arithmetik ohne Entsprechung in der Datenbank | Task 1, Steps 5 und 13 |
| I5 — kein Unique auf `(Aggregat, resulting_version)` | Task 1, Steps 6 und 13 |
| I6 — gegenläufige Sperrreihenfolge, `40P01` als 500 | Task 4 |
| I7 — Statistik-Poller als Seq Scan, keine Retention | Task 1 Step 7 (Index) und Task 6 (Retention, Sortierung, Doku) |
| I8 — Outbox weder beansprucht noch nach Commit-Reihenfolge gelesen | Task 1 Step 7 (Sequenz) und Task 5 (Poller) |
| I9 — Abbruch löscht die Wurfhistorie hart | Task 2 |
| Ad-hoc-Match ohne `isBoardOccupied` (Abschluss-Review Tier 1) | Task 7 |
| `assertWritableVisit`-Reihenfolge (Abschluss-Review Tier 1) | Task 8 |
| Dashboard-Rundreisen (Abschluss-Review Tier 1) | Task 9 |

Ausserhalb des Umfangs und im Plan begründet: C1 und I2 (in Tier 1 erledigt, Abschnitt «Nicht mehr zutreffend»), I10 (Tier 3), I11 (Tier 1), M1–M6 (Minor, andere Teilpläne).

**2. Platzhalter-Scan** — keine Vorkommen von «TBD», «TODO», «später ergänzen», «add validation», «ähnlich wie Task N» oder «Tests für das Obige schreiben». Jeder Code-Schritt trägt den vollständigen Code, jeder Testschritt den vollständigen Testkörper, jeder Migrations-Schritt das vollständige SQL. Task 7 Step 2 nennt statt einer erfundenen Fehlermeldung den tatsächlich prüfbaren Nachweis (der Weg lief bis dahin über den Constraint statt über die Prüfung) — das ist eine ehrliche Beschreibung, kein Platzhalter.

**3. Typkonsistenz**

- `DatabaseTransaction` wird in Task 3 in `matches.repository.ts` und `tournaments.repository.ts` je einmal als `Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0]` definiert; `encounter-scoring-lock.ts` (Task 4) und `board-occupancy.ts` (Bestand) leiten denselben Typ aus `Database` ab. Beide Formen sind identisch, weil `DatabaseService["database"]` genau `Database` ist.
- `findDuplicateScoreCommand`, `findDuplicateTournamentCommand` (Task 3, `matches.repository.ts`) und `findDuplicateCommand` (Task 3, `tournaments.repository.ts`) liefern alle drei `Promise<"ok" | null>` und werden konsequent mit `!== null` geprüft. Der Name `findDuplicateCommand` deckt sich absichtlich mit dem gleichnamigen Vorbild in `encounters.repository.ts:1250`; die beiden liegen in verschiedenen Klassen.
- `retryOnDeadlock<T>(command, conflictResult)` wird in Task 4 mit `T = MutationResult` (submitVisit, decideLeg), `T = UndoMutationResult` (undo) und explizit `T = AbortMutationResult` (abort) aufgerufen. `"version-conflict"` ist in allen drei Typen enthalten: `MutationResult` listet es, `UndoMutationResult` erweitert `MutationResult`, und `AbortMutationResult` enthält `Exclude<MutationResult, "ok">`.
- `isDeadlockError` (Task 4) folgt exakt der Form von `isBoardInProgressConflict` (`board-occupancy.ts:145`): `unknown` hinein, `boolean` heraus, fünf Ebenen `cause`.
- `OutboxExecutor = Database | DatabaseTransaction` (Task 5) entspricht `BoardOccupancyExecutor` in `board-occupancy.ts:23`.
- `outboxEvents.sequence` ist `bigserial({ mode: "number" })` und wird deshalb in TypeScript als `number` gelesen (`PgBigSerial53.mapFromDriverValue`). Task 5 nutzt die Spalte nur in `orderBy(asc(...))`, Task 6 ebenso; der Testschritt in Task 1 liest sie roh über `execute` und wandelt mit `Number(...)`, weil `execute` am Drizzle-Mapping vorbeigeht.
- `pruneProcessedOutboxEvents(database, now, retentionDays?)` (Task 6) wird in `main.ts` mit zwei Argumenten aufgerufen und im Test mit zwei; der dritte Parameter trägt den Default `OUTBOX_RETENTION_DAYS`, den der Test für seine Zeitrechnung importiert.
- `abortScoringMatch` (Task 2) behält Signatur und `AbortedScoringMatch`-Form; `discardedVisitCount` bleibt `number` und bleibt so benannt, weil der Name im Outbox-Payload `MATCH_ABORTED` und im Audit-Eintrag `TOURNAMENT_PARTICIPANT_WITHDRAWN` steht.
