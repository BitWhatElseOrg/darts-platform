# Einzelrangliste (Reglement A1.6–A1.10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Einzelrangliste je Wettbewerb (Trefferquote, Ranglistenpunkte, Rangkriterien Q-Sp./Q-Satz nach Reglement A1.7–A1.9), berechnet aus bereits gespeicherten Encounter-Slots — als neuer Endpunkt und als neuer Abschnitt in der Wettbewerbsansicht.

**Architecture:** Reine Domänenrechnung in `league-engine` (analog `standings.ts`), gespeist aus einer Repository-Query über abgeschlossene Begegnungen samt Einzelslots, Meldungen und Auswechslungen. Kein neues Schema, keine Migration, kein Read-Model — derselbe On-the-fly-Pfad wie die bestehende Ligatabelle.

**Tech Stack:** TypeScript, Drizzle ORM, NestJS, Zod, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-einzelrangliste-design.md`

## Global Constraints

- Business-Logik ausschliesslich in `league-engine`; API-Schicht bleibt dünn und hängt nur Namen an (AGENTS.md §4).
- Jede Repository-Query ist nach `organizationId` eingeschränkt.
- API-Antworten laufen durch ein Zod-Schema (serverseitige Validierung an der Grenze).
- Mutation entfällt hier vollständig — reiner Lesepfad, keine `commandId`/Version nötig.
- Regelverweise im Code nennen die jeweilige Reglement-Ziffer (z. B. `Reglement A1.7`), wie in `standings.ts`/`lineup.ts` bereits üblich.
- Rangfolge wird über ganzzahlige Kreuzmultiplikation verglichen, nie über Fliesskommazahlen (Spec, Abschnitt „Rechnung").
- Nur `SINGLES`-Slots mit `status in ('COMPLETED', 'WALKOVER')` innerhalb einer Begegnung mit `status = 'COMPLETED'` zählen.

---

### Task 1: Domain — `calculatePlayerRanking` in league-engine

**Files:**
- Create: `packages/league-engine/src/player-ranking.ts`
- Create: `packages/league-engine/src/player-ranking.spec.ts`
- Modify: `packages/league-engine/src/index.ts` (Export ergänzen)

**Interfaces:**
- Produces:
  ```ts
  export interface PlayerRankingSlot {
    readonly encounterId: string;
    readonly encounterStatus: "DRAFT" | "LINEUPS_OPEN" | "READY" | "RUNNING" | "COMPLETED" | "CANCELLED";
    readonly matchday: number;
    readonly discipline: "SINGLES" | "DOUBLES";
    readonly status: "WAITING" | "READY" | "IN_PROGRESS" | "COMPLETED" | "WALKOVER" | "CANCELLED";
    readonly legsToWinSet: number;
    readonly homeTeamId: string;
    readonly awayTeamId: string;
    /** Aufgelöst über `resolveSlotOccupancy`: genau eine Person je Seite bei einem gewerteten Einzelslot, sonst leer. */
    readonly homePlayerIds: readonly string[];
    readonly awayPlayerIds: readonly string[];
    readonly homeLegs: number;
    readonly awayLegs: number;
  }

  export interface PlayerRankingInput {
    readonly slots: readonly PlayerRankingSlot[];
  }

  export interface PlayerRankingRow {
    readonly playerId: string;
    readonly teamId: string;
    readonly otherTeamsCount: number;
    readonly played: number;
    readonly won: number;
    readonly lost: number;
    readonly achievedPoints: number;
    readonly possiblePoints: number;
    /** Gerundet auf 4 Nachkommastellen für stabile Snapshot-/JSON-Vergleiche; die Rangfolge selbst nutzt die exakten Brüche. */
    readonly hitRate: number;
    readonly rankingPoints: number;
    readonly rank: number;
  }

  export function calculatePlayerRanking(input: PlayerRankingInput): readonly PlayerRankingRow[];
  ```
- Consumes: nichts aus anderen Tasks — reine Blattfunktion.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/league-engine/src/player-ranking.spec.ts
import { describe, expect, it } from "vitest";

import { calculatePlayerRanking, type PlayerRankingSlot } from "./player-ranking.js";

const TEAM_A = "team-a";
const TEAM_B = "team-b";
const ALICE = "player-alice";
const BOB = "player-bob";
const CARLA = "player-carla";

function singles(overrides: Partial<PlayerRankingSlot> = {}): PlayerRankingSlot {
  return {
    encounterId: "encounter-1",
    encounterStatus: "COMPLETED",
    matchday: 1,
    discipline: "SINGLES",
    status: "COMPLETED",
    legsToWinSet: 2,
    homeTeamId: TEAM_A,
    awayTeamId: TEAM_B,
    homePlayerIds: [ALICE],
    awayPlayerIds: [BOB],
    homeLegs: 2,
    awayLegs: 0,
    ...overrides,
  };
}

describe("calculatePlayerRanking", () => {
  it("gibt eine leere Liste ohne gewertete Slots zurück", () => {
    expect(calculatePlayerRanking({ slots: [] })).toEqual([]);
  });

  it("rechnet die Punktetabelle nach Reglement A1.7 für alle vier Satzausgänge", () => {
    const cases: readonly [number, number, number, number][] = [
      // [homeLegs, awayLegs, erwartete Heimpunkte, erwartete Gastpunkte]
      [2, 0, 4, 0],
      [2, 1, 3, 1],
      [1, 2, 1, 3],
      [0, 2, 0, 4],
    ];
    for (const [homeLegs, awayLegs, homePoints, awayPoints] of cases) {
      const rows = calculatePlayerRanking({
        slots: [singles({ homeLegs, awayLegs })],
      });
      const alice = rows.find((row) => row.playerId === ALICE);
      const bob = rows.find((row) => row.playerId === BOB);
      expect(alice).toMatchObject({ achievedPoints: homePoints, possiblePoints: 4 });
      expect(bob).toMatchObject({ achievedPoints: awayPoints, possiblePoints: 4 });
    }
  });

  it("zählt Doppelslots nicht (Spec-Entscheid: nur Einzel)", () => {
    const rows = calculatePlayerRanking({
      slots: [singles({ discipline: "DOUBLES", homePlayerIds: [ALICE, CARLA], awayPlayerIds: [BOB] })],
    });
    expect(rows).toEqual([]);
  });

  it("zählt nur Begegnungen mit Status COMPLETED", () => {
    const rows = calculatePlayerRanking({
      slots: [singles({ encounterStatus: "RUNNING" })],
    });
    expect(rows).toEqual([]);
  });

  it("zählt CANCELLED-Slots nicht (Nichtantritt der ganzen Begegnung)", () => {
    const rows = calculatePlayerRanking({
      slots: [singles({ status: "CANCELLED" })],
    });
    expect(rows).toEqual([]);
  });

  it("zählt einen Einzel-Walkover mit dem erfassten Legstand (A4.4)", () => {
    const rows = calculatePlayerRanking({
      slots: [singles({ status: "WALKOVER", homeLegs: 2, awayLegs: 0 })],
    });
    const alice = rows.find((row) => row.playerId === ALICE);
    expect(alice).toMatchObject({ played: 1, won: 1, achievedPoints: 4 });
  });

  it("gibt einer ausgewechselten Person drei statt vier gewertete Einzel", () => {
    const rows = calculatePlayerRanking({
      slots: [
        singles({ encounterId: "e1", homePlayerIds: [ALICE] }),
        singles({ encounterId: "e1", homePlayerIds: [ALICE] }),
        singles({ encounterId: "e1", homePlayerIds: [ALICE] }),
        singles({ encounterId: "e1", homePlayerIds: [CARLA] }),
      ],
    });
    const alice = rows.find((row) => row.playerId === ALICE);
    const carla = rows.find((row) => row.playerId === CARLA);
    expect(alice?.played).toBe(3);
    expect(carla?.played).toBe(1);
  });

  it("ordnet eine Aushilfe der Mannschaft mit den meisten gewerteten Einzeln zu und zählt die andere", () => {
    const rows = calculatePlayerRanking({
      slots: [
        singles({ encounterId: "e1", matchday: 1, homeTeamId: TEAM_A, homePlayerIds: [ALICE] }),
        singles({ encounterId: "e1", matchday: 1, homeTeamId: TEAM_A, homePlayerIds: [ALICE] }),
        singles({ encounterId: "e2", matchday: 2, homeTeamId: TEAM_B, homePlayerIds: [ALICE], awayTeamId: TEAM_A }),
      ],
    });
    const alice = rows.find((row) => row.playerId === ALICE);
    expect(alice).toMatchObject({ teamId: TEAM_A, played: 3, otherTeamsCount: 1 });
  });

  it("ordnet nach Ranglistenpunkten (Kriterium 1)", () => {
    const rows = calculatePlayerRanking({
      slots: [
        singles({ homePlayerIds: [ALICE], homeLegs: 2, awayLegs: 0, awayPlayerIds: [BOB] }),
        singles({ homePlayerIds: [CARLA], homeLegs: 2, awayLegs: 1, awayPlayerIds: [BOB] }),
      ],
    });
    const ordered = rows.map((row) => row.playerId);
    expect(ordered.indexOf(ALICE)).toBeLessThan(ordered.indexOf(CARLA));
  });

  it("unterscheidet zwei Personen mit gleichem Q-Sp. schon über die Ranglistenpunkte (Kriterium 1 wertet die Siegmarge)", () => {
    // Beide je 1 Sieg aus 2 Einzeln (Q-Sp. gleich, 0.5), aber Carla mit der
    // überzeugenderen Siegmarge (2:0 statt 2:1) und damit höheren
    // Ranglistenpunkten — Kriterium 1 entscheidet hier bereits, ohne dass
    // Q-Sp. oder Q-Satz befragt werden müssen.
    const rows = calculatePlayerRanking({
      slots: [
        singles({ encounterId: "e1", homePlayerIds: [ALICE], homeLegs: 2, awayLegs: 1, awayPlayerIds: [BOB] }),
        singles({ encounterId: "e2", homePlayerIds: [ALICE], homeLegs: 0, awayLegs: 2, awayPlayerIds: [BOB] }),
        singles({ encounterId: "e3", homePlayerIds: [CARLA], homeLegs: 2, awayLegs: 0, awayPlayerIds: [BOB] }),
        singles({ encounterId: "e4", homePlayerIds: [CARLA], homeLegs: 0, awayLegs: 2, awayPlayerIds: [BOB] }),
      ],
    });
    const alice = rows.find((row) => row.playerId === ALICE);
    const carla = rows.find((row) => row.playerId === CARLA);
    // Alice: erzielte 3+0=3, möglich 8 -> Ranglistenpkt 3²/8 = 1.125.
    // Carla: erzielte 4+0=4, möglich 8 -> Ranglistenpkt 4²/8 = 2.0.
    expect((carla?.rank ?? 99)).toBeLessThan(alice?.rank ?? 0);
  });

  it("bricht einen echten Gleichstand der Ranglistenpunkte über Q-Sp. (Kriterium 2)", () => {
    // Beide kommen exakt auf Ranglistenpunkte 4 (erzielte² / mögliche =
    // 16/4 bzw. 64/16), aber mit unterschiedlichem Q-Sp.: Alice gewinnt ihr
    // einziges Einzel (Q-Sp. 1.0), Bob steht bei zwei Siegen aus vier
    // Einzeln (Q-Sp. 0.5) — von Hand nachgerechnet, keine Zufallszahlen.
    const rows = calculatePlayerRanking({
      slots: [
        singles({ encounterId: "e1", homePlayerIds: [ALICE], homeLegs: 2, awayLegs: 0, awayPlayerIds: [CARLA] }),
        singles({ encounterId: "e2", homePlayerIds: [BOB], homeLegs: 2, awayLegs: 0, awayPlayerIds: [CARLA] }),
        singles({ encounterId: "e3", homePlayerIds: [BOB], homeLegs: 2, awayLegs: 0, awayPlayerIds: [CARLA] }),
        singles({ encounterId: "e4", homePlayerIds: [BOB], homeLegs: 0, awayLegs: 2, awayPlayerIds: [CARLA] }),
        singles({ encounterId: "e5", homePlayerIds: [BOB], homeLegs: 0, awayLegs: 2, awayPlayerIds: [CARLA] }),
      ],
    });
    const alice = rows.find((row) => row.playerId === ALICE);
    const bob = rows.find((row) => row.playerId === BOB);
    // Alice: erzielte 4, möglich 4 -> Ranglistenpkt 16/4 = 4.0, Q-Sp. 1/1 = 1.0.
    // Bob: erzielte 4+4+0+0=8, möglich 16 -> Ranglistenpkt 64/16 = 4.0, Q-Sp. 2/4 = 0.5.
    expect(alice?.rankingPoints).toBeCloseTo(bob?.rankingPoints ?? -1, 6);
    expect((alice?.rank ?? 99)).toBeLessThan(bob?.rank ?? 0);
  });

  it("teilt gleiche Ranglistenpunkte, Q-Sp. und Q-Satz auf einen gemeinsamen Rang und überspringt den nächsten", () => {
    // Alice und Carla haben je exakt dasselbe Ergebnis (2:0 gegen Bob) und
    // damit identische Ranglistenpunkte, Q-Sp. und Q-Satz — ein echter
    // Gleichstand. Bob verliert beide Einzel und bleibt klar dahinter.
    const rows = calculatePlayerRanking({
      slots: [
        singles({ encounterId: "e1", homePlayerIds: [ALICE], homeLegs: 2, awayLegs: 0, awayPlayerIds: [BOB] }),
        singles({ encounterId: "e2", homePlayerIds: [CARLA], homeLegs: 2, awayLegs: 0, awayPlayerIds: [BOB] }),
      ],
    });
    const alice = rows.find((row) => row.playerId === ALICE);
    const carla = rows.find((row) => row.playerId === CARLA);
    expect(alice?.rank).toBe(carla?.rank);
    const bob = rows.find((row) => row.playerId === BOB);
    expect(bob?.rank).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/league-engine && npx vitest run src/player-ranking.spec.ts`
