# Vollbild-Scoringfläche Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Match-Seite wird eine Vollbildfläche mit Wurf-für-Wurf-Eingabe, deren Einzelwürfe dauerhaft gespeichert werden und die Regelprüfung exakt machen.

**Architecture:** Von unten nach oben. Erst Schema, Migration, Engine und API-Schreibpfad — bis dahin ändert sich an der Oberfläche nichts. Dann die Zerlegung der heutigen Scoreboard-Komponente ohne Verhaltensänderung, danach Layout, Keypads, Bestätigung und Modal. Die Engine bleibt die einzige Regelinstanz; der Client rechnet nur Vorschau.

**Tech Stack:** TypeScript strict, pnpm, Turborepo, Zod, Drizzle ORM, PostgreSQL, NestJS, Next.js, React, Tailwind, TanStack Query, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-09-05-scoreboard-ui-design.md](../specs/2026-09-05-scoreboard-ui-design.md)

## Global Constraints

- `strict: true`; kein `any`. `unknown` statt `any`, exhaustive `switch`.
- Kommentare und Oberflächentexte auf Deutsch, Code-Bezeichner auf Englisch — wie im Bestand.
- Jede tenant-bezogene Repository-Funktion nimmt `organizationId` explizit entgegen.
- Die Scoring-Engine darf nichts aus Drizzle, PostgreSQL, Redis, NestJS, Next.js oder Socket.IO importieren.
- Kritische Mutationen bleiben transaktional; Realtime-Events erst nach dem Commit.
- Conventional Commits, kleine Commits, jeder Task endet mit mindestens einem Commit.
- Commit-Nachrichten tragen KEINEN `Co-Authored-By`-Trailer (Repo-Regel in CLAUDE.md).
- Integrationstests brauchen eine laufende Datenbank: `pnpm infra:up` und Ausführung mit `dotenv -e .env`.
- Einzelne API-Testdatei: aus `apps/api` heraus `npx dotenv -e ../../.env -- npx vitest run <pfad>`; `pnpm --filter … test -- <pfad>` filtert nicht.
- Vor Abschluss: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, bei UI zusätzlich `pnpm test:e2e`.

## Abweichungen von der Spec

Zwei Punkte sind beim Schreiben des Plans geschärft worden; sie stehen hier, damit niemand sie für einen Fehler hält:

1. **Double In mit Einzelwürfen** ist nicht „der erste Wurf muss ein Doppel sein". Regelrichtig zählt die Aufnahme erst **ab dem ersten Doppel**; Würfe davor zählen nicht, und eine Aufnahme ohne Doppel ist kein Fehler, sondern eine Aufnahme mit null angerechneten Punkten. Task 3 setzt das so um. `points` bleibt die rohe Summe, `appliedPoints` die angerechnete.
2. **Der Schnellwerte-Endpunkt** hängt unter dem bestehenden Statistik-Pfad `organizations/:organizationId/players/:playerId/statistics/frequent-scores` statt unter einem neuen `/statistics/players/...`-Zweig, damit es nur eine Statistik-Route-Konvention gibt.

## File Structure

**Neu:**

| Datei | Verantwortung |
| --- | --- |
| `packages/database/drizzle/00XX_*.sql` | Migration: `visit_darts`, Index auf `visits` |
| `apps/web/src/lib/scoreboard-settings.ts` | Lesen, Schreiben, Prüfen der gerätelokalen Einstellungen |
| `apps/web/src/lib/scoreboard-settings.spec.ts` | Tests dazu |
| `apps/web/src/lib/dart-entry.ts` | Reiner Reducer der Dart-Eingabe samt Vorschau |
| `apps/web/src/lib/dart-entry.spec.ts` | Tests dazu |
| `apps/web/src/lib/round-entry.ts` | Reine Gültigkeitsprüfung der Runden-Eingabe |
| `apps/web/src/lib/round-entry.spec.ts` | Tests dazu |
| `apps/web/src/components/match/use-match-scoring.ts` | Mutationen, Offline-Queue, Board-Lock, laufende Aufnahme |
| `apps/web/src/components/match/scoreboard-header.tsx` | Kopfzeile |
| `apps/web/src/components/match/scoreboard-status.tsx` | Statusleiste |
| `apps/web/src/components/match/scoreboard-sides.tsx` | Spielerpanels und Dart-Band |
| `apps/web/src/components/match/dart-keypad.tsx` | Segmenttasten und Umschalter |
| `apps/web/src/components/match/round-keypad.tsx` | Ziffern, Schnellwerte, Absenden |
| `apps/web/src/components/match/visit-confirmation.tsx` | Bestätigungsfläche |
| `apps/web/src/components/match/scoreboard-settings-dialog.tsx` | Einstellungs-Modal |

**Geändert:**

| Datei | Änderung |
| --- | --- |
| `packages/schemas/src/match.ts` | `dartSchema`, `darts` in `submitVisitSchema` und `matchVisitSchema`, `liveTarget` in `matchStateSchema` |
| `packages/schemas/src/statistics.ts` | `frequentScoresSchema` |
| `packages/database/src/schema.ts` | Tabelle `visitDarts`, Index auf `visits` |
| `packages/scoring-engine/src/x01.ts` | `Dart`, `darts` im Kommando und in `AppliedVisit`, exakte Prüfung |
| `apps/api/src/matches/matches.repository.ts` | Würfe in Kommando, Persistenz, Rückgabe, `liveTarget` |
| `apps/api/src/statistics/*` | Schnellwerte-Endpunkt |
| `apps/web/src/components/match/match-scoreboard.tsx` | Zerlegung, dann Vollbildfläche |
| `apps/web/src/components/match/match-scoreboard-route.tsx` | Seitenhülle entfällt |
| `apps/web/package.json` | Abhängigkeit auf `@darts-platform/scoring-engine` |

---

### Task 1: Dart im Schema

**Files:**
- Modify: `packages/schemas/src/match.ts`
- Test: `packages/schemas/src/match.spec.ts`

**Interfaces:**
- Produces: `dartSchema`, `type Dart = z.infer<typeof dartSchema>`, `darts?: readonly Dart[]` auf `SubmitVisitInput`, `darts: readonly Dart[]` auf `matchVisitSchema`.

- [ ] **Step 1: Write the failing test**

An `packages/schemas/src/match.spec.ts` anhängen:

```ts
describe("dartSchema", () => {
  it("nimmt Triple 20 an", () => {
    expect(dartSchema.parse({ segment: 20, multiplier: 3 })).toEqual({ segment: 20, multiplier: 3 });
  });

  it("nimmt Bull als Doppel 25 an", () => {
    expect(dartSchema.safeParse({ segment: 25, multiplier: 2 }).success).toBe(true);
  });

  it("lehnt ein Segment zwischen 21 und 24 ab", () => {
    expect(dartSchema.safeParse({ segment: 21, multiplier: 1 }).success).toBe(false);
  });

  it("lehnt ein Triple auf Bull ab", () => {
    expect(dartSchema.safeParse({ segment: 25, multiplier: 3 }).success).toBe(false);
  });

  it("lehnt einen Fehlwurf mit Multiplikator ab", () => {
    expect(dartSchema.safeParse({ segment: 0, multiplier: 2 }).success).toBe(false);
  });
});

describe("submitVisitSchema mit Einzelwürfen", () => {
  const base = {
    commandId: "11111111-1111-4111-8111-111111111111",
    expectedVersion: 3,
    playerId: "22222222-2222-4222-8222-222222222222",
    points: 100,
    dartsThrown: 3 as const,
  };

  it("nimmt drei Würfe an, deren Summe den Punkten entspricht", () => {
    const parsed = submitVisitSchema.parse({
      ...base,
      darts: [{ segment: 20, multiplier: 3 }, { segment: 20, multiplier: 2 }, { segment: 0, multiplier: 1 }],
    });
    expect(parsed.darts).toHaveLength(3);
  });

  it("lehnt eine abweichende Summe ab", () => {
    const result = submitVisitSchema.safeParse({
      ...base,
      darts: [{ segment: 20, multiplier: 3 }, { segment: 1, multiplier: 1 }, { segment: 1, multiplier: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("lehnt eine andere Wurfzahl als dartsThrown ab", () => {
    const result = submitVisitSchema.safeParse({
      ...base,
      points: 60,
      darts: [{ segment: 20, multiplier: 3 }],
    });
    expect(result.success).toBe(false);
  });

  it("bleibt ohne Würfe gültig", () => {
    expect(submitVisitSchema.safeParse(base).success).toBe(true);
  });
});
```

Den Import in derselben Datei um `dartSchema` erweitern.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @darts-platform/schemas test`
Expected: FAIL, `dartSchema` ist nicht exportiert.

- [ ] **Step 3: Write minimal implementation**

In `packages/schemas/src/match.ts` vor `submitVisitSchema` einfügen:

```ts
/**
 * Ein einzelner Wurf. Segment 0 ist der Fehlwurf, 25 das Bull; beide tragen
 * keinen dritten Ring, deshalb die beiden Sonderregeln.
 */
