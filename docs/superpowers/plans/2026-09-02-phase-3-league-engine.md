# Phase 3 — packages/league-engine

> **Für agentische Bearbeiter:** ERFORDERLICHE SUB-SKILL:
> `superpowers:executing-plans` (inline). Schritte tragen Checkboxen
> (`- [ ]`) zur Nachverfolgung.

**Ziel:** Ein neues, infrastrukturfreies Paket `@darts-platform/league-engine`
trägt die gesamte Fachlogik der Team-Begegnung: Vorlagenprüfung,
Meldeprüfung, Doppelpaarungen, Auswechslungen, abgeleitete Slotbesetzung,
Wertung einer Begegnung und die Frage, ob ein Entscheidungsdoppel nötig ist.

**Architektur:** Zuschnitt analog `packages/tournament-engine`: ein
`tsconfig.build.json`, `main`/`types` auf `dist`, Vitest ohne eigene Config,
eine Fehlerklasse mit stabilem Code (`LeagueValidationError`, analog
`TournamentValidationError`). Reine Funktionen, kein Zustand, keine
Persistenz. Das Paket kennt weder `matches` noch `encounters` als Tabellen —
es bekommt Zeilen als schlichte, readonly Eingabeobjekte übergeben und liefert
Entscheidungen zurück. Phase 4 legt die Daten ab und ruft die Engine.

**Tech Stack:** TypeScript (strict), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-team-encounter-league-design.md`,
Abschnitte „Engines / league-engine", „Datenmodell", „Abläufe",
„Tests und Abnahmekriterien", „Aus dem Reglement übernommene Regeln".

**Roadmap:** `docs/superpowers/plans/2026-09-02-team-encounter-roadmap.md`,
Phase 3 (~1.500 LOC, 1,5–2,5M Token, ohne Abhängigkeit).

## Global Constraints

- Prioritäten aus `AGENTS.md`: Korrektheit vor Datenintegrität vor Security
  vor Testbarkeit.
- `packages/league-engine` importiert **nichts** aus Drizzle, PostgreSQL,
  Redis, NestJS, Next.js oder Socket.IO. Auch nicht aus `scoring-engine`,
  `database` oder `domain`: das Paket steht für sich und ist deterministisch
  testbar.
- Kein `any`. `unknown` statt `any`, exhaustive `switch`, `readonly` an den
  Domain-Grenzen, discriminated unions für Ausgänge.
- `tsconfig.base.json` gilt: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`. Indexzugriffe sind deshalb immer
  `T | undefined`; das ist beim Schreiben mitzudenken.
- Jeder Fehler ist eine `LeagueValidationError` mit stabilem, in diesem Plan
  festgehaltenem Code. Codes sind Teil der Schnittstelle zu Phase 4 (die API
  bildet sie auf `error.code` ab) und werden nicht nachträglich umbenannt.
- Während der Arbeit **kein** `pnpm test` oder `pnpm build` im Root. Nur
  `pnpm --filter @darts-platform/league-engine test -- <datei>`.
  Vollverifikation einmal am Ende.
- Keine Subagents.

## Dateien

```text
packages/league-engine/package.json          neu
packages/league-engine/tsconfig.json         neu
packages/league-engine/tsconfig.build.json   neu
packages/league-engine/src/errors.ts         neu   Fehlerklasse
packages/league-engine/src/template.ts       neu   Vorlage + Grundtypen
packages/league-engine/src/lineup.ts         neu   Meldung, Doppel, Wechsel, Besetzung
packages/league-engine/src/result.ts         neu   Wertung + Entscheidungsdoppel
packages/league-engine/src/index.ts          neu   öffentliche Schnittstelle
packages/league-engine/src/template.spec.ts  neu
packages/league-engine/src/lineup.spec.ts    neu
packages/league-engine/src/result.spec.ts    neu
```

Keine Datei ausserhalb `packages/league-engine` wird geändert, ausser dieser
Plan und — falls die Umsetzung von der in der Roadmap festgehaltenen
Schnittstelle abweicht — die Roadmap selbst.

## Nicht in dieser Phase

- Tabellen, Migrationen, Repositories, Controller, Zod-Schemata: Phase 4.
- Die Tabellenberechnung der Saison (Rangliste über mehrere Begegnungen). Die
  Spec verweist sie ausdrücklich in die Folge-Spec.
