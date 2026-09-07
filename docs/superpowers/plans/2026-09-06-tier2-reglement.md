# Tier 2, Teil C — Reglement-Treue der Engines und Statistik

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die fünf Important-Befunde aus Auditbericht D (I2–I6) und den zugehörigen
Befund A-I3 beheben, sodass Ligatabelle, Begegnungsvorlage, Anwurfregel und
Statistik dem VFC-Liga-Reglement folgen und die Regeln dort im Code stehen, wo
AGENTS.md §6 sie verlangt: in den Engine-Paketen, mit Reglementsziffer belegt.

**Architecture:** Alle fachlichen Änderungen liegen in `packages/league-engine`,
`packages/scoring-engine` und `packages/statistics` — infrastrukturfreie
Domänenpakete ohne Drizzle, PostgreSQL, Redis, NestJS, Next.js oder Socket.IO.
`apps/api` reicht Daten hinein und Ergebnisse hinaus, `apps/web` zeigt an. Eine
Regel, die im Reglement steht, wird im Code mit ihrer Ziffer belegt
(`Reglement A1.5`, `Reglement 2.2.8`, `Reglement 2.2.9`); wo bewusst abgewichen
wird, steht die Begründung im Kommentar und in diesem Plan, nicht als stiller
Sonderfall.

**Tech Stack:** TypeScript (strict), pnpm-Workspace mit Turborepo, Vitest,
Zod (`packages/schemas`), Drizzle ORM + PostgreSQL (`packages/database`),
NestJS/Fastify (`apps/api`), Next.js/React (`apps/web`).

**Spec:**
- `/tmp/claude-1000/-home-sut-projects-darts-platform/70688d40-4244-406a-b67f-18e37ab90b1a/scratchpad/audit/D-engines.md` — Befunde I2–I6, M5, M7 mit `file:line`, Reglementsziffer, Zahlenbeispiel und Fixvorschlag
- `/tmp/claude-1000/-home-sut-projects-darts-platform/70688d40-4244-406a-b67f-18e37ab90b1a/scratchpad/audit/A-architektur.md` — Befund I3 (Spielplan im Browser)
- `LIGA-REGLEMENT.md` — fachliche Autorität (Ziffern 2.2.1, 2.2.2, 2.2.8, 2.2.9, A1.1–A1.5)
- `AGENTS.md` §4, §6, §7, §11, §12, §20, §21, §24, §26; `ARCHITECTURE.md` §12, §23, §24

## Global Constraints

- Engines bleiben infrastrukturfrei: kein Import von Drizzle, `postgres`, Redis,
  BullMQ, NestJS, Next.js oder Socket.IO in `packages/league-engine`,
  `packages/scoring-engine`, `packages/statistics`.
- Determinismus: kein `Math.random`, `Date.now`, `new Date(`, `crypto`,
  `process.`, `globalThis` in den Engine-Paketen; keine ICU-abhängige Sortierung
  (`localeCompare` ohne Locale) in Domänenlogik.
- **Replay-Sicherheit der Scoring-Engine:** gespeicherte Kommandos (`score_commands.payload`)
  werten unverändert. Neue Regelangaben gehören an den Match-Datensatz (wie `inRule`),
  nicht ins Kommando.
- `strict: true`, kein `any`, `unknown` statt `any`, exhaustive `switch` ohne `default`
  über geschlossene Unions.
- Kommentare deutsch (Schweizer Rechtschreibung, kein ß), Bezeichner englisch.
- Migrationen nur vorwärts, mit Snapshot und Doku; keine bestehende Migration
  umschreiben. **Diese Arbeit legt genau eine Migration an: `0024_…`.** `0023_…` ist
  für Tier 2, Teil A reserviert — Task 4 läuft erst, wenn Teil A seine Nummer belegt hat
  oder feststeht, dass sie frei bleibt (dann wird 0024 trotzdem genommen, eine Lücke
  im Journal ist unzulässig — siehe Task 4, Schritt 2).
- Conventional Commits mit deutschem Betreff, **kein `Co-Authored-By`-Trailer**.
- Testkommandos:
  - Engines: `pnpm --filter @darts-platform/league-engine test`,
    `pnpm --filter @darts-platform/scoring-engine test`,
    `pnpm --filter @darts-platform/statistics test`
  - API (einzelne Datei): aus `apps/api` heraus
    `npx dotenv -e ../../.env -- npx vitest run <pfad>`
  - Web: `pnpm --filter @darts-platform/web test`
- Vor jedem Commit: `pnpm lint`, `pnpm typecheck`, `pnpm test`. Am Planende
  zusätzlich `pnpm build` und `pnpm test:e2e` (ein Worker).

## File Structure

**Task 1 — Ligatabelle nach A1.5**
- `packages/league-engine/src/standings.ts` — Tabellenrechnung; `minusPoints` je Zeile, `sortKeys` nach A1.5
- `packages/league-engine/src/standings.spec.ts` — Rangkriterien mit Zahlenbeispiel
- `packages/schemas/src/league.ts` — `standingsRowSchema` um `minusPoints`
- `apps/web/src/components/league/standings-table.tsx` — Spalte „Diff" → „Minus"

**Task 2 — Checkout-Kennzahlen unter Single Out**
- `packages/statistics/src/statistics.ts` — `outRule` je Match, Checkout-Kennzahlen nullable
- `packages/statistics/src/statistics.spec.ts`
- `packages/schemas/src/statistics.ts` — drei Felder `.nullable()`
- `apps/api/src/statistics/statistics.service.ts` — `outRule` durchreichen
- `apps/worker/src/main.ts`, `apps/worker/src/statistics/build-statistics-matches.ts` — dito
- `apps/web/src/components/player-profile.tsx` — „–" statt „0.0 %"
- `DATABASE_SCHEMA.md` Abschnitt 10 — dritte Einheit „nicht anwendbar"

**Task 3 — Begegnungsvorlage in die League-Engine**
- `packages/league-engine/src/encounter-template.ts` (neu) — `TemplateOptions`, `vfcTemplateOptions`, `buildEncounterTemplate`
- `packages/league-engine/src/encounter-template.spec.ts` (neu)
- `packages/league-engine/src/template.ts` — Rundenfolge nach 2.2.8, reguläre Doppel nach 2.2.1
- `packages/league-engine/src/template.spec.ts` — neue Prüfungen
- `packages/league-engine/src/index.ts` — Exporte
- `apps/web/package.json` — Abhängigkeit auf `@darts-platform/league-engine`
- `apps/web/src/lib/league-template.ts` — nur noch `slugFromName`
- `apps/web/src/lib/league-template.spec.ts` — Vorlagentests wandern in die Engine
- `apps/web/src/components/league/competition-setup.tsx` — Import aus der Engine
- `apps/api/src/common/league-error.ts` — neue Engine-Codes abbilden
- `package.json` (Repo-Wurzel) — `test:e2e` baut `league-engine` mit

**Task 4 — Ausbullen beim Entscheidungsdoppel (2.2.9)**
- `packages/database/src/schema.ts` — Spalte `matches.bull_off_from_leg_one`
- `packages/database/drizzle/0024_league_decider_bull_off.sql` (neu) + `meta/0024_snapshot.json` + `meta/_journal.json`
- `packages/scoring-engine/src/x01.ts` — `X01Rules.bullOffFromLegOne`, `LEG_START_FIXED` daran gebunden, Kommentar zu 2.2.9 vervollständigt
- `packages/scoring-engine/src/x01.spec.ts`
- `packages/schemas/src/match.ts` — `decideLegStartSchema.legNumber` ab 1, `matchStateSchema.bullOffFromLegOne`
- `apps/api/src/matches/matches.repository.ts` — Flag laden, ausliefern
- `apps/api/src/encounters/encounters.repository.ts` — Flag für DECIDER-Slots setzen
- `apps/api/src/encounters/encounters.integration.spec.ts`
- `DATABASE_SCHEMA.md` — Spalte dokumentieren

**Task 5 — Rankingverlauf gegen die echte Gegnerbewertung**
- `packages/statistics/src/statistics.ts` — Elo paarweise, benannte Konstanten, deterministische Reihenfolge
- `packages/statistics/src/statistics.spec.ts`
- `ARCHITECTURE.md` §23 — Reichweite der Zahl benennen

---

### Task 1: Ligatabelle nach Reglement A1.5 (Befund D-I2)

**Was ist:** `packages/league-engine/src/standings.ts:69` sortiert nach
`[points, gameDifference, gamesFor, legDifference, legsFor]`. A1.5 kennt keine
Differenz. Verlangt sind in abnehmender Gewichtung: 1. Pluspunkte,
2. Minuspunkte, 3. gewonnene Spiele, 4. verlorene Spiele, 5. gewonnene Sätze,
6. verlorene Sätze. Die Datei trägt keinen einzigen Reglementsverweis.

**Minuspunkte:** A1.4 vergibt spiegelbildlich — die unterlegene Mannschaft
erhält so viele Minuspunkte, wie die siegreiche Pluspunkte erhält (3:3 bei
klarem Ausgang, 1:1 beim Unentschieden, dazu je 1 Zusatz- und 1 Minuspunkt aus
dem sudden death). Die eigenen Minuspunkte einer Begegnung sind deshalb **die
Pluspunkte des Gegners in derselben Begegnung**. Diese Ableitung ist der Formel
`3 × played − points` vorzuziehen: sie kommt ohne Annahme über die Punkteregel
des Wettbewerbs aus (`competitions.points_win/draw/loss/decider_bonus` sind
konfigurierbar, 2.2.2 ist die Ligavorlage, nicht die einzige Möglichkeit) und
steht bereits vollständig in `StandingsEncounter.homePoints`/`awayPoints`.

**„Sätze" des Reglements sind die Legs dieser Engine:** A1.2 spielt jedes Spiel
auf zwei Gewinnsätze, A1.3 zählt darum höchstens 36 Sätze bei 18 Spielen —
genau die Zahl, die `legsFor`/`legsAgainst` je Begegnung tragen
(`packages/league-engine/src/result.ts`). Das gehört als Kommentar an `sortKeys`,
weil der Feldname sonst in die Irre führt.

**Files:**
- Modify: `packages/league-engine/src/standings.ts`
- Test: `packages/league-engine/src/standings.spec.ts`
- Modify: `packages/schemas/src/league.ts:113-122` (`standingsRowSchema`)
- Modify: `apps/web/src/components/league/standings-table.tsx:67-68` (Kopfzeile), `:104-106` (Zelle)

**Interfaces:**
- Consumes: nichts aus früheren Tasks.
- Produces: `StandingsRow` trägt zusätzlich `readonly minusPoints: number`.
  `calculateStandings(input: StandingsInput): readonly StandingsRow[]` bleibt in
  Signatur und Rückgabetyp unverändert; `gameDifference` und `legDifference`
  bleiben als Anzeigewerte auf der Zeile erhalten, bestimmen aber keinen Rang mehr.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

An `packages/league-engine/src/standings.spec.ts` unterhalb des bestehenden
`encounter`-Helfers einen zweiten Helfer und zwei Tests anfügen. Der Helfer
schreibt eine abgeschlossene Begegnung aus Sicht der Heimmannschaft; die
Gegner (`gegner-1` … `gegner-5`) stehen bewusst **nicht** in `teamIds`, damit
nur die beiden untersuchten Mannschaften in der Tabelle stehen.

