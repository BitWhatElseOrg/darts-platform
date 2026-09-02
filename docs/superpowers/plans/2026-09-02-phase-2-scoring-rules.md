# Phase 2 — Scoring-Regeln des Reglements

> **Für agentische Bearbeiter:** ERFORDERLICHE SUB-SKILL:
> `superpowers:executing-plans` (inline) oder
> `superpowers:subagent-driven-development`. Schritte tragen Checkboxen
> (`- [ ]`) zur Nachverfolgung.

**Ziel:** Die Scoring-Engine bildet die vier Ligavarianten des VFC-Reglements
ab — In-Regel, Out-Regel, Rundenbegrenzung mit Ausbullen und den Legbeginn ab
Leg 3 — und die Datenbank spricht dieselbe Sprache.

**Architektur:** `X01Rules.doubleOut: boolean` wird durch
`inRule` / `outRule` / `maxRounds` ersetzt. Die Engine bleibt rein: kein
Drizzle, kein NestJS, kein Zustand ausserhalb der Kommandoliste. Zwei neue
Kommandos (`DECIDE_LEG_START`, `DECIDE_LEG_BY_BULL`) fügen sich in dieselbe
Projektion ein wie `SUBMIT_VISIT`. Die Datenbankspalte `double_out` wird in
`in_rule` / `out_rule` / `max_rounds` überführt — auf `matches` **und** auf
`tournaments`, damit Turnier-Defaults und Ligavorlage dieselbe Sprache
sprechen.

**Tech Stack:** TypeScript (strict), Vitest, Drizzle ORM, PostgreSQL, Zod,
React Hook Form.

**Spec:** `docs/superpowers/specs/2026-09-02-team-encounter-league-design.md`,
Abschnitte „Engines / scoring-engine", „Migration" Punkt 6, „Aus dem
Reglement übernommene Regeln" Punkt 10 und „Tests und Abnahmekriterien".

**Roadmap:** `docs/superpowers/plans/2026-09-02-team-encounter-roadmap.md`,
Phase 2 (~800 LOC, 1,0–1,5M Token, hängt an Phase 1).

## Global Constraints

- Reihenfolge der Prioritäten aus `AGENTS.md`: Korrektheit vor
  Datenintegrität vor Security vor Testbarkeit.
- `packages/scoring-engine` importiert **nichts** aus Drizzle, PostgreSQL,
  Redis, NestJS, Next.js oder Socket.IO. Reine Domain-Logik, deterministisch.
- Kein `any`. `unknown` statt `any`, exhaustive `switch`, readonly an den
  Domain-Grenzen.
- Während der Arbeit **kein** `pnpm test` oder `pnpm build` im Root. Nur
  `pnpm --filter <paket> test -- <datei>`. Vollverifikation einmal am Ende
  (Task 7).
- Migrationen sind ausschliesslich vorwärts gerichtet. Bestehende
  Migrationsdateien werden nicht verändert.
- Jeder Commit ist grün: `pnpm --filter <paket> typecheck` läuft durch.
  Deshalb tragen Task 1 und Task 5 die Adapter, die Task 6 wieder entfernt.
- Conventional Commits, kleine Commits, Branch `feature/phase-2-scoring-rules`
  von `develop`.
- Fehlercodes sind stabil und werden von der API später 1:1 durchgereicht:
  `INVALID_THROWER`, `ROUND_LIMIT_NOT_REACHED`, `ROUND_LIMIT_REACHED`,
  `DOUBLE_IN_REQUIRED`, `LEG_START_FIXED`, `LEG_START_ALREADY_SET`,
  `LEG_ALREADY_PLAYED`, `LEG_ALREADY_STARTED`.

## Dateien

| Datei | Verantwortung | Task |
| --- | --- | --- |
| `packages/scoring-engine/src/x01.ts` | Regelwerk, Projektion, Kommandos | 1–4 |
| `packages/scoring-engine/src/x01.spec.ts` | Engine-Tests | 1–4 |
| `packages/scoring-engine/src/index.ts` | öffentliche Schnittstelle | 1, 3, 4 |
| `apps/api/src/matches/matches.repository.ts` | Regeln aus der Zeile bauen | 1, 6 |
| `packages/schemas/src/tournament.ts` | API-Vertrag Turnier | 5 |
| `packages/schemas/src/tournament.spec.ts` | Vertragstests | 5 |
| `apps/api/src/tournaments/tournaments.repository.ts` | Turnier- und Matchzeilen | 5, 6 |
| `apps/api/src/tournaments/tournaments.service.ts` | Dashboard-Projektion | 5, 6 |
| `apps/api/src/seeding/seed-fixtures.ts` | Demo-Daten | 5 |
| `apps/web/src/components/tournament/setup-sheet.tsx` | Turnieranlage | 5 |
| `apps/web/src/components/tournament/dashboard-header.tsx` | Anzeige der Variante | 5 |
| `packages/database/src/schema.ts` | Spalten und Check-Constraints | 6 |
| `packages/database/drizzle/0016_*.sql` | Migration mit Backfill | 6 |
| `docs/superpowers/plans/2026-09-02-team-encounter-roadmap.md` | Schnittstelle 2 → 4 | 7 |

## Nicht in dieser Phase

- Persistenz der beiden neuen Kommandos. `matches.repository` liest
  Kommandos aus `visits`; ein durch Ausbullen entschiedenes Leg erzeugt keine
  Visit-Zeile. Solange `max_rounds` überall `NULL` ist, kann kein Bestandsmatch
  ein solches Kommando tragen. Die Ablage gehört zu Phase 4 (Persistenz + API)
  und wird dort in der Roadmap-Schnittstelle festgehalten.
- `checkout_multiplier` als Spalte. Master Out wird über die Erreichbarkeit des
  Wurfs geprüft (siehe Task 1, Schritt 3), nicht über ein neues Feld. Damit
  bleibt der in Phase 1 festgelegte `visits`-Vertrag unverändert.