Expected: FAIL with "Cannot find module './player-ranking.js'"

- [ ] **Step 3: Write the implementation**

```ts
// packages/league-engine/src/player-ranking.ts
/**
 * Die Einzelrangliste. Reine Domänenlogik: sie bekommt die gewerteten
 * Einzelslots und gibt die geordnete Rangliste zurück — keine Datenbank,
 * keine Namen. Wertung nach `Reglement A1.6–A1.9`; nur Einzel zählen, Doppel
 * nie (Spec-Entscheid vom 2026-09-02).
 */

export interface PlayerRankingSlot {
  readonly encounterId: string;
  readonly encounterStatus:
    | "DRAFT"
    | "LINEUPS_OPEN"
    | "READY"
    | "RUNNING"
    | "COMPLETED"
    | "CANCELLED";
  readonly matchday: number;
  readonly discipline: "SINGLES" | "DOUBLES";
  readonly status: "WAITING" | "READY" | "IN_PROGRESS" | "COMPLETED" | "WALKOVER" | "CANCELLED";
  /** Reglement A1.7: mögliche Punkte je Einzel sind `2 × legsToWinSet`. */
  readonly legsToWinSet: number;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  /** Über `resolveSlotOccupancy` aufgelöst: genau eine Person bei einem gewerteten Einzel, sonst leer. */
  readonly homePlayerIds: readonly string[];
  readonly awayPlayerIds: readonly string[];
  readonly homeLegs: number;
  readonly awayLegs: number;
}

export interface PlayerRankingInput {
  readonly slots: readonly PlayerRankingSlot[];
}

export interface PlayerRankingRow {
  readonly playerId: string;
  readonly teamId: string;
  readonly otherTeamsCount: number;
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly achievedPoints: number;
  readonly possiblePoints: number;
  readonly hitRate: number;
  readonly rankingPoints: number;
  readonly rank: number;
}

interface Tally {
  played: number;
  won: number;
  lost: number;
  achievedPoints: number;
  possiblePoints: number;
  legsFor: number;
  legsPlayed: number;
  teamCounts: Map<string, { count: number; lastMatchday: number }>;
}

function emptyTally(): Tally {
  return {
    played: 0,
    won: 0,
    lost: 0,
    achievedPoints: 0,
    possiblePoints: 0,
    legsFor: 0,
    legsPlayed: 0,
    teamCounts: new Map(),
  };
}

function bookSide(
  tallies: Map<string, Tally>,
  playerId: string,
  teamId: string,
  matchday: number,
  ownLegs: number,
  opponentLegs: number,
  legsToWinSet: number,
): void {
  const tally = tallies.get(playerId) ?? emptyTally();
  tallies.set(playerId, tally);

  const possible = 2 * legsToWinSet;
  const won = ownLegs > opponentLegs;
  // Reglement A1.7: Sieger erhält mögliche Punkte abzüglich der gegnerischen
  // Sätze, Verlierer die eigenen Sätze — deckungsgleich mit der Tabelle
  // (2:0 -> 4, 2:1 -> 3, 1:2 -> 1, 0:2 -> 0) bei legsToWinSet = 2.
  const achieved = won ? possible - opponentLegs : ownLegs;

  tally.played += 1;
  if (won) tally.won += 1;
  else tally.lost += 1;
  tally.achievedPoints += achieved;
  tally.possiblePoints += possible;
  tally.legsFor += ownLegs;
  tally.legsPlayed += ownLegs + opponentLegs;

  const teamCount = tally.teamCounts.get(teamId) ?? { count: 0, lastMatchday: 0 };
  teamCount.count += 1;
  teamCount.lastMatchday = Math.max(teamCount.lastMatchday, matchday);
  tally.teamCounts.set(teamId, teamCount);
}

function primaryTeam(tally: Tally): { readonly teamId: string; readonly otherTeamsCount: number } {
  const entries = [...tally.teamCounts.entries()];
  entries.sort(([teamA, a], [teamB, b]) => {
    if (a.count !== b.count) return b.count - a.count;
    if (a.lastMatchday !== b.lastMatchday) return b.lastMatchday - a.lastMatchday;
    return teamA < teamB ? -1 : teamA > teamB ? 1 : 0;
  });
  const [first] = entries;
  if (first === undefined) throw new Error("Player tally without a team.");
  return { teamId: first[0], otherTeamsCount: entries.length - 1 };
}

/**
 * Vergleicht zwei Brüche `a/b` und `c/d` (b, d > 0) ohne Fliesskommarundung.
 * Positiv, wenn `a/b` grösser ist als `c/d`.
 */
function compareFractions(a: number, b: number, c: number, d: number): number {
  return a * d - c * b;
}

interface RankedCandidate {
  readonly playerId: string;
  readonly achievedPoints: number;
  readonly possiblePoints: number;
  readonly won: number;
  readonly played: number;
  readonly legsFor: number;
  readonly legsPlayed: number;
}

/**
 * Reglement A1.9: Ranglistenpunkte, dann Q-Sp., dann Q-Satz. Positiv, wenn
 * `first` vor `second` stehen soll (fachlich besser ist). Rein antisymmetrisch:
 * `compareRows(b, a) === -compareRows(a, b)` für jedes Paar, das macht den
 * finalen `playerId`-Tiebreak unten sicher.
 */
function compareRows(first: RankedCandidate, second: RankedCandidate): number {
  // Ranglistenpunkte = Trefferquote × erzielte Punkte = erzielte² / mögliche.
  const byRankingPoints = compareFractions(
    first.achievedPoints * first.achievedPoints,
    first.possiblePoints,
    second.achievedPoints * second.achievedPoints,
    second.possiblePoints,
  );
  if (byRankingPoints !== 0) return byRankingPoints;

  const byGameQuotient = compareFractions(first.won, first.played, second.won, second.played);
  if (byGameQuotient !== 0) return byGameQuotient;

  const bySetQuotient = compareFractions(
    first.legsFor,
    first.legsPlayed,
    second.legsFor,
    second.legsPlayed,
  );
  if (bySetQuotient !== 0) return bySetQuotient;

  // Rein technischer, stabiler Tiebreak ohne fachliche Bedeutung.
  if (first.playerId === second.playerId) return 0;
  return first.playerId < second.playerId ? 1 : -1;
}

export function calculatePlayerRanking(input: PlayerRankingInput): readonly PlayerRankingRow[] {
  const tallies = new Map<string, Tally>();

  for (const slot of input.slots) {
    if (slot.encounterStatus !== "COMPLETED") continue;
    if (slot.discipline !== "SINGLES") continue;
    if (slot.status !== "COMPLETED" && slot.status !== "WALKOVER") continue;

    const [homePlayerId] = slot.homePlayerIds;
    const [awayPlayerId] = slot.awayPlayerIds;
    if (homePlayerId === undefined || awayPlayerId === undefined) continue;

    bookSide(tallies, homePlayerId, slot.homeTeamId, slot.matchday, slot.homeLegs, slot.awayLegs, slot.legsToWinSet);
    bookSide(tallies, awayPlayerId, slot.awayTeamId, slot.matchday, slot.awayLegs, slot.homeLegs, slot.legsToWinSet);
  }

  const rows = [...tallies.entries()].map(([playerId, tally]) => {
    const { teamId, otherTeamsCount } = primaryTeam(tally);
    return {
      playerId,
      teamId,
      otherTeamsCount,
      played: tally.played,
      won: tally.won,
      lost: tally.lost,
      achievedPoints: tally.achievedPoints,
      possiblePoints: tally.possiblePoints,
      hitRate: tally.possiblePoints === 0 ? 0 : Math.round((tally.achievedPoints / tally.possiblePoints) * 10_000) / 10_000,
      rankingPoints:
        tally.possiblePoints === 0
          ? 0
          : Math.round(((tally.achievedPoints * tally.achievedPoints) / tally.possiblePoints) * 10_000) / 10_000,
      legsFor: tally.legsFor,
      legsPlayed: tally.legsPlayed,
      rank: 0,
    };
  });

  // `compareRows(a, b) > 0` heisst „a ist besser als b"; für eine nach dem
  // besten Rang beginnende Liste muss der Comparator bei besserem `a`
  // negativ werden — daher die vertauschten Argumente.
  const ordered = [...rows].sort((a, b) => compareRows(b, a));

  const ranked: PlayerRankingRow[] = [];
  for (const [index, row] of ordered.entries()) {
    const previous = ordered[index - 1];
    const previousRank = ranked[index - 1]?.rank ?? 0;
    const shared = previous !== undefined && compareRows(previous, row) === 0;
    const { legsFor: _legsFor, legsPlayed: _legsPlayed, ...rest } = row;
    ranked.push({ ...rest, rank: shared ? previousRank : index + 1 });
  }
  return ranked;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/league-engine && npx vitest run src/player-ranking.spec.ts`