```ts
function homeEncounter(
  teamId: string,
  opponentId: string,
  values: {
    readonly points: number;
    readonly opponentPoints: number;
    readonly games: number;
    readonly gamesAgainst: number;
    readonly legs: number;
    readonly legsAgainst: number;
  },
): StandingsEncounter {
  return {
    homeTeamId: teamId,
    awayTeamId: opponentId,
    status: "COMPLETED",
    result:
      values.games > values.gamesAgainst
        ? "HOME_WIN"
        : values.games < values.gamesAgainst
          ? "AWAY_WIN"
          : "DRAW",
    homePoints: values.points,
    awayPoints: values.opponentPoints,
    homeGames: values.games,
    awayGames: values.gamesAgainst,
    homeLegs: values.legs,
    awayLegs: values.legsAgainst,
  };
}

describe("Rangierungskriterien nach Reglement A1.5", () => {
  // Team A: fünf reguläre Begegnungen à 18 Spielen, drei klare Siege (3:0),
  // zwei klare Niederlagen (0:3) -> 9 Pluspunkte, 6 Minuspunkte, 48:42 Spiele.
  const teamA: readonly StandingsEncounter[] = [
    homeEncounter("a", "gegner-1", { points: 3, opponentPoints: 0, games: 11, gamesAgainst: 7, legs: 18, legsAgainst: 12 }),
    homeEncounter("a", "gegner-2", { points: 3, opponentPoints: 0, games: 11, gamesAgainst: 7, legs: 18, legsAgainst: 12 }),
    homeEncounter("a", "gegner-3", { points: 3, opponentPoints: 0, games: 10, gamesAgainst: 8, legs: 16, legsAgainst: 14 }),
    homeEncounter("a", "gegner-4", { points: 0, opponentPoints: 3, games: 8, gamesAgainst: 10, legs: 15, legsAgainst: 16 }),
    homeEncounter("a", "gegner-5", { points: 0, opponentPoints: 3, games: 8, gamesAgainst: 10, legs: 15, legsAgainst: 16 }),
  ];
  // Team B: drei Begegnungen mit sudden death (10:9 Spiele, 2:1 Punkte), ein
  // klarer Sieg, eine klare Niederlage -> ebenfalls 9 Pluspunkte und 6
  // Minuspunkte, aber 49:44 Spiele.
  const teamB: readonly StandingsEncounter[] = [
    homeEncounter("b", "gegner-1", { points: 2, opponentPoints: 1, games: 10, gamesAgainst: 9, legs: 17, legsAgainst: 15 }),
    homeEncounter("b", "gegner-2", { points: 2, opponentPoints: 1, games: 10, gamesAgainst: 9, legs: 17, legsAgainst: 15 }),
    homeEncounter("b", "gegner-3", { points: 2, opponentPoints: 1, games: 10, gamesAgainst: 9, legs: 17, legsAgainst: 15 }),
    homeEncounter("b", "gegner-4", { points: 3, opponentPoints: 0, games: 11, gamesAgainst: 7, legs: 17, legsAgainst: 13 }),
    homeEncounter("b", "gegner-5", { points: 0, opponentPoints: 3, games: 8, gamesAgainst: 10, legs: 12, legsAgainst: 16 }),
  ];

  it("stellt bei gleichen Plus- und Minuspunkten die Mannschaft mit mehr gewonnenen Spielen vor (Kriterium 3)", () => {
    const table = calculateStandings({ teamIds: ["a", "b"], encounters: [...teamA, ...teamB] });

    expect(table.map((row) => row.teamId)).toEqual(["b", "a"]);
    expect(table[0]).toMatchObject({
      teamId: "b", points: 9, minusPoints: 6, gamesFor: 49, gamesAgainst: 44, legsFor: 80, legsAgainst: 74, rank: 1,
    });
    expect(table[1]).toMatchObject({
      teamId: "a", points: 9, minusPoints: 6, gamesFor: 48, gamesAgainst: 42, legsFor: 82, legsAgainst: 70, rank: 2,
    });
  });

  it("stellt bei gleichen Pluspunkten die Mannschaft mit weniger Minuspunkten vor (Kriterium 2 schlägt Kriterium 3)", () => {
    // Team C: drei klare Siege, keine Niederlage -> 9 Pluspunkte, 0 Minuspunkte,
    // aber nur 33 gewonnene Spiele gegen 48 von Team A.
    const teamC: readonly StandingsEncounter[] = [
      homeEncounter("c", "gegner-1", { points: 3, opponentPoints: 0, games: 11, gamesAgainst: 7, legs: 18, legsAgainst: 12 }),
      homeEncounter("c", "gegner-2", { points: 3, opponentPoints: 0, games: 11, gamesAgainst: 7, legs: 18, legsAgainst: 12 }),
      homeEncounter("c", "gegner-3", { points: 3, opponentPoints: 0, games: 11, gamesAgainst: 7, legs: 18, legsAgainst: 12 }),
    ];
    const table = calculateStandings({ teamIds: ["a", "c"], encounters: [...teamA, ...teamC] });

    expect(table.map((row) => row.teamId)).toEqual(["c", "a"]);
    expect(table[0]).toMatchObject({ teamId: "c", points: 9, minusPoints: 0, gamesFor: 33 });
    expect(table[1]).toMatchObject({ teamId: "a", points: 9, minusPoints: 6, gamesFor: 48 });
  });
});
```

Ausserdem in derselben Datei zwei bestehende Testtitel auf das Reglement
umstellen — die Erwartungen bleiben, weil beide Fälle unter A1.5 dasselbe
Ergebnis liefern (Punkte 3 gegen 1; danach 4 gegen 3 gewonnene Spiele):

- `it("orders by points before game difference", …)` → `it("ordnet zuerst nach Pluspunkten (A1.5, Kriterium 1)", …)`
- `it("breaks equal points by game difference, then by leg difference", …)` → `it("bricht Punktgleichheit über gewonnene Spiele (A1.5, Kriterium 3)", …)`

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `pnpm --filter @darts-platform/league-engine test`
Expected: FAIL — beide neuen Tests. Der erste meldet
`expected [ 'a', 'b' ] to deep equal [ 'b', 'a' ]` (die alte Sortierung stellt A
wegen der besseren Differenz +6 gegen +5 vor), der zweite zusätzlich
`minusPoints: undefined`.

- [ ] **Step 3: `standings.ts` auf A1.5 umstellen**

`StandingsRow` um `minusPoints` erweitern (direkt nach `points`):

```ts
  readonly points: number;
  /**
   * Reglement A1.4/A1.5, zweites Rangierungskriterium. Die Minuspunkte einer
   * Begegnung sind die Pluspunkte des Gegners: 3:3 bei klarem Ausgang, 1:1 beim
   * Unentschieden, dazu 1 Zusatzpunkt und 1 Minuspunkt aus dem sudden death.
   * Abgeleitet statt aus der Punkteregel gerechnet, damit die Tabelle auch bei
   * abweichender Punktevergabe stimmt.
   */
  readonly minusPoints: number;
```

`Tally` und `emptyTally` um `minusPoints` erweitern:

```ts
interface Tally {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  minusPoints: number;
  gamesFor: number;
  gamesAgainst: number;
  legsFor: number;
  legsAgainst: number;
}

function emptyTally(): Tally {
  return {
    played: 0, won: 0, drawn: 0, lost: 0, points: 0, minusPoints: 0,
    gamesFor: 0, gamesAgainst: 0, legsFor: 0, legsAgainst: 0,
  };
}
```

In `calculateStandings` beide Seitenobjekte um `pointsAgainst` ergänzen — die
Heimseite bekommt `encounter.awayPoints`, die Gastseite `encounter.homePoints`:

```ts
      {
        tally: tallies.get(encounter.homeTeamId),
        points: encounter.homePoints,
        pointsAgainst: encounter.awayPoints,
        gamesFor: encounter.homeGames,
        ...
      },
      {
        tally: tallies.get(encounter.awayTeamId),
        points: encounter.awayPoints,
        pointsAgainst: encounter.homePoints,
        gamesFor: encounter.awayGames,
        ...
      },
```

In der Buchungsschleife direkt hinter `side.tally.points += side.points;`:

```ts
      side.tally.minusPoints += side.pointsAgainst;
```

In der `rows`-Bildung hinter `points: tally.points,`:

```ts
      minusPoints: tally.minusPoints,
```

`sortKeys` ersetzen:

```ts
/**
 * Reglement A1.5: Rangierungskriterien in abnehmender Gewichtung — 1. Pluspunkte,
 * 2. Minuspunkte, 3. gewonnene Spiele, 4. verlorene Spiele, 5. gewonnene Sätze,
 * 6. verlorene Sätze. Kriterien, bei denen weniger besser ist, stehen negiert im
 * Schlüssel, damit `compareKeys` durchgehend absteigend vergleicht.
 *
 * Eine Differenz kennt A1.5 an keiner Stelle; `gameDifference` und
 * `legDifference` bleiben Anzeigewerte auf der Zeile und bestimmen keinen Rang.
 *
 * „Sätze" des Reglements sind die Legs dieser Engine: A1.2 spielt jedes Spiel
 * auf zwei Gewinnsätze, A1.3 kommt darum bei 18 Spielen auf höchstens 36 —
 * genau die Zahl, die `legsFor`/`legsAgainst` je Begegnung tragen.
 */
function sortKeys(row: StandingsRow): readonly number[] {
  return [
    row.points,
    -row.minusPoints,
    row.gamesFor,
    -row.gamesAgainst,
    row.legsFor,
    -row.legsAgainst,
  ];
}
```

Im Dateikopf-Kommentar den Verweis ergänzen, damit die Datei nicht länger ohne
Reglementsbeleg dasteht: nach „gibt die geordnete Tabelle zurück" den Satz
„Rangkriterien nach `Reglement A1.5`, Punktevergabe nach `Reglement A1.4`."
anfügen.

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `pnpm --filter @darts-platform/league-engine test`
Expected: PASS, alle Tests des Pakets grün (die beiden umbenannten inklusive).

- [ ] **Step 5: Vertrag und Anzeige nachziehen**

`packages/schemas/src/league.ts`, in `standingsRowSchema` direkt nach `points`:

```ts
  points: z.number().int().nonnegative(),
  /** Reglement A1.5, zweites Rangierungskriterium. */
  minusPoints: z.number().int().nonnegative(),
```

`apps/api/src/competitions/competitions.service.ts` braucht keine Änderung —
`standings()` spreizt die Engine-Zeile (`...row`) in die Antwort.

`apps/web/src/components/league/standings-table.tsx`: die Spalte „Diff" trägt
eine Zahl, die keinen Rang mehr bestimmt, und stünde damit irreführend neben
der Rangfolge. Kopfzeile ersetzen:

```tsx
                <th className="py-2 pr-3 text-right" scope="col">Minus</th>
```

und die zugehörige Zelle:

```tsx
                  <td className="py-3 pr-3 text-right font-numerals tabular text-wedge-900">
                    {row.minusPoints}
                  </td>
```

- [ ] **Step 6: Vollständige Prüfung**

Run: `pnpm lint`
Run: `pnpm typecheck`
Run: `pnpm test`
Expected: alles grün. Schlägt `apps/api/src/competitions/competitions.integration.spec.ts`
fehl, weil eine Zeile ohne `minusPoints` geparst wird, fehlt der Wert im
Engine-Rückgabeobjekt — Step 3 nachprüfen, nicht das Schema aufweichen.

- [ ] **Step 7: Commit**

```bash
git add packages/league-engine/src/standings.ts packages/league-engine/src/standings.spec.ts packages/schemas/src/league.ts apps/web/src/components/league/standings-table.tsx
git commit -m "fix(league-engine): Ligatabelle nach Reglement A1.5 rangieren"
```

---

### Task 2: Checkout-Kennzahlen unter Single Out (Befund D-I5)

**Was ist:** `checkoutAttemptsFromDarts` (`packages/scoring-engine/src/x01.ts:375`)
liefert unter `SINGLE` immer 0; ohne Wurfdaten setzt die Engine mangels
`checkoutDouble` ebenfalls 0. `packages/statistics/src/statistics.ts:56` teilt
darauf. Eine Spielerin der Klasse C (501 SO, Reglement 1.1) sieht nach 60
gewonnenen Legs `checkouts: 0` und `checkoutPercentage: 0` — eine glatte Null
neben einem korrekten `highFinish`, im Ranking direkt neben 38 % einer
Klasse-A-Spielerin. Die Quote ist unter Straight Out fachlich **nicht
definiert**, nicht null.

**Umfang der Nullbarkeit:** Der Bericht nennt `checkoutPercentage` und
`checkouts`. `checkoutAttempts` kommt hinzu, weil die Fläche die Kennzahl als
„`checkouts` von `checkoutAttempts`" beschriftet — eine nicht definierte Quote
über einer Notiz „0 von 0" widerspräche sich selbst. Alle drei Werte sind
deshalb gemeinsam `null`, sobald keine einzige Aufnahme aus einem Match mit
Ausgangsregel `DOUBLE` oder `MASTER` vorliegt.

**Woher die Regel kommt:** `StatisticsVisit` trägt sie nicht, `StatisticsMatch`
kann sie tragen: `matches.out_rule` existiert seit Bestehen der Tabelle
(`packages/database/src/schema.ts:313`), `MatchStateResponse` führt `outRule`
(`packages/schemas/src/match.ts`, `matchStateSchema`). Beide Verbraucher —
API-Service und Worker — kommen ohne Migration daran.