- Aushilfe-Kontingente nach Reglement 1.2.3/1.2.4/1.2.9. `origin = 'GUEST'`
  wird entgegengenommen und schaltet die Kaderprüfung ab, mehr nicht.
- Board- und Verfügbarkeitsprüfung: das ist `scheduling-engine` in Phase 4.
- Statistik, Realtime, Oberfläche.

## Festgelegte Auslegungen

Punkte, die Spec und Reglement offen lassen und die hier entschieden werden.
Sie stehen hier, damit Phase 4 sie nicht neu erfindet.

1. **Auswechselkontingent je Seite.** `max_substitutions_per_encounter` ist
   eine Mannschaftsregel (Reglement 2.2.4). Die Engine zählt das Kontingent
   deshalb je Seite, nicht über beide Seiten zusammen.
2. **Fehlende Positionen bei drei Personen.** Die Meldung darf jede beliebige
   Position offen lassen, nicht nur die höchste. Reglement 2.2.5 spricht von
   „der fehlenden Position", nicht von der vierten. Die Engine prüft nur die
   Anzahl besetzter Positionen.
3. **Walkover-Legs.** Der Sieger erhält `legsToWinSet * setsToWin` Legs, der
   Verlierer null. Für die Ligavorlage sind das 2:0, wie im Reglement A4.4.
4. **Nichtantritt.** Statt 18 und 36 fest zu verdrahten, leitet die Engine
   die Zahlen aus der Vorlage ab: Spiele = Zahl der regulären Slots, Legs =
   Summe von `legsToWinSet * setsToWin` über die regulären Slots. Für die
   Ligavorlage ergibt das exakt 0:18 und 0:36; für andere Verbände bleibt es
   richtig.
5. **Entscheidungsslot fehlt trotz `EXTRA_SLOT`.** Wenn nach allen regulären
   Slots Gleichstand herrscht, die Wertungsregel ein Entscheidungsdoppel
   verlangt und die Vorlage keinen Entscheidungsslot trägt, ist das ein
   Konfigurationsfehler und keine stille Unentschieden-Wertung: beide
   Funktionen werfen `MISSING_DECIDER_SLOT`.
6. **Zwischenstand ohne Punkte.** Solange eine Begegnung nicht entschieden
   ist, liefert `calculateEncounterResult` Spiele und Legs als Zwischenstand,
   aber `homePoints`/`awayPoints` als 0 und `result`/`resultType` als `null`.
   Punkte entstehen erst mit dem Abschluss.

## Schnittstelle (verbindlich, Phase 3 → 4)

Die Roadmap führt diese Namen. Sie werden hier ausgeführt, nicht geändert.

```ts
function validateEncounterTemplate(slots: readonly TemplateSlot[]): void;
function validateNominations(input: NominationInput): void;
function validateDoublesPairings(input: DoublesInput): void;
function validateSubstitution(input: SubstitutionInput): void;
function resolveSlotOccupancy(input: OccupancyInput): SlotOccupancy;
function calculateEncounterResult(input: ResultInput): EncounterResult;
function resolveDeciderRequirement(input: ResultInput): DeciderDecision;
class LeagueValidationError extends Error { readonly code: string; }
```

---

### Task 1: Paketgerüst

- [x] `packages/league-engine/package.json` nach dem Vorbild von
      `tournament-engine`: Name `@darts-platform/league-engine`, `private`,
      `main`/`types` auf `dist`, `files: ["dist"]`, Skripte `build`
      (`tsc -p tsconfig.build.json`), `typecheck` (`tsc --noEmit`), `test`
      (`vitest run`), devDependencies `typescript` und `vitest` aus dem
      Catalog.
- [x] `tsconfig.json` erbt `../../tsconfig.base.json`, `rootDir: src`,
      `noEmit: true`, `include: ["src/**/*.ts"]`.
- [x] `tsconfig.build.json` erbt `./tsconfig.json`, `declaration: true`,
      `noEmit: false`, `outDir: dist`, `exclude` der `*.spec.ts`.
- [x] `pnpm install` im Root, damit der Workspace das Paket verlinkt und
      Vitest im Paket auflösbar ist. Das ist kein Testlauf.

**Verifikation:** `pnpm --filter @darts-platform/league-engine typecheck`
läuft (noch ohne Quellen leer durch).

---