Expected: PASS (alle 12 Fälle)

- [ ] **Step 5: Export from the package barrel**

In `packages/league-engine/src/index.ts`, nach dem bestehenden
`standings.js`-Export ergänzen:

```ts
export {
  calculatePlayerRanking,
  type PlayerRankingInput,
  type PlayerRankingRow,
  type PlayerRankingSlot,
} from "./player-ranking.js";
```

- [ ] **Step 6: Run the full engine test suite and typecheck**

Run: `cd packages/league-engine && npx vitest run && npx tsc --noEmit`
Expected: PASS, keine Typfehler

- [ ] **Step 7: Commit**

```bash
git add packages/league-engine/src/player-ranking.ts packages/league-engine/src/player-ranking.spec.ts packages/league-engine/src/index.ts
git commit -m "feat(league-engine): Einzelrangliste nach Reglement A1.7-A1.9

Trefferquote, erzielte/mögliche Punkte, Ranglistenpunkte, Rangkriterien
Q-Sp./Q-Satz. Reine Domänenrechnung, Rangfolge über ganzzahlige
Kreuzmultiplikation statt Fliesskommavergleich."
```

---

### Task 2: Zod-Schema für die API-Antwort

**Files:**
- Modify: `packages/schemas/src/league.ts` (neue Schemas nach `competitionStandingsSchema`, Zeile ~140)
- Modify: `packages/schemas/src/index.ts` (Re-Export)