**Files:**
- Modify: `packages/statistics/src/statistics.ts:1-11` (Typen), `:27-28`, `:46-56`, `:78-79`
- Test: `packages/statistics/src/statistics.spec.ts`
- Modify: `packages/schemas/src/statistics.ts:3-8`
- Modify: `apps/api/src/statistics/statistics.service.ts:35-45`
- Modify: `apps/worker/src/statistics/build-statistics-matches.ts:3-7`, `:75-79`
- Modify: `apps/worker/src/main.ts:13`
- Modify: `apps/web/src/components/player-profile.tsx:39`
- Modify: `DATABASE_SCHEMA.md`, Abschnitt 10, Unterabschnitt „Visit-Kommando: `checkoutAttempts` — zwei Einheiten in einer Spalte"

**Interfaces:**
- Consumes: nichts aus früheren Tasks.
- Produces:
  - `StatisticsMatch` trägt zusätzlich `readonly outRule: "SINGLE" | "DOUBLE" | "MASTER"`.
  - `CareerStatistics.checkoutPercentage`, `.checkoutAttempts`, `.checkouts` haben
    den Typ `number | null`.
  - `CompletedMatchRow` (Worker) trägt zusätzlich `readonly outRule: string`.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

An `packages/statistics/src/statistics.spec.ts` anfügen. Die beiden bestehenden
Tests bekommen zusätzlich das neue Pflichtfeld `outRule: "DOUBLE"` in ihrem
`StatisticsMatch`-Literal (erster Test: `id: "m1"`, zweiter: `id: "legacy"`) —
sonst kompiliert die Datei nicht.

```ts
  it("weist die Checkout-Kennzahlen unter Single Out als nicht anwendbar aus", () => {
    // Reglement 1.1, Klasse C: 501 SO. Unter Straight Out gibt es keinen
    // Doppelversuch, den man zaehlen koennte -- die Quote ist nicht definiert.
    const match: StatisticsMatch = {
      id: "single-out", completedAt: new Date("2026-02-01T12:00:00Z"), winnerPlayerId: "a",
      outRule: "SINGLE",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 }, { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 }],
      legs: [{ id: "l1", winnerPlayerId: "a" }],
      visits: [
        { legId: "l1", playerId: "a", appliedPoints: 180, dartsThrown: 3, checkoutAttempts: 0, outcome: "SCORED", reverted: false },
        { legId: "l1", playerId: "a", appliedPoints: 321, dartsThrown: 3, checkoutAttempts: 0, outcome: "MATCH_WON", reverted: false },
      ],
    };
    const career = calculatePlayerStatistics("a", [match]).career;

    expect(career.checkoutPercentage).toBeNull();
    expect(career.checkoutAttempts).toBeNull();
    expect(career.checkouts).toBeNull();
    // Alles andere bleibt auswertbar.
    expect(career).toMatchObject({ matchesPlayed: 1, wins: 1, oneEighties: 1, highFinish: 321, bestLeg: 6 });
  });

  it("zaehlt nur Aufnahmen aus Matches mit Doppel- oder Master-Out in die Quote", () => {
    const singleOut: StatisticsMatch = {
      id: "single-out", completedAt: new Date("2026-02-01T12:00:00Z"), winnerPlayerId: "a",
      outRule: "SINGLE",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 }, { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 }],
      legs: [{ id: "l1", winnerPlayerId: "a" }],
      visits: [{ legId: "l1", playerId: "a", appliedPoints: 40, dartsThrown: 2, checkoutAttempts: 0, outcome: "MATCH_WON", reverted: false }],
    };
    const doubleOut: StatisticsMatch = {
      id: "double-out", completedAt: new Date("2026-02-02T12:00:00Z"), winnerPlayerId: "a",
      outRule: "DOUBLE",
      participants: [{ playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 }, { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 }],
      legs: [{ id: "l2", winnerPlayerId: "a" }],
      visits: [{ legId: "l2", playerId: "a", appliedPoints: 40, dartsThrown: 2, checkoutAttempts: 2, outcome: "MATCH_WON", reverted: false }],
    };
    const career = calculatePlayerStatistics("a", [singleOut, doubleOut]).career;

    // Zwei Darts auf ein Finish, ein erfolgreiches Checkout -> 50 %.
    expect(career).toMatchObject({ checkoutAttempts: 2, checkouts: 1, checkoutPercentage: 50 });
  });
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `pnpm --filter @darts-platform/statistics test`
Expected: FAIL — TypeScript meldet `outRule` als unbekannte Eigenschaft in
`StatisticsMatch`; nach dem Typfehler zusätzlich
`expected 0 to be null` für `checkoutPercentage`.

- [ ] **Step 3: `packages/statistics/src/statistics.ts` umstellen**

`StatisticsMatch` um die Ausgangsregel erweitern:

```ts
export interface StatisticsMatch {
  readonly id: string;
  readonly completedAt: Date;
  /**
   * Die Ausgangsregel des Matches (`matches.out_rule`). Unter `SINGLE`
   * (Reglement 1.1, Klasse C: 501 SO) gibt es keinen Doppelversuch: die
   * Scoring Engine liefert dort per Konstruktion 0 Versuche
   * (`checkoutAttemptsFromDarts`), eine Checkout-Quote ist fachlich nicht
   * definiert. Solche Matches zaehlen deshalb nicht in die Checkout-Kennzahlen.
   */
  readonly outRule: "SINGLE" | "DOUBLE" | "MASTER";
  readonly winnerPlayerId: string;
  readonly participants: readonly [StatisticsParticipant, StatisticsParticipant];
  readonly legs: readonly StatisticsLeg[];
  readonly visits: readonly StatisticsVisit[];
}
```

`CareerStatistics` auf nullbare Checkout-Kennzahlen umstellen:

```ts
  /**
   * Die drei Checkout-Kennzahlen sind `null`, wenn keine einzige gewertete
   * Aufnahme aus einem Match mit Doppel- oder Master-Out stammt — „nicht
   * anwendbar", nicht „null Checkouts". Siehe DATABASE_SCHEMA.md, Abschnitt 10.
   */
  readonly checkoutPercentage: number | null;
  readonly checkoutAttempts: number | null;
  readonly checkouts: number | null;
```

In `calculatePlayerStatistics` einen Zähler für auswertbare Matches führen. Vor
der Schleife neben `let checkouts = 0;`:

```ts
  let checkoutRatedMatches = 0;
```

In der Schleife den bestehenden Block (heutige Zeilen 46-56) ersetzen:

```ts
    // Einheitenbruch, bewusst in Kauf genommen: `checkoutAttempts` ist bei
    // einer Aufnahme OHNE Einzelwuerfe eine Aufnahmenzahl (0 oder 1), bei
    // einer Aufnahme MIT Einzelwuerfen eine Wurfzahl (0 bis 3, abgeleitet in
    // `checkoutAttemptsFromDarts` der Scoring Engine). Diese Summe mischt
    // ueber den Umstellungszeitpunkt hinweg beide Einheiten, und
    // `checkoutPercentage` unten erbt das. Der Zaehler (`checkouts`) bleibt
    // davon unberuehrt, er zaehlt erfolgreiche Checkout-Aufnahmen. Eine
    // Umrechnung der Historie ist unmoeglich: fuer alte Aufnahmen existieren
    // die Wurfdaten nicht. Siehe DATABASE_SCHEMA.md, Abschnitt 10.
    //
    // Dritte Einheit: unter `SINGLE` gibt es keinen Doppelversuch. Solche
    // Matches fliessen gar nicht erst ein; bleibt am Ende kein einziges
    // gewertetes Match uebrig, sind die drei Kennzahlen `null`.
    if (match.outRule !== "SINGLE") {
      checkoutRatedMatches += 1;
      checkoutAttempts += activeVisits.reduce((sum, visit) => sum + visit.checkoutAttempts, 0);
      checkouts += activeVisits.filter((visit) => visit.checkoutAttempts > 0 && visit.outcome.endsWith("WON")).length;
    }
```

Im `career`-Objekt die drei Werte über den Zähler ausweisen. Dafür oberhalb des
`return` zwei Zeilen einziehen, damit die Rückgabe lesbar bleibt:

```ts
  const checkoutApplicable = checkoutRatedMatches > 0;
  const checkoutPercentage = !checkoutApplicable
    ? null
    : checkoutAttempts === 0
      ? 0
      : rounded(checkouts / checkoutAttempts * 100);
```

und im `career`-Literal `checkoutPercentage: checkoutAttempts === 0 ? 0 : rounded(...)`,
`checkoutAttempts`, `checkouts` ersetzen durch:

```ts
      checkoutPercentage,
      checkoutAttempts: checkoutApplicable ? checkoutAttempts : null,
      checkouts: checkoutApplicable ? checkouts : null,
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `pnpm --filter @darts-platform/statistics test`
Expected: PASS, alle vier Tests des Pakets grün.

- [ ] **Step 5: Vertrag, Verbraucher und Anzeige nachziehen**

`packages/schemas/src/statistics.ts`, `careerStatisticsSchema`:

```ts
  threeDartAverage: z.number().nonnegative(), firstNineAverage: z.number().nonnegative(),
  // Unter Straight Out (Reglement 1.1, Klasse C) ist die Quote nicht definiert.
  checkoutPercentage: z.number().min(0).max(100).nullable(),
  checkoutAttempts: z.number().int().nonnegative().nullable(),
  checkouts: z.number().int().nonnegative().nullable(),
```

`apps/api/src/statistics/statistics.service.ts`, im `statisticsMatches`-Literal
direkt nach `completedAt: state.updatedAt,`:

```ts
        outRule: state.outRule,
```

`apps/worker/src/statistics/build-statistics-matches.ts`: `CompletedMatchRow` um
`readonly outRule: string;` erweitern und im zurückgegebenen `StatisticsMatch`
nach `completedAt: match.completedAt,` einsetzen:

```ts
        outRule: match.outRule === "SINGLE" || match.outRule === "MASTER" ? match.outRule : "DOUBLE",
```

Dazu der Kommentar direkt darüber:

```ts
        // `matches.out_rule` ist `varchar` mit Check-Constraint; die Enge des
        // Typs gehoert an die Domaenengrenze. Der Rueckfall auf DOUBLE trifft
        // nur einen Wert, den die Constraint gar nicht zulaesst.
```

`apps/worker/src/main.ts:13`, die Auswahl der Matchspalten erweitern:

```ts
  const matchRows = await connection.database.select({ id: matches.id, winnerSeat: matches.winnerSeat, completedAt: matches.completedAt, outRule: matches.outRule })
```

`apps/web/src/components/player-profile.tsx:39` — die Kachel zeigt „–", wenn die
Quote nicht anwendbar ist:

```tsx
        <Statistic
          label="Checkout-Quote"
          value={stats.checkoutPercentage === null ? "–" : `${stats.checkoutPercentage.toFixed(1)} %`}
          note={stats.checkouts === null || stats.checkoutAttempts === null ? "Unter Straight Out nicht anwendbar" : `${stats.checkouts} von ${stats.checkoutAttempts}`}
        />
```

- [ ] **Step 6: `DATABASE_SCHEMA.md` ergänzen**