### Task 2: Fehlerklasse und Grundtypen

- [x] `src/errors.ts`: `LeagueValidationError extends Error` mit
      `readonly code: string` als erstem Konstruktorargument und
      `name = "LeagueValidationError"`, exakt wie
      `TournamentValidationError`.
- [x] `src/template.ts` trägt die von allen Modulen geteilten Grundtypen:

```ts
export type Side = "HOME" | "AWAY";
export type SlotRole = "REGULAR" | "DECIDER";
export type Discipline = "SINGLES" | "DOUBLES";
export type InRule = "STRAIGHT" | "DOUBLE";
export type OutRule = "SINGLE" | "DOUBLE" | "MASTER";

export interface TemplateSlot {
  readonly sequence: number;
  readonly role: SlotRole;
  readonly discipline: Discipline;
  readonly label: string;
  readonly homePosition: number | null;
  readonly awayPosition: number | null;
  readonly startingScore: number;
  readonly inRule: InRule;
  readonly outRule: OutRule;
  readonly maxRounds: number | null;
  readonly bestOfLegs: number;
  readonly legsToWinSet: number;
  readonly setsToWin: number;
}
```

Die Felder spiegeln `competition_slots` und `encounter_slots` aus dem
Datenmodell. Phase 4 reicht Zeilen beider Tabellen unverändert durch.

---

### Task 3: validateEncounterTemplate

- [x] `validateEncounterTemplate(slots)` prüft in dieser Reihenfolge:

| Prüfung | Code |
| --- | --- |
| mindestens ein Slot | `EMPTY_TEMPLATE` |
| Sequenzen eindeutig | `DUPLICATE_SLOT_SEQUENCE` |
| Sequenzen lückenlos ab 1 | `NON_CONTIGUOUS_SLOT_SEQUENCE` |
| Label nicht leer | `EMPTY_SLOT_LABEL` |
| `startingScore` in 301/501/701 | `INVALID_STARTING_SCORE` |
| `bestOfLegs` positiv und ungerade | `INVALID_LEG_DISTANCE` |
| `legsToWinSet > 0`, `setsToWin > 0` | `INVALID_LEG_DISTANCE` |
| `bestOfLegs === legsToWinSet * 2 - 1` | `INCONSISTENT_LEG_DISTANCE` |
| `maxRounds` null oder positiv | `INVALID_MAX_ROUNDS` |
| Einzel trägt beide Positionen, Doppel keine | `INVALID_SLOT_POSITIONS` |
| Positionen positiv | `INVALID_SLOT_POSITIONS` |
| höchstens ein `DECIDER` | `MULTIPLE_DECIDER_SLOTS` |
| `DECIDER` trägt die höchste Sequenz | `DECIDER_NOT_LAST` |
| `DECIDER` ist ein Doppel | `DECIDER_NOT_DOUBLES` |
| mindestens ein Einzelslot | `MISSING_SINGLES_SLOTS` |
| jede Paarung höchstens einmal | `DUPLICATE_SINGLES_PAIRING` |
| Rundenturnier vollständig | `INCOMPLETE_ROUND_ROBIN` |

- [x] Die Zahl der Aufstellungspositionen wird aus der Vorlage abgeleitet:
      `n = max(homePosition, awayPosition)` über alle Einzelslots. Vollständig
      ist das Rundenturnier, wenn es genau `n²` Einzelslots gibt und jedes
      Paar `(h, a)` mit `1 <= h,a <= n` genau einmal vorkommt. Damit ist
      `lineup_positions` kein zweites, widersprechbares Feld in der Vorlage.
- [x] Der Entscheidungsslot zählt nicht zum Rundenturnier; nur `REGULAR`.
- [x] Die Ableitung bleibt innerhalb von `validateRoundRobin` und wird nicht
      exportiert; Task 4 braucht sie nicht, weil dort `lineupPositions` aus
      dem Wettbewerb kommt.

**Verifikation:**
`pnpm --filter @darts-platform/league-engine test -- src/template.spec.ts`