**Interfaces:**
- Consumes: nichts.
- Produces:
  ```ts
  export const playerRankingRowSchema: z.ZodType<{
    playerId: string;
    playerName: string;
    teamId: string;
    teamName: string;
    teamShortName: string | null;
    otherTeamsCount: number;
    rank: number;
    played: number;
    won: number;
    lost: number;
    achievedPoints: number;
    possiblePoints: number;
    hitRate: number;
    rankingPoints: number;
  }>;
  export const competitionPlayerRankingSchema: z.ZodType<{
    competitionId: string;
    rows: /* array of the above */;
  }>;
  export type PlayerRankingRowResponse = z.infer<typeof playerRankingRowSchema>;
  export type CompetitionPlayerRanking = z.infer<typeof competitionPlayerRankingSchema>;
  ```

- [ ] **Step 1: Add the schemas**

In `packages/schemas/src/league.ts`, direkt nach dem Block
`export type CompetitionStandings = z.infer<typeof competitionStandingsSchema>;`
(aktuell Zeile 139) einfügen:

```ts
export const playerRankingRowSchema = z.object({
  playerId: z.uuid(),
  playerName: z.string(),
  teamId: z.uuid(),
  teamName: z.string(),
  teamShortName: z.string().nullable(),
  /** Anzahl weiterer Mannschaften, für die die Person mindestens ein gewertetes Einzel hat. */
  otherTeamsCount: z.number().int().nonnegative(),
  rank: z.number().int().positive(),
  played: z.number().int().nonnegative(),
  won: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
  achievedPoints: z.number().int().nonnegative(),
  possiblePoints: z.number().int().nonnegative(),
  /** Reglement A1.8. Zwischen 0 und 1, gerundet auf 4 Nachkommastellen. */
  hitRate: z.number().min(0).max(1),
  /** Reglement A1.8: Trefferquote × erzielte Punkte. */
  rankingPoints: z.number().nonnegative(),
});

export const competitionPlayerRankingSchema = z.object({
  competitionId: z.uuid(),
  rows: z.array(playerRankingRowSchema),
});

export type PlayerRankingRowResponse = z.infer<typeof playerRankingRowSchema>;
export type CompetitionPlayerRanking = z.infer<typeof competitionPlayerRankingSchema>;
```

- [ ] **Step 2: Re-export from the package index**

In `packages/schemas/src/index.ts`: `competitionPlayerRankingSchema` zur
Werte-Export-Zeile hinzufügen, die bereits `competitionStandingsSchema`
enthält (Zeile 146), und `playerRankingRowSchema` neben `standingsRowSchema`
(Zeile 174). Die Typen `CompetitionPlayerRanking` und
`PlayerRankingRowResponse` alphabetisch in den Typ-Export-Block einreihen
(neben `type StandingsRowResponse`, Zeile ~216).

- [ ] **Step 3: Typecheck the schemas package**

Run: `cd packages/schemas && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/schemas/src/league.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): Zod-Schema für die Einzelrangliste"
```

---

### Task 3: Repository-Query `playerRankingSource`

**Files:**
- Modify: `apps/api/src/competitions/competitions.repository.ts`

**Interfaces:**
- Consumes: nichts aus anderen Tasks (reine Datenbankschicht); nutzt
  `encounters`, `encounterSlots`, `encounterNominations`,
  `encounterSubstitutions`, `players`, `teams` aus `@darts-platform/database`.
- Produces:
  ```ts
  export interface PlayerRankingSource {
    readonly encounters: readonly {
      readonly id: string;
      readonly status: string;
      readonly matchday: number;
      readonly homeTeamId: string;
      readonly awayTeamId: string;
    }[];
    readonly slots: readonly {
      readonly encounterId: string;
      readonly discipline: string;
      readonly status: string;
      readonly legsToWinSet: number;
      readonly homePosition: number | null;
      readonly awayPosition: number | null;
      readonly homeLegs: number;
      readonly awayLegs: number;
    }[];
    readonly nominations: readonly {
      readonly encounterId: string;
      readonly side: string;
      readonly playerId: string;
      readonly position: number | null;
      readonly origin: string;
    }[];
    readonly substitutions: readonly {
      readonly encounterId: string;
      readonly side: string;
      readonly position: number;
      readonly outPlayerId: string;
      readonly inPlayerId: string;
      readonly effectiveFromSequence: number;
    }[];
    readonly players: readonly { readonly id: string; readonly displayName: string }[];
    readonly teams: readonly { readonly id: string; readonly name: string; readonly shortName: string | null }[];
  }
  public async playerRankingSource(input: {
    readonly organizationId: string;
    readonly competitionId: string;
  }): Promise<PlayerRankingSource>;
  ```
  Genutzt von Task 4 (Service).

Diese Query lädt bewusst rohe Zeilen und delegiert die
Besetzungsauflösung (`resolveSlotOccupancy`) an den Service/die Engine —
die Repository-Schicht bleibt reine Datenbeschaffung.

- [ ] **Step 1: Add imports**

In `apps/api/src/competitions/competitions.repository.ts`, den bestehenden
Import-Block erweitern:

```ts
import {
  auditEvents,
  competitionSlots,
  competitions,
  encounterNominations,
  encounters,
  encounterSlots,
  encounterSubstitutions,
  players,
  teams,
} from "@darts-platform/database";
```

- [ ] **Step 2: Add the `PlayerRankingSource` type and query**

Direkt nach der bestehenden `StandingsSource`-Definition (nach Zeile 46)
einfügen:

```ts
/** Was die Einzelrangliste aus der Datenbank braucht: gewertete Einzelslots samt Besetzungsdaten. */
export interface PlayerRankingSource {
  readonly encounters: readonly {
    readonly id: string;
    readonly status: string;
    readonly matchday: number;
    readonly homeTeamId: string;
    readonly awayTeamId: string;
  }[];
  readonly slots: readonly {
    readonly encounterId: string;
    readonly discipline: string;
    readonly status: string;
    readonly legsToWinSet: number;
    readonly homePosition: number | null;
    readonly awayPosition: number | null;
    readonly homeLegs: number;
    readonly awayLegs: number;
  }[];
  readonly nominations: readonly {
    readonly encounterId: string;
    readonly side: string;
    readonly playerId: string;
    readonly position: number | null;
    readonly origin: string;
  }[];
  readonly substitutions: readonly {
    readonly encounterId: string;
    readonly side: string;
    readonly position: number;
    readonly outPlayerId: string;
    readonly inPlayerId: string;
    readonly effectiveFromSequence: number;
  }[];
  readonly players: readonly { readonly id: string; readonly displayName: string }[];
  readonly teams: readonly { readonly id: string; readonly name: string; readonly shortName: string | null }[];
}
```