Im Abschnitt 10, Unterabschnitt „Visit-Kommando: `checkoutAttempts` — zwei
Einheiten in einer Spalte", die Aufzählung um einen dritten Punkt erweitern
(nach dem Punkt „Aufnahme mit Einzelwürfen"):

```markdown
- **Aufnahme aus einem Match mit Straight Out** (`matches.out_rule = 'SINGLE'`,
  Reglement 1.1 Klasse C): **keine Einheit** — unter Straight Out schliesst
  jedes Feld, es gibt keinen Doppelversuch. `checkoutAttemptsFromDarts` liefert
  dort per Konstruktion 0, und ohne `checkout_double` bleibt der Wert auch im
  Runden-Modus 0. Eine Quote ist fachlich nicht definiert.
```

und den Abschnitt „Folge für die Auswertung" um den Satz ergänzen:

```markdown
Matches mit `out_rule = 'SINGLE'` fliessen gar nicht erst in die
Checkout-Kennzahlen ein. Hat eine Person ausschliesslich solche Matches
gespielt, liefert `CareerStatistics` für `checkoutPercentage`,
`checkoutAttempts` und `checkouts` jeweils `null` — „nicht anwendbar", nicht
„null Checkouts". Die Fläche zeigt dafür „–".
```

- [ ] **Step 7: Vollständige Prüfung**

Run: `pnpm lint`
Run: `pnpm typecheck`
Run: `pnpm test`
Expected: alles grün. Schlägt eine API-Integrationsprüfung fehl, weil die
Antwort `checkoutPercentage: null` trägt und der Test `0` erwartet, ist der Test
anzupassen — er beschrieb bisher genau den Befund.

- [ ] **Step 8: Commit**

```bash
git add packages/statistics/src/statistics.ts packages/statistics/src/statistics.spec.ts packages/schemas/src/statistics.ts apps/api/src/statistics/statistics.service.ts apps/worker/src/main.ts apps/worker/src/statistics/build-statistics-matches.ts apps/web/src/components/player-profile.tsx DATABASE_SCHEMA.md
git commit -m "fix(statistics): Checkout-Quote unter Straight Out als nicht anwendbar ausweisen"
```

---

### Task 3: Begegnungsvorlage und Rundenfolge in die League-Engine (Befunde D-I4, A-I3, D-M7)

**Was ist:** `buildEncounterTemplate` und `vfcTemplateOptions` — die einzige
Stelle im Repo, die einen Begegnungsplan nach Reglement 2.2.8 erzeugt — liegen
in `apps/web/src/lib/league-template.ts`. Die Engine prüft Lückenlosigkeit, das
vollständige Rundenturnier der Einzel und den Entscheidungsslot, aber **nicht
die Reihenfolge**: eine Vorlage mit 16 Einzeln als Sequenz 1–16 und beiden
Doppeln als 17/18 geht durch, obwohl 2.2.8 sie verbietet. Ebenso geht eine
Vorlage mit **null** regulären Doppeln durch (D-M7) — die Begegnung hätte dann
16 statt 18 Spiele, ein 9:9 nach 2.2.2 wäre unerreichbar, und ein Nichtantritt
würde als 0:16 statt 0:18 gewertet (Reglement 2.5.1).

**Kein `POST /competitions/template-preview`:** Der Vergleich mit
`POST /tournaments/structure-preview` trägt nicht. Die Turniervorschau braucht
den Server, weil sie Teilnehmerdaten und eine gesäte Auslosung
(`randomSeed`, `tournament.ts:205-225`) auswertet, die der Client nicht hat.
`buildEncounterTemplate` ist dagegen eine reine Funktion der Formularwerte ohne
jeden Serverbezug; ein Endpunkt dafür wäre ein Netzwerk-Umweg um einen
Funktionsaufruf. AGENTS.md §4 ist erfüllt, sobald die Regel in der Engine steht
und der Server sie bei `POST`/`PATCH /competitions` prüft — beides leistet
dieser Task. Der Endpunkt entfällt deshalb bewusst.

**Files:**
- Create: `packages/league-engine/src/encounter-template.ts`
- Create: `packages/league-engine/src/encounter-template.spec.ts`
- Modify: `packages/league-engine/src/template.ts:38-95` (`validateEncounterTemplate`), `:155-205` (`validateRoundRobin`)
- Modify: `packages/league-engine/src/template.spec.ts`
- Modify: `packages/league-engine/src/index.ts:10-18`
- Modify: `apps/web/package.json` (Abhängigkeit)
- Modify: `apps/web/src/lib/league-template.ts` (auf `slugFromName` reduzieren)
- Modify: `apps/web/src/lib/league-template.spec.ts` (Vorlagentests entfernen)
- Modify: `apps/web/src/components/league/competition-setup.tsx:23`
- Modify: `apps/api/src/common/league-error.ts:31-49`
- Modify: `package.json` (Repo-Wurzel), Skript `test:e2e`

**Interfaces:**
- Consumes: nichts aus früheren Tasks.
- Produces, exportiert über `packages/league-engine/src/index.ts`:
  - `type StartingScore = 301 | 501 | 701`
  - `interface TemplateOptions { readonly lineupPositions: number; readonly singlesStartingScore: StartingScore; readonly doublesStartingScore: StartingScore; readonly inRule: InRule; readonly outRule: OutRule; readonly bestOfLegs: number; readonly maxRounds: number | null; readonly regularDoubles: number; readonly withDecider: boolean }`
  - `const vfcTemplateOptions: TemplateOptions`
  - `function buildEncounterTemplate(options: TemplateOptions): readonly TemplateSlot[]`
  - `validateEncounterTemplate(slots: readonly TemplateSlot[]): void` — unverändert in
    der Signatur, zusätzlich mit den Fehlercodes `INVALID_ROUND_ORDER` und
    `MISSING_DOUBLES_SLOTS`.

- [ ] **Step 1: Den fehlschlagenden Test für die Rundenfolge schreiben**

An `packages/league-engine/src/template.spec.ts` anfügen. Der Helfer, mit dem
die Datei ihre Vorlagen baut, heisst dort bereits so oder ähnlich — falls kein
passender existiert, den folgenden lokal in den neuen `describe`-Block setzen:

```ts
describe("Rundenfolge nach Reglement 2.2.8", () => {
  function singlesSlot(sequence: number, homePosition: number, awayPosition: number): TemplateSlot {
    return {
      sequence, role: "REGULAR", discipline: "SINGLES",
      label: `Einzel ${sequence}`, homePosition, awayPosition,
      startingScore: 501, inRule: "DOUBLE", outRule: "DOUBLE", maxRounds: null,
      bestOfLegs: 3, legsToWinSet: 2, setsToWin: 1,
    };
  }
  function doublesSlot(sequence: number, role: SlotRole): TemplateSlot {
    return {
      sequence, role, discipline: "DOUBLES",
      label: role === "DECIDER" ? "Entscheidungsdoppel" : `Doppel ${sequence}`,
      homePosition: null, awayPosition: null,
      startingScore: 701, inRule: "DOUBLE", outRule: "DOUBLE", maxRounds: null,
      bestOfLegs: 3, legsToWinSet: 2, setsToWin: 1,
    };
  }

  it("lehnt 16 Einzel am Stueck mit beiden Doppeln am Schluss ab", () => {
    // Genau die Vorlage, die ein fremder Client heute durchbekommt: lueckenlos,
    // vollstaendiges Rundenturnier, DECIDER zuletzt -- aber 2.2.8 verlangt die
    // Doppel nach Runde 2.
    const slots: TemplateSlot[] = [];
    let sequence = 1;
    for (let home = 1; home <= 4; home += 1) {
      for (let away = 1; away <= 4; away += 1) slots.push(singlesSlot(sequence++, home, away));
    }
    slots.push(doublesSlot(sequence++, "REGULAR"));
    slots.push(doublesSlot(sequence++, "REGULAR"));
    slots.push(doublesSlot(sequence, "DECIDER"));

    expect(() => validateEncounterTemplate(slots)).toThrowError(
      expect.objectContaining({ code: "INVALID_ROUND_ORDER" }),
    );
  });

  it("lehnt eine Runde ab, in der eine Aufstellungsposition zweimal antritt", () => {
    // 16 Einzel, vollstaendiges Rundenturnier, Doppel an der richtigen Stelle --
    // aber Runde 1 laesst Heimposition 1 zweimal spielen. Reglement 2.2.8 haelt
    // die Runden gerade deshalb sortenrein („Zwecks Zeiteinsparung").
    const pairings: readonly (readonly [number, number])[] = [
      [1, 1], [1, 2], [2, 3], [3, 4],
      [2, 1], [2, 2], [1, 3], [4, 4],
      [3, 1], [3, 2], [3, 3], [2, 4],
      [4, 1], [4, 2], [4, 3], [1, 4],
    ];
    const slots: TemplateSlot[] = [];
    let sequence = 1;
    for (const [home, away] of pairings.slice(0, 8)) slots.push(singlesSlot(sequence++, home, away));
    slots.push(doublesSlot(sequence++, "REGULAR"));
    slots.push(doublesSlot(sequence++, "REGULAR"));
    for (const [home, away] of pairings.slice(8)) slots.push(singlesSlot(sequence++, home, away));
    slots.push(doublesSlot(sequence, "DECIDER"));

    expect(() => validateEncounterTemplate(slots)).toThrowError(
      expect.objectContaining({ code: "INVALID_ROUND_ORDER" }),
    );
  });

  it("lehnt eine Vorlage ohne regulaeres Doppel ab", () => {
    // Reglement 2.2.1 und A1.1: 16 Einzel UND 2 Doppel. Ohne reguläres Doppel
    // kann ein 9:9 nach 2.2.2 nie entstehen und ein Nichtantritt waere 0:16
    // statt 0:18 (2.5.1).
    const slots: TemplateSlot[] = [];
    let sequence = 1;
    for (let round = 1; round <= 4; round += 1) {
      for (let home = 1; home <= 4; home += 1) {
        slots.push(singlesSlot(sequence++, home, ((home + round - 2) % 4) + 1));
      }
    }
    slots.push(doublesSlot(sequence, "DECIDER"));

    expect(() => validateEncounterTemplate(slots)).toThrowError(
      expect.objectContaining({ code: "MISSING_DOUBLES_SLOTS" }),
    );
  });

  it("nimmt die Vorlage der Ligagruppe an", () => {
    expect(() => validateEncounterTemplate(buildEncounterTemplate(vfcTemplateOptions))).not.toThrow();
  });
});
```

Die Importzeile der Datei um `buildEncounterTemplate`, `vfcTemplateOptions`,
`type SlotRole` und `type TemplateSlot` erweitern (aus `./encounter-template.js`
bzw. `./template.js`, je nach Herkunft).

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `pnpm --filter @darts-platform/league-engine test`
Expected: FAIL — `Cannot find module './encounter-template.js'`; nach Anlegen der
Datei zusätzlich „expected [Function] to throw an error" für die drei
Ablehnungen.

- [ ] **Step 3: `packages/league-engine/src/encounter-template.ts` anlegen**

Der Inhalt ist der bisherige Web-Code, auf den Engine-Typ `TemplateSlot`
umgestellt (die Engine hängt nicht an `packages/schemas`; `TemplateSlot` und
`CompetitionSlotInput` tragen dieselben Felder in denselben Typen):

```ts
import type { InRule, OutRule, TemplateSlot } from "./template.js";

export type StartingScore = 301 | 501 | 701;

export interface TemplateOptions {
  readonly lineupPositions: number;
  readonly singlesStartingScore: StartingScore;
  readonly doublesStartingScore: StartingScore;
  readonly inRule: InRule;
  readonly outRule: OutRule;
  readonly bestOfLegs: number;
  readonly maxRounds: number | null;
  readonly regularDoubles: number;
  readonly withDecider: boolean;
}

/**
 * Reglement 2.2.8, Nationalliga (1.1): vier Runden zu vier Einzel 501 DI/DO,
 * die beiden Doppel 701 nach Runde 2, bei Gleichstand ein Entscheidungsdoppel
 * (2.2.2). Jedes Spiel geht auf zwei Gewinnsätze (A1.2), insgesamt 16 Einzel
 * und 2 Doppel (2.2.1, A1.1).
 */
export const vfcTemplateOptions: TemplateOptions = {
  lineupPositions: 4,
  singlesStartingScore: 501,
  doublesStartingScore: 701,
  inRule: "DOUBLE",
  outRule: "DOUBLE",
  bestOfLegs: 3,
  maxRounds: null,
  regularDoubles: 2,
  withDecider: true,
};

/**
 * Baut die Begegnungsvorlage. Die Einzel sind ein vollständiges Rundenturnier:
 * in Runde `r` trifft Heimposition `i` auf Gastposition `((i + r - 2) mod n) + 1`.
 * Über `n` Runden tritt damit jede Heimposition genau einmal gegen jede
 * Gastposition an, und in jeder Runde spielt jede Position genau einmal — der
 * Grund für die Reihenfolge in Reglement 2.2.8 („Zwecks Zeiteinsparung").
 * Die regulären Doppel folgen nach Runde `ceil(n / 2)`, das Entscheidungsdoppel
 * steht zuletzt. `validateEncounterTemplate` prüft genau diese Gestalt.
 */
export function buildEncounterTemplate(options: TemplateOptions): readonly TemplateSlot[] {
  const positions = options.lineupPositions;
  const doublesAfterRound = Math.ceil(positions / 2);
  const legsToWinSet = Math.ceil(options.bestOfLegs / 2);
  const slots: TemplateSlot[] = [];
  let sequence = 1;
  let singlesNumber = 1;
  let doublesNumber = 1;

  const singles = (homePosition: number, awayPosition: number): TemplateSlot => ({
    sequence: sequence++,
    role: "REGULAR",
    discipline: "SINGLES",
    label: `Einzel ${singlesNumber++} · Heim ${homePosition} gegen Gast ${awayPosition}`,
    homePosition,
    awayPosition,
    startingScore: options.singlesStartingScore,
    inRule: options.inRule,
    outRule: options.outRule,
    maxRounds: options.maxRounds,
    bestOfLegs: options.bestOfLegs,
    legsToWinSet,
    setsToWin: 1,
  });

  const doubles = (role: "REGULAR" | "DECIDER"): TemplateSlot => ({
    sequence: sequence++,
    role,
    discipline: "DOUBLES",
    label: role === "DECIDER" ? "Entscheidungsdoppel" : `Doppel ${doublesNumber++}`,
    homePosition: null,
    awayPosition: null,
    startingScore: options.doublesStartingScore,
    inRule: options.inRule,
    outRule: options.outRule,
    maxRounds: options.maxRounds,
    bestOfLegs: options.bestOfLegs,
    legsToWinSet,
    setsToWin: 1,
  });

  for (let round = 1; round <= positions; round += 1) {
    for (let home = 1; home <= positions; home += 1) {
      slots.push(singles(home, ((home + round - 2) % positions) + 1));
    }
    if (round === doublesAfterRound) {
      for (let index = 0; index < options.regularDoubles; index += 1) slots.push(doubles("REGULAR"));
    }
  }
  if (options.withDecider) slots.push(doubles("DECIDER"));
  return slots;
}
```

- [ ] **Step 4: `validateEncounterTemplate` um 2.2.8 und 2.2.1 erweitern**

In `packages/league-engine/src/template.ts` die Ableitung der
Aufstellungspositionen aus `validateRoundRobin` herausziehen, damit beide
Prüfungen dieselbe Zahl verwenden:

```ts
/** Die Zahl der Aufstellungspositionen steht in der Vorlage selbst, nicht daneben. */
function lineupPositions(singles: readonly TemplateSlot[]): number {
  let positions = 0;
  for (const slot of singles) {
    positions = Math.max(positions, slot.homePosition ?? 0, slot.awayPosition ?? 0);
  }
  return positions;
}
```

`validateRoundRobin` nimmt `positions` künftig als zweiten Parameter entgegen
und lässt die eigene Berechnung fallen; der Aufruf am Ende von
`validateEncounterTemplate` wird ersetzt durch:

```ts
  const singles = slots.filter((slot) => slot.role === "REGULAR" && slot.discipline === "SINGLES");
  if (singles.length === 0) {
    throw new LeagueValidationError(
      "MISSING_SINGLES_SLOTS",
      "Eine Vorlage braucht mindestens einen Einzelslot.",
    );
  }
  const positions = lineupPositions(singles);
  validateRoundRobin(singles, positions);
  validateRoundOrder(slots, positions);
```

(Der `MISSING_SINGLES_SLOTS`-Wurf wandert damit aus `validateRoundRobin` nach
oben; die Funktion selbst beginnt neu bei der Duplikatprüfung.)

Neue Funktion, unterhalb von `validateRoundRobin`:

```ts
/**
 * Reglement 2.2.8: „Runde 1: 4 Einzel, Runde 2: 4 Einzel, 2 Doppel, Runde 3:
 * 4 Einzel, Runde 4: 4 Einzel, evtl. sudden death." Verallgemeinert auf `n`
 * Aufstellungspositionen: `n` Runden zu `n` Einzeln, die regulären Doppel nach
 * Runde `ceil(n / 2)`, das Entscheidungsdoppel zuletzt (dessen Position prüft
 * bereits `DECIDER_NOT_LAST`). Innerhalb einer Runde tritt jede Heim- und jede
 * Gastposition genau einmal an — das ist der Zweck der Reihenfolge, niemand
 * steht zweimal hintereinander an der Scheibe.
 *
 * Reglement 2.2.1 und A1.1 verlangen ausserdem Doppelbegegnungen neben den
 * Einzeln. Ohne reguläres Doppel kann ein 9:9 nach 2.2.2 nie entstehen, und ein
 * Nichtantritt nach 2.5.1 wäre 0:16 statt 0:18. Die Ligavorlage setzt zwei
 * (`vfcTemplateOptions.regularDoubles`); die Engine verlangt mindestens eins,
 * damit auch kleinere Aufstellungen abbildbar bleiben.
 */
function validateRoundOrder(slots: readonly TemplateSlot[], positions: number): void {
  const ordered = [...slots].sort((left, right) => left.sequence - right.sequence);
  const regular = ordered.filter((slot) => slot.role !== "DECIDER");
  const regularDoubles = regular.filter((slot) => slot.discipline === "DOUBLES");
  if (regularDoubles.length === 0) {
    throw new LeagueValidationError(
      "MISSING_DOUBLES_SLOTS",
      "Eine Vorlage braucht mindestens ein reguläres Doppel (Reglement 2.2.1, A1.1).",
    );
  }

  const doublesAfterRound = Math.ceil(positions / 2);
  const expected: readonly Discipline[] = [
    ...Array.from({ length: positions * doublesAfterRound }, (): Discipline => "SINGLES"),
    ...Array.from({ length: regularDoubles.length }, (): Discipline => "DOUBLES"),
    ...Array.from({ length: positions * (positions - doublesAfterRound) }, (): Discipline => "SINGLES"),
  ];
  if (regular.length !== expected.length) {
    throw new LeagueValidationError(
      "INVALID_ROUND_ORDER",
      `Bei ${positions} Aufstellungspositionen trägt die Vorlage ${expected.length} reguläre Spiele, nicht ${regular.length}.`,
    );
  }
  for (const [index, discipline] of expected.entries()) {
    const slot = regular[index];
    if (slot === undefined || slot.discipline !== discipline) {
      throw new LeagueValidationError(
        "INVALID_ROUND_ORDER",
        `Reglement 2.2.8: an Sequenz ${index + 1} steht ${discipline === "SINGLES" ? "ein Einzel" : "ein Doppel"}.`,
      );
    }
  }

  const singles = regular.filter((slot) => slot.discipline === "SINGLES");
  for (let round = 0; round < positions; round += 1) {
    const inRound = singles.slice(round * positions, (round + 1) * positions);
    const homes = new Set(inRound.map((slot) => slot.homePosition));
    const aways = new Set(inRound.map((slot) => slot.awayPosition));
    if (homes.size !== positions || aways.size !== positions) {
      throw new LeagueValidationError(
        "INVALID_ROUND_ORDER",
        `Reglement 2.2.8: in Runde ${round + 1} tritt jede Aufstellungsposition genau einmal an.`,
      );
    }
  }
}
```

Den Kopfkommentar von `validateEncounterTemplate` ergänzen: „… sowie das
vollständige Rundenturnier der Einzel **und die Rundenfolge nach Reglement
2.2.8**."

- [ ] **Step 5: Test laufen lassen und Erfolg bestätigen**

Run: `pnpm --filter @darts-platform/league-engine test`
Expected: PASS für die vier neuen Tests. Schlagen **bestehende** Tests in
`template.spec.ts` fehl, weil sie Vorlagen ohne reguläres Doppel oder mit
beliebiger Reihenfolge als gültig annahmen, sind diese Vorlagen auf die
Ligagestalt zu bringen (`buildEncounterTemplate` mit passenden Optionen) — die
Prüfung ist neu und richtig, der Test beschrieb die Lücke.

- [ ] **Step 6: Die Vorlagentests aus dem Web in die Engine holen**

`packages/league-engine/src/encounter-template.spec.ts` anlegen. Inhalt: die
sechs `describe("buildEncounterTemplate")`-Tests aus
`apps/web/src/lib/league-template.spec.ts:7-80`, unverändert bis auf die
Importzeile:

```ts
import { describe, expect, it } from "vitest";

import { buildEncounterTemplate, vfcTemplateOptions } from "./encounter-template.js";
```

Der letzte dieser Tests („kommt auch ohne Entscheidungsdoppel und mit anderer
Groesse aus") baut mit `lineupPositions: 2, regularDoubles: 1, withDecider: false`
fünf Slots — diese Vorlage muss `validateEncounterTemplate` bestehen. Deshalb
den Test um eine Zeile erweitern:

```ts
    expect(() => validateEncounterTemplate(small)).not.toThrow();
```

und `validateEncounterTemplate` aus `./template.js` mitimportieren.

In `apps/web/src/lib/league-template.spec.ts` den gesamten
`describe("buildEncounterTemplate", …)`-Block (Zeilen 7-80) streichen. Die
Blöcke `describe("slugFromName")` und `describe("die erzeugte Vorlage gegen den
API-Vertrag")` bleiben — der zweite prüft die Engine-Vorlage gegen
`createCompetitionSchema` aus `packages/schemas` und gehört damit weiterhin in
die Web-App. Seine Importzeile wird zu:

```ts
import { buildEncounterTemplate, vfcTemplateOptions } from "@darts-platform/league-engine";

import { slugFromName } from "./league-template";
```

- [ ] **Step 7: Exporte, Web-Abhängigkeit und Fehlerabbildung**

`packages/league-engine/src/index.ts`, nach dem `template.js`-Export einfügen:

```ts
export {
  buildEncounterTemplate,
  vfcTemplateOptions,
  type StartingScore,
  type TemplateOptions,
} from "./encounter-template.js";
```

`apps/web/package.json`, in `dependencies` alphabetisch einsortiert:

```json
    "@darts-platform/league-engine": "workspace:*",
```

danach `pnpm install` ausführen.

`apps/web/src/lib/league-template.ts` auf `slugFromName` reduzieren: die Zeilen
1-93 (Import, `StartingScore`, `TemplateOptions`, `vfcTemplateOptions`,
`buildEncounterTemplate`) entfernen; `slugReplacements` und `slugFromName`
bleiben stehen.

`apps/web/src/components/league/competition-setup.tsx:23` — der Import wird
aufgeteilt:

```tsx
import { buildEncounterTemplate, type StartingScore } from "@darts-platform/league-engine";

import { slugFromName } from "@/lib/league-template";
```

(Die zweite Zeile gehört zu den bestehenden `@/`-Importen der Datei.) Der Aufruf
in `useMemo` und die Verwendung von `slots` in `TemplateTable` und
`createCompetitionSchema.safeParse` bleiben unverändert: `TemplateSlot` trägt
dieselben Felder wie `TemplateRow` und `CompetitionSlotInput`.

`apps/api/src/common/league-error.ts`, in `apiErrors` bei den Template-Codes
ergänzen:

```ts
  INVALID_ROUND_ORDER: { code: "TEMPLATE_INVALID", status: 422 },
  MISSING_DOUBLES_SLOTS: { code: "TEMPLATE_INVALID", status: 422 },
```

(Bewusst auf den bestehenden Aussencode `TEMPLATE_INVALID` abgebildet, damit der
API-Vertrag nach §15 nicht ohne Not um zwei Codes wächst.)

`package.json` (Repo-Wurzel), Skript `test:e2e`: das Web-Bundle hängt jetzt an
`league-engine`, das Skript baut aber eine feste Paketliste ohne Turbo-Auflösung.
`--filter=@darts-platform/league-engine` hinter `--filter=@darts-platform/scoring-engine`
einfügen.

- [ ] **Step 8: Vollständige Prüfung**

Run: `pnpm --filter @darts-platform/league-engine test`
Run: `pnpm --filter @darts-platform/web test`
Run: `pnpm lint`
Run: `pnpm typecheck`
Run: `pnpm test`
Expected: alles grün.

- [ ] **Step 9: Commit**

```bash
git add packages/league-engine/src/encounter-template.ts packages/league-engine/src/encounter-template.spec.ts packages/league-engine/src/template.ts packages/league-engine/src/template.spec.ts packages/league-engine/src/index.ts apps/web/package.json apps/web/src/lib/league-template.ts apps/web/src/lib/league-template.spec.ts apps/web/src/components/league/competition-setup.tsx apps/api/src/common/league-error.ts package.json pnpm-lock.yaml
git commit -m "refactor(league-engine): Begegnungsvorlage und Rundenfolge nach Reglement 2.2.8 in die Engine"
```

---

### Task 4: Ausbullen beim Entscheidungsdoppel (Befund D-I3)

**Was ist:** Reglement 2.2.9 nimmt das Entscheidungsdoppel ausdrücklich von der
Heim-/Gast-Regel aus: „Ausgenommen von dieser Regel ist das Entscheidungs-Doppel
sudden death. Der Spielbeginn wird beim sudden death **immer** durch Wurf auf
Bull entschieden." Die Engine lehnt `DECIDE_LEG_START` für `legNumber < 3` hart
mit `LEG_START_FIXED` ab (`packages/scoring-engine/src/x01.ts`, `activeCommands`),
und `apps/api/src/encounters/encounters.repository.ts` legt für **jeden** Slot —
auch den DECIDER — `startingSeat: 1` an. Gewinnt das Gastteam das Ausbullen und
wählt den Anwurf, kann die Fläche das nicht erfassen. Bei 701 DI/DO ist der
Anwurf einen halben Durchgang wert, und das Doppel entscheidet die ganze
Begegnung (2.2.2: 2:1 statt 1:2 Punkte).

**Replay-Sicherheit:** Das Flag ist eine **Match-Regel** wie `inRule`, kein Teil
des Kommandos. Gespeicherte Kommandos (`score_commands.payload`) ändern sich
nicht und werten unverändert; `storedLegStartSchema` bleibt, wie es ist. Ein
Bestandsmatch trägt nach der Migration `false` und verhält sich exakt wie bisher.

**Keine Web-Änderung:** Eine Bedienoberfläche für `DECIDE_LEG_START` existiert
heute nicht (`grep` über `apps/web/src` findet weder „leg-start" noch
„Ausbullen"); der Weg läuft über `POST /organizations/:id/matches/:id/leg-start`.
Das Flag wird trotzdem in `matchStateSchema` ausgewiesen, damit eine spätere
Fläche das Ausbullen ab Leg 1 anbieten kann, ohne die Regel erneut abzuleiten.

**Files:**
- Modify: `packages/database/src/schema.ts` (Tabelle `matches`, nach `outRule`)
- Create: `packages/database/drizzle/0024_league_decider_bull_off.sql`, `packages/database/drizzle/meta/0024_snapshot.json`, Eintrag in `packages/database/drizzle/meta/_journal.json`
- Modify: `packages/scoring-engine/src/x01.ts:13-20` (`X01Rules`), `:81-91` (Kommentar `DecideLegStartCommand`), `:192-210` (`assertRules`), `:246-266` (`createX01Match`), `:653-676` (`activeCommands`), `:766`, `:1052`
- Test: `packages/scoring-engine/src/x01.spec.ts:63-73` (Helfer), neue Tests
- Modify: `packages/schemas/src/match.ts:62-72` (`decideLegStartSchema`), `:133-145` (`matchStateSchema`)
- Modify: `apps/api/src/matches/matches.repository.ts:259-262` (Antwort), `:1152-1168` (`aggregate`)
- Modify: `apps/api/src/encounters/encounters.repository.ts:772-788`
- Test: `apps/api/src/encounters/encounters.integration.spec.ts`
- Modify: `DATABASE_SCHEMA.md` (Tabelle `matches`)

**Interfaces:**
- Consumes: nichts aus früheren Tasks.
- Produces:
  - `X01Rules` trägt zusätzlich `readonly bullOffFromLegOne: boolean` (**Pflichtfeld**,
    kein optionales — AGENTS.md §5 verlangt explizite Typen an der Domänengrenze;
    es gibt genau drei Konstruktionsstellen).
  - `matchStateSchema` trägt `bullOffFromLegOne: z.boolean()`, also
    `MatchStateResponse.bullOffFromLegOne: boolean`.
  - `decideLegStartSchema.legNumber` akzeptiert ab 1; die Regelprüfung liegt
    serverseitig in der Engine, nicht im Vertrag.
  - DB: `matches.bull_off_from_leg_one boolean NOT NULL DEFAULT false`.

- [ ] **Step 1: Den fehlschlagenden Engine-Test schreiben**

In `packages/scoring-engine/src/x01.spec.ts` zuerst den Helfer `rules()`
(Zeilen 63-73) um das Pflichtfeld ergänzen:

```ts
function rules(overrides: Partial<X01Rules> = {}): X01Rules {
  return {
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    maxRounds: null,
    legsToWinSet: 1,
    setsToWin: 1,
    bullOffFromLegOne: false,
    ...overrides,
  };
}
```

Dann neben den bestehenden Legbeginn-Tests anfügen:

```ts
  it("laesst das sudden-death-Doppel schon Leg eins ausbullen", () => {
    // Reglement 2.2.9: „Ausgenommen von dieser Regel ist das
    // Entscheidungs-Doppel sudden death. Der Spielbeginn wird beim sudden death
    // immer durch Wurf auf Bull entschieden."
    const match = createX01Match({
      sides: singles("one", "two"),
      startingSeat: 1,
      rules: rules({ startingScore: 40, legsToWinSet: 2, setsToWin: 1, bullOffFromLegOne: true }),
    });
    const decided = executeX01Command(match, {
      type: "DECIDE_LEG_START",
      commandId: "bull-leg-one",
      legNumber: 1,
      startingSeat: 2,
    }).match;
    const state = projectX01Match(decided);

    expect(state.legNumber).toBe(1);
    expect(state.legStartingSeat).toBe(2);
    expect(state.activeSeat).toBe(2);
  });

  it("haelt ohne das Flag am festen Legbeginn der ersten beiden Legs fest", () => {
    const match = createX01Match({
      sides: singles("one", "two"),
      rules: rules({ bullOffFromLegOne: false }),
    });
    try {
      executeX01Command(match, {
        type: "DECIDE_LEG_START",
        commandId: "too-early",
        legNumber: 1,
        startingSeat: 2,
      });
      expect.unreachable("leg one belongs to the home side");
    } catch (error: unknown) {
      expect((error as ScoringValidationError).code).toBe("LEG_START_FIXED");
    }
  });
```

- [ ] **Step 2: Migration erzeugen — Nummer und Bestand prüfen**

Zuerst den Bestand prüfen:

```bash
ls packages/database/drizzle
```

Höchste vorhandene Nummer ist heute `0022_board_in_progress_unique.sql`. Belegt
Tier 2, Teil A bereits `0023_…`, ist diese hier `0024_…`. Ist `0023_…` **nicht**
vorhanden, weil Teil A noch nicht gelaufen ist: warten, bis Teil A seine
Migration angelegt hat — eine Lücke im Journal (`0022`, dann `0024`) lässt
`migration-runner.ts` nicht zu, und `drizzle-kit` vergibt die Nummer selbst
fortlaufend. Die Reihenfolge ist damit: Teil A vor Task 4.

Spalte in `packages/database/src/schema.ts` ergänzen, in der Tabelle `matches`
direkt nach `outRule`:

```ts
    /**
     * Reglement 2.2.9: normalerweise beginnt Leg 1 die Heimseite und Leg 2 die
     * Gastseite; erst ab Leg 3 entscheidet ein Wurf auf Bull. Das
     * Entscheidungsdoppel (sudden death) ist davon ausgenommen — dort wird der
     * Spielbeginn IMMER ausgebullt. Das Flag ist eine Match-Regel wie `in_rule`
     * und kein Teil der Kommandos; gespeicherte Kommandos werten unveraendert.
     */
    bullOffFromLegOne: boolean("bull_off_from_leg_one").default(false).notNull(),
```

`boolean` aus `drizzle-orm/pg-core` importieren, falls die Datei es noch nicht
tut.

Migration erzeugen:

```bash
pnpm db:generate
```

Die erzeugte Datei nach `packages/database/drizzle/0024_league_decider_bull_off.sql`
umbenennen und den `tag` des neuen Eintrags in
`packages/database/drizzle/meta/_journal.json` auf `0024_league_decider_bull_off`
setzen (gleiches Vorgehen wie bei `0022_board_in_progress_unique`). Der Inhalt
der SQL-Datei ist eine einzelne Anweisung:

```sql
ALTER TABLE "matches" ADD COLUMN "bull_off_from_leg_one" boolean DEFAULT false NOT NULL;
```

Ein Bestandscheck wie in `0022` ist hier nicht nötig und wäre irreführend: die
Spalte kommt mit Default, bestehende Zeilen erhalten `false` und verhalten sich
exakt wie bisher. Diese Begründung als SQL-Kommentar über die Anweisung setzen:

```sql
-- Reglement 2.2.9: das Entscheidungsdoppel wird immer ausgebullt. Bestehende
-- Matches erhalten false und verhalten sich unveraendert; ein Bestandscheck
-- eruebrigt sich deshalb.
```

Migration anwenden:

```bash
pnpm db:migrate
```

- [ ] **Step 3: Die Engine an das Flag binden**

`X01Rules` erweitern:

```ts
export interface X01Rules {
  readonly startingScore: number;
  readonly inRule: InRule;
  readonly outRule: OutRule;
  readonly maxRounds: number | null;
  readonly legsToWinSet: number;
  readonly setsToWin: number;
  /**
   * Reglement 2.2.9, Ausnahme für das Entscheidungsdoppel: ist das Flag
   * gesetzt, entscheidet ein Wurf auf Bull den Legbeginn ab Leg 1 statt erst
   * ab Leg 3. Es ist eine Regel des Matches, kein Feld eines Kommandos —
   * gespeicherte Kommandos werten dadurch unverändert (Replay-Sicherheit).
   */
  readonly bullOffFromLegOne: boolean;
}
```

Den Kommentar über `DecideLegStartCommand` vervollständigen — er zitierte 2.2.9
bisher nur bis Satz 3 und verschwieg die Ausnahme:

```ts
/**
 * Reglement 2.2.9: Leg 1 beginnt die Heimseite, Leg 2 die Gastseite, ab Leg 3
 * entscheidet ein Wurf auf Bull. Ausgenommen ist das Entscheidungsdoppel
 * (sudden death): dort wird der Spielbeginn IMMER ausgebullt — dafür trägt das
 * Match `X01Rules.bullOffFromLegOne`, und das Kommando ist dann schon für
 * Leg 1 zulässig. Fehlt das Kommando, wechselt der Legbeginn wie bisher.
 */
```

In `assertRules` hinter der Prüfung von `setsToWin`:

```ts
  if (typeof rules.bullOffFromLegOne !== "boolean") {
    throw new ScoringValidationError("INVALID_BULL_OFF_RULE", "The bull-off rule must be a boolean.");
  }
```

In `createX01Match` die Standardregeln ergänzen:

```ts
  const rules = input.rules ?? {
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    maxRounds: null,
    legsToWinSet: 1,
    setsToWin: 1,
    bullOffFromLegOne: false,
  };
```

`activeCommands` nimmt die Regeln entgegen und leitet die Untergrenze daraus ab:

```ts
function activeCommands(commands: readonly X01Command[], rules: X01Rules): ActiveCommands {
```

und im `DECIDE_LEG_START`-Zweig:

```ts
    // Reglement 2.2.9: Leg 1 und 2 sind festgelegt — ausser beim sudden death,
    // das immer ausgebullt wird.
    const firstDecidableLeg = rules.bullOffFromLegOne ? 1 : 3;
    if (!Number.isInteger(command.legNumber) || command.legNumber < firstDecidableLeg) {
      throw new ScoringValidationError(
        "LEG_START_FIXED",
        rules.bullOffFromLegOne
          ? "A leg number must be a positive integer."
          : "Leg one belongs to the home side and leg two to the guest side.",
      );
    }
```

Beide Aufrufstellen (`projectX01Match` und `executeX01Command`) auf
`activeCommands(match.commands, match.rules)` umstellen.

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `pnpm --filter @darts-platform/scoring-engine test`
Expected: PASS, alle Tests des Pakets grün — auch der bestehende
„refuses to decide the start of the first two legs" (er nutzt `createX01Match`
ohne Regeln, also `bullOffFromLegOne: false`).

- [ ] **Step 5: Vertrag und API nachziehen**

`packages/schemas/src/match.ts`, `decideLegStartSchema`:

```ts
/**
 * Reglement 2.2.9: ab Leg drei entscheidet ein Wurf auf Bull, wer beginnt; beim
 * Entscheidungsdoppel (sudden death) schon ab Leg eins. Welche Grenze gilt,
 * entscheidet der Server anhand von `matches.bull_off_from_leg_one` — der
 * Vertrag lässt deshalb jede Legnummer zu und die Engine lehnt ab
 * (`LEG_START_FIXED`).
 */
export const decideLegStartSchema = z.object({
  commandId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  legNumber: z.number().int().min(1).max(99),
  startingSeat: z.union([z.literal(1), z.literal(2)]),
  controllerId: z.uuid().optional(),
});
```

`matchStateSchema`, hinter `inRule: inRuleSchema, outRule: outRuleSchema,`:

```ts
  /** Reglement 2.2.9: beim Entscheidungsdoppel wird schon Leg 1 ausgebullt. */
  bullOffFromLegOne: z.boolean(),
```

`apps/api/src/matches/matches.repository.ts`, im Antwortobjekt neben `inRule`/`outRule`:

```ts
      bullOffFromLegOne: matchRow.match.bullOffFromLegOne,
```

und in `aggregate` in den Regeln:

```ts
      rules: {
        startingScore: match.startingScore,
        inRule: toInRule(match.inRule),
        outRule: toOutRule(match.outRule),
        maxRounds: match.maxRounds,
        legsToWinSet: match.legsToWinSet,
        setsToWin: match.setsToWin,
        bullOffFromLegOne: match.bullOffFromLegOne,
      },
```

`apps/api/src/encounters/encounters.repository.ts`, im `matches`-Insert des
Slotstarts (heute `startingSeat: 1`):

```ts
          // Reglement 2.2.9: der Spielbeginn des Entscheidungsdoppels wird
          // immer ausgebullt. `startingSeat` bleibt die Heimseite als Vorbelegung;
          // sobald das Ausbullen erfasst ist, setzt `DECIDE_LEG_START` fuer
          // Leg 1 den tatsaechlichen Anwurf.
          startingSeat: 1,
          currentSeat: 1,
          bullOffFromLegOne: slot.role === "DECIDER",
```

- [ ] **Step 6: API-Integrationstest schreiben und laufen lassen**

In `apps/api/src/encounters/encounters.integration.spec.ts` neben dem
bestehenden `decideLegStart`-Test (heute um Zeile 1340) ergänzen — der
vorhandene Test bullt Leg 3 eines regulären Slots aus und bleibt unverändert:

```ts
  it("bullt den Anwurf des Entscheidungsdoppels schon fuer Leg eins aus", async () => {
    // Reglement 2.2.9: „Der Spielbeginn wird beim sudden death immer durch
    // Wurf auf Bull entschieden."
    const { matchId, slotId } = await startDeciderSlot();
    const [row] = await databaseService.database
      .select({ bullOff: matchesTable.bullOffFromLegOne })
      .from(matchesTable)
      .where(eq(matchesTable.id, matchId));
    expect(row?.bullOff).toBe(true);

    const state = await matchesService.decideLegStart({
      organizationId,
      matchId,
      data: {
        commandId: randomUUID(),
        expectedVersion: 0,
        legNumber: 1,
        startingSeat: 2,
      },
      auth,
      audit,
    });

    expect(state.bullOffFromLegOne).toBe(true);
    const storedLegs = await databaseService.database
      .select({ legNumber: legsTable.legNumber, startingSeat: legsTable.startingSeat })
      .from(legsTable)
      .where(eq(legsTable.matchId, matchId));
    expect(storedLegs.find((leg) => leg.legNumber === 1)?.startingSeat).toBe(2);
    expect(slotId).toBeDefined();
  });
```

`startDeciderSlot()` gibt es noch nicht: den Weg des bestehenden
`decideLegStart`-Tests nachbauen — Begegnung bis 9:9 führen, sodass der
DECIDER-Slot entsteht, oder den vorhandenen Helfer der Datei nutzen, der einen
Slot startet, und ihm den DECIDER-Slot übergeben (die Datei führt die Begegnung
bereits bis zum Entscheidungsdoppel; die Stelle findet sich über
`grep -n "DECIDER" apps/api/src/encounters/encounters.integration.spec.ts`).
Wird kein solcher Weg gefunden, den Slot über
`encountersService.assignSlot` mit der Slot-ID des DECIDER-Slots starten und die
zurückgegebene `matchId` verwenden.

Run (aus `apps/api`):
`npx dotenv -e ../../.env -- npx vitest run src/encounters/encounters.integration.spec.ts`
Expected: PASS.

- [ ] **Step 7: `DATABASE_SCHEMA.md` ergänzen**

In der Spaltenliste der Tabelle `matches` hinter `out_rule` einfügen:

```text
bull_off_from_leg_one boolean NOT NULL DEFAULT false
```

und darunter den erklärenden Absatz:

```markdown
`bull_off_from_leg_one` bildet die Ausnahme aus Reglement 2.2.9 ab: normalerweise
beginnt Leg 1 die Heimseite und Leg 2 die Gastseite, erst ab Leg 3 entscheidet
ein Wurf auf Bull. Beim Entscheidungsdoppel (sudden death) wird der Spielbeginn
**immer** ausgebullt; `apps/api/src/encounters/encounters.repository.ts` setzt
das Flag beim Start eines DECIDER-Slots. Es ist eine Match-Regel wie `in_rule`
und steht bewusst nicht im Kommando: gespeicherte `score_commands` werten
dadurch unverändert (Migration `0024_league_decider_bull_off.sql`).
```

- [ ] **Step 8: Vollständige Prüfung**

Run: `pnpm lint`
Run: `pnpm typecheck`
Run: `pnpm test`
Expected: alles grün.

- [ ] **Step 9: Commit**

```bash
git add packages/database/src/schema.ts packages/database/drizzle packages/scoring-engine/src/x01.ts packages/scoring-engine/src/x01.spec.ts packages/schemas/src/match.ts apps/api/src/matches/matches.repository.ts apps/api/src/encounters/encounters.repository.ts apps/api/src/encounters/encounters.integration.spec.ts DATABASE_SCHEMA.md
git commit -m "feat(scoring-engine): Entscheidungsdoppel nach Reglement 2.2.9 ab Leg eins ausbullen"
```

---

### Task 5: Rankingverlauf gegen die echte Gegnerbewertung (Befunde D-I6, D-M5)

**Was ist:** `packages/statistics/src/statistics.ts:72` rechnet
`const expected = 1 / (1 + 10 ** ((1_500 - rating) / 400));` — die Gegnerstärke
steht fest auf 1500, obwohl der Gegner im selben Schleifendurchlauf als
`opponent` vorliegt. Zwei Spieler mit `rating: 1500` bekommen für einen Sieg
gegen den Ranglistenersten und einen gegen einen Debütanten exakt dieselben
**+12**. Die Zahl misst die Siegquote, nicht die Stärke, heisst aber `rating`
und wird als `rankingHistory` ausgeliefert (ROADMAP Phase 6 führt „Ranking
History" als umgesetzt).

**Entscheidung: Gegnerbewertung mitführen.** Die Funktion bekommt alle Matches
der betrachteten Person, und jedes Match nennt beide Beteiligten. Eine
Bewertungstabelle über alle in dieser Eingabe vorkommenden Personen, in
chronologischer Reihenfolge paarweise fortgeschrieben, liefert für jedes Match
die Bewertung, die der Gegner **zu diesem Zeitpunkt innerhalb dieser Eingabe**
hat.

**Ehrliche Grenze, die im Code stehen muss:** Diese Bewertung ist nicht die
globale Elo-Zahl des Gegners. In der Eingabe stehen nur Matches der
betrachteten Person; die Spiele des Gegners gegen Dritte fehlen, seine
Bewertung bewegt sich hier also nur in den gemeinsamen Begegnungen. Das ist
trotzdem strikt besser als die fixe 1500: die Zahl unterscheidet jetzt starke
von schwachen Gegnern, sobald man mehrfach gegen dieselbe Person spielt, und
sie ist paarweise konsistent. Eine echte, ligaweite Elo-Zahl gehört in das noch
nicht existierende `packages/ranking-engine` (ARCHITECTURE §23, ROADMAP Phase 10)
und ist nicht Gegenstand dieses Plans. Der Kommentar im Code und der Absatz in
`ARCHITECTURE.md` sagen genau das.

**Determinismus (D-M5 gehört hierher):** Die Reihenfolge der Matches entscheidet
über jede Bewertung. Sie wird nach `completedAt`, bei Gleichstand nach `id`
festgelegt — mit Code-Unit-Vergleich, nicht `localeCompare`. Aus demselben Grund
verliert die Head-to-Head-Sortierung ihr `localeCompare` ohne Locale
(`statistics.ts:81`): dieselbe Eingabe muss in Server, Worker und Test dieselbe
Reihenfolge ergeben, unabhängig von der ICU-Kollation der Laufzeit.

**Files:**
- Modify: `packages/statistics/src/statistics.ts:18-22`, `:34-35`, `:72-74`, `:81`
- Test: `packages/statistics/src/statistics.spec.ts`
- Modify: `ARCHITECTURE.md` §23

**Interfaces:**
- Consumes: `StatisticsMatch.outRule` aus Task 2 (die Testliterale dieses Tasks
  tragen das Feld).
- Produces: keine Signaturänderung. `RankingHistoryEntry` bleibt
  `{ matchId, recordedAt, rating }`; nur die Zahlen ändern sich.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

An `packages/statistics/src/statistics.spec.ts` anfügen. Die Zahlen sind von
Hand gerechnet, K = 24, Startbewertung 1500, Rundung nach jedem Match:

```
Match 1, A gewinnt: beide 1500 -> erwartet 0.5
  A = round(1500 + 24 * (1 - 0.5)) = 1512
  B = round(1500 + 24 * (0 - 0.5)) = 1488
Match 2, A gewinnt: A 1512, B 1488
  erwartet_A = 1 / (1 + 10^((1488 - 1512) / 400)) = 0.534484
  A = round(1512 + 24 * (1 - 0.534484)) = round(1523.172) = 1523
  B = round(1488 + 24 * (0 - 0.465516)) = round(1476.828) = 1477
Match 3, B gewinnt: A 1523, B 1477
  erwartet_A = 1 / (1 + 10^((1477 - 1523) / 400)) = 0.565815
  A = round(1523 + 24 * (0 - 0.565815)) = round(1509.420) = 1509
  B = round(1477 + 24 * (1 - 0.434185)) = round(1490.580) = 1491
```

```ts
  it("rechnet den Rankingverlauf gegen die Bewertung des tatsaechlichen Gegners", () => {
    const between = (id: string, completedAt: string, winnerPlayerId: string): StatisticsMatch => ({
      id, completedAt: new Date(completedAt), winnerPlayerId, outRule: "DOUBLE",
      participants: [
        { playerId: "a", displayName: "Anna", legsWon: winnerPlayerId === "a" ? 1 : 0, setsWon: winnerPlayerId === "a" ? 1 : 0 },
        { playerId: "b", displayName: "Beat", legsWon: winnerPlayerId === "b" ? 1 : 0, setsWon: winnerPlayerId === "b" ? 1 : 0 },
      ],
      legs: [],
      visits: [],
    });
    const history = calculatePlayerStatistics("a", [
      between("m1", "2026-03-01T20:00:00Z", "a"),
      between("m2", "2026-03-08T20:00:00Z", "a"),
      between("m3", "2026-03-15T20:00:00Z", "b"),
    ]).rankingHistory;

    // Von Hand gerechnet, K = 24, Start 1500: nach zwei Siegen gegen eine
    // schwaecher gewordene Gegnerin bringt der zweite Sieg weniger als der
    // erste (11 statt 12 Punkte), die Niederlage danach kostet 14.
    expect(history.map((entry) => entry.rating)).toEqual([1512, 1523, 1509]);
    expect(history.map((entry) => entry.matchId)).toEqual(["m1", "m2", "m3"]);
  });

  it("ordnet gleichzeitig beendete Matches deterministisch nach ihrer Id", () => {
    const sameMoment = (id: string, winnerPlayerId: string): StatisticsMatch => ({
      id, completedAt: new Date("2026-04-01T20:00:00Z"), winnerPlayerId, outRule: "DOUBLE",
      participants: [
        { playerId: "a", displayName: "Anna", legsWon: 0, setsWon: 0 },
        { playerId: "b", displayName: "Beat", legsWon: 0, setsWon: 0 },
      ],
      legs: [],
      visits: [],
    });
    const forwards = calculatePlayerStatistics("a", [sameMoment("m-b", "b"), sameMoment("m-a", "a")]).rankingHistory;
    const backwards = calculatePlayerStatistics("a", [sameMoment("m-a", "a"), sameMoment("m-b", "b")]).rankingHistory;

    expect(forwards).toEqual(backwards);
    expect(forwards.map((entry) => entry.matchId)).toEqual(["m-a", "m-b"]);
  });

  it("sortiert den direkten Vergleich ohne Abhaengigkeit von der Laufzeit-Kollation", () => {
    const against = (id: string, opponentId: string, opponentName: string): StatisticsMatch => ({
      id, completedAt: new Date(`2026-05-0${id.slice(-1)}T20:00:00Z`), winnerPlayerId: "a", outRule: "DOUBLE",
      participants: [
        { playerId: "a", displayName: "Anna", legsWon: 1, setsWon: 1 },
        { playerId: opponentId, displayName: opponentName, legsWon: 0, setsWon: 0 },
      ],
      legs: [],
      visits: [],
    });
    const headToHead = calculatePlayerStatistics("a", [
      against("m1", "z", "Zora"),
      against("m2", "o", "Örs"),
      against("m3", "b", "Beat"),
    ]).headToHead;

    // Gleiche Zahl Begegnungen -> Reihenfolge nach der Spieler-Id, nicht nach
    // einer ICU-Kollation, die je nach Laufzeit anders sortiert.
    expect(headToHead.map((entry) => entry.opponentPlayerId)).toEqual(["b", "o", "z"]);
  });
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `pnpm --filter @darts-platform/statistics test`
Expected: FAIL — der erste neue Test meldet
`expected [ 1512, 1524, 1508 ] to deep equal [ 1512, 1523, 1509 ]` (die feste
1500 auf der Gegenseite liefert andere Erwartungswerte).

- [ ] **Step 3: Die Bewertung paarweise rechnen**

In `packages/statistics/src/statistics.ts` oberhalb von
`calculatePlayerStatistics` zwei benannte Konstanten und den Vergleich einführen:

```ts
/**
 * Elo-Parameter des Rankingverlaufs. `RATING_K` ist der Ausschlag je Match,
 * `RATING_START` die Bewertung einer Person ohne Historie.
 */
const RATING_K = 24;
const RATING_START = 1_500;

/**
 * Reihenfolge der Matches. Sie entscheidet über jede Bewertung, muss also
 * eindeutig sein: nach Abschlusszeitpunkt, bei Gleichstand nach Id. Der
 * Vergleich läuft über Code-Units statt `localeCompare` — eine ICU-Kollation
 * kann je nach Laufzeit anders sortieren, und Server, Worker und Test müssen
 * dieselbe Zahl liefern.
 */
function compareByCompletion(left: StatisticsMatch, right: StatisticsMatch): number {
  const byTime = left.completedAt.getTime() - right.completedAt.getTime();
  if (byTime !== 0) return byTime;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
```

Die Sortierung am Anfang der Funktion darauf umstellen:

```ts
  const ordered = [...matches].sort(compareByCompletion);
```

`let rating = 1_500;` durch die Bewertungstabelle ersetzen:

```ts
  /**
   * Die Bewertung jeder Person, die in dieser Eingabe vorkommt. Beide Seiten
   * werden je Match fortgeschrieben, damit in der Elo-Formel die Bewertung des
   * TATSAECHLICHEN Gegners steht und nicht eine feste Zahl.
   *
   * Reichweite, die man kennen muss: die Eingabe enthaelt nur Matches der
   * betrachteten Person. Die Bewertung eines Gegners bewegt sich hier also nur
   * in den gemeinsamen Begegnungen — sie ist keine ligaweite Elo-Zahl. Die
   * gehoert in eine eigene Ranking Engine (ARCHITECTURE §23, ROADMAP Phase 10)
   * und nicht in diese Karriereauswertung.
   */
  const ratings = new Map<string, number>();
  const ratingOf = (id: string): number => ratings.get(id) ?? RATING_START;
```

Den Elo-Block (heutige Zeilen 72-74) ersetzen:

```ts
    const playerRating = ratingOf(playerId);
    const opponentRating = ratingOf(opponent.playerId);
    // Beide Erwartungswerte stehen auf den Bewertungen VOR diesem Match; erst
    // danach wird geschrieben, sonst rechnete die zweite Seite gegen die
    // bereits aktualisierte erste.
    const expected = 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
    const nextPlayerRating = Math.round(playerRating + RATING_K * ((won ? 1 : 0) - expected));
    const nextOpponentRating = Math.round(opponentRating + RATING_K * ((won ? 0 : 1) - (1 - expected)));
    ratings.set(playerId, nextPlayerRating);
    ratings.set(opponent.playerId, nextOpponentRating);
    rankingHistory.push({ matchId: match.id, recordedAt: match.completedAt, rating: nextPlayerRating });
```

Der Block steht hinter der `headToHead`-Zuweisung, weil er `won` benutzt — die
Variable ist dort bereits gesetzt.

Die Head-to-Head-Sortierung (heutige Zeile 81) auf einen deterministischen
Vergleich umstellen:

```ts
    headToHead: [...headToHead.values()].sort(
      (left, right) =>
        right.matchesPlayed - left.matchesPlayed ||
        // Kein `localeCompare`: die ICU-Kollation der Laufzeit darf die
        // Reihenfolge einer Domaenenauswertung nicht bestimmen. Die Fläche kann
        // fuer die Anzeige sprachrichtig nachsortieren.
        (left.opponentPlayerId < right.opponentPlayerId ? -1 : left.opponentPlayerId > right.opponentPlayerId ? 1 : 0),
    ),
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `pnpm --filter @darts-platform/statistics test`
Expected: PASS, alle Tests des Pakets grün — auch der bestehende
`expect(result.rankingHistory[0]?.rating).toBe(1512)` (erstes Match, beide
Seiten auf 1500, unverändert 1512).

- [ ] **Step 5: `ARCHITECTURE.md` §23 ergänzen**

In §23 (Ranking) den Absatz anfügen:

```markdown
Der `rankingHistory`-Verlauf aus `packages/statistics` ist eine
**Karriereauswertung, keine ligaweite Rangliste**: er rechnet Elo mit K = 24 ab
1500 paarweise über die Matches der betrachteten Person und führt dabei die
Bewertung des tatsächlichen Gegners mit. Weil die Eingabe nur die Matches dieser
Person enthält, bewegt sich die Gegnerbewertung nur in den gemeinsamen
Begegnungen. Eine ligaweite, konfigurierbare Rangliste gehört in
`packages/ranking-engine` (ROADMAP Phase 10) und existiert noch nicht.
```

- [ ] **Step 6: Vollständige Prüfung**

Run: `pnpm lint`
Run: `pnpm typecheck`
Run: `pnpm test`
Expected: alles grün. Schlägt eine API-Integrationsprüfung mit einer erwarteten
Ratingzahl fehl, ist die Zahl nach demselben Verfahren wie oben von Hand
nachzurechnen und im Test zu korrigieren — nicht die Formel zurückzudrehen.

- [ ] **Step 7: Commit**

```bash
git add packages/statistics/src/statistics.ts packages/statistics/src/statistics.spec.ts ARCHITECTURE.md
git commit -m "fix(statistics): Rankingverlauf gegen die Bewertung des tatsaechlichen Gegners rechnen"
```

---

### Abschluss des Plans

- [ ] **Step 1: Vollständige Testsuite**

Run: `pnpm lint`
Run: `pnpm typecheck`
Run: `pnpm test`
Run: `pnpm build`
Expected: alles grün. `pnpm build` braucht `NODE_ENV=production` — das Skript
der Wurzel setzt es bereits; ohne die Variable bricht der Web-Prerender mit
einem irreführenden React-Fehler ab.

- [ ] **Step 2: End-to-End auf einem Worker**

Run: `pnpm test:e2e`
Expected: grün. Sporadisch rote Läufe mit mehreren Workern sind Kontention gegen
`next dev`, kein Bug — der Lauf erfolgt auf einem Worker.

- [ ] **Step 3: Selbstprüfung gegen den Auditbericht**

Für jeden Befund nachweisen, wo er behoben ist:
- D-I2 → Task 1 (`standings.ts`, `sortKeys` nach A1.5, `minusPoints`)
- D-I5 → Task 2 (`statistics.ts`, drei Kennzahlen nullbar, Doku in `DATABASE_SCHEMA.md`)
- D-I4 / A-I3 / D-M7 → Task 3 (`encounter-template.ts` in der Engine, `validateRoundOrder`, `MISSING_DOUBLES_SLOTS`)
- D-I3 → Task 4 (`bullOffFromLegOne`, Migration `0024`, DECIDER-Slots)
- D-I6 / D-M5 → Task 5 (paarweise Elo, deterministische Sortierungen)

---

## Nicht mehr zutreffend

- **D-C1** (Legzähler des Verlierers wird beim Satzgewinn nicht zurückgesetzt) —
  in Tier 1 behoben. `winLeg` in `packages/scoring-engine/src/x01.ts` setzt heute
  beide Seiten zurück und trägt die Begründung als Kommentar; nicht Gegenstand
  dieses Plans.
- **D-C2** (Double In rechnet in der Rundensummen-Eingabe die Würfe vor dem
  eröffnenden Doppel mit) — in Tier 1 behoben.
- **D-I1** (Master Out ohne Wurfdaten) — in Tier 1 behoben.
- **D-M1 bis D-M4, D-M6, D-M8 bis D-M10** — bewusst nicht in Tier 2, Teil C.
  D-M7 gehört zu D-I4 und ist in Task 3 enthalten, D-M5 gehört zu D-I6 und ist in
  Task 5 enthalten.

## Self-Review

**Spec-Abdeckung.** Die fünf Important-Befunde des Berichts D (I2, I3, I4, I5, I6)
haben je einen Task; A-I3 fällt mit D-I4 in Task 3 zusammen; die beiden Minor,
die der Auftrag ausdrücklich einschliesst (M7, M5), sind in Task 3 bzw. Task 5
erledigt. Die drei in Tier 1 behobenen Befunde stehen unter „Nicht mehr
zutreffend". Der im Bericht A vorgeschlagene Endpunkt
`POST /competitions/template-preview` ist begründet weggelassen (Task 3,
Vorspann) statt stillschweigend übergangen.

**Platzhalter.** Jeder Schritt trägt entweder lauffähigen Code, einen exakten
Dateipfad mit Zeilenbereich oder ein Kommando mit erwartetem Ergebnis. Die
einzige Stelle mit einer Suchanweisung statt fertigem Code ist Task 4, Step 6
(`startDeciderSlot`): dort hängt der Aufbau an Helfern der bestehenden
Integrationstestdatei, die je nach Stand der Datei anders heissen — der Schritt
nennt das `grep`-Kommando, mit dem sie zu finden sind, und den Rückfallweg über
`assignSlot`.

**Typkonsistenz.** `StatisticsMatch.outRule` wird in Task 2 eingeführt und in
Task 5 in allen Testliteralen mitgeführt. `TemplateSlot` (Task 3) ist der
Engine-Typ aus `template.ts` und deckt sich Feld für Feld mit
`CompetitionSlotInput` und `TemplateRow` der Web-App; `buildEncounterTemplate`
liefert `readonly TemplateSlot[]`, was `TemplateTable` und
`createCompetitionSchema.safeParse` unverändert annehmen.
`X01Rules.bullOffFromLegOne` (Task 4) ist ein Pflichtfeld mit genau drei
Konstruktionsstellen — Testhelfer `rules()`, Default in `createX01Match`,
`aggregate` im Repository —, alle drei sind im Plan benannt.
`StandingsRow.minusPoints` (Task 1) heisst in Engine, Schema und Fläche gleich.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-06-tier2-reglement.md`.
Zwei Wege der Ausführung:

**1. Subagent-Driven (empfohlen)** — ein frischer Subagent je Task, Review
zwischen den Tasks, schnelle Iteration.

**2. Inline Execution** — Ausführung in dieser Sitzung über
`superpowers:executing-plans`, Stapelverarbeitung mit Kontrollpunkten.

Welcher Weg?
