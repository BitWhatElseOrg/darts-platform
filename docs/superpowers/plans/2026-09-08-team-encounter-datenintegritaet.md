# Team-Encounter Datenintegrität Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zwei der drei in `docs/superpowers/plans/2026-09-02-phase-7-e2e.md:725-729` als bewusst offen dokumentierten Constraint-Nachträge für `encounter_slots` und `competitions` als eine Migration nachziehen.

**Architektur:** Reine DB-Constraint-Ergänzung über `packages/database/src/schema.ts` + generierte Drizzle-Migration. Kein Anwendungscode betroffen — beide Constraints beschreiben Invarianten, die die bestehende Anwendungslogik bereits einhält (sonst wären sie in Produktion längst verletzt).

**Tech Stack:** Drizzle ORM, PostgreSQL, Vitest (Integrationstests gegen echte DB via Testcontainers/lokale Dev-DB).

**Spec:** `docs/superpowers/plans/2026-09-02-phase-7-e2e.md` (Abschnitt "Offen, ausserhalb der Roadmap", Punkt 3) und `docs/superpowers/plans/2026-09-06-tier2-datenintegritaet.md` (Vorbild-Pattern für Bestandscheck + Migration, siehe `0023_tier2_integrity_constraints.sql`).

## Global Constraints

- Migrationen ausschliesslich versioniert und über `pnpm --filter database db:generate` erzeugt, nicht von Hand geschrieben (AGENTS.md §21).
- Nach Deployment keine bestehende Migration rückwirkend ändern (AGENTS.md §21).
- DB-Constraints, nicht nur Applikationslogik (AGENTS.md §10).
- **Nicht Teil dieses Plans:** der dritte Nachtrag aus derselben Quelle — normalisierte Begegnung-Mannschaft-Beziehung samt Spielplangenerierung. Der ist laut Team-Encounter-Spec (`docs/superpowers/specs/2026-09-02-team-encounter-league-design.md:1101-1117`, Abschnitt "Nicht im Umfang") an die Saison-Spec gebunden und braucht eine eigene Planung, keinen Migrations-Nachtrag.

---

## Task 1: Check-Constraint `encounter_slots` — Board nur bei `IN_PROGRESS` belegt

**Files:**
- Modify: `packages/database/src/schema.ts:1355-1382` (Constraint-Array von `encounterSlots`)
- Test: `packages/database/src/encounter-slots-integrity.integration.spec.ts` (neu)
- Generate: `packages/database/drizzle/0028_*.sql` (per `db:generate`, nicht von Hand)

**Interfaces:**
- Consumes: `encounterSlots`-Tabellendefinition aus `schema.ts` (unverändert in Spalten, nur zusätzlicher Constraint).
- Produces: Neuer Constraint-Name `encounter_slots_board_status_check` — spätere Migrationen, die diese Tabelle anfassen, müssen ihn kennen.

**Kontext:** Die Tabelle `encounter_slots` (`schema.ts:1321-1404`) hat bereits `encounter_slots_board_in_progress_unique` (verhindert doppelte Belegung eines Boards unter `IN_PROGRESS`), aber keinen Constraint, der erzwingt, dass `board_id` ausserhalb von `IN_PROGRESS` leer ist. Ohne ihn kann eine Anwendungslogik-Lücke ein Board dauerhaft an einem längst abgeschlossenen Slot "kleben" lassen, ohne dass die Datenbank das verhindert.

- [ ] **Step 1: Bestand prüfen, bevor der Constraint entsteht**

Run: `psql "$DATABASE_URL" -c "select id, status, board_id from encounter_slots where board_id is not null and status <> 'IN_PROGRESS';"`
Expected: 0 Zeilen. Gibt es welche, **nicht** automatisch bereinigen (fachliche Entscheidung, siehe Begründung in `0023_tier2_integrity_constraints.sql:6-10`) — Klärung mit dem Auftraggeber vor dem nächsten Schritt.

- [ ] **Step 2: Constraint in `schema.ts` ergänzen**

`packages/database/src/schema.ts`, im Constraint-Array von `encounterSlots` (nach Zeile 1373, `check("encounter_slots_version_check", ...)`):

```ts
    check(
      "encounter_slots_board_status_check",
      sql`${table.boardId} is null or ${table.status} = 'IN_PROGRESS'`,
    ),
```

- [ ] **Step 3: Migration generieren**

Run: `pnpm --filter @darts-platform/database db:generate`
Expected: Neue Datei `packages/database/drizzle/0028_<generierter_name>.sql` mit genau einem `ALTER TABLE "encounter_slots" ADD CONSTRAINT "encounter_slots_board_status_check" CHECK (...)`, plus aktualisierter `meta/_journal.json` und `meta/00XX_snapshot.json`. Drizzle-kit fragt ggf. interaktiv nach dem Migrationsnamen — `encounter_slots_board_status` eingeben.