Und als neue Methode auf `CompetitionsRepository`, direkt nach
`standingsSource` (nach der schliessenden `}` von dessen Methodenkörper):

```ts
/**
 * Nur abgeschlossene Begegnungen; deren Einzelslots, Meldungen und
 * Auswechslungen lösen `resolveSlotOccupancy` im Service auf. Doppelslots
 * werden mitgeladen (für die Vollständigkeit der Begegnung), aber von der
 * Engine verworfen — sie zählen nicht für die Einzelrangliste.
 */
public async playerRankingSource(input: {
  readonly organizationId: string;
  readonly competitionId: string;
}): Promise<PlayerRankingSource> {
  const encounterRows = await this.databaseService.database
    .select({
      id: encounters.id,
      status: encounters.status,
      matchday: encounters.matchday,
      homeTeamId: encounters.homeTeamId,
      awayTeamId: encounters.awayTeamId,
    })
    .from(encounters)
    .where(
      and(
        eq(encounters.organizationId, input.organizationId),
        eq(encounters.competitionId, input.competitionId),
        eq(encounters.status, "COMPLETED"),
      ),
    );

  if (encounterRows.length === 0) {
    return { encounters: [], slots: [], nominations: [], substitutions: [], players: [], teams: [] };
  }
  const encounterIds = encounterRows.map((row) => row.id);

  const [slotRows, nominationRows, substitutionRows] = await Promise.all([
    this.databaseService.database
      .select({
        encounterId: encounterSlots.encounterId,
        discipline: encounterSlots.discipline,
        status: encounterSlots.status,
        legsToWinSet: encounterSlots.legsToWinSet,
        homePosition: encounterSlots.homePosition,
        awayPosition: encounterSlots.awayPosition,
        homeLegs: encounterSlots.homeLegs,
        awayLegs: encounterSlots.awayLegs,
      })
      .from(encounterSlots)
      .where(
        and(
          eq(encounterSlots.organizationId, input.organizationId),
          inArray(encounterSlots.encounterId, encounterIds),
        ),
      ),
    this.databaseService.database
      .select({
        encounterId: encounterNominations.encounterId,
        side: encounterNominations.side,
        playerId: encounterNominations.playerId,
        position: encounterNominations.position,
        origin: encounterNominations.origin,
      })
      .from(encounterNominations)
      .where(
        and(
          eq(encounterNominations.organizationId, input.organizationId),
          inArray(encounterNominations.encounterId, encounterIds),
        ),
      ),
    this.databaseService.database
      .select({
        encounterId: encounterSubstitutions.encounterId,
        side: encounterSubstitutions.side,
        position: encounterSubstitutions.position,
        outPlayerId: encounterSubstitutions.outPlayerId,
        inPlayerId: encounterSubstitutions.inPlayerId,
        effectiveFromSequence: encounterSubstitutions.effectiveFromSequence,
      })
      .from(encounterSubstitutions)
      .where(
        and(
          eq(encounterSubstitutions.organizationId, input.organizationId),
          inArray(encounterSubstitutions.encounterId, encounterIds),
        ),
      ),
  ]);

  const playerIds = [...new Set(nominationRows.flatMap((row) => [row.playerId]))];
  const teamIds = [...new Set(encounterRows.flatMap((row) => [row.homeTeamId, row.awayTeamId]))];

  const [playerRows, teamRows] = await Promise.all([
    playerIds.length === 0
      ? Promise.resolve([])
      : this.databaseService.database
          .select({ id: players.id, displayName: players.displayName })
          .from(players)
          .where(and(eq(players.organizationId, input.organizationId), inArray(players.id, playerIds))),
    this.databaseService.database
      .select({ id: teams.id, name: teams.name, shortName: teams.shortName })
      .from(teams)
      .where(and(eq(teams.organizationId, input.organizationId), inArray(teams.id, teamIds))),
  ]);

  return {
    encounters: encounterRows,
    slots: slotRows,
    nominations: nominationRows,
    substitutions: substitutionRows,
    players: playerRows,
    teams: teamRows,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/api && npx tsc --noEmit`
Expected: PASS (das Ergebnis wird in Task 4 zum ersten Mal konsumiert, aber
die Query selbst muss bereits typprüfen)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/competitions/competitions.repository.ts
git commit -m "feat(api): Repository-Query für die Einzelrangliste