Testfälle (Spec „Tests und Abnahmekriterien"):
- [x] Die Ligavorlage (19 Slots, 16 Einzel, 2 Doppel 701, 1 Entscheidung)
      besteht die Prüfung.
- [x] Lücke in der Sequenz → `NON_CONTIGUOUS_SLOT_SEQUENCE`.
- [x] Zwei Entscheidungsslots → `MULTIPLE_DECIDER_SLOTS`.
- [x] Entscheidungsslot nicht zuletzt → `DECIDER_NOT_LAST`.
- [x] Entscheidungsslot als Einzel → `DECIDER_NOT_DOUBLES`.
- [x] Gerade Distanz (`bestOfLegs: 4`) → `INVALID_LEG_DISTANCE`.
- [x] `bestOfLegs: 5` bei `legsToWinSet: 2` → `INCONSISTENT_LEG_DISTANCE`.
- [x] Einzelslot ohne Positionen → `INVALID_SLOT_POSITIONS`.
- [x] Doppelslot mit Positionen → `INVALID_SLOT_POSITIONS`.
- [x] Startscore 400 → `INVALID_STARTING_SCORE`.
- [x] Nur 15 statt 16 Einzel → `INCOMPLETE_ROUND_ROBIN`.
- [x] Paarung (1,1) doppelt statt (1,2) → `DUPLICATE_SINGLES_PAIRING`.
- [x] `maxRounds: 0` → `INVALID_MAX_ROUNDS`.
- [x] Eine Vorlage ohne Entscheidungsslot (nur 16 Einzel + 2 Doppel) ist
      gültig; `decider_rule = 'NONE'` ist ein zulässiger Wettbewerb.

---

### Task 4: Meldung, Doppel, Auswechslung, Besetzung

`src/lineup.ts`. Die Typen spiegeln `encounter_nominations`,
`encounter_lineup_entries` und `encounter_substitutions`.

```ts
export type NominationOrigin = "SQUAD" | "GUEST";

export interface NominationEntry {
  readonly playerId: string;
  readonly position: number | null;
  readonly origin: NominationOrigin;
}

export interface LineupRules {
  readonly lineupPositions: number;
  readonly minNominations: number;
  readonly minNominationsShorthanded: number;
}

export interface NominationInput {
  readonly side: Side;
  readonly nominations: readonly NominationEntry[];
  readonly squadPlayerIds: readonly string[];
  readonly rules: LineupRules;
}

export interface DoublesPairing {
  readonly slotSequence: number;
  readonly role: SlotRole;
  readonly playerIds: readonly string[];
}

export interface DoublesInput {
  readonly side: Side;
  readonly pairings: readonly DoublesPairing[];
  readonly nominatedPlayerIds: readonly string[];
  readonly maxDoublesPerPlayer: number;
}

export interface SubstitutionRecord {
  readonly side: Side;
  readonly position: number;
  readonly outPlayerId: string;
  readonly inPlayerId: string;
  readonly effectiveFromSequence: number;
}

export interface SubstitutionInput {
  readonly substitution: SubstitutionRecord;
  readonly nominations: readonly NominationEntry[];
  readonly existingSubstitutions: readonly SubstitutionRecord[];
  readonly startedSlotSequences: readonly number[];
  readonly lineupPositions: number;
  readonly maxSubstitutionsPerEncounter: number;
}

export interface SideLineup {
  readonly nominations: readonly NominationEntry[];
  readonly substitutions: readonly SubstitutionRecord[];
  readonly doublesPlayerIds?: readonly string[];
}

export interface OccupancySlot {
  readonly sequence: number;
  readonly discipline: Discipline;
  readonly homePosition: number | null;
  readonly awayPosition: number | null;
}

export interface OccupancyInput {
  readonly slot: OccupancySlot;
  readonly home: SideLineup;
  readonly away: SideLineup;
}

export interface SideOccupancy {
  readonly side: Side;
  readonly playerIds: readonly string[];
  readonly complete: boolean;
}

export interface SlotOccupancy {
  readonly home: SideOccupancy;
  readonly away: SideOccupancy;
  readonly playable: boolean;
  readonly walkoverWinner: Side | null;
}
```

#### validateNominations

- [x] Keine Person zweimal gemeldet → `DUPLICATE_NOMINATION`.
- [x] Jede Position höchstens einmal → `DUPLICATE_LINEUP_POSITION`.
- [x] Position innerhalb `1..lineupPositions` → `INVALID_LINEUP_POSITION`.
- [x] `origin === 'SQUAD'` verlangt Mitgliedschaft in `squadPlayerIds` →
      `PLAYER_NOT_IN_SQUAD`. `GUEST` überspringt die Prüfung (Reglement
      1.2.3/1.2.4, Kontingente ausserhalb dieser Stufe).
- [x] Zahl besetzter Positionen `< minNominationsShorthanded` →
      `NOT_ENOUGH_NOMINATIONS`. Das ist der Fall, in dem Phase 4 nicht
      `START_ENCOUNTER`, sondern `DECLARE_ENCOUNTER_FORFEIT` fährt.
- [x] Vollständige Aufstellung verlangt zusätzlich
      `nominations.length >= minNominations` → `NOT_ENOUGH_NOMINATIONS`.
- [x] Bei unvollständiger, aber zulässiger Aufstellung (Reglement 2.2.5)
      wird **nicht** geworfen; welche Slots kampflos verloren gehen,
      entscheidet `resolveSlotOccupancy` beim Start.
- [x] Leere `playerId` → `INVALID_NOMINATION`.

#### validateDoublesPairings

- [x] Slotsequenz je Meldung eindeutig → `DUPLICATE_DOUBLES_SLOT`.
- [x] Genau zwei Personen je Paarung → `INVALID_DOUBLES_SIZE`.
- [x] Nicht dieselbe Person zweimal in einer Paarung →
      `DUPLICATE_DOUBLES_PLAYER`.
- [x] Jede Person gemeldet → `PLAYER_NOT_NOMINATED`.
- [x] Über die `REGULAR`-Doppel höchstens `maxDoublesPerPlayer` Einsätze je
      Person → `DOUBLES_LIMIT_EXCEEDED`. Der `DECIDER` zählt nicht mit und
      unterliegt der Grenze nicht (Reglement 2.2.1); auch eine ausgewechselte
      Person ist dort wieder spielberechtigt.

#### validateSubstitution

- [x] `outPlayerId !== inPlayerId` → `INVALID_SUBSTITUTION`.
- [x] Position innerhalb `1..lineupPositions` → `INVALID_LINEUP_POSITION`.
- [x] `effectiveFromSequence > 0` → `INVALID_SUBSTITUTION`.
- [x] `effectiveFromSequence` grösser als jede bereits gestartete Sequenz →
      `SUBSTITUTION_DURING_RUNNING_SLOT` (Reglement 2.2.10: nie während einer
      laufenden Paarung).
- [x] Kontingent der Seite erschöpft → `SUBSTITUTION_LIMIT_EXCEEDED`.
- [x] Gleiche Position und gleiche Sequenz bereits gewechselt →
      `DUPLICATE_SUBSTITUTION` (entspricht dem Unique-Constraint).
- [x] Die einwechselnde Person ist gemeldet → `PLAYER_NOT_NOMINATED`.
- [x] Die einwechselnde Person war nicht bereits ausgewechselt →
      `PLAYER_SUBSTITUTED_OUT` (Sperre für weitere Einzel, Reglement 2.2.4).
- [x] Die einwechselnde Person besetzt zum Zeitpunkt keine andere Position →
      `PLAYER_ALREADY_IN_LINEUP`.
- [x] Die ausgewechselte Person ist zum Zeitpunkt tatsächlich Inhaberin der
      Position → `SUBSTITUTION_OUT_PLAYER_MISMATCH`.

#### resolveSlotOccupancy

- [x] Interne Hilfsfunktion `resolvePositionPlayer(position, sequence, lineup)`:
      die Meldung an der Position, überschrieben durch die jüngste
      Auswechslung derselben Position mit
      `effectiveFromSequence <= sequence`. Bei gleicher Sequenz gewinnt die
      spätere Auswechslung der Eingabeliste. Liefert `null`, wenn die
      Position nicht besetzt ist.
- [x] Einzelslot: je Seite ein Spieler aus Position und Wechselhistorie;
      `complete` ist `playerIds.length === 1`.
- [x] Doppelslot: `doublesPlayerIds` der Seite; `complete` ist genau zwei
      Personen.
- [x] `playable` ist `home.complete && away.complete`.
- [x] `walkoverWinner` ist die vollständige Seite, wenn genau eine
      vollständig ist, sonst `null`. Damit entscheidet Phase 4 beim Start
      der Begegnung ohne eigene Fachlogik, welche Slots einer mit drei
      Personen angetretenen Mannschaft kampflos verloren gehen.
- [x] Ein Einzelslot ohne Positionen oder ein Doppelslot mit Positionen ist
      eine widersprüchliche Eingabe → `INVALID_SLOT_POSITIONS`.

**Verifikation:**
`pnpm --filter @darts-platform/league-engine test -- src/lineup.spec.ts`

Testfälle:
- [x] Vollständige Meldung mit vier Positionen und zwei Ersatzpersonen
      besteht.
- [x] Person zweimal gemeldet → `DUPLICATE_NOMINATION`.
- [x] Zwei Personen auf Position 2 → `DUPLICATE_LINEUP_POSITION`.
- [x] Position 5 bei vier Positionen → `INVALID_LINEUP_POSITION`.
- [x] Person nicht im Kader und nicht als Gast → `PLAYER_NOT_IN_SQUAD`.
- [x] Dieselbe Person als `GUEST` besteht.
- [x] Drei besetzte Positionen bestehen (Reglement 2.2.5).
- [x] Zwei besetzte Positionen → `NOT_ENOUGH_NOMINATIONS`.
- [x] Doppelpaarungen mit vier verschiedenen Personen bestehen.
- [x] Dieselbe Person in beiden regulären Doppeln →
      `DOUBLES_LIMIT_EXCEEDED`.
- [x] Dieselbe Person im Entscheidungsdoppel und in einem regulären Doppel
      besteht.
- [x] Ersatzperson ohne Aufstellungsposition im Doppel besteht.
- [x] Nicht gemeldete Person im Doppel → `PLAYER_NOT_NOMINATED`.
- [x] Paarung mit einer Person → `INVALID_DOUBLES_SIZE`.
- [x] Auswechslung vor dem nächsten Slot besteht.
- [x] Auswechslung mit `effectiveFromSequence` gleich einer gestarteten
      Sequenz → `SUBSTITUTION_DURING_RUNNING_SLOT`.
- [x] Fünfte Auswechslung derselben Seite → `SUBSTITUTION_LIMIT_EXCEEDED`.
- [x] Vierte Auswechslung der Gegenseite besteht trotzdem (Kontingent je
      Seite).
- [x] Einwechslung einer zuvor ausgewechselten Person →
      `PLAYER_SUBSTITUTED_OUT`.
- [x] Falsche ausgewechselte Person → `SUBSTITUTION_OUT_PLAYER_MISMATCH`.
- [x] Einwechslung einer Person, die bereits eine andere Position besetzt →
      `PLAYER_ALREADY_IN_LINEUP`.
- [x] Besetzung eines Einzelslots vor und nach der Auswechslung: der frühere
      Slot behält die alte Person, der spätere trägt die neue.
- [x] Zwei Auswechslungen derselben Position hintereinander: die jüngste
      wirksame gewinnt.
- [x] Besetzung eines Doppelslots aus den Paarungen.
- [x] Fehlende Position 4: `walkoverWinner` ist die Gegenseite,
      `playable` ist `false`.
- [x] Beide Seiten unvollständig: `walkoverWinner` ist `null`.

---

### Task 5: Wertung und Entscheidungsdoppel

`src/result.ts`.

```ts
export type SlotOutcome =
  | { readonly type: "PENDING" }
  | { readonly type: "CANCELLED" }
  | { readonly type: "WALKOVER"; readonly winner: Side }
  | {
      readonly type: "PLAYED";
      readonly winner: Side;
      readonly homeLegs: number;
      readonly awayLegs: number;
    };

export interface ResultSlot {
  readonly sequence: number;
  readonly role: SlotRole;
  readonly legsToWinSet: number;
  readonly setsToWin: number;
  readonly outcome: SlotOutcome;
}

export interface ScoringRules {
  readonly pointsWin: number;
  readonly pointsDraw: number;
  readonly pointsLoss: number;
  readonly pointsDeciderBonus: number;
  readonly deciderRule: "NONE" | "EXTRA_SLOT";
}

export interface ResultInput {
  readonly slots: readonly ResultSlot[];
  readonly scoring: ScoringRules;
  readonly forfeitSide?: Side | null;
}

export interface EncounterResult {
  readonly homeGames: number;
  readonly awayGames: number;
  readonly homeLegs: number;
  readonly awayLegs: number;
  readonly homePoints: number;
  readonly awayPoints: number;
  readonly result: "HOME_WIN" | "AWAY_WIN" | "DRAW" | null;
  readonly resultType: "PLAYED" | "DECIDER" | "FORFEIT" | null;
  readonly complete: boolean;
}

export interface DeciderDecision {
  readonly status:
    | "REGULAR_SLOTS_PENDING"
    | "NOT_REQUIRED"
    | "REQUIRED"
    | "COMPLETED";
  readonly required: boolean;
  readonly slotSequence: number | null;
}
```

- [x] Eingangsprüfung: `pointsWin >= pointsDraw >= pointsLoss >= 0`,
      `pointsDeciderBonus >= 0`, und `pointsDeciderBonus > 0` nur bei
      `deciderRule === 'EXTRA_SLOT'` → `INVALID_SCORING_RULES`. Dieselben
      Bedingungen tragen als CHECK-Constraint auf `competitions`; die Engine
      wiederholt sie, weil sie auch ohne Datenbank benutzbar sein muss.
- [x] Höchstens ein `DECIDER`-Slot → `MULTIPLE_DECIDER_SLOTS`.
- [x] Negative oder nicht ganzzahlige Legs → `INVALID_SLOT_RESULT`.
- [x] `forfeitSide` gesetzt: Ergebnis aus der Vorlage abgeleitet — Spiele
      gleich Zahl der regulären Slots, Legs gleich Summe von
      `legsToWinSet * setsToWin` über die regulären Slots, alles für die
      Gegenseite; Punkte `pointsWin` zu `pointsLoss`; `result` entsprechend,
      `resultType = 'FORFEIT'`, `complete = true`. Die Slotausgänge werden
      dabei ignoriert, weil der Ablauf alle Slots auf `CANCELLED` setzt.
- [x] Regulärer Weg: Spiele und Legs über alle Slots mit terminalem Ausgang.
      `WALKOVER` gibt dem Sieger `legsToWinSet * setsToWin` Legs.
      `PENDING` und `CANCELLED` zählen nirgends.
- [x] `complete` verlangt, dass jeder reguläre Slot terminal ist.
- [x] Bei Gleichstand nach den regulären Slots und `deciderRule = 'NONE'`:
      `DRAW`, beide `pointsDraw`, `resultType = 'PLAYED'`.
- [x] Bei Gleichstand und `EXTRA_SLOT`: fehlt der Entscheidungsslot in der
      Vorlage → `MISSING_DECIDER_SLOT`; ist er noch nicht terminal →
      `complete = false`, Punkte 0, `result = null`; ist er terminal → beide
      `pointsDraw`, der Sieger zusätzlich `pointsDeciderBonus`,
      `resultType = 'DECIDER'`, `result` nach dem Sieger des
      Entscheidungsdoppels. Seine Spiele und Legs zählen mit (Reglement
      A1.4).
- [x] Kein Gleichstand: Sieger `pointsWin`, Verlierer `pointsLoss`,
      `resultType = 'PLAYED'`. Ein nicht benötigter Entscheidungsslot bleibt
      `CANCELLED` und zählt nirgends mit.
- [x] `resolveDeciderRequirement` teilt sich die Auswertung der regulären
      Slots mit `calculateEncounterResult` (gemeinsame interne Funktion) und
      liefert: `REGULAR_SLOTS_PENDING` solange reguläre Slots offen sind,
      `NOT_REQUIRED` bei Vorsprung einer Seite oder `deciderRule = 'NONE'`,
      `REQUIRED` bei Gleichstand mit offenem Entscheidungsslot,
      `COMPLETED` bei bereits gespieltem Entscheidungsslot.
      `slotSequence` trägt die Sequenz des Entscheidungsslots, sonst `null`.
      Bei `forfeitSide` ist das Ergebnis `NOT_REQUIRED`.

**Verifikation:**
`pnpm --filter @darts-platform/league-engine test -- src/result.spec.ts`

Testfälle:
- [x] 18:0 Spiele → 3:0 Punkte, `HOME_WIN`, `PLAYED`.
- [x] 10:8 Spiele → 3:0 Punkte.
- [x] 9:9 Spiele mit `deciderRule = 'NONE'` → 1:1 Punkte, `DRAW`,
      `PLAYED`.
- [x] 9:9 Spiele mit `EXTRA_SLOT` und offenem Entscheidungsslot →
      `complete = false`, Punkte 0:0, `resolveDeciderRequirement` liefert
      `REQUIRED` mit der Sequenz 19.
- [x] Entscheidungsdoppel gewonnen → 10:9 Spiele, 2:1 Punkte, `DECIDER`,
      Legs des Entscheidungsdoppels sind mitgezählt.
- [x] Nicht benötigter, `CANCELLED` gesetzter Entscheidungsslot zählt weder
      in Spielen noch in Legs.
- [x] Wertung mit drei Personen: vier Walkover gegen die unterbesetzte Seite
      ergeben 4 Spiele und 8 Legs für die Gegenseite.
- [x] Walkover-Legs folgen `legsToWinSet * setsToWin`.
- [x] Nichtantritt → 0:3 Punkte, 0:18 Spiele, 0:36 Legs, `FORFEIT`.
- [x] Offene reguläre Slots → `complete = false`, Punkte 0:0,
      `resolveDeciderRequirement` liefert `REGULAR_SLOTS_PENDING`.
- [x] `EXTRA_SLOT` ohne Entscheidungsslot bei Gleichstand →
      `MISSING_DECIDER_SLOT` aus beiden Funktionen.
- [x] `pointsDeciderBonus > 0` bei `deciderRule = 'NONE'` →
      `INVALID_SCORING_RULES`.
- [x] Zwei Entscheidungsslots → `MULTIPLE_DECIDER_SLOTS`.

---

### Task 6: Öffentliche Schnittstelle

- [x] `src/index.ts` re-exportiert nach dem Vorbild von
      `tournament-engine/src/index.ts`: benannte Funktionen zuerst, danach
      `type`-Exports, alphabetisch, mit `.js`-Endung im Modulpfad.
- [x] Exportiert werden alle sieben Funktionen der Roadmap, die
      `LeagueValidationError` und sämtliche Eingabe- und Ausgabetypen, die
      Phase 4 zum Aufruf braucht.
- [x] Nichts sonst: interne Hilfsfunktionen bleiben im Modul.

---

### Task 7: Dokumentation und Vollverifikation

- [x] `ARCHITECTURE.md` nennt das neue Paket in der Paketliste, falls dort
      eine geführt wird; sonst keine Änderung.
- [x] Diesen Plan als ausgeführt kennzeichnen und Abweichungen festhalten.
- [x] Prüfen, ob die Umsetzung der in der Roadmap festgehaltenen
      Schnittstelle entspricht. Bei Abweichung die Roadmap mitändern — sie
      ist die verbindliche Quelle für Phase 4.
- [x] Vollverifikation, einmal:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Umsetzung

**Status:** ausgeführt am 2026-09-02 auf `feature/phase-3-league-engine`.

Die Schnittstelle entspricht der Roadmap unverändert; sie musste nicht
nachgeführt werden. Das Paket umfasst 79 Tests in drei Dateien:
`template.spec.ts` (20), `lineup.spec.ts` (38), `result.spec.ts` (21).

Abweichungen vom Plan:

1. Zusätzlich zu `ARCHITECTURE.md` nennen auch `AGENTS.md` und `README.md` das
   neue Paket, weil beide dieselbe Paketliste führen.
2. `otherSide(side)` ist ein Modulexport von `template.ts`, aber bewusst nicht
   Teil von `index.ts`: eine Hilfsfunktion ohne Fachaussage gehört nicht in
   die Schnittstelle zu Phase 4.

## Selbstprüfung gegen die Spec

- „Vorlagenvalidierung (Lücke in der Sequenz, zwei Entscheidungsslots,
  ungerade Distanz, unvollständiges Rundenturnier)" → Task 3.
- „jede Fehlerklasse der Melde-, Doppel- und Auswechselprüfung" → Task 4.
- „Wertung 18:0 bis 9:9, Zusatzpunkt nach Entscheidungsdoppel, Wertung mit
  drei Personen, Nichtantritt mit 0:3 / 0:18 / 0:36" → Task 5.
- „abgeleitete Slotbesetzung nach Auswechslung" → Task 4,
  `resolveSlotOccupancy`.
- „Fehler sind eine `LeagueValidationError` mit stabilem Code" → Task 2 und
  die Codetabellen in Task 3 bis 5.
- „Die Tabellenberechnung ist bewusst nicht enthalten" → „Nicht in dieser
  Phase".