- [ ] **Step 4: Fehlschlagenden Integrationstest schreiben**

```ts
// packages/database/src/encounter-slots-integrity.integration.spec.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { createDatabaseConnection } from "./client.js";
import { boards, competitions, encounters, encounterSlots, organizations, teams } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    "DATABASE_URL is required for die Migrations-Integrationstests. Lokale Infrastruktur starten und Tests vom Workspace-Root ausfuehren.",
  );
}

const { database, close } = createDatabaseConnection(databaseUrl);
const organizationId = randomUUID();
let competitionId = "";
let homeTeamId = "";
let awayTeamId = "";
let encounterId = "";
let boardId = "";

beforeAll(async () => {
  await database.insert(organizations).values({
    id: organizationId,
    name: "Testverein Slot-Constraint",
    slug: `slot-constraint-${organizationId.slice(0, 8)}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });

  const [competition] = await database
    .insert(competitions)
    .values({ organizationId, type: "LEAGUE", name: "Testliga", slug: `testliga-${organizationId.slice(0, 8)}`, status: "ACTIVE" })
    .returning();
  competitionId = competition!.id;

  const [home] = await database
    .insert(teams)
    .values({ organizationId, name: `Heim ${organizationId.slice(0, 8)}` })
    .returning();
  homeTeamId = home!.id;

  const [away] = await database
    .insert(teams)
    .values({ organizationId, name: `Gast ${organizationId.slice(0, 8)}` })
    .returning();
  awayTeamId = away!.id;

  const [encounter] = await database
    .insert(encounters)
    .values({
      organizationId,
      competitionId,
      matchday: 1,
      homeTeamId,
      awayTeamId,
      scheduledAt: new Date(),
    })
    .returning();
  encounterId = encounter!.id;

  const [board] = await database
    .insert(boards)
    .values({ organizationId, name: `Board Slot-Constraint ${organizationId.slice(0, 8)}` })
    .returning();
  boardId = board!.id;
});

afterAll(async () => {
  await database.delete(organizations).where(sql`${organizations.id} = ${organizationId}`);
  await close();
});

describe("encounter_slots_board_status_check", () => {
  it("verweigert ein belegtes Board ausserhalb von IN_PROGRESS", async () => {
    try {
      await database.insert(encounterSlots).values({
        organizationId,
        encounterId,
        sequence: 1,
        role: "REGULAR",
        discipline: "SINGLES",
        label: "Slot 1",
        homePosition: 1,
        awayPosition: 1,
        startingScore: 501,
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        bestOfLegs: 3,
        legsToWinSet: 2,
        setsToWin: 1,
        status: "WAITING",
        boardId,
      });
    } catch (error) {
      const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
      expect(String(cause)).toContain("encounter_slots_board_status_check");
      return;
    }
    throw new Error("Erwartete eine verletzte Check-Constraint.");
  });

  it("erlaubt ein belegtes Board waehrend IN_PROGRESS", async () => {
    const [slot] = await database
      .insert(encounterSlots)
      .values({
        organizationId,
        encounterId,
        sequence: 2,
        role: "REGULAR",
        discipline: "SINGLES",
        label: "Slot 2",
        homePosition: 2,
        awayPosition: 2,
        startingScore: 501,
        inRule: "STRAIGHT",
        outRule: "DOUBLE",
        bestOfLegs: 3,
        legsToWinSet: 2,
        setsToWin: 1,
        status: "IN_PROGRESS",
        boardId,
      })
      .returning();

    expect(slot?.boardId).toBe(boardId);
  });
});
```

- [ ] **Step 5: Migration anwenden, Test ausführen**

Run: `pnpm --filter @darts-platform/database db:migrate && cd packages/database && npx dotenv -e ../../.env -- vitest run src/encounter-slots-integrity.integration.spec.ts`
Expected: Beide `it`-Blöcke PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/database/src/schema.ts packages/database/drizzle/0028_*.sql packages/database/drizzle/meta/ packages/database/src/encounter-slots-integrity.integration.spec.ts
git commit -m "feat(database): Check-Constraint fuer Board-Belegung ausserhalb IN_PROGRESS auf encounter_slots"
```

---

## Task 2: Check-Constraint `competitions` — `min_nominations_shorthanded <= lineup_positions`

**Files:**
- Modify: `packages/database/src/schema.ts:1152-1160` (Constraint-Array von `competitions`)
- Test: `packages/database/src/competitions-integrity.integration.spec.ts` (neu)
- Generate: `packages/database/drizzle/0029_*.sql` (per `db:generate`)

**Interfaces:**
- Consumes: `competitions`-Tabellendefinition (unverändert).
- Produces: Neuer Constraint-Name `competitions_min_nominations_shorthanded_lineup_check`.