Lädt abgeschlossene Begegnungen samt Einzelslots, Meldungen und
Auswechslungen; die Besetzungsauflösung bleibt beim Service/der Engine."
```

---

### Task 4: Service — Besetzung auflösen und Engine aufrufen

**Files:**
- Modify: `apps/api/src/competitions/competitions.service.ts`

**Interfaces:**
- Consumes:
  - `playerRankingSource` (Task 3) — exakte Rückgabeform siehe oben.
  - `calculatePlayerRanking`, `resolveSlotOccupancy` aus
    `@darts-platform/league-engine` (Task 1 bzw. bestehend).
  - `competitionPlayerRankingSchema` aus `@darts-platform/schemas` (Task 2).
- Produces:
  ```ts
  public async playerRanking(input: {
    readonly organizationId: string;
    readonly competitionId: string;
    readonly auth: AuthContext;
  }): Promise<CompetitionPlayerRanking>;
  ```
  Genutzt von Task 5 (Controller).

Der Service muss aus den flachen `slots`/`nominations`/`substitutions`
Zeilen der Query pro Slot die Besetzung auflösen. Das Repository liefert
keine `sequence` je Slot (nicht in `PlayerRankingSource` enthalten) — für
Substitutionen ist das ein Problem: `resolveSlotOccupancy` bei Einzeln
prüft nur die Position, nicht die Sequenz eines konkreten Slots, gegen die
**Auswechslungshistorie bis zu diesem Zeitpunkt**. Da für die
abgeschlossene, historische Rangliste ohnehin nur der **jeweils zuletzt
gültige** Stand pro Position zählt (der Slot ist bereits gespielt und sein
Ergebnis steht fest), genügt die einfachere Regel: die zuletzt gemeldete
Auswechslung mit `effectiveFromSequence <= slot.sequence` bestimmt die
besetzende Person. Weil `PlayerRankingSource` `sequence` nicht mitliefert,
ergänze sie zuerst in Task 3, dann hier verwenden — **Korrektur für den
Umsetzenden:** In Task 3, `slotRows`-Select um `sequence:
encounterSlots.sequence` erweitern und im `PlayerRankingSource`-Interface
`readonly sequence: number;` ergänzen, bevor dieser Task beginnt.

- [ ] **Step 1: Ergänze `sequence` in der Task-3-Query (Nachtrag)**

In `apps/api/src/competitions/competitions.repository.ts`:
- Im `PlayerRankingSource`-Interface, im `slots`-Eintrag, `readonly
  sequence: number;` ergänzen.
- Im `slotRows`-Select `sequence: encounterSlots.sequence,` ergänzen.

- [ ] **Step 2: Write the failing integration test**

In `apps/api/src/competitions/competitions.integration.spec.ts` (gleiche
Datei, gleicher `describe`-Block-Stil wie der bestehende `standings`-Test),
folgenden Test ergänzen. Er seedet zwei Einzelslots direkt über Drizzle
(gleiches Muster wie `apps/api/src/matches/encounter-scoring-lock.integration.spec.ts:169-203`),
einen davon mit einer Auswechslung:

```ts
it("builds the player ranking from completed singles slots, honouring a substitution", async () => {
  const competitionId = await create();
  const [homePlayerA, homePlayerB, awayPlayer] = playerIds;
  if (homePlayerA === undefined || homePlayerB === undefined || awayPlayer === undefined) {
    throw new Error("Expected at least three seeded players.");
  }
  const [encounterRow] = await databaseService.database
    .insert(encounters)
    .values({
      organizationId,
      competitionId,
      matchday: 1,
      homeTeamId,
      awayTeamId,
      scheduledAt: new Date("2026-10-09T19:00:00.000Z"),
      status: "COMPLETED",
      result: "HOME_WIN",
      resultType: "PLAYED",
      completedAt: new Date("2026-10-09T21:00:00.000Z"),
    })
    .returning();
  const encounterId = encounterRow?.id;
  if (encounterId === undefined) throw new Error("Expected the seeded encounter.");

  await databaseService.database.insert(encounterNominations).values([
    { organizationId, encounterId, side: "HOME", playerId: homePlayerA, position: 1, origin: "SQUAD" },
    { organizationId, encounterId, side: "HOME", playerId: homePlayerB, position: null, origin: "SQUAD" },
    { organizationId, encounterId, side: "AWAY", playerId: awayPlayer, position: 1, origin: "SQUAD" },
  ]);
  await databaseService.database.insert(encounterSubstitutions).values({
    organizationId,
    encounterId,
    side: "HOME",
    position: 1,
    outPlayerId: homePlayerA,
    inPlayerId: homePlayerB,
    effectiveFromSequence: 2,
  });
  await databaseService.database.insert(encounterSlots).values([
    {
      organizationId, encounterId, sequence: 1, role: "REGULAR", discipline: "SINGLES",
      label: "Einzel 1", homePosition: 1, awayPosition: 1, startingScore: 501,
      inRule: "STRAIGHT", outRule: "DOUBLE", bestOfLegs: 3, legsToWinSet: 2, setsToWin: 1,
      status: "COMPLETED", resultType: "PLAYED", winnerSide: "HOME", homeLegs: 2, awayLegs: 0,
      completedAt: new Date("2026-10-09T19:30:00.000Z"),
    },
    {
      organizationId, encounterId, sequence: 2, role: "REGULAR", discipline: "SINGLES",
      label: "Einzel 2", homePosition: 1, awayPosition: 1, startingScore: 501,
      inRule: "STRAIGHT", outRule: "DOUBLE", bestOfLegs: 3, legsToWinSet: 2, setsToWin: 1,
      status: "COMPLETED", resultType: "PLAYED", winnerSide: "AWAY", homeLegs: 1, awayLegs: 2,
      completedAt: new Date("2026-10-09T20:00:00.000Z"),
    },
  ]);

  const ranking = await service.playerRanking({ organizationId, competitionId, auth });

  expect(ranking.competitionId).toBe(competitionId);
  // Sequenz 1 (vor der Auswechslung) gehört homePlayerA, Sequenz 2 (danach) homePlayerB.
  const playerA = ranking.rows.find((row) => row.playerId === homePlayerA);
  const playerB = ranking.rows.find((row) => row.playerId === homePlayerB);
  const away = ranking.rows.find((row) => row.playerId === awayPlayer);
  expect(playerA).toMatchObject({ played: 1, won: 1, achievedPoints: 4, teamId: homeTeamId });
  expect(playerB).toMatchObject({ played: 1, lost: 1, achievedPoints: 1, teamId: homeTeamId });
  expect(away).toMatchObject({ played: 2, won: 1, lost: 1 });
  expect(playerA?.playerName.length ?? 0).toBeGreaterThan(0);
  expect(playerA?.teamName.length ?? 0).toBeGreaterThan(0);
}, 30_000);
```

Ergänze die nötigen Imports am Dateikopf:
```ts
import { encounterNominations, encounterSlots, encounterSubstitutions } from "@darts-platform/database";
```
(zusammen mit den bereits importierten `competitions, memberships,
organizations, players, teams, users`.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/competitions/competitions.integration.spec.ts -t "player ranking"`
Expected: FAIL mit „service.playerRanking is not a function"

(Für den genauen Testlauf-Befehl siehe [[api-single-test-file]] — `pnpm
--filter` filtert hier nicht.)

- [ ] **Step 4: Implement `playerRanking` on the service**

In `apps/api/src/competitions/competitions.service.ts`, die nötigen
Importe ergänzen:

```ts
import {
  calculatePlayerRanking,
  calculateStandings,
  resolveSlotOccupancy,
  type PlayerRankingSlot,
} from "@darts-platform/league-engine";
import {
  competitionPlayerRankingSchema,
  // ... bestehende Importe bleiben
} from "@darts-platform/schemas";
```

(Passe den bestehenden `@darts-platform/league-engine`-Import so an, dass
`calculatePlayerRanking`, `resolveSlotOccupancy` und `type
PlayerRankingSlot` ergänzt werden, statt einen zweiten Import-Block zu
erzeugen.)

Direkt nach der bestehenden `standings`-Methode einfügen:

```ts
/**
 * Die Einzelrangliste rechnet die League-Engine (Reglement A1.6–A1.9); der
 * Service löst nur die Besetzung je Slot auf (dieselbe Funktion wie beim
 * Nichtantritt-Pfad in `encounters.repository.ts`) und hängt Namen an.
 */
public async playerRanking(input: {
  readonly organizationId: string;
  readonly competitionId: string;
  readonly auth: AuthContext;
}): Promise<CompetitionPlayerRanking> {
  await this.require(input, "competition:read");
  const data = await this.repository.get(input);
  if (data === null) {
    throw new NotFoundException({ code: "NOT_FOUND", message: "Competition not found." });
  }
  const source = await this.repository.playerRankingSource(input);
  const encountersById = new Map(source.encounters.map((row) => [row.id, row]));
  const playerNames = new Map(source.players.map((row) => [row.id, row.displayName]));
  const teamsById = new Map(source.teams.map((row) => [row.id, row]));

  const slots: PlayerRankingSlot[] = source.slots
    .map((slot) => {
      const encounter = encountersById.get(slot.encounterId);
      if (encounter === undefined) return null;

      const nominationsFor = (side: "HOME" | "AWAY") =>
        source.nominations
          .filter((row) => row.encounterId === slot.encounterId && row.side === side)
          .map((row) => ({
            playerId: row.playerId,
            position: row.position,
            origin: row.origin === "GUEST" ? ("GUEST" as const) : ("SQUAD" as const),
          }));
      const substitutionsFor = (side: "HOME" | "AWAY") =>
        source.substitutions
          .filter((row) => row.encounterId === slot.encounterId && row.side === side)
          .map((row) => ({
            side,
            position: row.position,
            outPlayerId: row.outPlayerId,
            inPlayerId: row.inPlayerId,
            effectiveFromSequence: row.effectiveFromSequence,
          }));

      const occupancy = resolveSlotOccupancy({
        slot: {
          sequence: slot.sequence,
          discipline: slot.discipline === "DOUBLES" ? "DOUBLES" : "SINGLES",
          homePosition: slot.homePosition,
          awayPosition: slot.awayPosition,
        },
        home: { nominations: nominationsFor("HOME"), substitutions: substitutionsFor("HOME") },
        away: { nominations: nominationsFor("AWAY"), substitutions: substitutionsFor("AWAY") },
      });

      return {
        encounterId: slot.encounterId,
        encounterStatus: encounter.status as PlayerRankingSlot["encounterStatus"],
        matchday: encounter.matchday,
        discipline: slot.discipline as PlayerRankingSlot["discipline"],
        status: slot.status as PlayerRankingSlot["status"],
        legsToWinSet: slot.legsToWinSet,
        homeTeamId: encounter.homeTeamId,
        awayTeamId: encounter.awayTeamId,
        homePlayerIds: occupancy.home.playerIds,
        awayPlayerIds: occupancy.away.playerIds,
        homeLegs: slot.homeLegs,
        awayLegs: slot.awayLegs,
      } satisfies PlayerRankingSlot;
    })
    .filter((slot): slot is PlayerRankingSlot => slot !== null);

  const rows = calculatePlayerRanking({ slots });
  return competitionPlayerRankingSchema.parse({
    competitionId: input.competitionId,
    rows: rows.map((row) => ({
      ...row,
      playerName: playerNames.get(row.playerId) ?? "",
      teamName: teamsById.get(row.teamId)?.name ?? "",
      teamShortName: teamsById.get(row.teamId)?.shortName ?? null,
    })),
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/competitions/competitions.integration.spec.ts -t "player ranking"`
Expected: PASS