- Die Anzeige der Variante im Scoring-Workspace
  (`apps/web/src/components/match-workspace.tsx` zeigt fest „501 · Double
  Out"). Das ist Phase 6.

---

### Task 1: Regelvokabular und Out-Regeln

`X01Rules.doubleOut` wird zu `inRule`, `outRule`, `maxRounds`. Diese Task
implementiert nur die **Out**-Regel vollständig; `inRule` wird eingeführt und
validiert, wirkt aber erst in Task 2. `maxRounds` wird eingeführt und
validiert, wirkt erst in Task 4.

**Dateien:**
- Ändern: `packages/scoring-engine/src/x01.ts`
- Ändern: `packages/scoring-engine/src/index.ts`
- Test: `packages/scoring-engine/src/x01.spec.ts`
- Ändern: `apps/api/src/matches/matches.repository.ts:848`

**Interfaces:**
- Konsumiert: `X01Side`, `SubmitVisitCommand`, `createX01Match` aus Phase 1.
- Produziert:
  ```ts
  export type InRule = "STRAIGHT" | "DOUBLE";
  export type OutRule = "SINGLE" | "DOUBLE" | "MASTER";
  export interface X01Rules {
    readonly startingScore: number;
    readonly inRule: InRule;
    readonly outRule: OutRule;
    readonly maxRounds: number | null;
    readonly legsToWinSet: number;
    readonly setsToWin: number;
  }
  ```
  `X01SideState` erhält zusätzlich `readonly openedInLeg: boolean`.

- [ ] **Schritt 1: Fehlschlagende Tests schreiben**

In `packages/scoring-engine/src/x01.spec.ts` den bestehenden Test
`"supports straight-out checkout when configured"` auf das neue Vokabular
umstellen und die Regelvarianten ergänzen. Zuerst oben im Test-Modul einen
Regel-Helfer ergänzen:

```ts
import {
  ScoringValidationError,
  createX01Match,
  executeX01Command,
  isAttainableScore,
  projectX01Match,
  type OutRule,
  type X01Rules,
  type X01Side,
} from "./x01.js";

function rules(overrides: Partial<X01Rules> = {}): X01Rules {
  return {
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    maxRounds: null,
    legsToWinSet: 1,
    setsToWin: 1,
    ...overrides,
  };
}
```

Den bestehenden Straight-Out-Test auf `rules({ startingScore: 10, outRule: "SINGLE" })`
umstellen und diese Tests anfügen:

```ts
  it("finishes on a treble under master out but not under double out", () => {
    const master = executeX01Command(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 12, outRule: "MASTER" }) }),
      visit("master", 1, "one", 12, 1),
    );
    expect(master.state.status).toBe("COMPLETED");
    expect(master.state.winnerSeat).toBe(1);

    const double = executeX01Command(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 12, outRule: "DOUBLE" }) }),
      visit("double", 1, "one", 12, 1),
    );
    expect(double.outcome).toBe("BUST");
    expect(double.state.sides[0].remaining).toBe(12);
  });

  it("accepts a recorded double as a master-out checkout", () => {
    const result = executeX01Command(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 12, outRule: "MASTER" }) }),
      visit("d6", 1, "one", 12, 1, 6),
    );
    expect(result.state.status).toBe("COMPLETED");
  });

  it("busts on a remainder of one unless the out rule is single", () => {
    for (const outRule of ["DOUBLE", "MASTER"] as const satisfies readonly OutRule[]) {
      const result = executeX01Command(
        createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 12, outRule }) }),
        visit(`bust-${outRule}`, 1, "one", 11, 1),
      );
      expect(result.outcome).toBe("BUST");
      expect(result.state.sides[0].remaining).toBe(12);
    }
    const single = executeX01Command(
      createX01Match({ sides: singles("one", "two"), rules: rules({ startingScore: 12, outRule: "SINGLE" }) }),
      visit("single", 1, "one", 11, 1),
    );
    expect(single.outcome).toBe("SCORED");
    expect(single.state.sides[0].remaining).toBe(1);
  });

  it("rejects rules the reglement does not know", () => {
    const invalid = [
      { key: "INVALID_IN_RULE", rule: rules({ inRule: "TRIPLE" as InRule }) },
      { key: "INVALID_OUT_RULE", rule: rules({ outRule: "ANY" as OutRule }) },
      { key: "INVALID_MAX_ROUNDS", rule: rules({ maxRounds: 0 }) },
    ] as const;
    for (const { key, rule } of invalid) {
      try {
        createX01Match({ sides: singles("one", "two"), rules: rule });
        expect.unreachable(`${key} was accepted`);
      } catch (error: unknown) {
        expect((error as ScoringValidationError).code).toBe(key);
      }
    }
  });
```

`InRule` mit in den Import aufnehmen.

- [ ] **Schritt 2: Tests laufen lassen, Fehlschlag bestätigen**

```bash
pnpm --filter @darts-platform/scoring-engine test -- src/x01.spec.ts
```

Erwartet: Typfehler / Fehlschlag, weil `X01Rules` noch `doubleOut` verlangt.

- [ ] **Schritt 3: Regeln umstellen**

In `packages/scoring-engine/src/x01.ts`:

```ts
export type InRule = "STRAIGHT" | "DOUBLE";
export type OutRule = "SINGLE" | "DOUBLE" | "MASTER";

export interface X01Rules {
  readonly startingScore: number;
  readonly inRule: InRule;
  readonly outRule: OutRule;
  readonly maxRounds: number | null;
  readonly legsToWinSet: number;
  readonly setsToWin: number;
}
```

`assertRules` erweitern:

```ts
const inRules: readonly InRule[] = ["STRAIGHT", "DOUBLE"];
const outRules: readonly OutRule[] = ["SINGLE", "DOUBLE", "MASTER"];

function assertRules(rules: X01Rules): void {
  if (!Number.isInteger(rules.startingScore) || rules.startingScore < 2) {
    throw new ScoringValidationError("INVALID_STARTING_SCORE", "Starting score must be an integer of at least 2.");
  }
  if (!inRules.includes(rules.inRule)) {
    throw new ScoringValidationError("INVALID_IN_RULE", "In rule must be STRAIGHT or DOUBLE.");
  }
  if (!outRules.includes(rules.outRule)) {
    throw new ScoringValidationError("INVALID_OUT_RULE", "Out rule must be SINGLE, DOUBLE or MASTER.");
  }
  if (rules.maxRounds !== null && (!Number.isInteger(rules.maxRounds) || rules.maxRounds < 1)) {
    throw new ScoringValidationError("INVALID_MAX_ROUNDS", "The round limit must be a positive integer or null.");
  }
  if (!Number.isInteger(rules.legsToWinSet) || rules.legsToWinSet < 1) {
    throw new ScoringValidationError("INVALID_LEG_TARGET", "Leg target must be a positive integer.");
  }
  if (!Number.isInteger(rules.setsToWin) || rules.setsToWin < 1) {
    throw new ScoringValidationError("INVALID_SET_TARGET", "Set target must be a positive integer.");
  }
}
```

Die Vorgabe in `createX01Match`:

```ts
  const rules = input.rules ?? {
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    maxRounds: null,
    legsToWinSet: 1,
    setsToWin: 1,
  };
```

Master-Out-Erreichbarkeit neben `checkoutValue` ergänzen. Das letzte Dart muss
ein Doppel oder ein Triple sein; Bull (50) zählt als Doppel 25, das äussere
Bull (25) ist ein Single und schliesst nicht:

```ts
const masterFinishes: readonly number[] = [
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 2),
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 3),
  50,
];

function finishesOnMasterSegment(points: number, dartsThrown: 1 | 2 | 3): boolean {
  return masterFinishes.some(
    (value) => points >= value && attainableTotals(dartsThrown - 1).has(points - value),
  );
}

function closesLeg(
  outRule: OutRule,
  command: SubmitVisitCommand,
  validDoubleCheckout: boolean,
): boolean {
  switch (outRule) {
    case "SINGLE":
      return true;
    case "DOUBLE":
      return validDoubleCheckout;
    case "MASTER":
      return command.checkoutDouble === undefined
        ? finishesOnMasterSegment(command.points, command.dartsThrown)
        : validDoubleCheckout;
  }
}
```

`initialSide` bekommt die Regeln, weil `openedInLeg` von der In-Regel abhängt:

```ts
export interface X01SideState {
  readonly seat: 1 | 2;
  readonly playerIds: readonly string[];
  readonly remaining: number;
  readonly openedInLeg: boolean;
  readonly legsWonInSet: number;
  readonly totalLegsWon: number;
  readonly setsWon: number;
}

function initialSide(side: X01Side, rules: X01Rules): X01SideState {
  return {
    seat: side.seat,
    playerIds: side.playerIds,
    remaining: rules.startingScore,
    openedInLeg: rules.inRule === "STRAIGHT",
    legsWonInSet: 0,
    totalLegsWon: 0,
    setsWon: 0,
  };
}
```

In `projectX01Match` die beiden `initialSide`-Aufrufe auf `match.rules`
umstellen und den Checkout-Block ersetzen:

```ts
    const validCheckout = tentative === 0 && closesLeg(match.rules.outRule, command, validDoubleCheckout);
    const bust =
      tentative < 0 ||
      (match.rules.outRule !== "SINGLE" && tentative === 1) ||
      (tentative === 0 && !validCheckout);
```

Beim Legwechsel innerhalb der Projektion `openedInLeg` zurücksetzen:

```ts
      sides = [
        { ...sides[0], remaining: match.rules.startingScore, openedInLeg: match.rules.inRule === "STRAIGHT" },
        { ...sides[1], remaining: match.rules.startingScore, openedInLeg: match.rules.inRule === "STRAIGHT" },
      ];
```

`packages/scoring-engine/src/index.ts` um `type InRule` und `type OutRule`
erweitern (alphabetisch einsortiert).

- [ ] **Schritt 4: Tests laufen lassen**

```bash
pnpm --filter @darts-platform/scoring-engine test -- src/x01.spec.ts
pnpm --filter @darts-platform/scoring-engine typecheck
```

Erwartet: alle grün.

- [ ] **Schritt 5: Aufrufer grün halten**

`apps/api/src/matches/matches.repository.ts:848` baut die Regeln aus der
Matchzeile. Die Spalte heisst noch `double_out`; deshalb hier ein Adapter, den
Task 6 wieder entfernt:

```ts
      rules: {
        startingScore: match.startingScore,
        inRule: "STRAIGHT",
        outRule: match.doubleOut ? "DOUBLE" : "SINGLE",
        maxRounds: null,
        legsToWinSet: match.legsToWinSet,
        setsToWin: match.setsToWin,
      },
```

Prüfen:

```bash
pnpm --filter @darts-platform/api typecheck
```

- [ ] **Schritt 6: Commit**

```bash
git add packages/scoring-engine apps/api/src/matches/matches.repository.ts
git commit -m "feat: express x01 rules as in, out and round limit"
```

---

### Task 2: Double In

Reglement 1.1 kennt Ligavarianten mit Double In. Der erste punktende Visit
einer Seite in einem Leg muss auf einem Doppel eröffnen; ein Visit mit null
Punkten lässt die Seite geschlossen.

**Dateien:**
- Ändern: `packages/scoring-engine/src/x01.ts`
- Test: `packages/scoring-engine/src/x01.spec.ts`

**Interfaces:**
- Konsumiert: `X01Rules.inRule`, `X01SideState.openedInLeg` aus Task 1.
- Produziert: Fehlercode `DOUBLE_IN_REQUIRED`; `openedInLeg` wird auf `true`
  gesetzt, sobald eine Seite punktet — auch wenn derselbe Visit bustet.

- [ ] **Schritt 1: Fehlschlagende Tests schreiben**

```ts
  it("requires the opening double and keeps the side closed on a miss", () => {
    const match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 10, inRule: "DOUBLE" }),
    });
    try {
      executeX01Command(match, visit("no-double", 1, "one", 3, 1));
      expect.unreachable("a single must not open the leg");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("DOUBLE_IN_REQUIRED");
    }

    const missed = executeX01Command(match, visit("miss", 1, "one", 0, 3));
    expect(missed.state.sides[0].openedInLeg).toBe(false);
    expect(missed.state.sides[0].remaining).toBe(10);
  });

  it("opens on a double and finishes the 701 double-in double-out leg", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 701, inRule: "DOUBLE" }),
    });
    match = executeX01Command(match, visit("open", 1, "one", 40, 1, 20)).match;
    const opened = projectX01Match(match);
    expect(opened.sides[0].openedInLeg).toBe(true);
    expect(opened.sides[0].remaining).toBe(661);

    match = executeX01Command(match, visit("guest-miss", 2, "two", 0, 3)).match;
    expect(projectX01Match(match).sides[1].openedInLeg).toBe(false);
  });

  it("keeps a side open after a bust in the opening visit", () => {
    const match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 10, inRule: "DOUBLE" }),
    });
    const result = executeX01Command(match, visit("bust-open", 1, "one", 12, 1, 6));
    expect(result.outcome).toBe("BUST");
    expect(result.state.sides[0].openedInLeg).toBe(true);
    expect(result.state.sides[0].remaining).toBe(10);
  });
```

- [ ] **Schritt 2: Tests laufen lassen, Fehlschlag bestätigen**

```bash
pnpm --filter @darts-platform/scoring-engine test -- src/x01.spec.ts
```

Erwartet: `DOUBLE_IN_REQUIRED` wird nicht geworfen, `openedInLeg` bleibt false.

- [ ] **Schritt 3: Eröffnung umsetzen**

In `x01.ts` neben `finishesOnMasterSegment`:

```ts
const doubleValues: readonly number[] = [
  ...Array.from({ length: 20 }, (_, index) => (index + 1) * 2),
  50,
];

function opensOnDouble(points: number, dartsThrown: 1 | 2 | 3): boolean {
  return doubleValues.some(
    (value) => points >= value && attainableTotals(dartsThrown - 1).has(points - value),
  );
}
```

In der Visit-Verarbeitung von `projectX01Match`, direkt nach der
Werfer-Prüfung und vor `const tentative = ...`:

```ts
    if (!side.openedInLeg && command.points > 0 && !opensOnDouble(command.points, command.dartsThrown)) {
      throw new ScoringValidationError(
        "DOUBLE_IN_REQUIRED",
        "The first scoring visit of a leg must start on a double.",
      );
    }
    const openedInLeg = side.openedInLeg || command.points > 0;
```

Beide Zweige, die die Seite ohne Checkout fortschreiben, tragen `openedInLeg`
mit:

```ts
    } else if (bust) {
      sides = replaceSide(sides, activeIndex, { ...side, openedInLeg });
    } else {
      sides = replaceSide(sides, activeIndex, { ...side, remaining: tentative, openedInLeg });
    }
```

Der bisherige Code hatte keinen expliziten Bust-Zweig — bei einem Bust blieb
die Seite unverändert. Mit Double In muss auch der Bust die Eröffnung
festhalten, deshalb der neue Zweig.

- [ ] **Schritt 4: Tests laufen lassen**

```bash
pnpm --filter @darts-platform/scoring-engine test -- src/x01.spec.ts
pnpm --filter @darts-platform/scoring-engine typecheck
```

- [ ] **Schritt 5: Commit**

```bash
git add packages/scoring-engine
git commit -m "feat: enforce the opening double under the double-in rule"
```

---

### Task 3: Legbeginn ab Leg 3

Reglement 2.2.9: Leg 1 beginnt die Heimseite, Leg 2 die Gastseite, ab Leg 3
entscheidet ein Wurf auf Bull. Die Engine leitet den Beginner deshalb nicht
durchgängig ab, sondern nimmt ihn als Kommando entgegen. Fehlt das Kommando,
bleibt es beim Wechsel — Turniermatches über Best of 5 oder 7 laufen damit
unverändert weiter.

**Dateien:**
- Ändern: `packages/scoring-engine/src/x01.ts`
- Ändern: `packages/scoring-engine/src/index.ts`
- Test: `packages/scoring-engine/src/x01.spec.ts`

**Interfaces:**
- Produziert:
  ```ts
  export interface DecideLegStartCommand {
    readonly type: "DECIDE_LEG_START";
    readonly commandId: string;
    readonly legNumber: number;
    readonly startingSeat: 1 | 2;
  }
  ```
  Fehlercodes `LEG_START_FIXED` (Leg 1 und 2 stehen fest),
  `LEG_START_ALREADY_SET`, `LEG_ALREADY_PLAYED`, `LEG_ALREADY_STARTED`.

- [ ] **Schritt 1: Fehlschlagende Tests schreiben**

```ts
  it("lets a bull throw decide who starts the third leg", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 40, legsToWinSet: 2, setsToWin: 1 }),
    });
    match = executeX01Command(match, visit("leg1", 1, "one", 40, 1, 20)).match;
    match = executeX01Command(match, visit("leg2-guest", 2, "two", 40, 1, 20)).match;
    expect(projectX01Match(match).legNumber).toBe(3);
    expect(projectX01Match(match).legStartingSeat).toBe(1);

    match = executeX01Command(match, {
      type: "DECIDE_LEG_START",
      commandId: "bull",
      legNumber: 3,
      startingSeat: 2,
    }).match;
    const state = projectX01Match(match);
    expect(state.legStartingSeat).toBe(2);
    expect(state.activeSeat).toBe(2);
  });

  it("refuses to decide the start of the first two legs", () => {
    const match = createX01Match({ sides: singles("one", "two") });
    try {
      executeX01Command(match, {
        type: "DECIDE_LEG_START",
        commandId: "too-early",
        legNumber: 2,
        startingSeat: 2,
      });
      expect.unreachable("leg two is fixed by the reglement");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("LEG_START_FIXED");
    }
  });

  it("refuses to decide the start of a leg that is already running", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ startingScore: 40, legsToWinSet: 3, setsToWin: 1 }),
    });
    match = executeX01Command(match, visit("leg1", 1, "one", 40, 1, 20)).match;
    match = executeX01Command(match, visit("leg2", 2, "two", 40, 1, 20)).match;
    match = executeX01Command(match, visit("leg3-open", 1, "one", 20, 1)).match;
    try {
      executeX01Command(match, {
        type: "DECIDE_LEG_START",
        commandId: "late",
        legNumber: 3,
        startingSeat: 2,
      });
      expect.unreachable("the leg is already running");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("LEG_ALREADY_STARTED");
    }
  });
```

- [ ] **Schritt 2: Tests laufen lassen, Fehlschlag bestätigen**

```bash
pnpm --filter @darts-platform/scoring-engine test -- src/x01.spec.ts
```

Erwartet: Typfehler, `DECIDE_LEG_START` ist kein `X01Command`.

- [ ] **Schritt 3: Kommando umsetzen**

Typ ergänzen und in die Union aufnehmen:

```ts
export interface DecideLegStartCommand {
  readonly type: "DECIDE_LEG_START";
  readonly commandId: string;
  readonly legNumber: number;
  readonly startingSeat: 1 | 2;
}

export type X01Command = SubmitVisitCommand | UndoVisitCommand | DecideLegStartCommand;
```

`activeCommands` sammelt die Legbeginne und prüft ihre Struktur:

```ts
interface ActiveCommands {
  readonly submissions: readonly SubmitVisitCommand[];
  readonly reverted: readonly string[];
  readonly legStarts: ReadonlyMap<number, 1 | 2>;
}

function activeCommands(commands: readonly X01Command[]): ActiveCommands {
  const reverted = new Set(
    commands
      .filter((command): command is UndoVisitCommand => command.type === "UNDO_LAST_VISIT")
      .map((command) => command.targetCommandId),
  );
  const legStarts = new Map<number, 1 | 2>();
  for (const command of commands) {
    if (command.type !== "DECIDE_LEG_START") continue;
    if (!Number.isInteger(command.legNumber) || command.legNumber < 3) {
      throw new ScoringValidationError(
        "LEG_START_FIXED",
        "Leg one belongs to the home side and leg two to the guest side.",
      );
    }
    if (legStarts.has(command.legNumber)) {
      throw new ScoringValidationError(
        "LEG_START_ALREADY_SET",
        "The starting side of that leg is already decided.",
      );
    }
    legStarts.set(command.legNumber, command.startingSeat);
  }
  return {
    submissions: commands.filter(
      (command): command is SubmitVisitCommand =>
        command.type === "SUBMIT_VISIT" && !reverted.has(command.commandId),
    ),
    reverted: [...reverted],
    legStarts,
  };
}
```

Beim Legwechsel in `projectX01Match` den entschiedenen Beginner bevorzugen:

```ts
function nextLegStartIndex(
  legStarts: ReadonlyMap<number, 1 | 2>,
  nextLegNumber: number,
  previous: 0 | 1,
): 0 | 1 {
  const decided = legStarts.get(nextLegNumber);
  return decided === undefined ? other(previous) : indexOfSeat(decided);
}
```

und im Legwechsel `legStartingIndex = nextLegStartIndex(active.legStarts, legNumber, legStartingIndex);`
**nach** dem `legNumber += 1`.

Für das erste Leg gilt weiterhin `match.startingSeat`; ein Kommando für Leg 1
oder 2 ist durch `LEG_START_FIXED` ausgeschlossen.

In `executeX01Command` vor dem Anhängen die Zustandsprüfungen ergänzen:

```ts
  if (command.type === "DECIDE_LEG_START") {
    const current = projectX01Match(match);
    if (command.legNumber < current.legNumber) {
      throw new ScoringValidationError("LEG_ALREADY_PLAYED", "That leg is already played.");
    }
    if (
      command.legNumber === current.legNumber &&
      current.visits.some((applied) => applied.legNumber === current.legNumber)
    ) {
      throw new ScoringValidationError("LEG_ALREADY_STARTED", "The leg is already running.");
    }
  }
```

Das Ergebnis eines `DECIDE_LEG_START` ist kein Visit-Ausgang. `outcome`
zentral über einen exhaustiven Switch bestimmen:

```ts
function commandOutcome(
  command: X01Command,
  state: X01MatchState,
): VisitOutcome | "VISIT_UNDONE" | null {
  switch (command.type) {
    case "UNDO_LAST_VISIT":
      return "VISIT_UNDONE";
    case "DECIDE_LEG_START":
      return null;
    case "SUBMIT_VISIT":
      return state.visits.at(-1)?.outcome ?? null;
  }
}
```

und der Rückgabewert von `executeX01Command` nutzt
`outcome: commandOutcome(command, state)`.

`index.ts` um `type DecideLegStartCommand` erweitern.

- [ ] **Schritt 4: Tests laufen lassen**

```bash
pnpm --filter @darts-platform/scoring-engine test -- src/x01.spec.ts
pnpm --filter @darts-platform/scoring-engine typecheck
pnpm --filter @darts-platform/api typecheck
```

`parseStoredCommand` in `matches.repository.ts` liest nur `SUBMIT_VISIT` und
`UNDO_LAST_VISIT` aus `visits`; die erweiterte Union ändert daran nichts.

- [ ] **Schritt 5: Commit**

```bash
git add packages/scoring-engine
git commit -m "feat: take the leg starter as input from the third leg on"
```

---

### Task 4: Rundenbegrenzung und Ausbullen

Anhang 2 des Reglements begrenzt die Automaten (501 auf zwanzig Runden). Ist
die Grenze erreicht, endet das Leg nicht durch Checkout, sondern durch ein
Ausbullen. Eine Runde ist vollständig, wenn **beide** Seiten in diesem Leg
gleich viele Visits geworfen haben.

**Dateien:**
- Ändern: `packages/scoring-engine/src/x01.ts`
- Ändern: `packages/scoring-engine/src/index.ts`
- Test: `packages/scoring-engine/src/x01.spec.ts`

**Interfaces:**
- Produziert:
  ```ts
  export interface DecideLegByBullCommand {
    readonly type: "DECIDE_LEG_BY_BULL";
    readonly commandId: string;
    readonly winnerSeat: 1 | 2;
  }
  export interface LegDecision {
    readonly commandId: string;
    readonly legNumber: number;
    readonly winnerSeat: 1 | 2;
    readonly outcome: "LEG_WON" | "SET_WON" | "MATCH_WON";
  }
  ```
  `X01MatchState` erhält `readonly roundsPlayedInLeg: number`,
  `readonly roundLimitReached: boolean` und
  `readonly legDecisions: readonly LegDecision[]`.
  Fehlercodes `ROUND_LIMIT_REACHED`, `ROUND_LIMIT_NOT_REACHED`.

- [ ] **Schritt 1: Fehlschlagende Tests schreiben**

```ts
  it("stops the leg at the round limit and decides it by bull", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ maxRounds: 2 }),
    });
    for (const [index, seat] of ([1, 2, 1, 2] as const).entries()) {
      match = executeX01Command(
        match,
        visit(`v${index}`, seat, seat === 1 ? "one" : "two", 60),
      ).match;
    }
    const limited = projectX01Match(match);
    expect(limited.roundsPlayedInLeg).toBe(2);
    expect(limited.roundLimitReached).toBe(true);

    try {
      executeX01Command(match, visit("too-many", 1, "one", 60));
      expect.unreachable("the round limit is reached");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("ROUND_LIMIT_REACHED");
    }

    const decided = executeX01Command(match, {
      type: "DECIDE_LEG_BY_BULL",
      commandId: "bull-out",
      winnerSeat: 2,
    });
    expect(decided.outcome).toBe("MATCH_WON");
    expect(decided.state.winnerSeat).toBe(2);
    expect(decided.state.sides[1].totalLegsWon).toBe(1);
    expect(decided.state.legDecisions).toHaveLength(1);
  });

  it("refuses the bull decision before the round limit and without one", () => {
    let match = createX01Match({ sides: singles("one", "two"), rules: rules({ maxRounds: 2 }) });
    match = executeX01Command(match, visit("v0", 1, "one", 60)).match;
    try {
      executeX01Command(match, { type: "DECIDE_LEG_BY_BULL", commandId: "early", winnerSeat: 1 });
      expect.unreachable("the round limit is not reached");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("ROUND_LIMIT_NOT_REACHED");
    }

    const unlimited = createX01Match({ sides: singles("one", "two") });
    try {
      executeX01Command(unlimited, { type: "DECIDE_LEG_BY_BULL", commandId: "no-limit", winnerSeat: 1 });
      expect.unreachable("a match without a round limit is never decided by bull");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("ROUND_LIMIT_NOT_REACHED");
    }
  });

  it("continues with the next leg after a leg decided by bull", () => {
    let match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ maxRounds: 1, legsToWinSet: 2, setsToWin: 1 }),
    });
    match = executeX01Command(match, visit("a", 1, "one", 60)).match;
    match = executeX01Command(match, visit("b", 2, "two", 60)).match;
    match = executeX01Command(match, {
      type: "DECIDE_LEG_BY_BULL",
      commandId: "bull-1",
      winnerSeat: 1,
    }).match;
    const state = projectX01Match(match);
    expect(state.status).toBe("IN_PROGRESS");
    expect(state.legNumber).toBe(2);
    expect(state.legStartingSeat).toBe(2);
    expect(state.sides[0].remaining).toBe(501);
    expect(state.roundsPlayedInLeg).toBe(0);
  });
```

- [ ] **Schritt 2: Tests laufen lassen, Fehlschlag bestätigen**

```bash
pnpm --filter @darts-platform/scoring-engine test -- src/x01.spec.ts
```

- [ ] **Schritt 3: Ausbullen umsetzen**

Typen und Union erweitern:

```ts
export interface DecideLegByBullCommand {
  readonly type: "DECIDE_LEG_BY_BULL";
  readonly commandId: string;
  readonly winnerSeat: 1 | 2;
}

export type X01Command =
  | SubmitVisitCommand
  | UndoVisitCommand
  | DecideLegStartCommand
  | DecideLegByBullCommand;

export interface LegDecision {
  readonly commandId: string;
  readonly legNumber: number;
  readonly winnerSeat: 1 | 2;
  readonly outcome: "LEG_WON" | "SET_WON" | "MATCH_WON";
}
```

`ActiveCommands.submissions` wird zu einem geordneten Strom aus Visits und
Ausbullen; `submissions` bleibt für die Undo-Prüfung erhalten:

```ts
type StreamCommand = SubmitVisitCommand | DecideLegByBullCommand;

interface ActiveCommands {
  readonly stream: readonly StreamCommand[];
  readonly submissions: readonly SubmitVisitCommand[];
  readonly reverted: readonly string[];
  readonly legStarts: ReadonlyMap<number, 1 | 2>;
}
```

mit

```ts
  const submissions = commands.filter(
    (command): command is SubmitVisitCommand =>
      command.type === "SUBMIT_VISIT" && !reverted.has(command.commandId),
  );
  const stream = commands.filter(
    (command): command is StreamCommand =>
      (command.type === "SUBMIT_VISIT" && !reverted.has(command.commandId)) ||
      command.type === "DECIDE_LEG_BY_BULL",
  );
```

Gemeinsame Hilfsfunktionen für Leggewinn und Legwechsel — beide Wege, Checkout
und Ausbullen, benutzen sie:

```ts
interface LegWin {
  readonly sides: [X01SideState, X01SideState];
  readonly outcome: VisitOutcome;
  readonly setWon: boolean;
  readonly matchWon: boolean;
}

function winLeg(
  sides: readonly [X01SideState, X01SideState],
  index: 0 | 1,
  rules: X01Rules,
): LegWin {
  const side = sides[index];
  const legsWonInSet = side.legsWonInSet + 1;
  const setWon = legsWonInSet >= rules.legsToWinSet;
  const setsWon = side.setsWon + (setWon ? 1 : 0);
  const matchWon = setsWon >= rules.setsToWin;
  return {
    sides: replaceSide(sides, index, {
      ...side,
      remaining: 0,
      legsWonInSet: setWon ? 0 : legsWonInSet,
      totalLegsWon: side.totalLegsWon + 1,
      setsWon,
    }),
    outcome: matchWon ? "MATCH_WON" : setWon ? "SET_WON" : "LEG_WON",
    setWon,
    matchWon,
  };
}

function resetForNextLeg(
  sides: readonly [X01SideState, X01SideState],
  rules: X01Rules,
): [X01SideState, X01SideState] {
  const opened = rules.inRule === "STRAIGHT";
  return [
    { ...sides[0], remaining: rules.startingScore, openedInLeg: opened },
    { ...sides[1], remaining: rules.startingScore, openedInLeg: opened },
  ];
}

function roundsCompleted(visitsInLeg: readonly [number, number]): number {
  return Math.min(visitsInLeg[0], visitsInLeg[1]);
}

function isRoundLimitReached(maxRounds: number | null, visitsInLeg: readonly [number, number]): boolean {
  return maxRounds !== null && roundsCompleted(visitsInLeg) >= maxRounds;
}
```

Die Schleife in `projectX01Match` läuft nun über `active.stream` und
verzweigt am Kommandotyp. Der Kopf der Schleife:

```ts
  const decisions: LegDecision[] = [];

  for (const command of active.stream) {
    if (winnerSeat !== null) {
      throw new ScoringValidationError(
        "MATCH_ALREADY_COMPLETED",
        "No command can be added to a completed match.",
      );
    }

    if (command.type === "DECIDE_LEG_BY_BULL") {
      if (!isRoundLimitReached(match.rules.maxRounds, visitsInLeg)) {
        throw new ScoringValidationError(
          "ROUND_LIMIT_NOT_REACHED",
          "A leg is only decided by bull once the round limit is reached.",
        );
      }
      const index = indexOfSeat(command.winnerSeat);
      const won = winLeg(sides, index, match.rules);
      sides = won.sides;
      decisions.push({
        commandId: command.commandId,
        legNumber,
        winnerSeat: command.winnerSeat,
        outcome: won.outcome === "BUST" || won.outcome === "SCORED" ? "LEG_WON" : won.outcome,
      });
      if (won.matchWon) {
        winnerSeat = command.winnerSeat;
        continue;
      }
      legNumber += 1;
      if (won.setWon) setNumber += 1;
      legStartingIndex = nextLegStartIndex(active.legStarts, legNumber, legStartingIndex);
      activeIndex = legStartingIndex;
      visitsInLeg = [0, 0];
      sides = resetForNextLeg(sides, match.rules);
      continue;
    }

    if (isRoundLimitReached(match.rules.maxRounds, visitsInLeg)) {
      throw new ScoringValidationError(
        "ROUND_LIMIT_REACHED",
        "The round limit is reached; the leg is decided by a bull throw.",
      );
    }
    // ... bestehende Visit-Verarbeitung
  }
```

`winLeg` liefert nie `BUST` oder `SCORED`; der Ausdruck im `outcome`-Feld ist
nur die Verengung des `VisitOutcome`-Typs auf die drei möglichen Werte.

Die bestehende Visit-Verarbeitung ersetzt ihren Checkout-Block durch `winLeg`
und ihren Legwechsel durch dieselben fünf Zeilen wie oben:

```ts
    if (validCheckout) {
      const won = winLeg(sides, activeIndex, match.rules);
      sides = won.sides;
      outcome = won.outcome;
      scoreAfter = 0;
      if (won.matchWon) winnerSeat = seatOf(activeIndex);
      setWonByVisit = won.setWon;
    } else if (bust) {
      sides = replaceSide(sides, activeIndex, { ...side, openedInLeg });
    } else {
      sides = replaceSide(sides, activeIndex, { ...side, remaining: tentative, openedInLeg });
    }
```

mit `let setWonByVisit = false;` vor dem Block und danach unverändert dem
`visits.push(...)`, gefolgt von

```ts
    visitsInLeg =
      activeIndex === 0
        ? [visitsInLeg[0] + 1, visitsInLeg[1]]
        : [visitsInLeg[0], visitsInLeg[1] + 1];

    if (validCheckout) {
      if (winnerSeat === null) {
        legNumber += 1;
        if (setWonByVisit) setNumber += 1;
        legStartingIndex = nextLegStartIndex(active.legStarts, legNumber, legStartingIndex);
        activeIndex = legStartingIndex;
        visitsInLeg = [0, 0];
        sides = resetForNextLeg(sides, match.rules);
      }
    } else {
      activeIndex = other(activeIndex);
    }
```

Der Rückgabewert der Projektion wächst um drei Felder:

```ts
    roundsPlayedInLeg: roundsCompleted(visitsInLeg),
    roundLimitReached: isRoundLimitReached(match.rules.maxRounds, visitsInLeg),
    legDecisions: decisions,
```

`commandOutcome` um den neuen Fall erweitern:

```ts
    case "DECIDE_LEG_BY_BULL":
      return state.legDecisions.at(-1)?.outcome ?? null;
```

Undo darf ein durch Ausbullen entschiedenes Leg nicht aufreissen. In
`executeX01Command` im Undo-Zweig ergänzen:

```ts
    if (active.stream.at(-1)?.type === "DECIDE_LEG_BY_BULL") {
      throw new ScoringValidationError(
        "UNDO_TARGET_NOT_LATEST",
        "The leg was decided by a bull throw; the visit before it cannot be undone.",
      );
    }
```

`index.ts` um `type DecideLegByBullCommand` und `type LegDecision` erweitern.

- [ ] **Schritt 4: Tests laufen lassen**

```bash
pnpm --filter @darts-platform/scoring-engine test
pnpm --filter @darts-platform/scoring-engine typecheck
pnpm --filter @darts-platform/api typecheck
```

- [ ] **Schritt 5: Commit**

```bash
git add packages/scoring-engine
git commit -m "feat: end a leg by bull once the round limit is reached"
```

---

### Task 5: Vertrag und Oberfläche

Der API-Vertrag und die Oberfläche sprechen bis hierher `doubleOut`. Diese
Task stellt sie auf `inRule` / `outRule` / `maxRounds` um. Die Spalte
`double_out` existiert noch; deshalb übersetzen Repository und Service an
genau zwei Stellen, was Task 6 wieder entfernt.

**Dateien:**
- Ändern: `packages/schemas/src/tournament.ts:175`, `:230`
- Ändern: `packages/schemas/src/tournament.spec.ts:11`, `:80`
- Ändern: `apps/api/src/tournaments/tournaments.repository.ts:351`
- Ändern: `apps/api/src/tournaments/tournaments.service.ts:523`
- Ändern: `apps/api/src/seeding/seed-fixtures.ts:250`
- Ändern: `apps/api/src/tournaments/tournaments.integration.spec.ts`
- Ändern: `apps/api/src/tournaments/tournaments.reference.integration.spec.ts:93`
- Ändern: `apps/web/src/components/tournament/setup-sheet.tsx`
- Ändern: `apps/web/src/components/tournament/dashboard-header.tsx`

**Interfaces:**
- Konsumiert: `InRule`, `OutRule` aus Task 1 (als Zod-Enums nachgebildet, das
  Schemapaket hängt nicht von der Engine ab).
- Produziert: `createTournamentSchema` mit `inRule`, `outRule`, `maxRounds`;
  `tournamentDashboardSchema.tournament` mit `inRule`, `outRule`.

- [ ] **Schritt 1: Fehlschlagenden Vertragstest schreiben**

In `packages/schemas/src/tournament.spec.ts` das Fixture in Zeile 11 und die
Dashboard-Zeile 80 auf das neue Vokabular umstellen und einen Test ergänzen:

```ts
  it("rejects an out rule the platform does not know", () => {
    const parsed = createTournamentSchema.safeParse({ ...validCreateInput, outRule: "TRIPLE" });
    expect(parsed.success).toBe(false);
  });

  it("defaults the round limit to null", () => {
    const parsed = createTournamentSchema.parse(validCreateInput);
    expect(parsed.maxRounds).toBeNull();
  });
```

`validCreateInput` ist das bestehende Fixture ab Zeile 11; dort
`doubleOut: true` durch `inRule: "STRAIGHT", outRule: "DOUBLE"` ersetzen.

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
pnpm --filter @darts-platform/schemas test -- src/tournament.spec.ts
```

- [ ] **Schritt 3: Vertrag umstellen**

In `packages/schemas/src/tournament.ts` oben bei den übrigen Enums:

```ts
export const inRuleSchema = z.enum(["STRAIGHT", "DOUBLE"]);
export const outRuleSchema = z.enum(["SINGLE", "DOUBLE", "MASTER"]);
```

Im Dashboard-Schema `doubleOut: z.boolean()` ersetzen durch:

```ts
    inRule: inRuleSchema,
    outRule: outRuleSchema,
```

In `createTournamentSchema` ebenso, zusätzlich die Rundenbegrenzung:

```ts
    inRule: inRuleSchema,
    outRule: outRuleSchema,
    maxRounds: z.number().int().min(1).max(99).nullable().default(null),
```

- [ ] **Schritt 4: API übersetzen lassen**

`apps/api/src/tournaments/tournaments.repository.ts:351` schreibt weiterhin in
die Spalte `double_out`, bis Task 6 sie ersetzt:

```ts
          doubleOut: input.data.outRule !== "SINGLE",
```

`apps/api/src/tournaments/tournaments.service.ts:523` liefert das neue
Vokabular aus der alten Spalte:

```ts
        inRule: "STRAIGHT",
        outRule: data.tournament.doubleOut ? "DOUBLE" : "SINGLE",
```

`apps/api/src/seeding/seed-fixtures.ts:250`: `doubleOut: true` wird zu
`inRule: "STRAIGHT", outRule: "DOUBLE", maxRounds: null`.

In `tournaments.integration.spec.ts` alle `doubleOut: true` durch
`inRule: "STRAIGHT", outRule: "DOUBLE"` ersetzen, in
`tournaments.reference.integration.spec.ts:93` `doubleOut: false` durch
`inRule: "STRAIGHT", outRule: "SINGLE"`:

```bash
rg -l "doubleOut" apps/api/src
sed -i 's/^\( *\)doubleOut: true,$/\1inRule: "STRAIGHT",\n\1outRule: "DOUBLE",/' \
  apps/api/src/tournaments/tournaments.integration.spec.ts
sed -i 's/^\( *\)doubleOut: false,$/\1inRule: "STRAIGHT",\n\1outRule: "SINGLE",/' \
  apps/api/src/tournaments/tournaments.reference.integration.spec.ts
```

Danach `rg "doubleOut" apps/api/src` prüfen: es dürfen nur noch die beiden
Adapterzeilen und die Drizzle-Spalte übrig sein.

- [ ] **Schritt 5: Oberfläche umstellen**

In `apps/web/src/components/tournament/setup-sheet.tsx`:

- `SetupFormValues`: `doubleOut: boolean;` wird zu
  ```ts
  inRule: InRule;
  outRule: OutRule;
  ```
  mit `import { type InRule, type OutRule } from "@darts-platform/schemas";`
  falls dort exportiert, sonst lokal
  `type InRule = "STRAIGHT" | "DOUBLE";` / `type OutRule = "SINGLE" | "DOUBLE" | "MASTER";`
  neben den übrigen lokalen Formulartypen.
- `defaultValues`: `doubleOut: true` wird zu `inRule: "STRAIGHT", outRule: "DOUBLE"`.
- `onSubmit`: `doubleOut: formValues.doubleOut` wird zu
  `inRule: formValues.inRule, outRule: formValues.outRule, maxRounds: null`.
- Die Checkbox (Zeilen ~300–307) wird zu zwei Feldern im bestehenden
  `Field`/`SelectInput`-Muster:

```tsx
                <Field error={contractErrors.inRule ?? null} htmlFor="inRule" label="In-Regel">
                  <SelectInput
                    aria-describedby={contractErrors.inRule ? "inRule-error" : undefined}
                    id="inRule"
                    {...register("inRule")}
                  >
                    <option value="STRAIGHT">Straight In</option>
                    <option value="DOUBLE">Double In</option>
                  </SelectInput>
                </Field>
                <Field error={contractErrors.outRule ?? null} htmlFor="outRule" label="Out-Regel">
                  <SelectInput
                    aria-describedby={contractErrors.outRule ? "outRule-error" : undefined}
                    id="outRule"
                    {...register("outRule")}
                  >
                    <option value="SINGLE">Single Out</option>
                    <option value="DOUBLE">Double Out</option>
                    <option value="MASTER">Master Out</option>
                  </SelectInput>
                </Field>
```

- In `MESSAGES` zwei Einträge ergänzen:
  ```ts
  inRule: "Wähle, wie ein Leg eröffnet wird.",
  outRule: "Wähle, wie ein Leg geschlossen wird.",
  ```

In `apps/web/src/components/tournament/dashboard-header.tsx:34` die Anzeige
auf beide Regeln umstellen:

```tsx
            {tournament.startingScore} {inRuleLabel(tournament.inRule)} ·{" "}
            {outRuleLabel(tournament.outRule)}
```

mit zwei kleinen Abbildungen oberhalb der Komponente:

```tsx
function inRuleLabel(rule: "STRAIGHT" | "DOUBLE"): string {
  return rule === "DOUBLE" ? "Double In" : "Straight In";
}

function outRuleLabel(rule: "SINGLE" | "DOUBLE" | "MASTER"): string {
  switch (rule) {
    case "SINGLE":
      return "Single Out";
    case "DOUBLE":
      return "Double Out";
    case "MASTER":
      return "Master Out";
  }
}
```

- [ ] **Schritt 6: Tests und Typen prüfen**

```bash
pnpm --filter @darts-platform/schemas test
pnpm --filter @darts-platform/schemas typecheck
pnpm --filter @darts-platform/api typecheck
pnpm --filter @darts-platform/web typecheck
```

- [ ] **Schritt 7: Commit**

```bash
git add packages/schemas apps/api apps/web
git commit -m "feat: expose the in and out rule across contract and interface"
```

---

### Task 6: Datenbankspalten

Migrationsschritt 6 der Spec: `in_rule`, `out_rule` und `max_rounds` ersetzen
`double_out` — auf `matches` und auf `tournaments`.

**Dateien:**
- Ändern: `packages/database/src/schema.ts:312`, `:546`
- Anlegen: `packages/database/drizzle/0016_*.sql` (+ `meta/0016_snapshot.json`,
  `meta/_journal.json` — beide erzeugt drizzle-kit)
- Ändern: `apps/api/src/matches/matches.repository.ts` (Adapter aus Task 1)
- Ändern: `apps/api/src/tournaments/tournaments.repository.ts:351`, `:636`
- Ändern: `apps/api/src/tournaments/tournaments.service.ts:523`

**Interfaces:**
- Produziert: `matches.inRule|outRule|maxRounds`,
  `tournaments.inRule|outRule|maxRounds`; `matches.doubleOut` und
  `tournaments.doubleOut` entfallen.

- [ ] **Schritt 1: Schema ändern**

In `packages/database/src/schema.ts` bei `matches` `doubleOut` ersetzen:

```ts
    inRule: varchar("in_rule", { length: 10 }).default("STRAIGHT").notNull(),
    outRule: varchar("out_rule", { length: 10 }).default("DOUBLE").notNull(),
    maxRounds: integer("max_rounds"),
```

und in der Constraint-Liste ergänzen:

```ts
    check("matches_in_rule_check", sql`${table.inRule} in ('STRAIGHT', 'DOUBLE')`),
    check("matches_out_rule_check", sql`${table.outRule} in ('SINGLE', 'DOUBLE', 'MASTER')`),
    check("matches_max_rounds_check", sql`${table.maxRounds} is null or ${table.maxRounds} > 0`),
```

Bei `tournaments` dieselben drei Spalten und dieselben drei Constraints mit
dem Präfix `tournaments_`.

- [ ] **Schritt 2: Migration erzeugen**

```bash
pnpm --filter @darts-platform/database db:generate
```

Erwartet: neue Datei `packages/database/drizzle/0016_*.sql`, ein neuer
Snapshot und ein neuer Journaleintrag.

- [ ] **Schritt 3: Backfill in die Migration einsetzen**

drizzle-kit erzeugt `ADD COLUMN` und `DROP COLUMN`, aber keinen Backfill.
Unmittelbar **nach** den drei `ADD COLUMN`-Anweisungen je Tabelle und **vor**
jedem `DROP COLUMN "double_out"` einfügen:

```sql
UPDATE "matches" SET "out_rule" = CASE WHEN "double_out" THEN 'DOUBLE' ELSE 'SINGLE' END;--> statement-breakpoint
UPDATE "tournaments" SET "out_rule" = CASE WHEN "double_out" THEN 'DOUBLE' ELSE 'SINGLE' END;--> statement-breakpoint
```

`in_rule` bleibt auf dem Vorgabewert `STRAIGHT`, `max_rounds` auf `NULL`.
Anschliessend die Reihenfolge der Datei prüfen: erst `ADD COLUMN`, dann die
beiden `UPDATE`, dann `ADD CONSTRAINT`, zuletzt `DROP COLUMN`.

```bash
cat packages/database/drizzle/0016_*.sql
```

- [ ] **Schritt 4: Adapter entfernen**

`apps/api/src/matches/matches.repository.ts` (Aggregat) liest die Regeln nun
aus der Zeile. Die Spalten sind `varchar`, also auf die Union verengen:

```ts
function toInRule(value: string): InRule {
  return value === "DOUBLE" ? "DOUBLE" : "STRAIGHT";
}

function toOutRule(value: string): OutRule {
  return value === "SINGLE" ? "SINGLE" : value === "MASTER" ? "MASTER" : "DOUBLE";
}
```

(neben den übrigen Modulfunktionen der Datei, mit
`import { type InRule, type OutRule } from "@darts-platform/scoring-engine";`)

```ts
      rules: {
        startingScore: match.startingScore,
        inRule: toInRule(match.inRule),
        outRule: toOutRule(match.outRule),
        maxRounds: match.maxRounds,
        legsToWinSet: match.legsToWinSet,
        setsToWin: match.setsToWin,
      },
```

`apps/api/src/tournaments/tournaments.repository.ts:351` (Turnier anlegen):

```ts
          inRule: input.data.inRule,
          outRule: input.data.outRule,
          maxRounds: input.data.maxRounds,
```

`apps/api/src/tournaments/tournaments.repository.ts:636` (Match aus dem
Turnier anlegen):

```ts
          inRule: tournament.inRule,
          outRule: tournament.outRule,
          maxRounds: tournament.maxRounds,
```

`apps/api/src/tournaments/tournaments.service.ts:523`:

```ts
        inRule: data.tournament.inRule,
        outRule: data.tournament.outRule,
```

Danach darf `rg "doubleOut|double_out" packages apps --glob '!**/drizzle/**'`
nichts mehr finden.

- [ ] **Schritt 5: Migration und Integrationstests laufen lassen**

```bash
pnpm --filter @darts-platform/database typecheck
pnpm --filter @darts-platform/api typecheck
pnpm --filter @darts-platform/database test
pnpm --filter @darts-platform/api test -- src/tournaments/tournaments.integration.spec.ts
```

Erwartet: die Testcontainers-Läufe wenden Migration 0016 an und laufen grün.
Schlägt die Migration fehl, ist die Reihenfolge in der SQL-Datei falsch
(Schritt 3), nicht das Schema.

- [ ] **Schritt 6: Commit**

```bash
git add packages/database apps/api
git commit -m "feat: store the in rule, out rule and round limit"
```

---

### Task 7: Dokumentation und Vollverifikation

**Dateien:**
- Ändern: `docs/superpowers/plans/2026-09-02-team-encounter-roadmap.md`
- Ändern: `docs/superpowers/specs/2026-09-02-team-encounter-league-design.md`

- [ ] **Schritt 1: Roadmap-Schnittstelle nachziehen**

Im Abschnitt „Phase 2 → 4" `DecideLegStartCommand` ergänzen und festhalten,
dass die Ablage der beiden neuen Kommandos zu Phase 4 gehört:

```ts
interface DecideLegStartCommand {
  type: "DECIDE_LEG_START";
  commandId: string;
  legNumber: number;
  startingSeat: 1 | 2;
}
```

Dazu ein Satz: Phase 4 legt beide Kommandos ab; solange `max_rounds` überall
`NULL` ist, kann kein Bestandsmatch eines tragen.

- [ ] **Schritt 2: Spec um die getroffenen Entscheidungen ergänzen**

Im Abschnitt „Engines / scoring-engine" zwei Sätze anfügen: Master Out wird
über die Erreichbarkeit des letzten Wurfs geprüft, nicht über ein zusätzliches
Feld, damit der `visits`-Vertrag aus Phase 1 unverändert bleibt. Der Legbeginn
ab Leg 3 ist ein Kommando; fehlt es, wechselt der Beginn wie bisher, damit
Turniermatches über Best of 5 oder 7 unverändert laufen.

- [ ] **Schritt 3: Vollverifikation**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Erwartet: alles grün. Fehlschläge werden behoben, nicht ignoriert.

- [ ] **Schritt 4: Commit**

```bash
git add docs
git commit -m "docs: record the phase 2 scoring rule decisions"
```

---

## Selbstprüfung gegen die Spec

| Spec-Anforderung | Task |
| --- | --- |
| `inRule` / `outRule` statt `doubleOut` | 1 |
| Bust bei Rest 1 nur für `DOUBLE` und `MASTER` | 1 |
| `maxRounds` bildet Anhang 2 ab | 1, 4 |
| Ausbullen schliesst das Leg, weitere Visits abgelehnt | 4 |
| Ausbullen vor der Grenze abgelehnt (`ROUND_LIMIT_NOT_REACHED`) | 4 |
| Legbeginn 2.2.9, Beginner ab Leg 3 als Eingabe | 3 |
| Double In | 2 |
| `matches.in_rule|out_rule|max_rounds` statt `double_out` | 6 |
| `tournaments` erhält dieselbe Behandlung | 5, 6 |
| Engine-Tests: 701 DI/DO, Master, Single, Bust je Regel, Ausbullen | 1, 2, 4 |

Nicht Teil dieser Phase und bewusst offen: die Ablage der beiden neuen
Kommandos (Phase 4), die Anzeige der Variante im Scoring-Workspace (Phase 6),
`evaluateMatchReadiness` in der scheduling-engine (Phase 4).