export const dartSchema = z
  .object({
    segment: z.number().int().min(0).max(25),
    multiplier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .refine((dart) => dart.segment <= 20 || dart.segment === 25, { message: "Segment must be 0-20 or 25.", path: ["segment"] })
  .refine((dart) => dart.segment !== 0 || dart.multiplier === 1, { message: "A miss carries no multiplier.", path: ["multiplier"] })
  .refine((dart) => dart.segment !== 25 || dart.multiplier <= 2, { message: "Bull has no triple.", path: ["multiplier"] });
```

`submitVisitSchema` bekommt das Feld und zwei zusätzliche Refinements. Die bestehende `.refine`-Kette bleibt, die neuen hängen dahinter:

```ts
export const submitVisitSchema = z.object({
  commandId: z.uuid(), expectedVersion: z.number().int().nonnegative(), playerId: z.uuid(),
  points: z.number().int().min(0).max(180), dartsThrown: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  checkoutDouble: z.number().int().min(1).max(25).nullable().optional(),
  checkoutAttempts: z.number().int().min(0).max(3).optional(),
  controllerId: z.uuid().optional(),
  darts: z.array(dartSchema).min(1).max(3).optional(),
}).refine((value) => (value.checkoutAttempts ?? 0) <= value.dartsThrown, { message: "Checkout attempts cannot exceed darts thrown.", path: ["checkoutAttempts"] })
  .refine((value) => value.darts === undefined || value.darts.length === value.dartsThrown, { message: "The number of darts must match dartsThrown.", path: ["darts"] })
  .refine(
    (value) => value.darts === undefined || value.darts.reduce((sum, dart) => sum + dart.segment * dart.multiplier, 0) === value.points,
    { message: "The darts must add up to the visit score.", path: ["darts"] },
  );
```

`matchVisitSchema` bekommt `darts: z.array(dartSchema)`, und unter den Typ-Exports am Dateiende:

```ts
export type Dart = z.infer<typeof dartSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @darts-platform/schemas test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/match.ts packages/schemas/src/match.spec.ts
git commit -m "$(cat <<'EOF'
feat(schemas): Einzelwuerfe im Visit-Schema

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Tabelle visit_darts und Migration

**Files:**
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/drizzle/00XX_*.sql` (von drizzle-kit erzeugt)
- Test: `packages/database/src/client.integration.spec.ts`

**Interfaces:**
- Produces: `visitDarts` (Drizzle-Tabelle), `type VisitDart`.

- [ ] **Step 1: Write the failing test**

An `packages/database/src/client.integration.spec.ts` innerhalb des bestehenden `describe("database connection", …)` anhängen:

```ts
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

  it("indexes visits by thrower so frequent scores do not scan the table", async () => {
    const indexes = await connection.database.execute<{ readonly indexname: string }>(sql`
      select indexname from pg_indexes where tablename = 'visits'
    `);
    expect(indexes.map((row) => row.indexname)).toContain("visits_organization_thrower_idx");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm infra:up && npx dotenv -e .env -- npx vitest run --root packages/database src/client.integration.spec.ts`
Expected: FAIL, Relation `visit_darts` existiert nicht.

- [ ] **Step 3: Write minimal implementation**

In `packages/database/src/schema.ts` direkt nach der `visits`-Tabelle:

```ts
/**
 * Die einzelnen Wuerfe einer Aufnahme. Sie haengen am Visit; eine
 * zurueckgenommene Aufnahme behaelt ihre Wuerfe, `visits.reverted_at` bleibt
 * die einzige Wahrheit ueber den Widerruf.
 */
export const visitDarts = pgTable(
  "visit_darts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    dartIndex: integer("dart_index").notNull(),
    segment: integer("segment").notNull(),
    multiplier: integer("multiplier").notNull(),
    value: integer("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("visit_darts_visit_index_unique").on(table.visitId, table.dartIndex),
    index("visit_darts_organization_visit_idx").on(table.organizationId, table.visitId),
    check("visit_darts_index_check", sql`${table.dartIndex} between 1 and 3`),
    check("visit_darts_segment_check", sql`${table.segment} between 0 and 20 or ${table.segment} = 25`),
    check("visit_darts_multiplier_check", sql`${table.multiplier} between 1 and 3`),
    check("visit_darts_miss_check", sql`${table.segment} <> 0 or ${table.multiplier} = 1`),
    check("visit_darts_bull_check", sql`${table.segment} <> 25 or ${table.multiplier} <= 2`),
    check("visit_darts_value_check", sql`${table.value} = ${table.segment} * ${table.multiplier}`),
  ],
);
```

In der `visits`-Tabelle die Indexliste um eine Zeile erweitern:

```ts
    index("visits_organization_thrower_idx").on(table.organizationId, table.throwerPlayerId),
```

Am Dateiende neben `export type Visit`:

```ts
export type VisitDart = typeof visitDarts.$inferSelect;
```

Prüfen, dass `visitDarts` über `packages/database/src/index.ts` mit exportiert wird (die Datei re-exportiert das Schema; falls einzeln aufgezählt, ergänzen).

- [ ] **Step 4: Migration erzeugen und anwenden**

Run: `pnpm db:generate && pnpm db:migrate`
Expected: neue Datei unter `packages/database/drizzle/`, Journal-Eintrag, Migration läuft durch. Die erzeugte SQL-Datei lesen und prüfen, dass sie nur `CREATE TABLE "visit_darts"`, die Constraints und `CREATE INDEX "visits_organization_thrower_idx"` enthält — keine fremden Änderungen.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx dotenv -e .env -- npx vitest run --root packages/database src/client.integration.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/database
git commit -m "$(cat <<'EOF'
feat(database): Tabelle visit_darts fuer Einzelwuerfe

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Engine prüft exakt, sobald Würfe vorliegen

**Files:**
- Modify: `packages/scoring-engine/src/x01.ts`
- Modify: `packages/scoring-engine/src/index.ts` (Re-Export von `Dart` und `dartValue`)
- Test: `packages/scoring-engine/src/x01.spec.ts`

**Interfaces:**
- Consumes: nichts aus Task 1 oder 2 — die Engine hat eigene Typen.
- Produces:
  - `export interface Dart { readonly segment: number; readonly multiplier: 1 | 2 | 3 }`
  - `export function dartValue(dart: Dart): number`
  - `SubmitVisitCommand.darts?: readonly Dart[]`
  - `AppliedVisit.darts: readonly Dart[]`

- [ ] **Step 1: Write the failing test**

An `packages/scoring-engine/src/x01.spec.ts` anhängen. Die Datei bringt oben bereits die Helfer `singles(one, two)` und `rules(overrides)` mit — die werden benutzt, nicht neu erfunden. Der Import am Dateikopf wird um `type Dart` erweitert.

```ts
describe("X01 mit Einzelwürfen", () => {
  const sides = singles("p1", "p2");

  const submit = (
    commandId: string,
    throwerPlayerId: string,
    seat: 1 | 2,
    darts: readonly { segment: number; multiplier: 1 | 2 | 3 }[],
  ): SubmitVisitCommand => ({
    type: "SUBMIT_VISIT", commandId, seat, throwerPlayerId,
    points: darts.reduce((sum, dart) => sum + dart.segment * dart.multiplier, 0),
    dartsThrown: darts.length as 1 | 2 | 3,
    darts,
  });

  it("lehnt eine Aufnahme ab, deren Würfe nicht zur Punktzahl passen", () => {
    const match = createX01Match({ rules: rules(), sides, startingSeat: 1 });
    expect(() => executeX01Command(match, {
      type: "SUBMIT_VISIT", commandId: "c1", seat: 1, throwerPlayerId: "p1",
      points: 100, dartsThrown: 3,
      darts: [{ segment: 20, multiplier: 1 }, { segment: 20, multiplier: 1 }, { segment: 20, multiplier: 1 }],
    })).toThrow(ScoringValidationError);
  });

  it("lehnt eine andere Wurfzahl als dartsThrown ab", () => {
    const match = createX01Match({ rules: rules(), sides, startingSeat: 1 });
    expect(() => executeX01Command(match, {
      type: "SUBMIT_VISIT", commandId: "c1", seat: 1, throwerPlayerId: "p1",
      points: 60, dartsThrown: 3,
      darts: [{ segment: 20, multiplier: 3 }],
    })).toThrow(ScoringValidationError);
  });

  it("schliesst das Leg auf dem tatsächlich geworfenen Doppel", () => {
    let match = createX01Match({ rules: rules({ startingScore: 40 }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [{ segment: 20, multiplier: 2 }]));
    const visit = result.state.visits.at(-1);
    expect(visit?.outcome).toBe("MATCH_WON");
    expect(visit?.checkoutDouble).toBe(20);
    expect(visit?.darts).toHaveLength(1);
  });

  it("wertet einen Single-Finish bei Double Out als Bust", () => {
    const match = createX01Match({ rules: rules({ startingScore: 20 }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [{ segment: 20, multiplier: 1 }]));
    expect(result.state.visits.at(-1)?.outcome).toBe("BUST");
  });

  it("lässt Master Out auf einem Triple schliessen", () => {
    const match = createX01Match({ rules: rules({ startingScore: 60, outRule: "MASTER" }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [{ segment: 20, multiplier: 3 }]));
    const visit = result.state.visits.at(-1);
    expect(visit?.outcome).toBe("MATCH_WON");
    expect(visit?.checkoutDouble).toBeNull();
  });

  it("zählt bei Double In erst ab dem ersten Doppel", () => {
    const match = createX01Match({ rules: rules({ startingScore: 501, inRule: "DOUBLE" }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 1 },
      { segment: 10, multiplier: 2 },
      { segment: 5, multiplier: 1 },
    ]));
    const visit = result.state.visits.at(-1);
    expect(visit?.points).toBe(45);
    expect(visit?.appliedPoints).toBe(25);
    expect(visit?.scoreAfter).toBe(476);
  });

  it("rechnet bei Double In ohne Doppel nichts an, ohne zu scheitern", () => {
    const match = createX01Match({ rules: rules({ startingScore: 501, inRule: "DOUBLE" }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 1 }, { segment: 20, multiplier: 1 }, { segment: 20, multiplier: 1 },
    ]));
    const visit = result.state.visits.at(-1);
    expect(visit?.appliedPoints).toBe(0);
    expect(visit?.scoreAfter).toBe(501);
    expect(visit?.outcome).toBe("SCORED");
  });

  it("zählt Würfe auf ein Finishfeld als Checkout-Versuche", () => {
    const match = createX01Match({ rules: rules({ startingScore: 40 }), sides, startingSeat: 1 });
    const result = executeX01Command(match, submit("c1", "p1", 1, [
      { segment: 20, multiplier: 1 },
      { segment: 20, multiplier: 1 },
      { segment: 0, multiplier: 1 },
    ]));
    // Rest 40 vor dem ersten Wurf, Rest 20 vor dem zweiten: zwei Positionen,
    // auf denen ein Doppel geschlossen haette.
    expect(result.state.visits.at(-1)?.checkoutAttempts).toBe(2);
  });

  it("bleibt ohne Würfe beim bisherigen Verhalten", () => {
    const match = createX01Match({ rules: rules({ startingScore: 40 }), sides, startingSeat: 1 });
    const result = executeX01Command(match, {
      type: "SUBMIT_VISIT", commandId: "c1", seat: 1, throwerPlayerId: "p1",
      points: 40, dartsThrown: 2, checkoutDouble: 20,
    });
    expect(result.state.visits.at(-1)?.outcome).toBe("MATCH_WON");
    expect(result.state.visits.at(-1)?.darts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @darts-platform/scoring-engine test`
Expected: FAIL, `darts` ist im Kommando unbekannt.

- [ ] **Step 3: Write minimal implementation**

Typen und Hilfen in `packages/scoring-engine/src/x01.ts`, oberhalb von `SubmitVisitCommand`:

```ts
export interface Dart {
  readonly segment: number;
  readonly multiplier: 1 | 2 | 3;
}

export function dartValue(dart: Dart): number {
  return dart.segment * dart.multiplier;
}

function isValidDart(dart: Dart): boolean {
  if (!Number.isInteger(dart.segment) || dart.segment < 0) return false;
  if (dart.segment > 20 && dart.segment !== 25) return false;
  if (dart.segment === 0) return dart.multiplier === 1;
  if (dart.segment === 25) return dart.multiplier <= 2;
  return true;
}

function dartsTotal(darts: readonly Dart[]): number {
  return darts.reduce((sum, dart) => sum + dartValue(dart), 0);
}

/**
 * Double In: die Aufnahme zaehlt erst ab dem ersten Doppel. Wuerfe davor sind
 * keine Regelverletzung, sie zaehlen bloss nicht. Segment 0 traegt nie einen
 * Multiplikator, ein Doppel ist deshalb immer ein Treffer.
 */
function openingDartIndex(darts: readonly Dart[]): number {
  return darts.findIndex((dart) => dart.multiplier === 2);
}

/**
 * Ein Rest, den ein Doppel schliessen kann. Grundlage fuer die Zaehlung der
 * Checkout-Versuche; bei Master Out gilt dieselbe Definition, weil der
 * Doppelversuch die berichtete Groesse ist.
 */
function isFinishPosition(remaining: number): boolean {
  return remaining === 50 || (remaining > 0 && remaining <= 40 && remaining % 2 === 0);
}

function checkoutAttemptsFromDarts(scoreBefore: number, darts: readonly Dart[], outRule: OutRule): number {
  if (outRule === "SINGLE") return 0;
  let remaining = scoreBefore;
  let attempts = 0;
  for (const dart of darts) {
    if (isFinishPosition(remaining)) attempts += 1;
    remaining -= dartValue(dart);
    if (remaining < 0) break;
  }
  return attempts;
}

function closesLegWithDarts(outRule: OutRule, finishing: Dart): boolean {
  switch (outRule) {
    case "SINGLE":
      return true;
    case "DOUBLE":
      return finishing.multiplier === 2;
    case "MASTER":
      return finishing.multiplier >= 2;
  }
}
```

`SubmitVisitCommand` und `AppliedVisit` erweitern:

```ts
export interface SubmitVisitCommand {
  // … bestehende Felder unverändert …
  readonly darts?: readonly Dart[];
}

export interface AppliedVisit {
  // … bestehende Felder unverändert …
  readonly darts: readonly Dart[];
}
```

`validateVisit` um den Wurfblock ergänzen:

```ts
function validateVisit(command: SubmitVisitCommand): void {
  if (!isAttainableScore(command.points, command.dartsThrown)) { /* unverändert */ }
  // … bestehende Prüfungen unverändert …
  if (command.darts !== undefined) {
    if (command.darts.length !== command.dartsThrown) {
      throw new ScoringValidationError("INVALID_DART_COUNT", "The number of darts must match the darts thrown.");
    }
    if (!command.darts.every(isValidDart)) {
      throw new ScoringValidationError("INVALID_DART", "A dart must hit 0-20 or bull, with a valid multiplier.");
    }
    if (dartsTotal(command.darts) !== command.points) {
      throw new ScoringValidationError("DART_SUM_MISMATCH", "The darts must add up to the visit score.");
    }
  }
}
```

In der Projektionsschleife von `projectX01Match` den Block ab der Double-In-Prüfung ersetzen. Bisher:

```ts
    if (!side.openedInLeg && command.points > 0 && !opensOnDouble(command.points, command.dartsThrown)) {
      throw new ScoringValidationError("DOUBLE_IN_REQUIRED", "The first scoring visit of a leg must start on a double.");
    }
    const openedInLeg = side.openedInLeg || command.points > 0;
    const scoreBefore = side.remaining;
    const tentative = scoreBefore - command.points;
```

Neu:

```ts
    const darts = command.darts;
    let countedPoints = command.points;
    if (!side.openedInLeg) {
      if (darts === undefined) {
        if (command.points > 0 && !opensOnDouble(command.points, command.dartsThrown)) {
          throw new ScoringValidationError("DOUBLE_IN_REQUIRED", "The first scoring visit of a leg must start on a double.");
        }
      } else {
        const opening = openingDartIndex(darts);
        countedPoints = opening === -1 ? 0 : dartsTotal(darts.slice(opening));
      }
    }
    const openedInLeg = side.openedInLeg || countedPoints > 0;
    const scoreBefore = side.remaining;
    const tentative = scoreBefore - countedPoints;
```

Die Checkout-Prüfung darunter ersetzen:

```ts
    const doubleValue = command.checkoutDouble === undefined ? null : checkoutValue(command.checkoutDouble);
    const finishingDart = darts === undefined ? null : (darts.at(-1) ?? null);
    const validDoubleCheckout =
      doubleValue !== null &&
      command.points >= doubleValue &&
      attainableTotals(command.dartsThrown - 1).has(command.points - doubleValue);
    const validCheckout =
      tentative === 0 &&
      (finishingDart === null
        ? closesLeg(match.rules.outRule, command, validDoubleCheckout)
        : closesLegWithDarts(match.rules.outRule, finishingDart));
```

Und die Zeile, die den Visit in die Liste legt, um die drei abgeleiteten Werte:

```ts
    const derivedCheckoutDouble =
      finishingDart !== null && validCheckout && finishingDart.multiplier === 2
        ? finishingDart.segment
        : null;

    visits.push({
      commandId: command.commandId,
      seat: command.seat,
      throwerPlayerId: command.throwerPlayerId,
      legNumber,
      points: command.points,
      appliedPoints: bust ? 0 : countedPoints,
      dartsThrown: command.dartsThrown,
      scoreBefore,
      scoreAfter,
      checkoutDouble: darts === undefined ? (command.checkoutDouble ?? null) : derivedCheckoutDouble,
      checkoutAttempts:
        darts === undefined
          ? (command.checkoutAttempts ?? (command.checkoutDouble === undefined ? 0 : 1))
          : checkoutAttemptsFromDarts(scoreBefore, darts, match.rules.outRule),
      outcome,
      darts: darts ?? [],
    });
```

Achtung: `bust` weiter unten nutzt `tentative`, das jetzt auf `countedPoints` beruht — die bestehende Berechnung bleibt unverändert, sie liest nur die neue Variable.

`packages/scoring-engine/src/index.ts` um `Dart` und `dartValue` erweitern, falls dort einzeln exportiert wird.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @darts-platform/scoring-engine test`
Expected: PASS, auch alle bestehenden Tests. Schlägt ein bestehender Test fehl, ist das ein Regressionsfund und kein Anlass, den Test anzupassen — der Pfad ohne Würfe muss sich exakt wie vorher verhalten.

- [ ] **Step 5: Commit**

```bash
git add packages/scoring-engine
git commit -m "$(cat <<'EOF'
feat(scoring-engine): exakte Regelpruefung anhand der Einzelwuerfe

Liegen die Wuerfe vor, entscheidet das tatsaechlich getroffene Segment ueber
Double In, Double und Master Out. Ohne Wuerfe bleibt der bisherige Pfad.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Würfe im API-Schreibpfad

**Files:**
- Modify: `apps/api/src/matches/matches.repository.ts`
- Test: `apps/api/src/matches/matches.integration.spec.ts`

**Interfaces:**
- Consumes: `dartSchema`/`SubmitVisitInput.darts` aus Task 1, `visitDarts` aus Task 2, `Dart` und `AppliedVisit.darts` aus Task 3.
- Produces: `matchVisitSchema.darts` gefüllt in `MatchesRepository.getState`.

- [ ] **Step 1: Write the failing test**

An `apps/api/src/matches/matches.integration.spec.ts` anhängen, im Stil der bestehenden Fälle (eigenes Match über `service.create`, dann Visits):

```ts
  it("persists the single darts of a visit and returns them", async () => {
    const matchId = await service.create({
      organizationId,
      data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, bestOfLegs: 1, bestOfSets: 1, boardId: null },
      auth, audit,
    });
    const commandId = randomUUID();
    const state = await service.submitVisit({
      organizationId, matchId, auth, audit,
      data: {
        commandId, expectedVersion: 0, playerId: playerOneId,
        points: 100, dartsThrown: 3,
        darts: [{ segment: 20, multiplier: 3 }, { segment: 20, multiplier: 2 }, { segment: 0, multiplier: 1 }],
      },
    });

    expect(state.visits[0]?.darts).toEqual([
      { segment: 20, multiplier: 3 },
      { segment: 20, multiplier: 2 },
      { segment: 0, multiplier: 1 },
    ]);

    const stored = await databaseService.database
      .select()
      .from(visitDarts)
      .where(and(eq(visitDarts.organizationId, organizationId), eq(visitDarts.visitId, state.visits[0]!.id)));
    expect(stored).toHaveLength(3);
    expect(stored.map((row) => row.value).reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it("does not duplicate darts when the same command arrives twice", async () => {
    const matchId = await service.create({
      organizationId,
      data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, bestOfLegs: 1, bestOfSets: 1, boardId: null },
      auth, audit,
    });
    const data = {
      commandId: randomUUID(), expectedVersion: 0, playerId: playerOneId,
      points: 60, dartsThrown: 3 as const,
      darts: [{ segment: 20, multiplier: 1 }, { segment: 20, multiplier: 1 }, { segment: 20, multiplier: 1 }],
    };
    const first = await service.submitVisit({ organizationId, matchId, auth, audit, data });
    await service.submitVisit({ organizationId, matchId, auth, audit, data });

    const stored = await databaseService.database
      .select()
      .from(visitDarts)
      .where(and(eq(visitDarts.organizationId, organizationId), eq(visitDarts.visitId, first.visits[0]!.id)));
    expect(stored).toHaveLength(3);
  });
```

Den Import in der Testdatei um `visitDarts` erweitern.

- [ ] **Step 2: Run test to verify it fails**

Run: aus `apps/api`: `npx dotenv -e ../../.env -- npx vitest run src/matches/matches.integration.spec.ts -t "single darts"`
Expected: FAIL, `darts` fehlt in der Antwort.

- [ ] **Step 3: Write minimal implementation**

Drei Stellen in `apps/api/src/matches/matches.repository.ts`.

Erstens das gespeicherte Kommando — `storedSubmitSchema` erweitern und in `parseStoredCommand` durchreichen:

```ts
const storedDartSchema = z.object({
  segment: z.number().int().min(0).max(25),
  multiplier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
const storedSubmitSchema = z.object({
  // … bestehende Felder …
  darts: z.array(storedDartSchema).min(1).max(3).optional(),
});
```

```ts
  return {
    ...base,
    checkoutAttempts: parsed.checkoutAttempts,
    ...(parsed.checkoutDouble === undefined ? {} : { checkoutDouble: parsed.checkoutDouble }),
    ...(parsed.darts === undefined ? {} : { darts: parsed.darts }),
  };
```

Zweitens der Schreibpfad in `submitVisit`. Das Kommando trägt die Würfe:

```ts
      const command: X01Command = {
        type: "SUBMIT_VISIT", commandId: input.data.commandId, seat: commandSide.seat,
        throwerPlayerId: input.data.playerId, points: input.data.points, dartsThrown: input.data.dartsThrown,
        checkoutAttempts: input.data.checkoutAttempts ?? 0,
        ...(input.data.checkoutDouble === undefined || input.data.checkoutDouble === null ? {} : { checkoutDouble: input.data.checkoutDouble }),
        ...(input.data.darts === undefined ? {} : { darts: input.data.darts }),
      };
```

Direkt nach dem `insert(visits)` samt `createdVisit`-Prüfung, in derselben Transaktion:

```ts
      if (applied.darts.length > 0) {
        await transaction.insert(visitDarts).values(
          applied.darts.map((dart, index) => ({
            organizationId: input.organizationId,
            visitId: createdVisit.id,
            dartIndex: index + 1,
            segment: dart.segment,
            multiplier: dart.multiplier,
            value: dart.segment * dart.multiplier,
          })),
        );
      }
```

Weil die Wiederholung mit gleicher `commandId` früher zurückkehrt (`result.duplicate`), entstehen keine zweiten Zeilen — das prüft der zweite Test.

Drittens die Rückgabe in `getState`. Nach der Abfrage der Visits die Würfe nachladen und zuordnen:

```ts
    const visitIds = visitRows.map(({ visit }) => visit.id);
    const dartRows = visitIds.length === 0 ? [] : await this.databaseService.database
      .select()
      .from(visitDarts)
      .where(and(eq(visitDarts.organizationId, organizationId), inArray(visitDarts.visitId, visitIds)))
      .orderBy(asc(visitDarts.visitId), asc(visitDarts.dartIndex));
    const dartsByVisit = new Map<string, { readonly segment: number; readonly multiplier: 1 | 2 | 3 }[]>();
    for (const row of dartRows) {
      const list = dartsByVisit.get(row.visitId) ?? [];
      list.push({ segment: row.segment, multiplier: row.multiplier as 1 | 2 | 3 });
      dartsByVisit.set(row.visitId, list);
    }
```

und im Visit-Mapping `darts: dartsByVisit.get(visit.id) ?? []` ergänzen. `inArray` und `visitDarts` importieren.

- [ ] **Step 4: Run test to verify it passes**

Run: aus `apps/api`: `npx dotenv -e ../../.env -- npx vitest run src/matches/matches.integration.spec.ts`
Expected: PASS, inklusive aller bestehenden Fälle.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/matches
git commit -m "$(cat <<'EOF'
feat(api): Einzelwuerfe transaktional zum Visit speichern

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Live-Bezug im Matchzustand

**Files:**
- Modify: `packages/schemas/src/match.ts`
- Modify: `apps/api/src/matches/matches.repository.ts`
- Test: `apps/api/src/matches/matches.integration.spec.ts`

**Interfaces:**
- Produces: `matchStateSchema.liveTarget` mit dem Typ

```ts
type MatchLiveTarget =
  | { readonly kind: "TOURNAMENT"; readonly tournamentId: string }
  | { readonly kind: "ENCOUNTER"; readonly publicId: string }
  | null;
```

- [ ] **Step 1: Write the failing test**

```ts
  it("names no live target for a match without a competition", async () => {
    const matchId = await service.create({
      organizationId,
      data: { playerOneId, playerTwoId, startingPlayerId: playerOneId, bestOfLegs: 1, bestOfSets: 1, boardId: null },
      auth, audit,
    });
    const state = await repository.getState(organizationId, matchId);
    expect(state?.liveTarget).toBeNull();
  });
```

Ein zweiter Fall für den Turnierbezug gehört dorthin, wo bereits ein Turnier aufgebaut wird — in `tournament-scoring-lock.integration.spec.ts` existiert ein solcher Aufbau. Dort anhängen:

```ts
  it("names the tournament as live target of a tournament match", async () => {
    const state = await repository.getState(organizationId, scoringMatchId);
    expect(state?.liveTarget).toEqual({ kind: "TOURNAMENT", tournamentId });
  });
```

Die Namen `scoringMatchId` und `tournamentId` aus dem dortigen Aufbau übernehmen; zuerst die Datei lesen.

- [ ] **Step 2: Run test to verify it fails**

Run: aus `apps/api`: `npx dotenv -e ../../.env -- npx vitest run src/matches -t "live target"`
Expected: FAIL, `liveTarget` existiert nicht.

- [ ] **Step 3: Write minimal implementation**

In `packages/schemas/src/match.ts`:

```ts
/**
 * Woher das Match seine oeffentliche Live-Ansicht bezieht. Ein freies Match
 * ohne Wettbewerbsbezug traegt null.
 */
export const matchLiveTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TOURNAMENT"), tournamentId: z.uuid() }),
  z.object({ kind: z.literal("ENCOUNTER"), publicId: z.uuid() }),
]).nullable();
```

und in `matchStateSchema` das Feld `liveTarget: matchLiveTargetSchema`. Typ-Export `export type MatchLiveTarget = z.infer<typeof matchLiveTargetSchema>;`.

In `getState`, vor dem Rückgabeobjekt:

```ts
    const [tournamentRow] = await this.databaseService.database
      .select({ tournamentId: tournamentMatches.tournamentId })
      .from(tournamentMatches)
      .where(and(eq(tournamentMatches.organizationId, organizationId), eq(tournamentMatches.scoringMatchId, matchId)))
      .limit(1);
    const [encounterRow] = tournamentRow !== undefined ? [] : await this.databaseService.database
      .select({ publicId: encounters.publicId })
      .from(encounterSlots)
      .innerJoin(encounters, and(eq(encounters.id, encounterSlots.encounterId), eq(encounters.organizationId, organizationId)))
      .where(and(eq(encounterSlots.organizationId, organizationId), eq(encounterSlots.matchId, matchId)))
      .limit(1);
    const liveTarget =
      tournamentRow !== undefined
        ? ({ kind: "TOURNAMENT", tournamentId: tournamentRow.tournamentId } as const)
        : encounterRow !== undefined
          ? ({ kind: "ENCOUNTER", publicId: encounterRow.publicId } as const)
          : null;
```

`liveTarget` ins Rückgabeobjekt aufnehmen. `tournamentMatches`, `encounterSlots` und `encounters` importieren.

- [ ] **Step 4: Run test to verify it passes**

Run: aus `apps/api`: `npx dotenv -e ../../.env -- npx vitest run src/matches`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas apps/api/src/matches
git commit -m "$(cat <<'EOF'
feat(api): Live-Bezug im Matchzustand

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Schnellwerte-Endpunkt

**Files:**
- Modify: `packages/schemas/src/statistics.ts`
- Modify: `apps/api/src/statistics/statistics.repository.ts`
- Modify: `apps/api/src/statistics/statistics.service.ts`
- Modify: `apps/api/src/statistics/statistics.controller.ts`
- Test: `apps/api/src/statistics/statistics.integration.spec.ts` (neu, falls nicht vorhanden)

**Interfaces:**
- Produces:
  - `frequentScoresSchema` mit `{ scores: number[]; source: "PLAYER" | "ORGANIZATION" | "DEFAULT" }`
  - `StatisticsService.frequentScores({ organizationId, playerId, auth }): Promise<FrequentScores>`
  - `StatisticsRepository.playerExists(organizationId, playerId): Promise<boolean>`
  - Route `GET organizations/:organizationId/players/:playerId/statistics/frequent-scores`

- [ ] **Step 1: Write the failing test**

Neue Datei `apps/api/src/statistics/statistics.integration.spec.ts`, Aufbau wie in `matches.integration.spec.ts` (Organisation, Benutzer mit Rolle `OWNER`, zwei Spieler, ein Match). Kern:

```ts
  it("falls back to the default set for a player without visits", async () => {
    const result = await service.frequentScores({ organizationId, playerId: playerOneId, auth });
    expect(result.source).toBe("DEFAULT");
    expect(result.scores).toEqual([26, 41, 45, 60, 81, 85]);
  });

  it("rejects a player of another organization", async () => {
    await expect(
      service.frequentScores({ organizationId: otherOrganizationId, playerId: playerOneId, auth }),
    ).rejects.toThrow();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: aus `apps/api`: `npx dotenv -e ../../.env -- npx vitest run src/statistics/statistics.integration.spec.ts`
Expected: FAIL, `frequentScores` existiert nicht.

- [ ] **Step 3: Write minimal implementation**

In `packages/schemas/src/statistics.ts`:

```ts
export const frequentScoresSourceSchema = z.enum(["PLAYER", "ORGANIZATION", "DEFAULT"]);
export const frequentScoresSchema = z.object({
  scores: z.array(z.number().int().min(0).max(180)).max(6),
  source: frequentScoresSourceSchema,
});
export type FrequentScores = z.infer<typeof frequentScoresSchema>;
```

In `statistics.repository.ts`:

```ts
  /** Die haeufigsten gewerteten Aufnahmesummen, absteigend nach Haeufigkeit. */
  public async frequentScores(input: {
    readonly organizationId: string;
    readonly playerId: string | null;
    readonly limit: number;
  }): Promise<readonly { readonly points: number; readonly count: number }[]> {
    const conditions = [
      eq(visits.organizationId, input.organizationId),
      isNull(visits.revertedAt),
      ne(visits.outcome, "BUST"),
      gt(visits.points, 0),
    ];
    if (input.playerId !== null) conditions.push(eq(visits.throwerPlayerId, input.playerId));
    const rows = await this.database.database
      .select({ points: visits.points, count: count() })
      .from(visits)
      .where(and(...conditions))
      .groupBy(visits.points)
      .orderBy(desc(count()))
      .limit(input.limit);
    return rows.map((row) => ({ points: row.points, count: Number(row.count) }));
  }

  public async playerExists(organizationId: string, playerId: string): Promise<boolean> {
    const [row] = await this.database.database
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.organizationId, organizationId), eq(players.id, playerId)))
      .limit(1);
    return row !== undefined;
  }

  public async visitCount(organizationId: string, playerId: string): Promise<number> {
    const [row] = await this.database.database
      .select({ count: count() })
      .from(visits)
      .where(and(eq(visits.organizationId, organizationId), eq(visits.throwerPlayerId, playerId), isNull(visits.revertedAt)));
    return Number(row?.count ?? 0);
  }
```

In `statistics.service.ts`:

```ts
const DEFAULT_SCORES = [26, 41, 45, 60, 81, 85] as const;
const MINIMUM_VISITS = 30;

  public async frequentScores(input: { readonly organizationId: string; readonly playerId: string; readonly auth: AuthContext }): Promise<FrequentScores> {
    await this.access.requirePermission({ organizationId: input.organizationId, userId: input.auth.user.id, permission: "statistics:read" });
    // Nicht ueber `getData` pruefen: das laedt alle Matches, Legs und Visits
    // der Person, nur um ihre Existenz zu klaeren.
    if (!await this.repository.playerExists(input.organizationId, input.playerId)) {
      throw new NotFoundException("Spieler nicht gefunden.");
    }
    const own = await this.repository.visitCount(input.organizationId, input.playerId);
    const rows = own >= MINIMUM_VISITS
      ? await this.repository.frequentScores({ organizationId: input.organizationId, playerId: input.playerId, limit: 6 })
      : await this.repository.frequentScores({ organizationId: input.organizationId, playerId: null, limit: 6 });
    const source = rows.length < 6 ? "DEFAULT" : own >= MINIMUM_VISITS ? "PLAYER" : "ORGANIZATION";
    const scores = source === "DEFAULT" ? [...DEFAULT_SCORES] : rows.map((row) => row.points).sort((a, b) => a - b);
    return frequentScoresSchema.parse({ scores, source });
  }
```

In `statistics.controller.ts`:

```ts
  @Get("frequent-scores")
  public frequentScores(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("playerId", ParseUUIDPipe) playerId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<FrequentScores> {
    return this.service.frequentScores({ organizationId, playerId, auth });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: aus `apps/api`: `npx dotenv -e ../../.env -- npx vitest run src/statistics`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas apps/api/src/statistics
git commit -m "$(cat <<'EOF'
feat(api): Schnellwerte fuer die Runden-Eingabe

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Gerätelokale Scoreboard-Einstellungen

**Files:**
- Create: `apps/web/src/lib/scoreboard-settings.ts`
- Create: `apps/web/src/lib/scoreboard-settings.spec.ts`

**Interfaces:**
- Produces:

```ts
export type ScoreboardInputMode = "DART" | "ROUND";
export interface ScoreboardSettings {
  readonly mode: ScoreboardInputMode;
  readonly confirmScore: boolean;
  readonly autoConfirm: boolean;
  readonly confirmCheckoutDarts: boolean;
}
export const defaultScoreboardSettings: ScoreboardSettings;
export function parseScoreboardSettings(raw: string | null): ScoreboardSettings;
export function readScoreboardSettings(): ScoreboardSettings;
export function writeScoreboardSettings(settings: ScoreboardSettings): void;
export function subscribeScoreboardSettings(listener: () => void): () => void;
export const scoreboardSettingsStorageKey: string;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  defaultScoreboardSettings,
  parseScoreboardSettings,
  readScoreboardSettings,
  writeScoreboardSettings,
} from "./scoreboard-settings";

describe("parseScoreboardSettings", () => {
  it("liefert die Standardwerte ohne gespeicherten Wert", () => {
    expect(parseScoreboardSettings(null)).toEqual(defaultScoreboardSettings);
  });

  it("liefert die Standardwerte bei kaputtem JSON", () => {
    expect(parseScoreboardSettings("{nicht json")).toEqual(defaultScoreboardSettings);
  });

  it("liefert die Standardwerte bei unbekanntem Modus", () => {
    expect(parseScoreboardSettings(JSON.stringify({ mode: "GEMISCHT", confirmScore: true, autoConfirm: false, confirmCheckoutDarts: true })))
      .toEqual(defaultScoreboardSettings);
  });

  it("liest gültige Einstellungen", () => {
    const stored = { mode: "ROUND", confirmScore: false, autoConfirm: false, confirmCheckoutDarts: false };
    expect(parseScoreboardSettings(JSON.stringify(stored))).toEqual(stored);
  });

  it("startet im Dart-Modus mit Bestätigung und ohne automatisches Absenden", () => {
    expect(defaultScoreboardSettings).toEqual({
      mode: "DART", confirmScore: true, autoConfirm: false, confirmCheckoutDarts: true,
    });
  });
});

describe("readScoreboardSettings", () => {
  it("liefert denselben Schnappschuss, solange nichts geschrieben wurde", () => {
    expect(readScoreboardSettings()).toBe(readScoreboardSettings());
  });

  it("liefert nach dem Schreiben den neuen Stand", () => {
    const next = { mode: "ROUND", confirmScore: false, autoConfirm: false, confirmCheckoutDarts: false } as const;
    writeScoreboardSettings(next);
    expect(readScoreboardSettings()).toEqual(next);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @darts-platform/web test`
Expected: FAIL, Modul fehlt.

- [ ] **Step 3: Write minimal implementation**

```ts
import { z } from "zod";

/** Die Einstellungen gehoeren zum Scoring-Geraet am Board, nicht zum Konto. */
export const scoreboardSettingsStorageKey = "dartbase.scoreboard-settings.v1";

const settingsSchema = z.object({
  mode: z.enum(["DART", "ROUND"]),
  confirmScore: z.boolean(),
  autoConfirm: z.boolean(),
  confirmCheckoutDarts: z.boolean(),
});

export type ScoreboardInputMode = z.infer<typeof settingsSchema>["mode"];
export type ScoreboardSettings = z.infer<typeof settingsSchema>;

export const defaultScoreboardSettings: ScoreboardSettings = {
  mode: "DART",
  confirmScore: true,
  autoConfirm: false,
  confirmCheckoutDarts: true,
};

export function parseScoreboardSettings(raw: string | null): ScoreboardSettings {
  if (raw === null) return defaultScoreboardSettings;
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : defaultScoreboardSettings;
  } catch {
    return defaultScoreboardSettings;
  }
}

const listeners = new Set<() => void>();

export function subscribeScoreboardSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * `useSyncExternalStore` vergleicht den Schnappschuss per Referenz. Wuerde hier
 * bei jedem Aufruf ein frisches Objekt entstehen, liefe React endlos neu.
 * Deshalb haelt das Modul den gelesenen Stand und ersetzt ihn nur beim
 * Schreiben.
 */
let snapshot: ScoreboardSettings | null = null;

export function readScoreboardSettings(): ScoreboardSettings {
  if (typeof window === "undefined") return defaultScoreboardSettings;
  if (snapshot !== null) return snapshot;
  try {
    snapshot = parseScoreboardSettings(window.localStorage.getItem(scoreboardSettingsStorageKey));
  } catch {
    snapshot = defaultScoreboardSettings;
  }
  return snapshot;
}

export function writeScoreboardSettings(settings: ScoreboardSettings): void {
  snapshot = settings;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(scoreboardSettingsStorageKey, JSON.stringify(settings));
    } catch {
      // Ein gesperrter Speicher darf das Scoring nicht anhalten.
    }
  }
  for (const listener of listeners) listener();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @darts-platform/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/scoreboard-settings.ts apps/web/src/lib/scoreboard-settings.spec.ts
git commit -m "$(cat <<'EOF'
feat(web): geraetelokale Scoreboard-Einstellungen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Reducer der Dart-Eingabe

**Files:**
- Create: `apps/web/src/lib/dart-entry.ts`
- Create: `apps/web/src/lib/dart-entry.spec.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: `Dart` und `dartValue` aus `@darts-platform/scoring-engine` (Task 3).
- Produces:

```ts
export interface DartEntryState {
  readonly darts: readonly Dart[];
  readonly modifier: 1 | 2 | 3;
}
export type DartEntryAction =
  | { readonly type: "SEGMENT"; readonly segment: number }
  | { readonly type: "MODIFIER"; readonly multiplier: 2 | 3 }
  | { readonly type: "BACKSPACE" }
  | { readonly type: "RESET" };
export const emptyDartEntry: DartEntryState;
export function dartEntryReducer(state: DartEntryState, action: DartEntryAction): DartEntryState;
export interface DartEntryPreview {
  readonly points: number;
  readonly remaining: number;
  readonly complete: boolean;
  readonly outcome: "OPEN" | "SCORED" | "BUST" | "CHECKOUT";
}
export function previewDartEntry(input: {
  readonly darts: readonly Dart[];
  readonly remaining: number;
  readonly outRule: "SINGLE" | "DOUBLE" | "MASTER";
}): DartEntryPreview;
export function isSegmentAvailable(segment: number, modifier: 1 | 2 | 3): boolean;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { dartEntryReducer, emptyDartEntry, isSegmentAvailable, previewDartEntry } from "./dart-entry";

describe("dartEntryReducer", () => {
  it("legt einen Single ab", () => {
    const state = dartEntryReducer(emptyDartEntry, { type: "SEGMENT", segment: 20 });
    expect(state.darts).toEqual([{ segment: 20, multiplier: 1 }]);
  });

  it("wendet den Umschalter auf genau einen Wurf an", () => {
    const withModifier = dartEntryReducer(emptyDartEntry, { type: "MODIFIER", multiplier: 3 });
    const afterFirst = dartEntryReducer(withModifier, { type: "SEGMENT", segment: 20 });
    const afterSecond = dartEntryReducer(afterFirst, { type: "SEGMENT", segment: 20 });
    expect(afterSecond.darts).toEqual([
      { segment: 20, multiplier: 3 },
      { segment: 20, multiplier: 1 },
    ]);
  });

  it("schaltet einen aktiven Umschalter wieder ab", () => {
    const on = dartEntryReducer(emptyDartEntry, { type: "MODIFIER", multiplier: 2 });
    expect(dartEntryReducer(on, { type: "MODIFIER", multiplier: 2 }).modifier).toBe(1);
  });

  it("nimmt mit der Rücktaste den letzten Wurf zurück", () => {
    const one = dartEntryReducer(emptyDartEntry, { type: "SEGMENT", segment: 5 });
    expect(dartEntryReducer(one, { type: "BACKSPACE" }).darts).toEqual([]);
  });

  it("nimmt keinen vierten Wurf an", () => {
    let state = emptyDartEntry;
    for (const segment of [20, 20, 20, 20]) state = dartEntryReducer(state, { type: "SEGMENT", segment });
    expect(state.darts).toHaveLength(3);
  });

  it("bildet die Bullseye-Taste auf Doppel 25 ab", () => {
    expect(dartEntryReducer(emptyDartEntry, { type: "SEGMENT", segment: 50 }).darts)
      .toEqual([{ segment: 25, multiplier: 2 }]);
  });

  it("sperrt die Bullseye-Taste bei aktivem Umschalter", () => {
    const withTriple = dartEntryReducer(emptyDartEntry, { type: "MODIFIER", multiplier: 3 });
    expect(dartEntryReducer(withTriple, { type: "SEGMENT", segment: 50 }).darts).toEqual([]);
  });
});

describe("isSegmentAvailable", () => {
  it("sperrt das Triple auf Bull", () => {
    expect(isSegmentAvailable(25, 3)).toBe(false);
    expect(isSegmentAvailable(25, 2)).toBe(true);
  });

  it("sperrt jeden Multiplikator auf dem Fehlwurf", () => {
    expect(isSegmentAvailable(0, 2)).toBe(false);
    expect(isSegmentAvailable(0, 1)).toBe(true);
  });
});

describe("previewDartEntry", () => {
  it("meldet die Aufnahme als offen, solange Würfe fehlen", () => {
    const preview = previewDartEntry({ darts: [{ segment: 20, multiplier: 1 }], remaining: 501, outRule: "DOUBLE" });
    expect(preview).toMatchObject({ points: 20, remaining: 481, complete: false, outcome: "OPEN" });
  });

  it("erkennt einen Checkout auf dem Doppel", () => {
    const preview = previewDartEntry({ darts: [{ segment: 20, multiplier: 2 }], remaining: 40, outRule: "DOUBLE" });
    expect(preview).toMatchObject({ complete: true, outcome: "CHECKOUT", remaining: 0 });
  });

  it("erkennt den Bust unter null", () => {
    const preview = previewDartEntry({ darts: [{ segment: 20, multiplier: 3 }], remaining: 40, outRule: "DOUBLE" });
    expect(preview).toMatchObject({ complete: true, outcome: "BUST", remaining: 40 });
  });

  it("erkennt den Bust auf Rest eins bei Double Out", () => {
    const preview = previewDartEntry({ darts: [{ segment: 19, multiplier: 1 }], remaining: 20, outRule: "DOUBLE" });
    expect(preview).toMatchObject({ complete: true, outcome: "BUST" });
  });

  it("wertet ein Single-Finish bei Double Out als Bust", () => {
    const preview = previewDartEntry({ darts: [{ segment: 20, multiplier: 1 }], remaining: 20, outRule: "DOUBLE" });
    expect(preview.outcome).toBe("BUST");
  });

  it("schliesst die Aufnahme nach dem dritten Wurf", () => {
    const preview = previewDartEntry({
      darts: [{ segment: 20, multiplier: 1 }, { segment: 20, multiplier: 1 }, { segment: 20, multiplier: 1 }],
      remaining: 501, outRule: "DOUBLE",
    });
    expect(preview).toMatchObject({ complete: true, outcome: "SCORED", remaining: 441 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @darts-platform/web test`
Expected: FAIL, Modul fehlt.

- [ ] **Step 3: Add the engine dependency**

In `apps/web/package.json` unter `dependencies`:

```json
    "@darts-platform/scoring-engine": "workspace:*",
```

Run: `pnpm install`

Die Engine ist reine Domänenlogik ohne Infrastruktur; der Import in die Web-App ist erlaubt und ersetzt keine serverseitige Prüfung — sie liefert nur die Vorschau.

- [ ] **Step 4: Write minimal implementation**

```ts
import { dartValue, type Dart } from "@darts-platform/scoring-engine";

export interface DartEntryState {
  readonly darts: readonly Dart[];
  readonly modifier: 1 | 2 | 3;
}

export type DartEntryAction =
  | { readonly type: "SEGMENT"; readonly segment: number }
  | { readonly type: "MODIFIER"; readonly multiplier: 2 | 3 }
  | { readonly type: "BACKSPACE" }
  | { readonly type: "RESET" };

export const emptyDartEntry: DartEntryState = { darts: [], modifier: 1 };

/**
 * Bull traegt kein Triple, der Fehlwurf gar keinen Multiplikator, und die
 * Bullseye-Taste (50) ist selbst schon ein Doppel.
 */
export function isSegmentAvailable(segment: number, modifier: 1 | 2 | 3): boolean {
  if (segment === 0) return modifier === 1;
  if (segment === 50) return modifier === 1;
  if (segment === 25) return modifier <= 2;
  return true;
}

export function dartEntryReducer(state: DartEntryState, action: DartEntryAction): DartEntryState {
  switch (action.type) {
    case "SEGMENT": {
      if (state.darts.length >= 3) return state;
      if (!isSegmentAvailable(action.segment, state.modifier)) return state;
      // Die Bullseye-Taste traegt den Wert, nicht das Segment: 50 ist Doppel 25.
      if (action.segment === 50) {
        return { darts: [...state.darts, { segment: 25, multiplier: 2 }], modifier: 1 };
      }
      const multiplier = action.segment === 0 ? 1 : state.modifier;
      return { darts: [...state.darts, { segment: action.segment, multiplier }], modifier: 1 };
    }
    case "MODIFIER":
      return { ...state, modifier: state.modifier === action.multiplier ? 1 : action.multiplier };
    case "BACKSPACE":
      return { darts: state.darts.slice(0, -1), modifier: 1 };
    case "RESET":
      return emptyDartEntry;
  }
}

export interface DartEntryPreview {
  readonly points: number;
  readonly remaining: number;
  readonly complete: boolean;
  readonly outcome: "OPEN" | "SCORED" | "BUST" | "CHECKOUT";
}

function closes(outRule: "SINGLE" | "DOUBLE" | "MASTER", finishing: Dart): boolean {
  switch (outRule) {
    case "SINGLE": return true;
    case "DOUBLE": return finishing.multiplier === 2;
    case "MASTER": return finishing.multiplier >= 2;
  }
}

/**
 * Nur Vorschau. Ueber Bust und Checkout entscheidet die Engine auf dem Server;
 * weicht ihre Antwort ab, gilt die Antwort.
 */
export function previewDartEntry(input: {
  readonly darts: readonly Dart[];
  readonly remaining: number;
  readonly outRule: "SINGLE" | "DOUBLE" | "MASTER";
}): DartEntryPreview {
  const points = input.darts.reduce((sum, dart) => sum + dartValue(dart), 0);
  const tentative = input.remaining - points;
  const finishing = input.darts.at(-1) ?? null;
  const checkout = tentative === 0 && finishing !== null && closes(input.outRule, finishing);
  const bust = tentative < 0 || (input.outRule !== "SINGLE" && tentative === 1) || (tentative === 0 && !checkout);
  if (checkout) return { points, remaining: 0, complete: true, outcome: "CHECKOUT" };
  if (bust) return { points, remaining: input.remaining, complete: true, outcome: "BUST" };
  return {
    points,
    remaining: tentative,
    complete: input.darts.length >= 3,
    outcome: input.darts.length >= 3 ? "SCORED" : "OPEN",
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @darts-platform/web test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/src/lib/dart-entry.ts apps/web/src/lib/dart-entry.spec.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(web): Reducer und Vorschau der Dart-Eingabe

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Gültigkeitsprüfung der Runden-Eingabe

**Files:**
- Create: `apps/web/src/lib/round-entry.ts`
- Create: `apps/web/src/lib/round-entry.spec.ts`

**Interfaces:**
- Consumes: `isAttainableScore` aus `@darts-platform/scoring-engine`.
- Produces:

```ts
export function appendRoundDigit(current: string, digit: number): string;
export function removeRoundDigit(current: string): string;
export function isRoundEntrySubmittable(value: string): boolean;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { appendRoundDigit, isRoundEntrySubmittable, removeRoundDigit } from "./round-entry";

describe("appendRoundDigit", () => {
  it("hängt eine Ziffer an", () => {
    expect(appendRoundDigit("1", 8)).toBe("18");
  });

  it("nimmt keinen Wert über 180 an", () => {
    expect(appendRoundDigit("18", 5)).toBe("18");
  });

  it("ersetzt die führende Null", () => {
    expect(appendRoundDigit("0", 6)).toBe("6");
  });
});

describe("removeRoundDigit", () => {
  it("entfernt die letzte Ziffer", () => {
    expect(removeRoundDigit("140")).toBe("14");
  });

  it("bleibt bei leerer Eingabe leer", () => {
    expect(removeRoundDigit("")).toBe("");
  });
});

describe("isRoundEntrySubmittable", () => {
  it("lehnt eine leere Eingabe ab", () => {
    expect(isRoundEntrySubmittable("")).toBe(false);
  });

  it("lehnt eine mit drei Darts unmögliche Summe ab", () => {
    expect(isRoundEntrySubmittable("179")).toBe(false);
  });

  it("nimmt 180 an", () => {
    expect(isRoundEntrySubmittable("180")).toBe(true);
  });

  it("nimmt eine Null an", () => {
    expect(isRoundEntrySubmittable("0")).toBe(true);
  });

  it("nimmt eine Überwerfung an, weil der Bust ein gültiger Ausgang ist", () => {
    expect(isRoundEntrySubmittable("60")).toBe(true);
  });

  it("nimmt einen Rest von eins an, weil auch das ein Bust ist", () => {
    expect(isRoundEntrySubmittable("39")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @darts-platform/web test`
Expected: FAIL, Modul fehlt.

- [ ] **Step 3: Write minimal implementation**

```ts
import { isAttainableScore } from "@darts-platform/scoring-engine";

export function appendRoundDigit(current: string, digit: number): string {
  const next = current === "0" ? String(digit) : `${current}${digit}`;
  if (next.length > 3) return current;
  return Number(next) > 180 ? current : next;
}

export function removeRoundDigit(current: string): string {
  return current.slice(0, -1);
}

/**
 * Gesperrt wird nur, was mit drei Darts gar nicht zu werfen ist. Eine
 * Ueberwerfung und ein Rest von eins bleiben erlaubt: das sind Busts, also
 * gueltige Ausgaenge, und wer sie nicht erfassen kann, kann nicht zaehlen.
 * Ueber den Ausgang entscheidet die Engine.
 */
export function isRoundEntrySubmittable(value: string): boolean {
  if (value === "") return false;
  const points = Number(value);
  if (!Number.isInteger(points) || points < 0 || points > 180) return false;
  return isAttainableScore(points, 3);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @darts-platform/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/round-entry.ts apps/web/src/lib/round-entry.spec.ts
git commit -m "$(cat <<'EOF'
feat(web): Gueltigkeitspruefung der Runden-Eingabe

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Zustand aus der Komponente lösen

**Files:**
- Create: `apps/web/src/components/match/use-match-scoring.ts`
- Modify: `apps/web/src/components/match/match-scoreboard.tsx`

**Interfaces:**
- Produces:

```ts
export interface MatchScoring {
  readonly lock: ReturnType<typeof useBoardControllerLock>;
  readonly queued: readonly OfflineCommand[];
  readonly online: boolean;
  readonly replaying: boolean;
  readonly mayControl: boolean;
  readonly error: unknown;
  readonly submitPending: boolean;
  readonly undoPending: boolean;
  readonly abortPending: boolean;
  readonly submitVisit: (visit: {
    readonly points: number;
    readonly dartsThrown: 1 | 2 | 3;
    readonly checkoutDouble?: number;
    readonly darts?: readonly Dart[];
  }) => void;
  readonly undoVisit: () => void;
  readonly abortMatch: (reason: string) => void;
  readonly resetSubmit: () => void;
  readonly replay: () => void;
  readonly discardQueued: (commandId: string) => void;
}
export function useMatchScoring(input: {
  readonly organizationId: string;
  readonly match: MatchStateResponse;
  readonly canScore: boolean;
}): MatchScoring;
```

`Dart` wird im Hook aus `@darts-platform/schemas` importiert, nicht aus der Engine: der Wert wandert als Teil des HTTP-Bodys hinaus, und das Schema ist die Wahrheit über den Body.

**Diese Aufgabe ändert kein Verhalten.** Sie verschiebt den vorhandenen Zustandscode aus `match-scoreboard.tsx` in den Hook, ohne ihn umzuschreiben — mit einer Ausnahme: `submitVisit` reicht ein optionales `darts` mit, das im Body als `darts` landet, und der Offline-Body trägt es mit.

- [ ] **Step 1: Hook anlegen**

Aus `match-scoreboard.tsx` unverändert in `use-match-scoring.ts` verschieben: `refresh`, `refreshQueue`, die beiden `useEffect` für die Queue und die Online-Ereignisse, `replay`, die drei Mutationen `submit`, `undo`, `abort`, sowie die Ableitungen `error`, `hasPending`, `mayControl`. Die Komponente behält `points`, `checkoutOpen`, `checkoutDouble`, `checkoutDarts`, `abortOpen` — das ist Eingabezustand der Fläche, nicht Scoringzustand.

Im Body der Visit-Mutation ergänzen:

```ts
        ...(visit.darts === undefined ? {} : { darts: visit.darts }),
```

- [ ] **Step 2: Komponente auf den Hook umstellen**

`match-scoreboard.tsx` ruft `useMatchScoring({ organizationId, match, canScore })` und nutzt dessen Rückgaben. Die JSX bleibt in diesem Schritt Zeile für Zeile dieselbe.

- [ ] **Step 3: Prüfen, dass sich nichts geändert hat**

Run: `pnpm --filter @darts-platform/web typecheck && pnpm lint`
Expected: sauber.

Run: `pnpm test:e2e`
Expected: PASS — der bestehende E2E-Lauf deckt das heutige Scoring ab und ist hier das Sicherheitsnetz. E2E mit einem Worker laufen lassen, sporadische Fehlschläge sind Kontention gegen `next dev`, kein Bug.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/match
git commit -m "$(cat <<'EOF'
refactor(web): Scoringzustand in einen Hook loesen

Reine Verschiebung ohne Verhaltensaenderung, als Grundlage fuer die
Vollbildflaeche.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Vollbildlayout mit Kopfzeile, Status und Spielerpanels

**Files:**
- Create: `apps/web/src/components/match/scoreboard-header.tsx`
- Create: `apps/web/src/components/match/scoreboard-status.tsx`
- Create: `apps/web/src/components/match/scoreboard-sides.tsx`
- Modify: `apps/web/src/components/match/match-scoreboard.tsx`
- Modify: `apps/web/src/components/match/match-scoreboard-route.tsx`
- Create: `apps/web/src/lib/scoreboard-view.ts`
- Create: `apps/web/src/lib/scoreboard-view.spec.ts`

**Interfaces:**
- Consumes: `MatchStateResponse` samt `liveTarget` (Task 5), `useMatchScoring` (Task 10).
- Produces:

Die drei Helfer nehmen bewusst nur das, was sie brauchen, statt den ganzen `MatchStateResponse`. Ein Matchzustand erfüllt diese Formen strukturell und wird unverändert übergeben; die Tests kommen dadurch ohne Typzwang aus.

```ts
// scoreboard-view.ts
export interface RoundVisit {
  readonly legNumber: number;
  readonly playerId: string;
  readonly reverted: boolean;
}
export interface AverageVisit extends RoundVisit {
  readonly appliedPoints: number;
  readonly dartsThrown: number;
}
export function currentRoundNumber(input: {
  readonly currentLegNumber: number;
  readonly visits: readonly RoundVisit[];
}): number;
export function liveHref(input: {
  readonly boardId: string | null;
  readonly liveTarget: MatchLiveTarget;
}): string | null;
export function threeDartAverage(input: {
  readonly visits: readonly AverageVisit[];
  readonly playerIds: readonly string[];
  readonly legNumber: number;
}): number;
// Komponenten
export function ScoreboardHeader(props: { readonly match: MatchStateResponse; readonly backHref: string; readonly backLabel: string; readonly onOpenSettings: () => void }): JSX.Element;
export function ScoreboardStatus(props: { readonly lockState: "EIGEN" | "FREMD" | "UNBEKANNT"; readonly online: boolean; readonly queuedCount: number; readonly message: string | null; readonly onTakeOver: () => void }): JSX.Element | null;
export function ScoreboardSides(props: { readonly match: MatchStateResponse; readonly pendingDarts: readonly Dart[]; readonly showDartBand: boolean }): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/scoreboard-view.spec.ts` — reine Funktionen, kein Rendering:

```ts
import { describe, expect, it } from "vitest";
import { currentRoundNumber, liveHref, threeDartAverage } from "./scoreboard-view";

describe("currentRoundNumber", () => {
  it("beginnt bei eins ohne Aufnahme im Leg", () => {
    expect(currentRoundNumber({ currentLegNumber: 2, visits: [] })).toBe(1);
  });

  it("zählt die Runde aus den Aufnahmen des laufenden Legs", () => {
    expect(currentRoundNumber({
      currentLegNumber: 2,
      visits: [
        { legNumber: 2, playerId: "p1", reverted: false },
        { legNumber: 2, playerId: "p2", reverted: false },
        { legNumber: 2, playerId: "p1", reverted: false },
        { legNumber: 1, playerId: "p1", reverted: false },
      ],
    })).toBe(2);
  });

  it("übergeht zurückgenommene Aufnahmen", () => {
    expect(currentRoundNumber({
      currentLegNumber: 2,
      visits: [
        { legNumber: 2, playerId: "p1", reverted: true },
        { legNumber: 2, playerId: "p2", reverted: true },
      ],
    })).toBe(1);
  });
});

describe("liveHref", () => {
  it("führt ohne Wettbewerbsbezug nirgendwohin", () => {
    expect(liveHref({ boardId: "b1", liveTarget: null })).toBeNull();
  });

  it("führt bei einem Turnier mit Board auf die Board-Ansicht", () => {
    expect(liveHref({ boardId: "b1", liveTarget: { kind: "TOURNAMENT", tournamentId: "t1" } }))
      .toBe("/live/t1/board/b1");
  });

  it("führt bei einem Turnier ohne Board auf die Turnieransicht", () => {
    expect(liveHref({ boardId: null, liveTarget: { kind: "TOURNAMENT", tournamentId: "t1" } }))
      .toBe("/live/t1");
  });

  it("führt bei einer Begegnung auf die öffentliche Begegnung", () => {
    expect(liveHref({ boardId: null, liveTarget: { kind: "ENCOUNTER", publicId: "e1" } }))
      .toBe("/live/begegnungen/e1");
  });
});

describe("threeDartAverage", () => {
  it("ist null ohne gewertete Aufnahme", () => {
    expect(threeDartAverage({ visits: [], playerIds: ["p1"], legNumber: 1 })).toBe(0);
  });

  it("rechnet die angerechneten Punkte auf drei Darts hoch", () => {
    expect(threeDartAverage({
      visits: [
        { legNumber: 1, playerId: "p1", appliedPoints: 60, dartsThrown: 3, reverted: false },
        { legNumber: 1, playerId: "p1", appliedPoints: 40, dartsThrown: 2, reverted: false },
      ],
      playerIds: ["p1"],
      legNumber: 1,
    })).toBeCloseTo(60, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @darts-platform/web test`
Expected: FAIL, Modul fehlt.

- [ ] **Step 3: Write the pure helpers**

`apps/web/src/lib/scoreboard-view.ts`:

```ts
import type { MatchLiveTarget } from "@darts-platform/schemas";

export interface RoundVisit {
  readonly legNumber: number;
  readonly playerId: string;
  readonly reverted: boolean;
}

export interface AverageVisit extends RoundVisit {
  readonly appliedPoints: number;
  readonly dartsThrown: number;
}

/** Eine Runde ist voll, wenn beide Seiten im Leg gleich oft geworfen haben. */
export function currentRoundNumber(input: {
  readonly currentLegNumber: number;
  readonly visits: readonly RoundVisit[];
}): number {
  const inLeg = input.visits.filter((visit) => visit.legNumber === input.currentLegNumber && !visit.reverted);
  const perPlayer = new Map<string, number>();
  for (const visit of inLeg) perPlayer.set(visit.playerId, (perPlayer.get(visit.playerId) ?? 0) + 1);
  const counts = [...perPlayer.values()];
  return counts.length === 0 ? 1 : Math.min(...counts) + 1;
}

export function liveHref(input: {
  readonly boardId: string | null;
  readonly liveTarget: MatchLiveTarget;
}): string | null {
  if (input.liveTarget === null) return null;
  if (input.liveTarget.kind === "ENCOUNTER") return `/live/begegnungen/${input.liveTarget.publicId}`;
  return input.boardId === null
    ? `/live/${input.liveTarget.tournamentId}`
    : `/live/${input.liveTarget.tournamentId}/board/${input.boardId}`;
}

export function threeDartAverage(input: {
  readonly visits: readonly AverageVisit[];
  readonly playerIds: readonly string[];
  readonly legNumber: number;
}): number {
  const own = input.visits.filter(
    (visit) => visit.legNumber === input.legNumber && !visit.reverted && input.playerIds.includes(visit.playerId),
  );
  const darts = own.reduce((sum, visit) => sum + visit.dartsThrown, 0);
  if (darts === 0) return 0;
  return (own.reduce((sum, visit) => sum + visit.appliedPoints, 0) / darts) * 3;
}
```

Achtung: `currentRoundNumber` zählt korrekt nur, solange beide Seiten geworfen haben; mit einer angefangenen Runde liefert `Math.min(...) + 1` die laufende Runde — genau das, was die Kopfzeile zeigen soll.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @darts-platform/web test`
Expected: PASS.

- [ ] **Step 5: Die drei Darstellungsbausteine schreiben**

`scoreboard-header.tsx`: Grid mit drei Spalten. Links Zurück-Pfeil (`Link` auf `backHref`, `aria-label={backLabel}`) und darunter `LEG {match.currentLegNumber}` in `text-label text-slate-400` sowie `RUNDE {currentRoundNumber(match)}` in `text-label text-white`. Mitte `match.startingScore` in `text-title font-numerals` und darunter `variantLabel(...)` in `text-caption text-slate-400`. Rechts ein `Link` auf `liveHref(match)` mit Beschriftung `LIVE` — nur wenn nicht null — und ein Knopf mit Zahnrad-Symbol, `aria-label="Einstellungen"`, der `onOpenSettings` ruft.

`scoreboard-status.tsx`: gibt `null` zurück, wenn nichts anliegt. Sonst eine Zeile mit `role="status"` und den Meldungen in dieser Reihenfolge: fremde Steuerung (mit Knopf `Steuerung übernehmen`), offline, wartende Aufnahmen, freie Fehlermeldung in `role="alert"`. Farben: Amber für Wartendes, Rose für Fehler, Slate für den Rest — jede Meldung trägt Text, nie nur Farbe.

`scoreboard-sides.tsx`: zwei Spalten. Aktive Seite `bg-emerald-500/15` mit `text-white`, inaktive `bg-slate-900 text-slate-400`. Pro Seite: Average aus `threeDartAverage` auf eine Nachkommastelle, Restscore in `text-display font-numerals tabular`, daneben die letzte Aufnahme dieser Seite im Leg als `text-title-sm`, darunter die Namen — im Doppel beide, die werfende Person als `rounded-plate bg-emerald-500 px-2 text-slate-950`. Darunter `{legsWonInSet} / {legsToWin} Legs · {setsWon} / {setsToWin} Sets`. Ist `showDartBand` gesetzt, folgt je Seite ein Band mit drei Plätzen; für die aktive Seite kommen die Beschriftungen aus `pendingDarts` (`T 5`, `D 20`, `20`, `—` für den Fehlwurf), leere Plätze bleiben als `bg-slate-800` Silhouette.

- [ ] **Step 6: Layout in der Fläche verdrahten**

`match-scoreboard.tsx` bekommt das Gerüst:

```tsx
    <section aria-label="Match-Scoreboard" className="grid h-[100dvh] grid-rows-[auto_auto_auto_1fr] bg-slate-950 text-white">
      <ScoreboardHeader … />
      <ScoreboardStatus … />
      <ScoreboardSides … />
      <div className="min-h-0">{/* Keypad folgt in Task 12 und 13 */}</div>
    </section>
```

In diesem Schritt bleibt im letzten Feld das heutige Eingabefeld samt Erfassen-Knopf stehen, damit die Fläche durchgehend bedienbar ist. `match-scoreboard-route.tsx` gibt die Seitenhülle auf: kein `PageNav`, kein `max-w-2xl`, kein Titel — nur noch der Ladezustand und darunter die Fläche über die volle Breite. Der Rückweg wandert als `backHref`/`backLabel` in die Kopfzeile.

- [ ] **Step 7: Verify**

Run: `pnpm --filter @darts-platform/web test && pnpm --filter @darts-platform/web typecheck && pnpm lint`
Expected: sauber. Anschliessend die Seite im Browser öffnen und prüfen: kein Scrollbalken auf einem Mobilviewport, Statusleiste erscheint nur bei Vorkommnis.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "$(cat <<'EOF'
feat(web): Vollbildlayout fuer das Scoreboard

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Dart-Keypad und Bestätigungsfläche

**Files:**
- Create: `apps/web/src/components/match/dart-keypad.tsx`
- Create: `apps/web/src/components/match/visit-confirmation.tsx`
- Modify: `apps/web/src/components/match/match-scoreboard.tsx`

**Interfaces:**
- Consumes: `dartEntryReducer`, `previewDartEntry`, `isSegmentAvailable` (Task 8), `useMatchScoring.submitVisit` mit `darts` (Task 10), `ScoreboardSettings` (Task 7).
- Produces:

```ts
export function DartKeypad(props: {
  readonly disabled: boolean;
  readonly modifier: 1 | 2 | 3;
  readonly onSegment: (segment: number) => void;
  readonly onModifier: (multiplier: 2 | 3) => void;
  readonly onBackspace: () => void;
}): JSX.Element;

export function VisitConfirmation(props: {
  readonly points: number;
  readonly bust: boolean;
  readonly onBack: () => void;
  readonly onConfirm: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Keypad schreiben**

Raster aus fünf Zeilen zu vier Segmenttasten (1–20) plus einer rechten Spalte mit Rücktaste, `0`, `25`, `50`; darunter zwei breite Umschalter `DOUBLE` und `TRIPLE`. Jede Taste ist ein `button` mit `type="button"`, `min-h-14`, `aria-label` in ausgeschriebener Form:

```tsx
const dartLabel = (segment: number, modifier: 1 | 2 | 3): string => {
  if (segment === 0) return "Fehlwurf";
  if (segment === 50) return "Bullseye";
  if (segment === 25) return "Bull";
  return modifier === 3 ? `Triple ${segment}` : modifier === 2 ? `Doppel ${segment}` : `Single ${segment}`;
};
```

Die Taste `25` ruft `onSegment(25)`, die Taste `50` ruft `onSegment(50)`; die Abbildung von `50` auf `{ segment: 25, multiplier: 2 }` erledigt der Reducer aus Task 8. Das Keypad entscheidet nichts selbst, es meldet nur die gedrückte Taste.

Gesperrt wird über `isSegmentAvailable(segment, modifier)` aus Task 8: `25` bei aktivem Triple, `50` und `0` bei jedem aktiven Umschalter. Gesperrte Tasten bekommen `disabled` und `aria-disabled`.

- [ ] **Step 2: Bestätigungsfläche schreiben**

Über dem Keypad liegend, `absolute inset-0 bg-slate-950/95`, mit der Summe in `text-display` und darunter `GEWORFEN` beziehungsweise `BUST` in `text-label`. Unten zwei Flächen: links `‹` mit `aria-label="Eingabe korrigieren"`, rechts `WEITER`. Die ganze Fläche ist zusätzlich als Knopf bedienbar; Tastaturfokus liegt beim Öffnen auf `WEITER`.

- [ ] **Step 3: In der Fläche verdrahten**

In `match-scoreboard.tsx`:

```tsx
const [entry, dispatchEntry] = useReducer(dartEntryReducer, emptyDartEntry);
const [pendingConfirmation, setPendingConfirmation] = useState<DartEntryPreview | null>(null);
```

Nach jedem Wurf die Vorschau rechnen. Ist sie `complete`, entweder direkt senden oder — bei `settings.confirmScore` — `setPendingConfirmation(preview)`. Bei `settings.autoConfirm` zusätzlich ein `setTimeout` von 1200 ms, das bestätigt; das Timeout beim Verlassen und beim manuellen Bestätigen aufräumen.

Gesendet wird:

```ts
scoring.submitVisit({
  points: preview.points,
  dartsThrown: entry.darts.length as 1 | 2 | 3,
  darts: entry.darts,
});
dispatchEntry({ type: "RESET" });
```

Die Rücktaste bei leerer Aufnahme ruft `scoring.undoVisit()`.

Wechselt durch die Serverantwort `match.currentPlayerId` oder `match.currentLegNumber`, wird die angefangene Aufnahme verworfen:

```tsx
useEffect(() => {
  dispatchEntry({ type: "RESET" });
  setPendingConfirmation(null);
}, [match.currentPlayerId, match.currentLegNumber]);
```

Ein Versionskonflikt lässt die Würfe ausdrücklich stehen — deshalb hängt dieser Effekt nicht an `match.version`.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @darts-platform/web test && pnpm --filter @darts-platform/web typecheck && pnpm lint`
Expected: sauber. Im Browser ein Leg Wurf für Wurf spielen: Dart-Band füllt sich, Restscore läuft mit, Checkout auf einem Doppel beendet das Leg, ein Single-Finish bei Double Out zeigt `BUST`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "$(cat <<'EOF'
feat(web): Dart-Keypad mit Bestaetigungsflaeche

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Runden-Keypad und Checkout-Schritt

**Files:**
- Create: `apps/web/src/components/match/round-keypad.tsx`
- Modify: `apps/web/src/components/match/match-scoreboard.tsx`

**Interfaces:**
- Consumes: `appendRoundDigit`, `removeRoundDigit`, `isRoundEntrySubmittable` (Task 9), `frequentScoresSchema` (Task 6).
- Produces:

```ts
export function RoundKeypad(props: {
  readonly value: string;
  readonly quickScores: readonly number[];
  readonly submittable: boolean;
  readonly disabled: boolean;
  readonly onDigit: (digit: number) => void;
  readonly onQuickScore: (score: number) => void;
  readonly onBackspace: () => void;
  readonly onSubmit: () => void;
}): JSX.Element;
```

- [ ] **Step 1: Schnellwerte laden**

In `match-scoreboard.tsx`, für die werfende Person:

```ts
const quickScoresQuery = useQuery({
  queryKey: ["frequent-scores", organizationId, match.currentPlayerId],
  queryFn: ({ signal }) => apiRequest({
    path: `/organizations/${organizationId}/players/${match.currentPlayerId ?? ""}/statistics/frequent-scores`,
    schema: frequentScoresSchema,
    signal,
  }),
  enabled: match.currentPlayerId !== null && settings.mode === "ROUND",
  staleTime: 10 * 60 * 1000,
});
const quickScores = quickScoresQuery.data?.scores ?? [26, 41, 45, 60, 81, 85];
```

Der Standardsatz steht auch hier, damit ein Ausfall der Abfrage die Eingabe nicht anfasst.

- [ ] **Step 2: Keypad schreiben**

Oben die getippte Zahl gross in `text-display font-numerals`, darunter zwei Zeilen zu drei Schnellwerten, darunter drei Zeilen zu drei Ziffern (1–9), unten `‹`, `0`, `›`. `›` ist der Absendeknopf und trägt `aria-label="Aufnahme erfassen"`; er ist `disabled`, solange `submittable` falsch ist. Schnellwerte tragen ihren Wert als Beschriftung und `aria-label={`${score} Punkte`}`.

- [ ] **Step 3: Checkout-Schritt anschliessen**

Entspricht der eingegebene Wert genau `activeParticipant.remaining` und ist `settings.confirmCheckoutDarts` gesetzt, öffnet der bestehende `CheckoutDialog` — inhaltlich unverändert, aber mit den benötigten Darts als drei grossen Tasten statt eines `select`, und mit vorbelegtem Doppelfeld, wenn nur eine Möglichkeit bleibt:

```ts
/** Bleibt rechnerisch nur ein Doppel, ist die Nachfrage eine Bestaetigung. */
function onlyPossibleDouble(points: number): number | null {
  if (points === 50) return 25;
  return points <= 40 && points % 2 === 0 ? points / 2 : null;
}
```

Ist `confirmCheckoutDarts` aus, geht die Aufnahme direkt mit `dartsThrown: 3` und ohne `checkoutDouble` raus.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @darts-platform/web test && pnpm --filter @darts-platform/web typecheck && pnpm lint`
Expected: sauber. Im Browser im Runden-Modus ein Leg spielen, inklusive Checkout mit und ohne die Einstellung.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "$(cat <<'EOF'
feat(web): Runden-Keypad mit dynamischen Schnellwerten

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Einstellungs-Modal

**Files:**
- Create: `apps/web/src/components/match/scoreboard-settings-dialog.tsx`
- Modify: `apps/web/src/components/match/match-scoreboard.tsx`

**Interfaces:**
- Consumes: `ScoreboardSettings`, `readScoreboardSettings`, `writeScoreboardSettings`, `subscribeScoreboardSettings` (Task 7), `useMatchScoring` (Task 10).
- Produces:

```ts
export function ScoreboardSettingsDialog(props: {
  readonly open: boolean;
  readonly settings: ScoreboardSettings;
  readonly onChange: (settings: ScoreboardSettings) => void;
  readonly onClose: () => void;
  readonly visits: MatchStateResponse["visits"];
  readonly lockState: "EIGEN" | "FREMD" | "UNBEKANNT";
  readonly onTakeOver: () => void;
  readonly backHref: string;
  readonly backLabel: string;
  readonly canAbort: boolean;
  readonly onAbort: () => void;
}): JSX.Element | null;
```

- [ ] **Step 1: Einstellungen anbinden**

In `match-scoreboard.tsx`:

```ts
const settings = useSyncExternalStore(subscribeScoreboardSettings, readScoreboardSettings, () => defaultScoreboardSettings);
```

Der dritte Parameter ist der Server-Snapshot; ohne ihn laufen Server- und erster Client-Render auseinander.

- [ ] **Step 2: Modal schreiben**

`dialog` mit `showModal`, gebaut wie `AbortMatchDialog` in derselben Datei — dieselbe Ref-Mechanik, dasselbe `onCancel`-Abfangen. Inhalt von oben nach unten:

1. Überschrift `EINGABE` und eine Segmentwahl aus zwei Knöpfen `Dart` und `Runde`, umgesetzt mit `role="radiogroup"` und `aria-checked`.
2. Die Schalter des gewählten Modus. Jeder Schalter ist ein `button` mit `role="switch"`, `aria-checked`, sichtbarem `NEIN` links und `JA` rechts. Im Dart-Modus `Punktzahl bestätigen` und `automatisch bestätigen`, letzterer `disabled`, solange `confirmScore` aus ist. Im Runden-Modus `Checkout-Darts bestätigen`.
3. `Letzte Aufnahmen` — die Liste aus der heutigen Komponente, unverändert übernommen, auf acht Einträge begrenzt.
4. Board-Steuerung: bei `lockState === "FREMD"` ein Knopf `Steuerung übernehmen`.
5. Ein Link zurück auf `backHref` mit `backLabel`.
6. `SPIEL FORTSETZEN` schliesst. `SPIEL BEENDEN` in Rose, nur bei `canAbort`, ruft `onAbort` und öffnet damit den bestehenden Abbruch-Dialog.

Jede Änderung ruft `onChange`, die Fläche schreibt sie mit `writeScoreboardSettings` fort.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @darts-platform/web test && pnpm --filter @darts-platform/web typecheck && pnpm lint`
Expected: sauber. Im Browser: Moduswechsel wirkt sofort, überlebt einen Reload, Tastaturbedienung des Modals funktioniert, `SPIEL BEENDEN` fehlt für eine Rolle ohne Abbruchrecht.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src
git commit -m "$(cat <<'EOF'
feat(web): Einstellungs-Modal der Scoringflaeche

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: E2E, Dokumentation, volle Suite

**Files:**
- Modify: `apps/web/tests/foundation.spec.ts` oder neu `apps/web/tests/scoreboard.spec.ts`
- Modify: `ROADMAP.md`, `PRODUCT.md`
- Modify: `DATABASE_SCHEMA.md`

- [ ] **Step 1: E2E-Test schreiben**

Neue Datei `apps/web/tests/scoreboard.spec.ts`, im Stil von `apps/web/tests/team-encounter.spec.ts` (dort zuerst den Aufbau der Testdaten lesen und übernehmen). Der Ablauf:

1. Als Rolle mit Scoring-Recht anmelden, ein Match mit zugewiesenem Board öffnen.
2. Prüfen, dass Kopfzeile `LEG 1` und `RUNDE 1` zeigt.
3. Drei Würfe tippen (`Triple 20`, `Triple 20`, `Single 20`), Bestätigungsfläche erwarten, `WEITER` drücken.
4. Prüfen, dass der Restscore auf 361 steht.
5. Zahnrad öffnen, auf `Runde` umschalten, `SPIEL FORTSETZEN`, prüfen, dass das Ziffernfeld erscheint.

- [ ] **Step 2: E2E ausführen**

Run: `pnpm test:e2e`
Expected: PASS. Mit einem Worker laufen lassen.

- [ ] **Step 3: Dokumentation nachziehen**

`DATABASE_SCHEMA.md` um `visit_darts` samt Constraints ergänzen. In `ROADMAP.md` den Punkt zur Scoringfläche auf erledigt setzen und die offene Folgearbeit „Statistik über Wurfdaten" aufnehmen. In `PRODUCT.md` die Beschreibung der Scoring-Bedienung an die zwei Modi anpassen.

- [ ] **Step 4: Volle Suite**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm build` braucht `NODE_ENV`; ohne die Variable bricht der Web-Prerender mit einem irreführenden React-Fehler ab. Fehlschläge werden behoben, nicht weggelassen.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "$(cat <<'EOF'
test(web): E2E fuer die Vollbild-Scoringflaeche

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec-Abdeckung.** Datenmodell → Task 1, 2. Engine → Task 3. API-Schreibpfad und Replay → Task 4. Live-Bezug → Task 5. Schnellwerte → Task 6, im Runden-Keypad verbraucht in Task 13. Einstellungen und Persistenz → Task 7, Modal in Task 14. Dart-Modus → Task 8, 12. Runden-Modus und Checkout → Task 9, 13. Zerlegung → Task 10. Layout, Kopfzeile, Statusleiste, Spielerpanels, Dart-Band, Doppel → Task 11. Barrierefreiheit → in Task 11 bis 14 je Baustein. Randfälle → Task 12 (Wechsel und Konflikt), Task 4 (Idempotenz), Task 13 (Ausfall der Schnellwerte). Tests → in jedem Task, E2E in Task 15.

**Offene Verantwortung.** Die Ergebnisfläche für ein beendetes Match steht heute schon in `match-scoreboard.tsx` und bleibt dort; Task 11 behält sie im letzten Feld des Grids, wenn `match.status === "COMPLETED"`.