**Kontext:** `competitions` hat bereits `competitions_min_nominations_check` (`minNominations >= lineupPositions`) und `competitions_min_nominations_shorthanded_check` (`minNominationsShorthanded > 0 and minNominationsShorthanded <= minNominations`, Zeilen 1157-1160). Der Nachtrag verlangt zusätzlich direkt `minNominationsShorthanded <= lineupPositions` — bisher nur transitiv über `minNominations` gesichert, nicht direkt. Da `minNominations >= lineupPositions` bereits gilt, ist die neue Bedingung strenger als nötig für den Normalfall, aber deckt den Fall ab, in dem jemand künftig `competitions_min_nominations_check` lockert, ohne an die Transitivität zu denken.

- [ ] **Step 1: Bestand prüfen**

Run: `psql "$DATABASE_URL" -c "select id, min_nominations_shorthanded, lineup_positions from competitions where min_nominations_shorthanded > lineup_positions;"`
Expected: 0 Zeilen (folgt bereits aus den beiden bestehenden Constraints; Prüfung dient nur der Absicherung vor der Migration).

- [ ] **Step 2: Constraint ergänzen**

`packages/database/src/schema.ts`, direkt nach Zeile 1160 (`competitions_min_nominations_shorthanded_check`):

```ts
    check(
      "competitions_min_nominations_shorthanded_lineup_check",
      sql`${table.minNominationsShorthanded} <= ${table.lineupPositions}`,
    ),
```

- [ ] **Step 3: Migration generieren**

Run: `pnpm --filter @darts-platform/database db:generate`
Expected: Neue Datei `packages/database/drizzle/0029_<generierter_name>.sql`, Name `competitions_min_nominations_shorthanded_lineup` bei interaktiver Nachfrage.

- [ ] **Step 4: Fehlschlagenden Integrationstest schreiben**

```ts
// packages/database/src/competitions-integrity.integration.spec.ts
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { createDatabaseConnection } from "./client.js";
import { competitions, organizations } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    "DATABASE_URL is required for die Migrations-Integrationstests. Lokale Infrastruktur starten und Tests vom Workspace-Root ausfuehren.",
  );
}

const { database, close } = createDatabaseConnection(databaseUrl);
const organizationId = randomUUID();

afterAll(async () => {
  await database.delete(organizations).where(sql`${organizations.id} = ${organizationId}`);
  await close();
});

describe("competitions_min_nominations_shorthanded_lineup_check", () => {
  it("verweigert ein Unterbesetzungs-Minimum ueber der Kaderposition", async () => {
    await database.insert(organizations).values({
      id: organizationId,
      name: "Testverein Competition-Constraint",
      slug: `competition-constraint-${organizationId.slice(0, 8)}`,
      timezone: "Europe/Zurich",
      locale: "de-CH",
    });

    try {
      await database.insert(competitions).values({
        organizationId,
        type: "LEAGUE",
        name: "Testliga",
        slug: `testliga-${organizationId.slice(0, 8)}`,
        status: "ACTIVE",
        lineupPositions: 4,
        minNominations: 5,
        minNominationsShorthanded: 5,
      });
    } catch (error) {
      const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
      expect(String(cause)).toContain("competitions_min_nominations_shorthanded_lineup_check");
      return;
    }
    throw new Error("Erwartete eine verletzte Check-Constraint.");
  });
});
```

Hinweis: `minNominations: 5, lineupPositions: 4` verletzt bewusst zunächst keinen der beiden bestehenden Constraints (`5 >= 4` ✓, `5 > 0 and 5 <= 5` ✓), erst der neue Constraint (`5 <= 4`) schlägt fehl — der Test prüft damit gezielt den neuen, nicht einen der alten.

- [ ] **Step 5: Migration anwenden, Test ausführen**

Run: `pnpm --filter @darts-platform/database db:migrate && cd packages/database && npx dotenv -e ../../.env -- vitest run src/competitions-integrity.integration.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/database/src/schema.ts packages/database/drizzle/0029_*.sql packages/database/drizzle/meta/ packages/database/src/competitions-integrity.integration.spec.ts
git commit -m "feat(database): Check-Constraint min_nominations_shorthanded gegen lineup_positions auf competitions"
```

---

## Self-Review

- **Spec-Abdeckung:** Zwei der drei Nachträge aus `phase-7-e2e.md:725-729` sind abgedeckt. Der dritte (normalisierte Begegnung-Mannschaft-Beziehung + Spielplangenerierung) ist bewusst ausgeklammert — siehe Global Constraints.
- **Platzhalter-Scan:** keine.
- **Reihenfolge:** Beide Tasks sind unabhängig voneinander migrierbar; Task 2 erzeugt Migration `0029` nur, weil sie nach `0028` läuft — bei abweichender Ausführungsreihenfolge generiert `db:generate` die jeweils nächste freie Nummer automatisch, die Nummern in diesem Plan sind daher illustrativ, nicht bindend.