- [ ] **Step 6: Run the full API test suite and typecheck**

Run: `cd apps/api && npx tsc --noEmit && npx dotenv -e ../../.env -- npx vitest run src/competitions`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/competitions/competitions.repository.ts apps/api/src/competitions/competitions.service.ts apps/api/src/competitions/competitions.integration.spec.ts
git commit -m "feat(api): Service für die Einzelrangliste

Löst die Besetzung je Slot über resolveSlotOccupancy auf (dieselbe
Funktion wie im Nichtantritt-Pfad) und ruft die League-Engine auf."
```

---

### Task 5: Controller-Endpunkt

**Files:**
- Modify: `apps/api/src/competitions/competitions.controller.ts`
- Test: `apps/api/src/competitions/competitions.integration.spec.ts` (404/403-Fälle, gleiche Datei wie Task 4)

**Interfaces:**
- Consumes: `service.playerRanking(...)` (Task 4).
- Produces: `GET /api/v1/organizations/:organizationId/competitions/:competitionId/player-ranking`.

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/competitions/competitions.integration.spec.ts`, im selben
`describe`-Block:

```ts
it("returns a 404 for a competition of a foreign organisation", async () => {
  const competitionId = await create();
  await expect(
    service.playerRanking({ organizationId: randomUUID(), competitionId, auth }),
  ).rejects.toMatchObject({ response: { code: "NOT_FOUND" } });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/competitions/competitions.integration.spec.ts -t "foreign organisation"`
Expected: Test existiert erst nach Step 1 — nach dessen Ausführung PASS
(die 404-Logik existiert bereits aus Task 4 über `this.repository.get`);
falls PASS bereits hier eintritt, ist das erwartet — der Test dient als
Regressionsschutz, nicht als TDD-Treiber für neuen Code in diesem Schritt.

- [ ] **Step 3: Add the controller route**

In `apps/api/src/competitions/competitions.controller.ts`, nach der
bestehenden `standings`-Methode:

```ts
@Get(":competitionId/player-ranking")
public playerRanking(
  @Param("organizationId", ParseUUIDPipe) organizationId: string,
  @Param("competitionId", ParseUUIDPipe) competitionId: string,
  @CurrentAuth() auth: AuthContext,
): Promise<CompetitionPlayerRanking> {
  return this.service.playerRanking({ organizationId, competitionId, auth });
}
```

Und den Typ-Import am Kopf der Datei um `type CompetitionPlayerRanking`
ergänzen (im bestehenden `@darts-platform/schemas`-Importblock).

- [ ] **Step 4: Run the full API test suite and typecheck**

Run: `cd apps/api && npx tsc --noEmit && npx dotenv -e ../../.env -- npx vitest run src/competitions`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/competitions/competitions.controller.ts apps/api/src/competitions/competitions.integration.spec.ts
git commit -m "feat(api): Endpunkt GET .../competitions/:id/player-ranking"
```

---

### Task 6: Web — Tabelle in der Wettbewerbsansicht

**Files:**
- Create: `apps/web/src/components/league/player-ranking-table.tsx`
- Modify: `apps/web/src/components/league/competition-detail.tsx`

**Interfaces:**
- Consumes: `GET .../player-ranking` (Task 5), Schema
  `competitionPlayerRankingSchema` aus `@darts-platform/schemas` (Task 2).
- Produces: `<PlayerRankingTable competitionId awayOrganizationId />`
  (exportierte Komponente, gerendert unterhalb von `<StandingsTable />`).

- [ ] **Step 1: Create the component**

```tsx
// apps/web/src/components/league/player-ranking-table.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { competitionPlayerRankingSchema } from "@darts-platform/schemas";
import { Rule, SheetLabel } from "@darts-platform/ui";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";

/**
 * Die Einzelrangliste. Gerechnet wird sie im Server (League-Engine);
 * Rangkriterien nach `Reglement A1.9`: Ranglistenpunkte, Quotient der
 * Spiele, Quotient der Sätze. Nur Einzel zählen, keine Doppel.
 */
export function PlayerRankingTable({
  competitionId,
  organizationId,
}: {
  readonly competitionId: string;
  readonly organizationId: string;
}) {
  const rankingQuery = useQuery({
    queryKey: ["player-ranking", organizationId, competitionId],
    queryFn: ({ signal }) =>
      apiRequest({
        path: `/organizations/${organizationId}/competitions/${competitionId}/player-ranking`,
        schema: competitionPlayerRankingSchema,
        signal,
      }),
  });

  const rows = rankingQuery.data?.rows ?? [];

  return (
    <section aria-labelledby="player-ranking-heading" className="mt-9">
      <div className="flex items-baseline justify-between gap-3">
        <SheetLabel as="h2" id="player-ranking-heading">
          Einzelrangliste
        </SheetLabel>
        <span className="shrink-0 font-numerals text-counter font-bold tabular text-sisal-500">
          {rows.length}
        </span>
      </div>
      <Rule className="mt-2" />

      {rankingQuery.isPending ? (
        <p className="mt-4 font-plate text-body text-sisal-500">Rangliste wird geladen …</p>
      ) : rankingQuery.error ? (
        <p className="mt-4 font-plate text-body text-ring-red-deep" role="alert">
          {userFacingErrorMessage(rankingQuery.error)}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 font-plate text-body text-sisal-500">
          Sobald das erste Einzel abgeschlossen ist, stehen die Spielerinnen und Spieler hier.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse">
            <caption className="sr-only">
              Einzelrangliste des Wettbewerbs, geordnet nach Ranglistenpunkten, Spiel- und Satzquotient.
            </caption>
            <thead>
              <tr className="border-b border-sisal-400 text-left font-plate text-caption font-semibold tracking-[0.12em] text-sisal-500 uppercase">
                <th className="py-2 pr-3" scope="col">#</th>
                <th className="py-2 pr-3" scope="col">Person</th>
                <th className="py-2 pr-3" scope="col">Mannschaft</th>
                <th className="py-2 pr-3 text-right" scope="col">Sp</th>
                <th className="py-2 pr-3 text-right" scope="col">S</th>
                <th className="py-2 pr-3 text-right" scope="col">N</th>
                <th className="py-2 pr-3 text-right" scope="col">Quote</th>
                <th className="py-2 text-right" scope="col">Rangl.-Pkt.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-b border-sisal-300" key={row.playerId}>
                  <td className="py-3 pr-3 font-numerals tabular text-sisal-500">{row.rank}</td>
                  <th className="py-3 pr-3 text-left font-plate text-field font-semibold text-wedge-900" scope="row">
                    {row.playerName}
                  </th>
                  <td className="py-3 pr-3 text-left font-plate text-body text-wedge-900">
                    {row.teamShortName ?? row.teamName}
                    {row.otherTeamsCount > 0 ? (
                      <span className="ml-2 font-plate text-caption text-sisal-500">
                        +{row.otherTeamsCount}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3 text-right font-numerals tabular text-wedge-900">{row.played}</td>
                  <td className="py-3 pr-3 text-right font-numerals tabular text-wedge-900">{row.won}</td>
                  <td className="py-3 pr-3 text-right font-numerals tabular text-wedge-900">{row.lost}</td>
                  <td className="py-3 pr-3 text-right font-numerals tabular text-wedge-900">
                    {(row.hitRate * 100).toFixed(1)}%
                  </td>
                  <td className="py-3 text-right font-numerals font-bold tabular text-wedge-900">
                    {row.rankingPoints.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Render it in the competition detail page**

In `apps/web/src/components/league/competition-detail.tsx`:
- Import ergänzen: `import { PlayerRankingTable } from "./player-ranking-table";`
- Direkt nach `<StandingsTable competitionId={competitionId}
  organizationId={organization.id} />` (Zeile 157) ergänzen:
  `<PlayerRankingTable competitionId={competitionId} organizationId={organization.id} />`

- [ ] **Step 3: Typecheck and lint the web app**

Run: `cd apps/web && npx tsc --noEmit && npx eslint src/components/league/player-ranking-table.tsx src/components/league/competition-detail.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/league/player-ranking-table.tsx apps/web/src/components/league/competition-detail.tsx
git commit -m "feat(web): Einzelrangliste in der Wettbewerbsansicht"
```

---

### Task 7: E2E-Fall

**Files:**
- Modify: die bestehende Liga-E2E-Suite unter `apps/web/tests/` — genauer
  Dateiname ist vom Umsetzenden zuerst zu ermitteln (Suche:
  `grep -rl "Tabelle\|standings-heading" apps/web/tests`), damit der neue
  Fall im bestehenden Setup (gesäter Wettbewerb, gespielte Begegnung)
  mitläuft statt ein eigenes Fixture aufzubauen.

**Interfaces:**
- Consumes: die laufende Web- und API-App aus dem bestehenden
  Playwright-Setup; keine neuen Typen.

- [ ] **Step 1: Find the existing league E2E fixture**

Run: `cd apps/web && grep -rl "standings-heading\|Tabelle" tests`

Lies die gefundene Datei, um zu verstehen, wie dort ein Wettbewerb mit
mindestens einer abgeschlossenen Begegnung aufgebaut wird (Fixtures,
Helper-Funktionen für Seed-Daten).

- [ ] **Step 2: Write the failing test**

Ergänze in derselben Datei einen Fall, der auf denselben Seed aufsetzt wie
der bestehende Tabellen-Test:

```ts
test("zeigt die Einzelrangliste mit den gespielten Personen", async ({ page }) => {
  // ... denselben Wettbewerb/dieselbe Begegnung wie im vorhandenen
  // Tabellen-Test öffnen (Helper aus Step 1 wiederverwenden) ...
  await expect(page.getByRole("heading", { name: "Einzelrangliste" })).toBeVisible();
  await expect(page.getByRole("table").last()).toContainText(/%/);
});
```

Passe Selektoren an den tatsächlich vorgefundenen Teststil an (Rollen,
`data-testid`, o. Ä.) — dieser Schritt ist ein Gerüst, kein wörtlich
copy-pasteter Endzustand, weil die genaue Fixture-API erst in Step 1
bekannt wird.

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/web && npx playwright test <gefundene-datei> -g "Einzelrangliste"`
Expected: FAIL (Überschrift „Einzelrangliste" existiert im aktuellen Lauf
nur, wenn Task 6 bereits deployt/lokal gebaut ist — sollte bereits PASS
sein, wenn diese Aufgabe nach Task 6 ausgeführt wird; in diesem Fall dient
der Testlauf als Bestätigung, nicht als Rot-Grün-Nachweis).

- [ ] **Step 4: Run the full web E2E suite for this file**

Run: `cd apps/web && npx playwright test <gefundene-datei>`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/<gefundene-datei>
git commit -m "test(web): E2E-Fall für die Einzelrangliste"
```

---

### Task 8: Ganze Testsuite, Doku-Nachtrag

**Files:**
- Modify: `docs/superpowers/plans/2026-09-08-tier3-backlog-und-rueckfragen.md`
  (Streichung, siehe unten) — nur falls dort noch ein offener Verweis auf
  die Einzelrangliste steht (aktuell nicht der Fall; prüfen, nicht
  vorschnell ändern).

- [ ] **Step 1: Run the full quality gate (AGENTS.md §20)**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Alle Schritte müssen grün sein. Fehlschläge nicht ignorieren — bei einem
echten Fehlschlag zurück zum jeweiligen Task, nicht hier durchwinken.

- [ ] **Step 2: Update the memory pointer (outside git)**

Dieser Schritt ist keine Code-Änderung: nach Abschluss aller Tasks im
persistenten Memory (`audit-offene-punkte.md`) vermerken, dass die
Einzelrangliste (A1.7–A1.9) umgesetzt ist, mit Verweis auf Spec und PR-Nummer.
(Das ist Aufgabe des orchestrierenden Agents nach Merge, nicht Teil dieses
Branches.)

- [ ] **Step 3: Open the pull request**

Branch-Name: `feature/einzelrangliste` (AGENTS.md §22). PR-Beschreibung
nach AGENTS.md §23: Problem (Reglement A1.6–A1.10 war nicht abgebildet),
Lösung (neues Engine-Modul, Endpunkt, Web-Abschnitt), keine
Architektur-Auswirkung ausserhalb `league-engine`/`competitions`, keine
DB-Migration, Tests (Engine-Unit, API-Integration, E2E), keine
Security-Auswirkung (derselbe Berechtigungspfad wie `standings`),
Screenshot der neuen Tabelle.

```bash
git push -u origin feature/einzelrangliste
gh pr create --base main --title "feat: Einzelrangliste nach Reglement A1.7-A1.9" --body-file <lokale-datei-mit-obigem-text>
```

---

## Self-Review (durchgeführt beim Schreiben dieses Plans)

**Spec-Abdeckung:** Rechnung (Task 1), Was zählt/Nicht zählt (Task 1 Tests),
Mannschaftszuordnung bei Aushilfen (Task 1), Aufbau-Tabelle Domain/Schema/
Query/Service/Endpunkt/Web (Tasks 1–6), Fehlerfälle 404/403 (Task 5), Tests
auf allen drei Ebenen (Tasks 1, 4, 7), Definition of Done (Task 8) — jede
Zeile der Spec hat eine Aufgabe.

**Platzhalter-Scan:** Task 7 enthält bewusst einen Rechercheschritt (Step 1)
vor dem eigentlichen Test, weil die konkrete Fixture-Datei nicht Teil dieser
Planungsrunde war — das ist kein „TODO", sondern ein expliziter, actionable
erster Schritt mit Suchbefehl. Alle anderen Schritte tragen vollständigen
Code.

**Typkonsistenz geprüft:** `PlayerRankingSlot` (Task 1 Domain-Typ) taucht in
Task 4 identisch benannt und importiert wieder auf; `PlayerRankingRow`
(Task 1) speist über `.map` direkt in `competitionPlayerRankingSchema`
(Task 2/4) — Feldnamen (`playerId`, `teamId`, `otherTeamsCount`, `played`,
`won`, `lost`, `achievedPoints`, `possiblePoints`, `hitRate`,
`rankingPoints`, `rank`) sind über Domain, Schema, Service und Web-Tabelle
identisch. `PlayerRankingSource` (Task 3) wird in Task 4 exakt in den
genannten Feldern konsumiert; die Nachbesserung um `sequence` steht explizit
als Step 1 in Task 4, nicht stillschweigend vorausgesetzt.

**Scope-Check:** Ein zusammenhängendes Feature, acht Tasks, keine
unabhängigen Subsysteme — passt in einen Plan.
