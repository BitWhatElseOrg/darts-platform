# Vereinsduell – Plan 1: Engine, Datenmodell, API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Turnierformat `CLUB_DUEL` (Freundschaftsturnier Verein gegen Verein) vollständig im Backend: Engine, Migration, API inkl. automatischer Rundenpaarung, Gastspieler-Erfassung, Korrektur-Sperre, Tests, ADR.

**Architecture:** Die Regeln (Pausen-Rotation, Schweizer Paarung als Zuordnungsproblem, Quoten-Ranglisten, Kreuz-Finalrunde, Vereinswertung) liegen als reine Funktionen in `packages/tournament-engine/src/club-duel.ts`. Die API erzeugt beim Anlegen Quali-Runde 1 sowie Finalrunde und Final mit `SIDE_RANK`-Platzhaltern; `advance-club-duel.ts` paart nach jeder abgeschlossenen Quali-Runde in derselben Transaktion die nächste Runde und löst die Platzhalter auf. Die Web-Oberfläche folgt in **Plan 2** (`2026-10-01-vereinsduell-web.md`, wird nach Abschluss dieses Plans geschrieben); hier wird nur sichergestellt, dass `apps/web` weiterhin kompiliert.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Drizzle ORM + handgeschriebene SQL-Migration, Zod 4, NestJS/Fastify, Vitest, lokale Postgres (`pnpm infra:up`, Port 5433).

**Spec:** `docs/superpowers/specs/2026-10-01-vereinsduell-design.md`

## Global Constraints

- AGENTS.md gilt vollständig: Engine importiert keine Infrastruktur; jede tenant-bezogene Query trägt `organizationId`; Realtime nur über Outbox nach Commit; keine `any`.
- Ein Spielmodus (Best of Legs/Sets) für das ganze Turnier – **kein** Modus je Phase.
- Rangkriterien Quali: Siegquote → Legdifferenz pro Spiel → gewonnene Legs pro Spiel → Seed; Spieler ohne Spiel hinter allen mit Spiel.
- Rangkriterien Finalrunde: Siege → Legdifferenz → Quali-Rang.
- Vereinswertung: 1 Punkt pro gewonnenem Spiel inkl. Walkover; Gleichstand → Legdifferenz → `TIED`. Berechnet, nie gespeichert.
- Stage-Keys: `qualifying`, `final-round`, `final`. Stage-Typen: `CLUB_SWISS`, `CLUB_CROSS_ROUND_ROBIN`, `SINGLE_ELIMINATION`. Turnierstatus neu: `FINAL_ROUND`.
- Grenzen: `qualifyingRounds` 1–15, `finalRoundSize` 2–6 und ≤ kleinere Seite, Gastspieler-Erfassung 1–64 Namen.
- Fehlercodes: `CLUB_DUEL_SIDE_TOO_SMALL`, `CLUB_DUEL_SIDE_REQUIRED`, `CLUB_DUEL_SAME_SIDE_PAIRING`, `CLUB_DUEL_DUPLICATE_IN_ROUND`, `CLUB_DUEL_ROUND_ALREADY_PAIRED`, `INVALID_CLUB_DUEL_ROUNDS`.
- Commit-Nachrichten: Conventional Commits auf Deutsch, **kein** `Co-Authored-By`-Trailer (CLAUDE.md).
- API-Tests laufen gegen `packages/*/dist`: nach jeder Änderung an `tournament-engine`, `schemas`, `database` das Paket bauen (`pnpm --filter @darts-platform/<paket> build`).
- Einzelne Testdatei: `cd <paket> && npx dotenv -e ../../.env -- npx vitest run src/<datei>.spec.ts` (Engine/Schemas ohne dotenv).
- Branch: `feature/vereinsduell` (existiert, Spec ist darauf committet).

---

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `packages/tournament-engine/src/club-duel.ts` (neu) | Typen, `planClubDuel`, `previewClubDuel`, `pairClubSwissRound`, `calculateClubStandings`, `calculateCrossRoundStandings`, `calculateClubScore` |
| `packages/tournament-engine/src/club-duel.spec.ts` (neu) | Engine-Tests inkl. Property-Test |
| `packages/tournament-engine/src/tournament.ts` | Typen weiten (`PlannedMatch.stageType`, `KnockoutParticipantReference` um `SIDE_RANK`), Lifecycle für `CLUB_DUEL` |
| `packages/tournament-engine/src/index.ts` | Exporte |
| `packages/schemas/src/club-duel.ts` (neu) | `clubSideSchema`, `clubDuelDashboardSchema`, `createClubDuelTournamentSchema`, `clubDuelPreviewInputSchema/Schema` |
| `packages/schemas/src/tournament.ts` | Format/Status weiten, `createTournamentSchema` als Union, `clubDuel`-Block im Dashboard, `side` an Teilnehmern |
| `packages/schemas/src/player.ts` | `playerKindSchema`, `kind`/`guestClubName` in `playerSchema`, `createGuestPlayersSchema`, `playerKindFilterSchema` |
| `packages/database/src/schema.ts`, `drizzle/0037_club_duel.sql`, `drizzle/meta/_journal.json` | Spalten, Checks, Indexe |
| `packages/database/src/club-duel-constraints.integration.spec.ts` (neu) | DB-Constraints |
| `apps/web/src/lib/tournament-format.ts`, `components/tournament/setup-sheet.tsx` | nur Kompilierbarkeit (Labels, klassisches Schema) |
| `apps/api/src/players/*` | Gastspieler-Erfassung, Listenfilter `kind` |
| `apps/api/src/organizations/organizations.repository.ts` | Gast darf nicht mit Konto verknüpft werden |
| `apps/api/src/tournaments/completed-match-results.ts` (neu) | Resultate abgeschlossener Matches laden (aus `resolve-completed-group.ts` extrahiert) |
| `apps/api/src/tournaments/advance-club-duel.ts` (neu) | nächste Quali-Runde paaren, `SIDE_RANK` auflösen, Audit + Outbox |
| `apps/api/src/tournaments/club-duel-projection.ts` (neu) | `clubDuel`-Block des Dashboards |
| `apps/api/src/tournaments/club-duel-correction-lock.ts` (neu) | Sperre der Resultatkorrektur |
| `apps/api/src/tournaments/tournaments.repository.ts`, `.service.ts`, `.controller.ts`, `update-tournament-progress.ts` | Anlegen, Vorschau, Dashboard-Daten, Status |
| `apps/api/src/matches/matches.repository.ts` | Hook nach Matchabschluss, Korrektur-Sperre |
| `apps/api/src/tournaments/club-duel.integration.spec.ts` (neu), `apps/api/src/players/guest-players.integration.spec.ts` (neu) | API-Tests |
| `apps/api/src/security/tenant-isolation-matrix.integration.spec.ts` | Körper für neue Routen |
| `docs/adr/0021-vereinsduell-rundenpaarung.md` (neu), `README.md` | Doku |

---

### Task 1: Engine – Typen, Plan und Vorschau

**Files:**
- Create: `packages/tournament-engine/src/club-duel.ts`
- Create: `packages/tournament-engine/src/club-duel.spec.ts`
- Modify: `packages/tournament-engine/src/tournament.ts:37-53` (Referenz-Union und `PlannedMatch.stageType`)

**Interfaces:**
- Consumes: `TournamentValidationError`, `PlannedMatch`, `GroupMatchResult` aus `./tournament.js`
- Produces (für Task 2–4 und API):
  - `type ClubSide = "A" | "B"`
  - `interface ClubDuelParticipant { playerId: string; seed: number; side: ClubSide }`
  - `interface ClubRankedPlayer { playerId: string; seed: number }` (Reihenfolge im Array = aktueller Rang)
  - `interface ClubSwissPairing { position: number; playerAId: string; playerBId: string; repeated: boolean }`
  - `interface ClubSwissRound { round: number; pairings: readonly ClubSwissPairing[]; pausedPlayerIds: readonly string[]; warnings: readonly string[] }`
  - `const CLUB_DUEL_STAGE_KEYS = { qualifying: "qualifying", finalRound: "final-round", final: "final" }`
  - `planClubDuel(input: ClubDuelPlanInput): ClubDuelPlan` mit `ClubDuelPlan = { matches: readonly PlannedMatch[]; roundOne: ClubSwissRound }`
  - `plannedQualifyingMatch(round: number, pairing: ClubSwissPairing): PlannedMatch`
  - `previewClubDuel(input: ClubDuelPreviewInput): ClubDuelPreview`
  - In Task 1 wird `pairClubSwissRound` nur **deklariert** (Signatur + minimale Implementierung für Runde 1 ohne Historie); Task 2 ersetzt den Rumpf.

- [ ] **Step 1: Referenz-Union und Stage-Typen weiten**

In `packages/tournament-engine/src/tournament.ts` ersetzen:

```ts
export type KnockoutParticipantReference =
  | { readonly type: "PLAYER"; readonly playerId: string }
  | { readonly type: "GROUP_RANK"; readonly groupKey: string; readonly rank: number }
  | { readonly type: "MATCH_WINNER"; readonly matchKey: string }
  | {
      /** Vereinsduell: Rang `rank` der Seite `side` in der Phase `stageKey` (Spec, Datenmodell). */
      readonly type: "SIDE_RANK";
      readonly stageKey: string;
      readonly side: "A" | "B";
      readonly rank: number;
    };

export type PlannedStageType =
  | "GROUP"
  | "ROUND_ROBIN"
  | "SINGLE_ELIMINATION"
  | "CLUB_SWISS"
  | "CLUB_CROSS_ROUND_ROBIN";

export interface PlannedMatch {
  readonly key: string;
  readonly stageKey: string;
  readonly stageType: PlannedStageType;
  // ... übrige Felder unverändert
```

Die übrigen Felder von `PlannedMatch` bleiben. `TournamentLifecycleStage.type` noch **nicht** anfassen (Task 4).

- [ ] **Step 2: Failing Tests für Plan und Vorschau schreiben**

`packages/tournament-engine/src/club-duel.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  CLUB_DUEL_STAGE_KEYS,
  TournamentValidationError,
  planClubDuel,
  previewClubDuel,
  type ClubDuelParticipant,
} from "./index";

export function clubParticipants(sideACount: number, sideBCount: number): ClubDuelParticipant[] {
  const sideA = Array.from({ length: sideACount }, (_, index) => ({
    playerId: `a-${index + 1}`,
    seed: index + 1,
    side: "A" as const,
  }));
  const sideB = Array.from({ length: sideBCount }, (_, index) => ({
    playerId: `b-${index + 1}`,
    seed: sideACount + index + 1,
    side: "B" as const,
  }));
  return [...sideA, ...sideB];
}

function sideOf(playerId: string): "A" | "B" {
  return playerId.startsWith("a-") ? "A" : "B";
}

describe("planClubDuel", () => {
  it("plant 13 gegen 9: Runde 1 mit 9 Spielen, 4 Pausen bei A, Finalrunde 4x4, Final und Platz 3", () => {
    const plan = planClubDuel({
      participants: clubParticipants(13, 9),
      qualifyingRounds: 4,
      finalRoundSize: 4,
      thirdPlaceMatch: true,
    });
    const qualifying = plan.matches.filter((match) => match.stageKey === CLUB_DUEL_STAGE_KEYS.qualifying);
    const finalRound = plan.matches.filter((match) => match.stageKey === CLUB_DUEL_STAGE_KEYS.finalRound);
    const final = plan.matches.filter((match) => match.stageKey === CLUB_DUEL_STAGE_KEYS.final);
    expect(qualifying).toHaveLength(9);
    expect(qualifying.every((match) => match.round === 1 && match.state === "READY")).toBe(true);
    expect(plan.roundOne.pausedPlayerIds).toEqual(["a-13", "a-12", "a-11", "a-10"]);
    expect(finalRound).toHaveLength(16);
    expect(finalRound.every((match) => match.state === "WAITING" && match.stageType === "CLUB_CROSS_ROUND_ROBIN")).toBe(true);
    expect(final.map((match) => match.key)).toEqual(["final:r1:m1", "final:r1:m2"]);
    expect(final[0]?.participantOne).toEqual({ type: "SIDE_RANK", stageKey: "final-round", side: "A", rank: 1 });
    expect(final[1]?.participantTwo).toEqual({ type: "SIDE_RANK", stageKey: "final-round", side: "B", rank: 2 });
  });

  it("setzt Runde 1 nach Seed: Seed-Rang i von A gegen Seed-Rang i von B", () => {
    const plan = planClubDuel({ participants: clubParticipants(9, 13), qualifyingRounds: 2, finalRoundSize: 2, thirdPlaceMatch: false });
    expect(plan.roundOne.pausedPlayerIds).toEqual(["b-13", "b-12", "b-11", "b-10"]);
    expect(plan.roundOne.pairings[0]).toMatchObject({ playerAId: "a-1", playerBId: "b-1", position: 1 });
    expect(plan.roundOne.pairings[8]).toMatchObject({ playerAId: "a-9", playerBId: "b-9", position: 9 });
    expect(plan.matches.filter((match) => match.stageKey === "final")).toHaveLength(1);
  });

  it("jedes geplante Spiel mit Spielern ist A gegen B, jeder spielt pro Finalrunden-Runde genau einmal", () => {
    const plan = planClubDuel({ participants: clubParticipants(8, 8), qualifyingRounds: 3, finalRoundSize: 4, thirdPlaceMatch: true });
    expect(plan.roundOne.pausedPlayerIds).toEqual([]);
    for (const match of plan.matches) {
      if (match.participantOne?.type === "PLAYER" && match.participantTwo?.type === "PLAYER") {
        expect(sideOf(match.participantOne.playerId)).toBe("A");
        expect(sideOf(match.participantTwo.playerId)).toBe("B");
      }
      if (match.participantOne?.type === "SIDE_RANK" && match.participantTwo?.type === "SIDE_RANK") {
        expect(match.participantOne.side).toBe("A");
        expect(match.participantTwo.side).toBe("B");
      }
    }
    const finalRound = plan.matches.filter((match) => match.stageKey === "final-round");
    for (const round of [1, 2, 3, 4]) {
      const inRound = finalRound.filter((match) => match.round === round);
      expect(inRound).toHaveLength(4);
      const ranksA = inRound.map((match) => (match.participantOne?.type === "SIDE_RANK" ? match.participantOne.rank : -1)).sort();
      const ranksB = inRound.map((match) => (match.participantTwo?.type === "SIDE_RANK" ? match.participantTwo.rank : -1)).sort();
      expect(ranksA).toEqual([1, 2, 3, 4]);
      expect(ranksB).toEqual([1, 2, 3, 4]);
    }
    // Runde 1 ist A1–B1, A2–B2, …; Runde r: j = ((i + r − 2) mod N) + 1
    const roundTwo = finalRound.filter((match) => match.round === 2).map((match) => [
      match.participantOne?.type === "SIDE_RANK" ? match.participantOne.rank : -1,
      match.participantTwo?.type === "SIDE_RANK" ? match.participantTwo.rank : -1,
    ]);
    expect(roundTwo).toEqual([[1, 2], [2, 3], [3, 4], [4, 1]]);
  });

  it("lehnt eine Seite kleiner als die Finalrunde ab", () => {
    expect(() => planClubDuel({ participants: clubParticipants(3, 9), qualifyingRounds: 2, finalRoundSize: 4, thirdPlaceMatch: true }))
      .toThrowError(new TournamentValidationError("CLUB_DUEL_SIDE_TOO_SMALL", "Jeder Verein braucht mindestens so viele Spieler wie die Finalrunde Plätze hat."));
  });

  it("lehnt ungültige Rundenzahlen und doppelte Spieler ab", () => {
    expect(() => planClubDuel({ participants: clubParticipants(4, 4), qualifyingRounds: 0, finalRoundSize: 2, thirdPlaceMatch: true }))
      .toThrowError(TournamentValidationError);
    expect(() => planClubDuel({ participants: clubParticipants(4, 4), qualifyingRounds: 16, finalRoundSize: 2, thirdPlaceMatch: true }))
      .toThrowError(TournamentValidationError);
    const duplicate = [...clubParticipants(4, 4), { playerId: "a-1", seed: 99, side: "B" as const }];
    expect(() => planClubDuel({ participants: duplicate, qualifyingRounds: 2, finalRoundSize: 2, thirdPlaceMatch: true }))
      .toThrowError(new TournamentValidationError("DUPLICATE_PARTICIPANT", "A participant may only appear once."));
  });
});

describe("previewClubDuel", () => {
  it("rechnet 13/9 mit 4 Runden, N=4, Platz 3 auf 8 Scheiben", () => {
    const preview = previewClubDuel({ sideACount: 13, sideBCount: 9, qualifyingRounds: 4, finalRoundSize: 4, thirdPlaceMatch: true, boardCount: 8, bestOfLegs: 3 });
    expect(preview).toEqual({
      qualifyingMatches: 36,
      finalRoundMatches: 16,
      finalMatches: 2,
      totalMatches: 54,
      matchesPerPlayer: { sideA: { min: 2, max: 3 }, sideB: { min: 4, max: 4 } },
      estimatedMinutes: 7 * 12,
      warnings: [],
    });
  });

  it("warnt, wenn Wiederholungen unvermeidbar werden, und lehnt zu grosse Finalrunden ab", () => {
    const preview = previewClubDuel({ sideACount: 4, sideBCount: 4, qualifyingRounds: 5, finalRoundSize: 2, thirdPlaceMatch: false, boardCount: 2, bestOfLegs: 3 });
    expect(preview.warnings).toEqual(["Ab Runde 5 sind Wiederholungen von Paarungen unvermeidbar."]);
    expect(() => previewClubDuel({ sideACount: 3, sideBCount: 9, qualifyingRounds: 2, finalRoundSize: 4, thirdPlaceMatch: true, boardCount: 2, bestOfLegs: 3 }))
      .toThrowError(TournamentValidationError);
  });
});
```

- [ ] **Step 3: Test ausführen – muss scheitern**

Run: `cd packages/tournament-engine && npx vitest run src/club-duel.spec.ts`
Expected: FAIL – `./index` exportiert `planClubDuel` nicht.

- [ ] **Step 4: `club-duel.ts` anlegen (Plan, Vorschau, Minimalpaarung)**

```ts
import {
  TournamentValidationError,
  type GroupMatchResult,
  type PlannedMatch,
} from "./tournament.js";

export type ClubSide = "A" | "B";

export interface ClubDuelParticipant {
  readonly playerId: string;
  readonly seed: number;
  readonly side: ClubSide;
}

/** Spieler einer Seite, Reihenfolge im Array = aktueller Rang (bester zuerst). */
export interface ClubRankedPlayer {
  readonly playerId: string;
  readonly seed: number;
}

export interface ClubSwissPairing {
  readonly position: number;
  readonly playerAId: string;
  readonly playerBId: string;
  /** Diese beiden haben in der Quali schon gegeneinander gespielt. */
  readonly repeated: boolean;
}

export interface ClubSwissRound {
  readonly round: number;
  readonly pairings: readonly ClubSwissPairing[];
  readonly pausedPlayerIds: readonly string[];
  readonly warnings: readonly string[];
}

export interface ClubSwissPairingInput {
  readonly round: number;
  readonly sideA: readonly ClubRankedPlayer[];
  readonly sideB: readonly ClubRankedPlayer[];
  readonly previousPairings: readonly { readonly playerAId: string; readonly playerBId: string }[];
  /** Pausen bisher je Spieler (fehlt ein Spieler: 0). */
  readonly pauses: ReadonlyMap<string, number>;
  /** Spiele bisher je Spieler (fehlt ein Spieler: 0). */
  readonly played: ReadonlyMap<string, number>;
}

export interface ClubDuelPlanInput {
  readonly participants: readonly ClubDuelParticipant[];
  readonly qualifyingRounds: number;
  readonly finalRoundSize: number;
  readonly thirdPlaceMatch: boolean;
}

export interface ClubDuelPlan {
  readonly matches: readonly PlannedMatch[];
  readonly roundOne: ClubSwissRound;
}

export interface ClubDuelPreviewInput {
  readonly sideACount: number;
  readonly sideBCount: number;
  readonly qualifyingRounds: number;
  readonly finalRoundSize: number;
  readonly thirdPlaceMatch: boolean;
  readonly boardCount: number;
  readonly bestOfLegs: number;
}

export interface ClubDuelPreview {
  readonly qualifyingMatches: number;
  readonly finalRoundMatches: number;
  readonly finalMatches: number;
  readonly totalMatches: number;
  readonly matchesPerPlayer: {
    readonly sideA: { readonly min: number; readonly max: number };
    readonly sideB: { readonly min: number; readonly max: number };
  };
  readonly estimatedMinutes: number;
  readonly warnings: readonly string[];
}

export const CLUB_DUEL_STAGE_KEYS = {
  qualifying: "qualifying",
  finalRound: "final-round",
  final: "final",
} as const;

export const CLUB_DUEL_LIMITS = {
  minRounds: 1,
  maxRounds: 15,
  minFinalRoundSize: 2,
  maxFinalRoundSize: 6,
} as const;

/** Grobe Planungsgrösse für die Vorschau; dieselbe Annahme wie `match-overrun.ts` in der API. */
const ESTIMATED_MINUTES_PER_LEG = 4;

function assertRounds(rounds: number): void {
  if (!Number.isInteger(rounds) || rounds < CLUB_DUEL_LIMITS.minRounds || rounds > CLUB_DUEL_LIMITS.maxRounds) {
    throw new TournamentValidationError("INVALID_CLUB_DUEL_ROUNDS", "Die Qualifikation braucht 1 bis 15 Runden.");
  }
}

function assertFinalRoundSize(size: number, smallerSide: number): void {
  if (!Number.isInteger(size) || size < CLUB_DUEL_LIMITS.minFinalRoundSize || size > CLUB_DUEL_LIMITS.maxFinalRoundSize) {
    throw new TournamentValidationError("INVALID_CLUB_DUEL_FINAL_ROUND_SIZE", "Die Finalrunde braucht 2 bis 6 Spieler je Verein.");
  }
  if (smallerSide < size) {
    throw new TournamentValidationError("CLUB_DUEL_SIDE_TOO_SMALL", "Jeder Verein braucht mindestens so viele Spieler wie die Finalrunde Plätze hat.");
  }
}

function assertUniqueClubParticipants(participants: readonly ClubDuelParticipant[]): void {
  if (new Set(participants.map((participant) => participant.playerId)).size !== participants.length) {
    throw new TournamentValidationError("DUPLICATE_PARTICIPANT", "A participant may only appear once.");
  }
  if (new Set(participants.map((participant) => participant.seed)).size !== participants.length) {
    throw new TournamentValidationError("DUPLICATE_SEED", "Every seed must be unique.");
  }
}

export function sidePlayers(participants: readonly ClubDuelParticipant[], side: ClubSide): readonly ClubRankedPlayer[] {
  return participants
    .filter((participant) => participant.side === side)
    .sort((left, right) => left.seed - right.seed)
    .map((participant) => ({ playerId: participant.playerId, seed: participant.seed }));
}

export function plannedQualifyingMatch(round: number, pairing: ClubSwissPairing): PlannedMatch {
  return {
    key: `${CLUB_DUEL_STAGE_KEYS.qualifying}:r${round}:m${pairing.position}`,
    stageKey: CLUB_DUEL_STAGE_KEYS.qualifying,
    stageType: "CLUB_SWISS",
    groupKey: null,
    round,
    position: pairing.position,
    participantOne: { type: "PLAYER", playerId: pairing.playerAId },
    participantTwo: { type: "PLAYER", playerId: pairing.playerBId },
    state: "READY",
    byeWinnerPlayerId: null,
  };
}

function crossRoundMatches(size: number): readonly PlannedMatch[] {
  const matches: PlannedMatch[] = [];
  for (let round = 1; round <= size; round += 1) {
    for (let rankA = 1; rankA <= size; rankA += 1) {
      // Spec: Runde r, A_i trifft B_j mit j = ((i + r − 2) mod N) + 1
      const rankB = ((rankA + round - 2) % size) + 1;
      matches.push({
        key: `${CLUB_DUEL_STAGE_KEYS.finalRound}:r${round}:m${rankA}`,
        stageKey: CLUB_DUEL_STAGE_KEYS.finalRound,
        stageType: "CLUB_CROSS_ROUND_ROBIN",
        groupKey: null,
        round,
        position: rankA,
        participantOne: { type: "SIDE_RANK", stageKey: CLUB_DUEL_STAGE_KEYS.qualifying, side: "A", rank: rankA },
        participantTwo: { type: "SIDE_RANK", stageKey: CLUB_DUEL_STAGE_KEYS.qualifying, side: "B", rank: rankB },
        state: "WAITING",
        byeWinnerPlayerId: null,
      });
    }
  }
  return matches;
}

function finalMatches(thirdPlaceMatch: boolean): readonly PlannedMatch[] {
  const finalMatch = (position: number, rank: number): PlannedMatch => ({
    key: `${CLUB_DUEL_STAGE_KEYS.final}:r1:m${position}`,
    stageKey: CLUB_DUEL_STAGE_KEYS.final,
    stageType: "SINGLE_ELIMINATION",
    groupKey: null,
    round: 1,
    position,
    participantOne: { type: "SIDE_RANK", stageKey: CLUB_DUEL_STAGE_KEYS.finalRound, side: "A", rank },
    participantTwo: { type: "SIDE_RANK", stageKey: CLUB_DUEL_STAGE_KEYS.finalRound, side: "B", rank },
    state: "WAITING",
    byeWinnerPlayerId: null,
  });
  return thirdPlaceMatch ? [finalMatch(1, 1), finalMatch(2, 2)] : [finalMatch(1, 1)];
}

export function planClubDuel(input: ClubDuelPlanInput): ClubDuelPlan {
  assertUniqueClubParticipants(input.participants);
  assertRounds(input.qualifyingRounds);
  const sideA = sidePlayers(input.participants, "A");
  const sideB = sidePlayers(input.participants, "B");
  if (sideA.length === 0 || sideB.length === 0) {
    throw new TournamentValidationError("CLUB_DUEL_SIDE_EMPTY", "Beide Vereine brauchen mindestens einen Spieler.");
  }
  assertFinalRoundSize(input.finalRoundSize, Math.min(sideA.length, sideB.length));

  const roundOne = pairClubSwissRound({
    round: 1,
    sideA,
    sideB,
    previousPairings: [],
    pauses: new Map(),
    played: new Map(),
  });
  return {
    roundOne,
    matches: [
      ...roundOne.pairings.map((pairing) => plannedQualifyingMatch(1, pairing)),
      ...crossRoundMatches(input.finalRoundSize),
      ...finalMatches(input.thirdPlaceMatch),
    ],
  };
}

export function previewClubDuel(input: ClubDuelPreviewInput): ClubDuelPreview {
  assertRounds(input.qualifyingRounds);
  if (!Number.isInteger(input.sideACount) || !Number.isInteger(input.sideBCount) || input.sideACount < 1 || input.sideBCount < 1) {
    throw new TournamentValidationError("CLUB_DUEL_SIDE_EMPTY", "Beide Vereine brauchen mindestens einen Spieler.");
  }
  if (!Number.isInteger(input.boardCount) || input.boardCount < 1) {
    throw new TournamentValidationError("INVALID_STRUCTURE", "Mindestens eine Scheibe ist nötig.");
  }
  const smaller = Math.min(input.sideACount, input.sideBCount);
  const larger = Math.max(input.sideACount, input.sideBCount);
  assertFinalRoundSize(input.finalRoundSize, smaller);

  const qualifyingMatches = input.qualifyingRounds * smaller;
  const largerMin = Math.floor(qualifyingMatches / larger);
  const largerMax = Math.ceil(qualifyingMatches / larger);
  const perSmaller = { min: input.qualifyingRounds, max: input.qualifyingRounds };
  const perLarger = { min: largerMin, max: largerMax };
  const finalRoundMatches = input.finalRoundSize * input.finalRoundSize;
  const finalCount = input.thirdPlaceMatch ? 2 : 1;
  const totalMatches = qualifyingMatches + finalRoundMatches + finalCount;
  const minutesPerMatch = input.bestOfLegs * ESTIMATED_MINUTES_PER_LEG;
  const warnings: string[] = [];
  // Ein Spieler der kleineren Seite hat `larger` mögliche Gegner; danach wiederholt sich etwas.
  if (input.qualifyingRounds > larger) {
    warnings.push(`Ab Runde ${larger + 1} sind Wiederholungen von Paarungen unvermeidbar.`);
  }
  return {
    qualifyingMatches,
    finalRoundMatches,
    finalMatches: finalCount,
    totalMatches,
    matchesPerPlayer: {
      sideA: input.sideACount <= input.sideBCount ? perSmaller : perLarger,
      sideB: input.sideBCount <= input.sideACount ? perSmaller : perLarger,
    },
    estimatedMinutes: Math.ceil(totalMatches / input.boardCount) * minutesPerMatch,
    warnings,
  };
}

/**
 * Vorläufig (Task 1): paart Rang i gegen Rang i ohne Historie. Task 2 ersetzt
 * den Rumpf durch Pausen-Rotation und Zuordnungsproblem.
 */
export function pairClubSwissRound(input: ClubSwissPairingInput): ClubSwissRound {
  const larger = input.sideA.length >= input.sideB.length ? input.sideA : input.sideB;
  const pauseCount = Math.abs(input.sideA.length - input.sideB.length);
  const pausedPlayerIds = [...larger].reverse().slice(0, pauseCount).map((player) => player.playerId);
  const paused = new Set(pausedPlayerIds);
  const playingA = input.sideA.filter((player) => !paused.has(player.playerId));
  const playingB = input.sideB.filter((player) => !paused.has(player.playerId));
  const pairings = playingA.map((playerA, index) => {
    const playerB = playingB[index];
    if (playerB === undefined) throw new Error("Club duel pairing invariant violated.");
    return { position: index + 1, playerAId: playerA.playerId, playerBId: playerB.playerId, repeated: false };
  });
  return { round: input.round, pairings, pausedPlayerIds, warnings: [] };
}

// `GroupMatchResult` wird in Task 3 für die Ranglisten wiederverwendet.
export type ClubMatchResult = GroupMatchResult;
```

In `index.ts` ergänzen:

```ts
export {
  CLUB_DUEL_LIMITS,
  CLUB_DUEL_STAGE_KEYS,
  pairClubSwissRound,
  planClubDuel,
  plannedQualifyingMatch,
  previewClubDuel,
  sidePlayers,
  type ClubDuelParticipant,
  type ClubDuelPlan,
  type ClubDuelPlanInput,
  type ClubDuelPreview,
  type ClubDuelPreviewInput,
  type ClubMatchResult,
  type ClubRankedPlayer,
  type ClubSide,
  type ClubSwissPairing,
  type ClubSwissPairingInput,
  type ClubSwissRound,
} from "./club-duel.js";
```

und in der bestehenden Exportliste aus `./tournament.js` `type PlannedStageType` ergänzen.

- [ ] **Step 5: Tests ausführen – müssen bestehen**

Run: `cd packages/tournament-engine && npx vitest run src/club-duel.spec.ts && npx vitest run`
Expected: alle PASS (auch `tournament.spec.ts`, das von der Typweitung unberührt bleibt).

- [ ] **Step 6: Typecheck und Commit**

```bash
pnpm --filter @darts-platform/tournament-engine typecheck
git add packages/tournament-engine/src
git commit -m "feat(tournament-engine): Vereinsduell planen und Vorschau rechnen"
```

---

### Task 2: Engine – Paarung mit Pausen-Rotation und Zuordnungsproblem

**Files:**
- Modify: `packages/tournament-engine/src/club-duel.ts` (Rumpf von `pairClubSwissRound`)
- Modify: `packages/tournament-engine/src/club-duel.spec.ts`

**Interfaces:**
- Consumes: Typen aus Task 1
- Produces: `pairClubSwissRound(input: ClubSwissPairingInput): ClubSwissRound` – endgültig. Pausenregel: nur bei der grösseren Seite, Anzahl = Differenz; es pausieren die mit den wenigsten Pausen, bei Gleichstand wer mehr Spiele hat, dann die höhere Seed-Nummer. Paarung: minimale Kosten `|RangA − RangB| + 1000·Wiederholung` (ungarischer Algorithmus).

- [ ] **Step 1: Failing Tests schreiben**

Anhängen an `club-duel.spec.ts`:

```ts
import { pairClubSwissRound, type ClubRankedPlayer, type ClubSwissPairingInput } from "./index";

function ranked(prefix: string, count: number, seedOffset = 0): ClubRankedPlayer[] {
  return Array.from({ length: count }, (_, index) => ({ playerId: `${prefix}-${index + 1}`, seed: seedOffset + index + 1 }));
}

/** Spielt `rounds` Runden durch; Rangfolge bleibt die Seed-Folge (nur die Paarungslogik steht im Test). */
function simulateRounds(sideA: ClubRankedPlayer[], sideB: ClubRankedPlayer[], rounds: number) {
  const pauses = new Map<string, number>();
  const played = new Map<string, number>();
  const previous: { playerAId: string; playerBId: string }[] = [];
  const result: ClubSwissRound[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const paired = pairClubSwissRound({ round, sideA, sideB, previousPairings: previous, pauses, played });
    for (const id of paired.pausedPlayerIds) pauses.set(id, (pauses.get(id) ?? 0) + 1);
    for (const pairing of paired.pairings) {
      played.set(pairing.playerAId, (played.get(pairing.playerAId) ?? 0) + 1);
      played.set(pairing.playerBId, (played.get(pairing.playerBId) ?? 0) + 1);
      previous.push({ playerAId: pairing.playerAId, playerBId: pairing.playerBId });
    }
    result.push(paired);
  }
  return { rounds: result, pauses, played };
}

describe("pairClubSwissRound", () => {
  it("rotiert die Pausen bei 13 gegen 9 über 4 Runden gleichmässig", () => {
    const { rounds, pauses } = simulateRounds(ranked("a", 13), ranked("b", 9, 13), 4);
    expect(rounds[0]?.pausedPlayerIds).toEqual(["a-13", "a-12", "a-11", "a-10"]);
    expect(rounds[1]?.pausedPlayerIds).toEqual(["a-9", "a-8", "a-7", "a-6"]);
    expect(rounds[2]?.pausedPlayerIds).toEqual(["a-5", "a-4", "a-3", "a-2"]);
    // Runde 4: a-1 ist der Einzige mit 0 Pausen; alle anderen haben 1 Pause und 2 Spiele → höchste Seed-Nummern
    expect(rounds[3]?.pausedPlayerIds).toEqual(["a-1", "a-13", "a-12", "a-11"]);
    for (let index = 1; index <= 13; index += 1) {
      expect(pauses.get(`a-${index}`) ?? 0).toBeGreaterThanOrEqual(1);
      expect(pauses.get(`a-${index}`) ?? 0).toBeLessThanOrEqual(2);
    }
    expect([...pauses.keys()].some((id) => id.startsWith("b-"))).toBe(false);
  });

  it("vermeidet Wiederholungen, solange es aufgeht, und meldet sie danach als Warnung", () => {
    const sideA = ranked("a", 4);
    const sideB = ranked("b", 4, 4);
    const { rounds } = simulateRounds(sideA, sideB, 5);
    for (const round of rounds.slice(0, 4)) {
      expect(round.pairings.every((pairing) => !pairing.repeated)).toBe(true);
      expect(round.warnings).toEqual([]);
    }
    const fifth = rounds[4];
    expect(fifth?.pairings.filter((pairing) => pairing.repeated)).toHaveLength(4);
    expect(fifth?.warnings).toEqual(["Runde 5: 4 Paarungen wiederholen sich, weil keine neuen Gegner mehr frei sind."]);
  });

  it("paart nahe Ränge: nach Rang sortierte Seiten ergeben Rang i gegen Rang i, wenn keine Wiederholung droht", () => {
    const paired = pairClubSwissRound({
      round: 2,
      sideA: ranked("a", 3),
      sideB: ranked("b", 3, 3),
      previousPairings: [],
      pauses: new Map(),
      played: new Map(),
    });
    expect(paired.pairings.map((pairing) => [pairing.playerAId, pairing.playerBId])).toEqual([["a-1", "b-1"], ["a-2", "b-2"], ["a-3", "b-3"]]);
  });

  it("weicht minimal aus, wenn Rang i gegen Rang i eine Wiederholung wäre", () => {
    const paired = pairClubSwissRound({
      round: 2,
      sideA: ranked("a", 3),
      sideB: ranked("b", 3, 3),
      previousPairings: [{ playerAId: "a-1", playerBId: "b-1" }],
      pauses: new Map(),
      played: new Map(),
    });
    expect(paired.pairings.every((pairing) => !pairing.repeated)).toBe(true);
    expect(paired.pairings.find((pairing) => pairing.playerAId === "a-1")?.playerBId).toBe("b-2");
  });

  it("ist deterministisch", () => {
    const input: ClubSwissPairingInput = { round: 3, sideA: ranked("a", 7), sideB: ranked("b", 5, 7), previousPairings: [{ playerAId: "a-2", playerBId: "b-2" }], pauses: new Map([["a-7", 1]]), played: new Map([["a-7", 1]]) };
    expect(pairClubSwissRound(input)).toEqual(pairClubSwissRound(input));
  });

  it("Property: nie zweimal pro Runde, nie A gegen A, Pausen gleichmässig (zufällige Grössen 2–32)", () => {
    let state = 12345;
    const next = () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    for (let iteration = 0; iteration < 40; iteration += 1) {
      const sizeA = 2 + Math.floor(next() * 31);
      const sizeB = 2 + Math.floor(next() * 31);
      const rounds = 1 + Math.floor(next() * 6);
      const sideA = ranked("a", sizeA);
      const sideB = ranked("b", sizeB, sizeA);
      const pauses = new Map<string, number>();
      const played = new Map<string, number>();
      const previous: { playerAId: string; playerBId: string }[] = [];
      for (let round = 1; round <= rounds; round += 1) {
        // zufällige Rangfolge wie nach echten Ergebnissen
        const shuffledA = [...sideA].sort(() => next() - 0.5);
        const shuffledB = [...sideB].sort(() => next() - 0.5);
        const paired = pairClubSwissRound({ round, sideA: shuffledA, sideB: shuffledB, previousPairings: previous, pauses, played });
        const seen = new Set<string>();
        for (const pairing of paired.pairings) {
          expect(pairing.playerAId.startsWith("a-")).toBe(true);
          expect(pairing.playerBId.startsWith("b-")).toBe(true);
          expect(seen.has(pairing.playerAId)).toBe(false);
          expect(seen.has(pairing.playerBId)).toBe(false);
          seen.add(pairing.playerAId);
          seen.add(pairing.playerBId);
          played.set(pairing.playerAId, (played.get(pairing.playerAId) ?? 0) + 1);
          played.set(pairing.playerBId, (played.get(pairing.playerBId) ?? 0) + 1);
          previous.push({ playerAId: pairing.playerAId, playerBId: pairing.playerBId });
        }
        expect(paired.pairings).toHaveLength(Math.min(sizeA, sizeB));
        expect(paired.pausedPlayerIds).toHaveLength(Math.abs(sizeA - sizeB));
        for (const id of paired.pausedPlayerIds) {
          expect(seen.has(id)).toBe(false);
          pauses.set(id, (pauses.get(id) ?? 0) + 1);
        }
      }
      const largerPrefix = sizeA >= sizeB ? "a-" : "b-";
      const larger = sizeA >= sizeB ? sideA : sideB;
      const pauseValues = larger.map((player) => pauses.get(player.playerId) ?? 0);
      expect(Math.max(...pauseValues) - Math.min(...pauseValues)).toBeLessThanOrEqual(1);
      expect([...pauses.keys()].every((id) => id.startsWith(largerPrefix))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Tests ausführen – die neuen müssen scheitern**

Run: `cd packages/tournament-engine && npx vitest run src/club-duel.spec.ts`
Expected: FAIL bei Rotation (Runde 2 pausiert erneut `a-13…`), bei Wiederholungen (`repeated` immer false) und beim Ausweichen.

- [ ] **Step 3: Rumpf von `pairClubSwissRound` ersetzen**

In `club-duel.ts` die vorläufige Funktion und ihren Kommentar ersetzen durch:

```ts
/** Wiederholung kostet mehr als jede denkbare Summe von Rangabständen (n ≤ 64 → Summe < 64·63). */
const REPEAT_PENALTY = 10_000;

function numberAt(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) throw new Error("Assignment index invariant violated.");
  return value;
}

/**
 * Ungarischer Algorithmus (Kuhn–Munkres, Potentialform), O(n³). Liefert für
 * jede Zeile i die Spalte `assignment[i]` mit minimalen Gesamtkosten.
 * Deterministisch: gleiche Matrix, gleiche Zuordnung.
 */
function solveAssignment(cost: readonly (readonly number[])[]): readonly number[] {
  const n = cost.length;
  const INF = Number.MAX_SAFE_INTEGER;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(INF);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = numberAt(p, j0);
      let delta = INF;
      let j1 = 0;
      const row = cost[i0 - 1];
      if (row === undefined) throw new Error("Assignment row invariant violated.");
      for (let j = 1; j <= n; j += 1) {
        if (used[j] === true) continue;
        const current = numberAt(row, j - 1) - numberAt(u, i0) - numberAt(v, j);
        if (current < numberAt(minv, j)) {
          minv[j] = current;
          way[j] = j0;
        }
        if (numberAt(minv, j) < delta) {
          delta = numberAt(minv, j);
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j] === true) {
          u[numberAt(p, j)] = numberAt(u, numberAt(p, j)) + delta;
          v[j] = numberAt(v, j) - delta;
        } else {
          minv[j] = numberAt(minv, j) - delta;
        }
      }
      j0 = j1;
    } while (numberAt(p, j0) !== 0);
    do {
      const j1 = numberAt(way, j0);
      p[j0] = numberAt(p, j1);
      j0 = j1;
    } while (j0 !== 0);
  }
  const assignment = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j += 1) assignment[numberAt(p, j) - 1] = j - 1;
  return assignment;
}

function selectPaused(
  larger: readonly ClubRankedPlayer[],
  count: number,
  pauses: ReadonlyMap<string, number>,
  played: ReadonlyMap<string, number>,
): readonly string[] {
  // Spec: wenigste Pausen → bei Gleichstand mehr Spiele → höhere Seed-Nummer
  return [...larger]
    .sort((left, right) =>
      (pauses.get(left.playerId) ?? 0) - (pauses.get(right.playerId) ?? 0) ||
      (played.get(right.playerId) ?? 0) - (played.get(left.playerId) ?? 0) ||
      right.seed - left.seed,
    )
    .slice(0, count)
    .map((player) => player.playerId);
}

/**
 * Paart eine Quali-Runde (Spec, Engine). Pausen nur bei der grösseren Seite;
 * dann Zuordnung A×B mit Kosten `|RangA − RangB|` plus Strafe je Wiederholung,
 * so dass Wiederholungen zuerst minimiert werden und danach die Rangnähe.
 */
export function pairClubSwissRound(input: ClubSwissPairingInput): ClubSwissRound {
  if (input.sideA.length === 0 || input.sideB.length === 0) {
    throw new TournamentValidationError("CLUB_DUEL_SIDE_EMPTY", "Beide Vereine brauchen mindestens einen aktiven Spieler.");
  }
  const larger = input.sideA.length >= input.sideB.length ? input.sideA : input.sideB;
  const pauseCount = Math.abs(input.sideA.length - input.sideB.length);
  const pausedPlayerIds = selectPaused(larger, pauseCount, input.pauses, input.played);
  const paused = new Set(pausedPlayerIds);
  const playingA = input.sideA.filter((player) => !paused.has(player.playerId));
  const playingB = input.sideB.filter((player) => !paused.has(player.playerId));
  if (playingA.length !== playingB.length) throw new Error("Club duel pause invariant violated.");

  const previous = new Set(input.previousPairings.map((pair) => `${pair.playerAId}:${pair.playerBId}`));
  const cost = playingA.map((playerA, rankA) =>
    playingB.map((playerB, rankB) =>
      Math.abs(rankA - rankB) + (previous.has(`${playerA.playerId}:${playerB.playerId}`) ? REPEAT_PENALTY : 0),
    ),
  );
  const assignment = solveAssignment(cost);
  const pairings = playingA.map((playerA, index) => {
    const playerB = playingB[numberAt(assignment, index)];
    if (playerB === undefined) throw new Error("Club duel assignment invariant violated.");
    return {
      position: index + 1,
      playerAId: playerA.playerId,
      playerBId: playerB.playerId,
      repeated: previous.has(`${playerA.playerId}:${playerB.playerId}`),
    };
  });
  const repeated = pairings.filter((pairing) => pairing.repeated).length;
  const warnings = repeated === 0
    ? []
    : [`Runde ${input.round}: ${repeated} Paarungen wiederholen sich, weil keine neuen Gegner mehr frei sind.`];
  return { round: input.round, pairings, pausedPlayerIds, warnings };
}
```

- [ ] **Step 4: Tests ausführen – alle müssen bestehen**

Run: `cd packages/tournament-engine && npx vitest run src/club-duel.spec.ts`
Expected: PASS. Falls der Rotationstest in Runde 4 eine andere Reihenfolge liefert, die Sortierregel gegen die Spec prüfen (Pausen asc, Spiele desc, Seed desc) – **nicht** den Test anpassen.

- [ ] **Step 5: Commit**

```bash
pnpm --filter @darts-platform/tournament-engine typecheck
git add packages/tournament-engine/src
git commit -m "feat(tournament-engine): Quali-Runden im Vereinsduell mit Pausen-Rotation paaren"
```

---

### Task 3: Engine – Ranglisten und Vereinswertung

**Files:**
- Modify: `packages/tournament-engine/src/club-duel.ts`
- Modify: `packages/tournament-engine/src/club-duel.spec.ts`
- Modify: `packages/tournament-engine/src/index.ts`

**Interfaces:**
- Consumes: `ClubDuelParticipant`, `ClubMatchResult` (= `GroupMatchResult`: `PLAYED` mit Legs oder `WALKOVER` mit 0:0)
- Produces:
  - `interface ClubStandingRow { position; playerId; side; seed; played; won; lost; legsFor; legsAgainst; winRate: number; legDifferencePerMatch: number; withdrawn: boolean }`
  - `interface ClubStandings { overall: readonly ClubStandingRow[]; sideA: readonly ClubStandingRow[]; sideB: readonly ClubStandingRow[] }`
  - `calculateClubStandings({ participants, results, withdrawnPlayerIds? }): ClubStandings`
  - `interface CrossRoundEntrant { playerId: string; qualifyingRank: number }`
  - `interface CrossRoundStandingRow { position; playerId; played; won; legsFor; legsAgainst; legDifference; qualifyingRank }`
  - `calculateCrossRoundStandings({ sideA: CrossRoundEntrant[], sideB, results, unopposedWalkoverWinnerIds? }): { sideA: CrossRoundStandingRow[]; sideB: CrossRoundStandingRow[] }`
  - `interface ClubScore { pointsA: number; pointsB: number; legDifferenceA: number; leader: "A" | "B" | "TIED" }`
  - `calculateClubScore({ sideOf: ReadonlyMap<string, ClubSide>, results, unopposedWalkoverWinnerIds? }): ClubScore`

`unopposedWalkoverWinnerIds`: Spieler, die ein Finalrunden-Spiel kampflos gewannen, weil der Gegnerverein den Platz nicht besetzen konnte (Spec, Rückzug). Sie zählen als Sieg ohne Legs.

- [ ] **Step 1: Failing Tests schreiben**

Anhängen an `club-duel.spec.ts`:

```ts
import { calculateClubScore, calculateClubStandings, calculateCrossRoundStandings, type ClubMatchResult } from "./index";

const played = (a: string, b: string, legsA: number, legsB: number): ClubMatchResult => ({
  type: "PLAYED", playerOneId: a, playerTwoId: b, playerOneLegs: legsA, playerTwoLegs: legsB, winnerPlayerId: legsA > legsB ? a : b,
});
const walkover = (a: string, b: string, winner: string): ClubMatchResult => ({
  type: "WALKOVER", playerOneId: a, playerTwoId: b, playerOneLegs: 0, playerTwoLegs: 0, winnerPlayerId: winner,
});

describe("calculateClubStandings", () => {
  const participants = clubParticipants(3, 2);

  it("ordnet nach Siegquote, dann Legdifferenz pro Spiel, dann Legs pro Spiel, dann Seed", () => {
    const standings = calculateClubStandings({
      participants,
      results: [
        played("a-1", "b-1", 2, 0), // a-1: 1/1, +2
        played("a-2", "b-2", 2, 1), // a-2: 1/1, +1
        played("a-3", "b-1", 0, 2), // a-3: 0/1
        played("a-1", "b-2", 0, 2), // a-1: 1/2, Legs 2:2 ; b-2: 1/2, Legs 3:2
      ],
    });
    // Quote 1: a-2. Quote ½: b-2 (+0,5 pro Spiel) vor a-1 und b-1 (je 0, je 1 Leg pro Spiel) → Seed 1 vor Seed 4. Zuletzt a-3 (Quote 0).
    expect(standings.overall.map((row) => row.playerId)).toEqual(["a-2", "b-2", "a-1", "b-1", "a-3"]);
    expect(standings.overall[0]).toMatchObject({ position: 1, side: "A", played: 1, won: 1, lost: 0, legsFor: 2, legsAgainst: 1, winRate: 1, legDifferencePerMatch: 1, withdrawn: false });
    expect(standings.sideA.map((row) => [row.position, row.playerId])).toEqual([[1, "a-2"], [2, "a-1"], [3, "a-3"]]);
    expect(standings.sideB.map((row) => [row.position, row.playerId])).toEqual([[1, "b-2"], [2, "b-1"]]);
  });

  it("stellt Spieler ohne Spiel hinter alle mit Spiel und markiert Zurückgezogene", () => {
    const standings = calculateClubStandings({
      participants,
      results: [played("a-3", "b-2", 0, 2)],
      withdrawnPlayerIds: ["a-3"],
    });
    expect(standings.overall.map((row) => row.playerId)).toEqual(["b-2", "a-3", "a-1", "a-2", "b-1"]);
    expect(standings.overall.find((row) => row.playerId === "a-3")?.withdrawn).toBe(true);
  });

  it("zählt Walkover als Sieg ohne Legs", () => {
    const standings = calculateClubStandings({ participants, results: [walkover("a-1", "b-1", "b-1")] });
    expect(standings.overall[0]).toMatchObject({ playerId: "b-1", won: 1, legsFor: 0, legsAgainst: 0, winRate: 1 });
    expect(standings.overall.find((row) => row.playerId === "a-1")).toMatchObject({ played: 1, lost: 1, winRate: 0 });
  });

  it("lehnt ein Resultat innerhalb desselben Vereins oder mit Unbekannten ab", () => {
    expect(() => calculateClubStandings({ participants, results: [played("a-1", "a-2", 2, 0)] }))
      .toThrowError(new TournamentValidationError("CLUB_DUEL_SAME_SIDE_PAIRING", "Ein Spiel muss zwischen den beiden Vereinen stattfinden."));
    expect(() => calculateClubStandings({ participants, results: [played("a-1", "x-9", 2, 0)] }))
      .toThrowError(TournamentValidationError);
  });
});

describe("calculateCrossRoundStandings", () => {
  it("ordnet je Verein nach Siegen, Legdifferenz, Quali-Rang und zählt kampflose Siege", () => {
    const standings = calculateCrossRoundStandings({
      sideA: [{ playerId: "a-1", qualifyingRank: 1 }, { playerId: "a-2", qualifyingRank: 2 }],
      sideB: [{ playerId: "b-1", qualifyingRank: 1 }, { playerId: "b-2", qualifyingRank: 2 }],
      results: [
        played("a-1", "b-1", 2, 1),
        played("a-2", "b-2", 2, 0),
        played("a-1", "b-2", 1, 2),
        played("a-2", "b-1", 0, 2),
      ],
      unopposedWalkoverWinnerIds: ["b-2"],
    });
    // a-1: 1 Sieg, +0 ; a-2: 1 Sieg, +0 → Quali-Rang entscheidet
    expect(standings.sideA.map((row) => [row.position, row.playerId])).toEqual([[1, "a-1"], [2, "a-2"]]);
    // b-2: 2 Siege (1 davon kampflos), b-1: 1 Sieg
    expect(standings.sideB.map((row) => [row.position, row.playerId, row.won, row.played])).toEqual([[1, "b-2", 2, 3], [2, "b-1", 1, 2]]);
  });
});

describe("calculateClubScore", () => {
  const sideOf = new Map(clubParticipants(2, 2).map((participant) => [participant.playerId, participant.side]));

  it("vergibt einen Punkt pro Spiel und führt die Legdifferenz; Summe = Spiele", () => {
    const results = [played("a-1", "b-1", 2, 0), played("a-2", "b-2", 1, 2), walkover("a-1", "b-2", "a-1")];
    const score = calculateClubScore({ sideOf, results });
    expect(score).toEqual({ pointsA: 2, pointsB: 1, legDifferenceA: 1, leader: "A" });
    expect(score.pointsA + score.pointsB).toBe(results.length);
  });

  it("entscheidet Gleichstand über die Legdifferenz, sonst TIED", () => {
    expect(calculateClubScore({ sideOf, results: [played("a-1", "b-1", 2, 0), played("a-2", "b-2", 1, 2)] }).leader).toBe("A");
    expect(calculateClubScore({ sideOf, results: [played("a-1", "b-1", 2, 1), played("a-2", "b-2", 1, 2)] })).toEqual({ pointsA: 1, pointsB: 1, legDifferenceA: 0, leader: "TIED" });
    expect(calculateClubScore({ sideOf, results: [], unopposedWalkoverWinnerIds: ["b-1"] })).toEqual({ pointsA: 0, pointsB: 1, legDifferenceA: 0, leader: "B" });
  });
});
```

- [ ] **Step 2: Tests ausführen – müssen scheitern**

Run: `cd packages/tournament-engine && npx vitest run src/club-duel.spec.ts`
Expected: FAIL – `calculateClubStandings` ist kein Export.

- [ ] **Step 3: Implementieren**

Anhängen an `club-duel.ts`:

```ts
export interface ClubStandingRow {
  readonly position: number;
  readonly playerId: string;
  readonly side: ClubSide;
  readonly seed: number;
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly legsFor: number;
  readonly legsAgainst: number;
  /** Siege / Spiele; 0 ohne Spiel. */
  readonly winRate: number;
  /** (legsFor − legsAgainst) / Spiele; 0 ohne Spiel. */
  readonly legDifferencePerMatch: number;
  readonly withdrawn: boolean;
}

export interface ClubStandings {
  readonly overall: readonly ClubStandingRow[];
  readonly sideA: readonly ClubStandingRow[];
  readonly sideB: readonly ClubStandingRow[];
}

interface Tally {
  readonly playerId: string;
  readonly side: ClubSide;
  readonly seed: number;
  played: number;
  won: number;
  lost: number;
  legsFor: number;
  legsAgainst: number;
}

function assertClubResult(result: ClubMatchResult, sideOf: ReadonlyMap<string, ClubSide>): void {
  const sideOne = sideOf.get(result.playerOneId);
  const sideTwo = sideOf.get(result.playerTwoId);
  if (sideOne === undefined || sideTwo === undefined) {
    throw new TournamentValidationError("INVALID_GROUP_RESULT", "A result references an invalid participant.");
  }
  if (sideOne === sideTwo) {
    throw new TournamentValidationError("CLUB_DUEL_SAME_SIDE_PAIRING", "Ein Spiel muss zwischen den beiden Vereinen stattfinden.");
  }
  const validWinner = result.winnerPlayerId === result.playerOneId || result.winnerPlayerId === result.playerTwoId;
  const validScore = result.type === "WALKOVER"
    ? result.playerOneLegs === 0 && result.playerTwoLegs === 0
    : result.playerOneLegs >= 0 && result.playerTwoLegs >= 0 && result.playerOneLegs !== result.playerTwoLegs;
  if (!validWinner || !validScore) {
    throw new TournamentValidationError("INVALID_GROUP_RESULT", "A result is invalid.");
  }
}

function applyResult(tallies: ReadonlyMap<string, Tally>, result: ClubMatchResult): void {
  const one = tallies.get(result.playerOneId);
  const two = tallies.get(result.playerTwoId);
  if (one === undefined || two === undefined) throw new Error("Tally invariant violated.");
  one.played += 1;
  two.played += 1;
  one.legsFor += result.playerOneLegs;
  one.legsAgainst += result.playerTwoLegs;
  two.legsFor += result.playerTwoLegs;
  two.legsAgainst += result.playerOneLegs;
  const winner = result.winnerPlayerId === one.playerId ? one : two;
  const loser = winner === one ? two : one;
  winner.won += 1;
  loser.lost += 1;
}

/**
 * Ganzzahlige Quotenvergleiche (Kreuzmultiplikation) statt Gleitkomma, damit
 * gleiche Quoten exakt gleich sind. Spieler ohne Spiel stehen hinter allen mit Spiel.
 */
function compareTallies(left: Tally, right: Tally): number {
  if ((left.played === 0) !== (right.played === 0)) return left.played === 0 ? 1 : -1;
  if (left.played === 0) return left.seed - right.seed;
  const winRate = right.won * left.played - left.won * right.played;
  if (winRate !== 0) return winRate;
  const legDifference = (right.legsFor - right.legsAgainst) * left.played - (left.legsFor - left.legsAgainst) * right.played;
  if (legDifference !== 0) return legDifference;
  const legsFor = right.legsFor * left.played - left.legsFor * right.played;
  if (legsFor !== 0) return legsFor;
  return left.seed - right.seed;
}

function toRows(tallies: readonly Tally[], withdrawn: ReadonlySet<string>): readonly ClubStandingRow[] {
  return [...tallies].sort(compareTallies).map((tally, index) => ({
    position: index + 1,
    playerId: tally.playerId,
    side: tally.side,
    seed: tally.seed,
    played: tally.played,
    won: tally.won,
    lost: tally.lost,
    legsFor: tally.legsFor,
    legsAgainst: tally.legsAgainst,
    winRate: tally.played === 0 ? 0 : tally.won / tally.played,
    legDifferencePerMatch: tally.played === 0 ? 0 : (tally.legsFor - tally.legsAgainst) / tally.played,
    withdrawn: withdrawn.has(tally.playerId),
  }));
}

export function calculateClubStandings(input: {
  readonly participants: readonly ClubDuelParticipant[];
  readonly results: readonly ClubMatchResult[];
  readonly withdrawnPlayerIds?: readonly string[];
}): ClubStandings {
  assertUniqueClubParticipants(input.participants);
  const sideOf = new Map(input.participants.map((participant) => [participant.playerId, participant.side]));
  const tallies = new Map<string, Tally>(
    input.participants.map((participant) => [
      participant.playerId,
      { playerId: participant.playerId, side: participant.side, seed: participant.seed, played: 0, won: 0, lost: 0, legsFor: 0, legsAgainst: 0 },
    ]),
  );
  for (const result of input.results) {
    assertClubResult(result, sideOf);
    applyResult(tallies, result);
  }
  const withdrawn = new Set(input.withdrawnPlayerIds ?? []);
  const all = [...tallies.values()];
  return {
    overall: toRows(all, withdrawn),
    sideA: toRows(all.filter((tally) => tally.side === "A"), withdrawn),
    sideB: toRows(all.filter((tally) => tally.side === "B"), withdrawn),
  };
}

export interface CrossRoundEntrant {
  readonly playerId: string;
  readonly qualifyingRank: number;
}

export interface CrossRoundStandingRow {
  readonly position: number;
  readonly playerId: string;
  readonly played: number;
  readonly won: number;
  readonly legsFor: number;
  readonly legsAgainst: number;
  readonly legDifference: number;
  readonly qualifyingRank: number;
}

export function calculateCrossRoundStandings(input: {
  readonly sideA: readonly CrossRoundEntrant[];
  readonly sideB: readonly CrossRoundEntrant[];
  readonly results: readonly ClubMatchResult[];
  readonly unopposedWalkoverWinnerIds?: readonly string[];
}): { readonly sideA: readonly CrossRoundStandingRow[]; readonly sideB: readonly CrossRoundStandingRow[] } {
  const sideOf = new Map<string, ClubSide>([
    ...input.sideA.map((entrant) => [entrant.playerId, "A"] as const),
    ...input.sideB.map((entrant) => [entrant.playerId, "B"] as const),
  ]);
  const rankOf = new Map([...input.sideA, ...input.sideB].map((entrant) => [entrant.playerId, entrant.qualifyingRank]));
  const tallies = new Map<string, Tally>(
    [...sideOf.entries()].map(([playerId, side]) => [playerId, { playerId, side, seed: rankOf.get(playerId) ?? 0, played: 0, won: 0, lost: 0, legsFor: 0, legsAgainst: 0 }]),
  );
  for (const result of input.results) {
    assertClubResult(result, sideOf);
    applyResult(tallies, result);
  }
  for (const playerId of input.unopposedWalkoverWinnerIds ?? []) {
    const tally = tallies.get(playerId);
    if (tally === undefined) throw new TournamentValidationError("INVALID_GROUP_RESULT", "A walkover references an invalid participant.");
    tally.played += 1;
    tally.won += 1;
  }
  const rows = (side: ClubSide): readonly CrossRoundStandingRow[] =>
    [...tallies.values()]
      .filter((tally) => tally.side === side)
      .sort((left, right) =>
        right.won - left.won ||
        (right.legsFor - right.legsAgainst) - (left.legsFor - left.legsAgainst) ||
        left.seed - right.seed,
      )
      .map((tally, index) => ({
        position: index + 1,
        playerId: tally.playerId,
        played: tally.played,
        won: tally.won,
        legsFor: tally.legsFor,
        legsAgainst: tally.legsAgainst,
        legDifference: tally.legsFor - tally.legsAgainst,
        qualifyingRank: tally.seed,
      }));
  return { sideA: rows("A"), sideB: rows("B") };
}

export interface ClubScore {
  readonly pointsA: number;
  readonly pointsB: number;
  /** Legdifferenz aus Sicht von A; für B ist sie das Negative. */
  readonly legDifferenceA: number;
  readonly leader: ClubSide | "TIED";
}

/** Spec, Vereinswertung: 1 Punkt pro gewonnenem Spiel inkl. Walkover; Gleichstand → Legdifferenz → TIED. */
export function calculateClubScore(input: {
  readonly sideOf: ReadonlyMap<string, ClubSide>;
  readonly results: readonly ClubMatchResult[];
  readonly unopposedWalkoverWinnerIds?: readonly string[];
}): ClubScore {
  let pointsA = 0;
  let pointsB = 0;
  let legDifferenceA = 0;
  for (const result of input.results) {
    assertClubResult(result, input.sideOf);
    const winnerSide = input.sideOf.get(result.winnerPlayerId);
    if (winnerSide === "A") pointsA += 1;
    else pointsB += 1;
    const legsA = input.sideOf.get(result.playerOneId) === "A" ? result.playerOneLegs - result.playerTwoLegs : result.playerTwoLegs - result.playerOneLegs;
    legDifferenceA += legsA;
  }
  for (const playerId of input.unopposedWalkoverWinnerIds ?? []) {
    const side = input.sideOf.get(playerId);
    if (side === undefined) throw new TournamentValidationError("INVALID_GROUP_RESULT", "A walkover references an invalid participant.");
    if (side === "A") pointsA += 1;
    else pointsB += 1;
  }
  const leader: ClubSide | "TIED" =
    pointsA !== pointsB ? (pointsA > pointsB ? "A" : "B") : legDifferenceA !== 0 ? (legDifferenceA > 0 ? "A" : "B") : "TIED";
  return { pointsA, pointsB, legDifferenceA, leader };
}
```

In `index.ts` ergänzen: `calculateClubScore`, `calculateClubStandings`, `calculateCrossRoundStandings`, `type ClubScore`, `type ClubStandingRow`, `type ClubStandings`, `type CrossRoundEntrant`, `type CrossRoundStandingRow`.

- [ ] **Step 4: Tests ausführen**

Run: `cd packages/tournament-engine && npx vitest run src/club-duel.spec.ts`
Expected: PASS. Prüfe im ersten Standings-Test die erwartete Reihenfolge von Hand gegen die Kriterien; stimmt die Rechnung im Test nicht, den **Testkommentar** korrigieren, nicht die Sortierregel.

- [ ] **Step 5: Commit**

```bash
pnpm --filter @darts-platform/tournament-engine typecheck
git add packages/tournament-engine/src
git commit -m "feat(tournament-engine): Ranglisten, Finalrunden-Wertung und Vereinswertung fuer das Vereinsduell"
```

---

### Task 4: Engine – Lifecycle für CLUB_DUEL und Paket bauen

**Files:**
- Modify: `packages/tournament-engine/src/tournament.ts:80-122` (`TournamentLifecycleStage`, `TournamentLifecycle`, `calculateTournamentLifecycle`)
- Modify: `packages/tournament-engine/src/tournament.spec.ts`

**Interfaces:**
- Produces: `calculateTournamentLifecycle({ format: TournamentFormatKey, stages })` mit `TournamentFormatKey = "GROUPS_THEN_KNOCKOUT" | "ROUND_ROBIN" | "SINGLE_ELIMINATION" | "CLUB_DUEL"`, `TournamentLifecycleStage.type: PlannedStageType`, `TournamentLifecycle.tournamentStatus: "GROUP_STAGE" | "FINAL_ROUND" | "KNOCKOUT" | "COMPLETED"`.

- [ ] **Step 1: Failing Test**

In `tournament.spec.ts`, `describe("tournament lifecycle")` ergänzen:

```ts
  it("führt ein Vereinsduell durch Quali, Finalrunde und Final", () => {
    const stages = (open: readonly boolean[]) => [
      { id: "qualifying", type: "CLUB_SWISS" as const, hasOpenMatches: open[0] ?? false },
      { id: "final-round", type: "CLUB_CROSS_ROUND_ROBIN" as const, hasOpenMatches: open[1] ?? false },
      { id: "final", type: "SINGLE_ELIMINATION" as const, hasOpenMatches: open[2] ?? false },
    ];
    expect(calculateTournamentLifecycle({ format: "CLUB_DUEL", stages: stages([true, true, true]) })).toEqual({
      tournamentStatus: "GROUP_STAGE",
      stages: [{ id: "qualifying", status: "OPEN" }, { id: "final-round", status: "WAITING" }, { id: "final", status: "WAITING" }],
    });
    expect(calculateTournamentLifecycle({ format: "CLUB_DUEL", stages: stages([false, true, true]) })).toEqual({
      tournamentStatus: "FINAL_ROUND",
      stages: [{ id: "qualifying", status: "COMPLETED" }, { id: "final-round", status: "OPEN" }, { id: "final", status: "WAITING" }],
    });
    expect(calculateTournamentLifecycle({ format: "CLUB_DUEL", stages: stages([false, false, true]) }).tournamentStatus).toBe("KNOCKOUT");
    expect(calculateTournamentLifecycle({ format: "CLUB_DUEL", stages: stages([false, false, false]) }).tournamentStatus).toBe("COMPLETED");
  });
```

- [ ] **Step 2: Test ausführen – muss scheitern (Typfehler/falscher Status)**

Run: `cd packages/tournament-engine && npx vitest run src/tournament.spec.ts`

- [ ] **Step 3: Implementieren**

In `tournament.ts`:

```ts
export type TournamentFormatKey = "GROUPS_THEN_KNOCKOUT" | "ROUND_ROBIN" | "SINGLE_ELIMINATION" | "CLUB_DUEL";

export interface TournamentLifecycleStage {
  readonly id: string;
  readonly type: PlannedStageType;
  readonly hasOpenMatches: boolean;
}

export interface TournamentLifecycle {
  readonly tournamentStatus: "GROUP_STAGE" | "FINAL_ROUND" | "KNOCKOUT" | "COMPLETED";
  readonly stages: readonly { readonly id: string; readonly status: "OPEN" | "WAITING" | "COMPLETED" }[];
}

/** Reihenfolge der Phasen eines Vereinsduells; die erste mit offenen Spielen ist die laufende. */
const CLUB_DUEL_STAGE_ORDER: readonly PlannedStageType[] = ["CLUB_SWISS", "CLUB_CROSS_ROUND_ROBIN", "SINGLE_ELIMINATION"];
const CLUB_DUEL_STATUS_BY_STAGE = ["GROUP_STAGE", "FINAL_ROUND", "KNOCKOUT"] as const;

function calculateClubDuelLifecycle(stages: readonly TournamentLifecycleStage[]): TournamentLifecycle {
  const openTypes = new Set(stages.filter((stage) => stage.hasOpenMatches).map((stage) => stage.type));
  const currentIndex = CLUB_DUEL_STAGE_ORDER.findIndex((type) => openTypes.has(type));
  const tournamentStatus = currentIndex === -1 ? "COMPLETED" : (CLUB_DUEL_STATUS_BY_STAGE[currentIndex] ?? "COMPLETED");
  return {
    tournamentStatus,
    stages: stages.map((stage) => ({
      id: stage.id,
      status: !stage.hasOpenMatches ? "COMPLETED" : CLUB_DUEL_STAGE_ORDER.indexOf(stage.type) === currentIndex ? "OPEN" : "WAITING",
    })),
  };
}

export function calculateTournamentLifecycle(input: {
  readonly format: TournamentFormatKey;
  readonly stages: readonly TournamentLifecycleStage[];
}): TournamentLifecycle {
  if (input.format === "CLUB_DUEL") return calculateClubDuelLifecycle(input.stages);
  // bestehender Rumpf unverändert
```

`TournamentPlanInput.format` bleibt auf den drei klassischen Formaten – `createTournamentPlan` kennt `CLUB_DUEL` nicht; die API ruft dafür `planClubDuel`. `type TournamentFormatKey` in `index.ts` exportieren.

- [ ] **Step 4: Tests, Typecheck, Build, Commit**

```bash
cd packages/tournament-engine && npx vitest run && cd ../..
pnpm --filter @darts-platform/tournament-engine typecheck
pnpm --filter @darts-platform/tournament-engine build
git add packages/tournament-engine
git commit -m "feat(tournament-engine): Turnierstatus FINAL_ROUND fuer das Vereinsduell"
```

Hinweis: `pnpm typecheck` auf Root scheitert jetzt vermutlich in `apps/api` (`update-tournament-progress.ts` castet auf die alten Unions). Das ist erwartet und wird in Task 9 behoben.

---

### Task 5: Schemas – Format, Status, Anlage-Union, Dashboard-Block, Gastspieler

**Files:**
- Create: `packages/schemas/src/club-duel.ts`
- Modify: `packages/schemas/src/tournament.ts`
- Modify: `packages/schemas/src/player.ts`
- Modify: `packages/schemas/src/index.ts`
- Modify: `packages/schemas/src/tournament.spec.ts`, `packages/schemas/src/player.spec.ts` (falls vorhanden; sonst anlegen)

**Interfaces (Produces):**
- `tournamentFormatSchema = z.enum(["GROUPS_THEN_KNOCKOUT","ROUND_ROBIN","SINGLE_ELIMINATION","CLUB_DUEL"])`, `classicTournamentFormatSchema` (die drei alten)
- `tournamentStatusSchema` um `"FINAL_ROUND"` erweitert
- `createClassicTournamentSchema` (= bisheriges `createTournamentSchema`, `format: classicTournamentFormatSchema`), `createClubDuelTournamentSchema`, `createTournamentSchema = z.discriminatedUnion("format", [...])`; Typen `CreateClassicTournamentInput`, `CreateClubDuelTournamentInput`, `CreateTournamentInput` (Union)
- `clubSideSchema`, `clubDuelDashboardSchema`, `clubDuelPreviewInputSchema`, `clubDuelPreviewSchema`
- `tournamentDashboardSchema.clubDuel: clubDuelDashboardSchema.nullable()`; Teilnehmer erhalten `side: clubSideSchema.nullable()`; `publicTournamentDashboardSchema.clubDuel` ebenso
- `playerKindSchema = z.enum(["MEMBER","GUEST"])`, `playerSchema` um `kind`, `guestClubName: string | null`; `createGuestPlayersSchema`, `playerKindFilterSchema = z.enum(["MEMBER","GUEST","ALL"]).default("MEMBER")`

- [ ] **Step 1: Failing Tests**

In `tournament.spec.ts` ergänzen:

```ts
import { clubDuelDashboardSchema, createClubDuelTournamentSchema, createTournamentSchema, tournamentStatusSchema } from "./index";

describe("club duel contracts", () => {
  const base = {
    name: "Vereinsduell",
    startsAt: new Date().toISOString(),
    format: "CLUB_DUEL" as const,
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    bestOfLegs: 3,
    bestOfSets: 1,
    sideAName: "VFC",
    sideBName: "DC Musterdorf",
    qualifyingRounds: 4,
    finalRoundSize: 4,
    thirdPlaceMatch: true,
    participants: [
      ...Array.from({ length: 5 }, (_, index) => ({ playerId: id(index + 1), side: "A" })),
      ...Array.from({ length: 4 }, (_, index) => ({ playerId: id(index + 10), side: "B" })),
    ],
    boardIds: [id(90)],
  };

  it("accepts a club duel through the shared create schema", () => {
    const parsed = createTournamentSchema.parse(base);
    expect(parsed.format).toBe("CLUB_DUEL");
    if (parsed.format === "CLUB_DUEL") expect(parsed.participants).toHaveLength(9);
  });

  it("rejects duplicate players, out-of-range rounds and a one-sided field", () => {
    expect(createClubDuelTournamentSchema.safeParse({ ...base, participants: [...base.participants, { playerId: id(1), side: "B" }] }).success).toBe(false);
    expect(createClubDuelTournamentSchema.safeParse({ ...base, qualifyingRounds: 16 }).success).toBe(false);
    expect(createClubDuelTournamentSchema.safeParse({ ...base, finalRoundSize: 7 }).success).toBe(false);
    expect(createClubDuelTournamentSchema.safeParse({ ...base, participants: base.participants.filter((entry) => entry.side === "A") }).success).toBe(false);
  });

  it("knows the FINAL_ROUND status and the clubDuel block", () => {
    expect(tournamentStatusSchema.parse("FINAL_ROUND")).toBe("FINAL_ROUND");
    expect(clubDuelDashboardSchema.safeParse({
      sideAName: "VFC", sideBName: "DC", qualifyingRounds: 2, finalRoundSize: 2, thirdPlaceMatch: false,
      currentRound: 1,
      rounds: [{ round: 1, matchIds: [id(1)], pausedPlayerIds: [id(5)] }],
      standings: { overall: [], sideA: [], sideB: [] },
      finalRound: { sideA: [], sideB: [], matches: [] },
      score: { pointsA: 0, pointsB: 0, legDifferenceA: 0, leader: "TIED" },
    }).success).toBe(true);
  });
});
```

`id(n)` existiert bereits in dieser Spec-Datei (siehe Zeile 19). In `player.spec.ts` (neu, falls nicht vorhanden):

```ts
import { describe, expect, it } from "vitest";
import { createGuestPlayersSchema, playerKindFilterSchema } from "./index";

describe("guest players contract", () => {
  it("accepts up to 64 distinct trimmed names and defaults the list filter to MEMBER", () => {
    const parsed = createGuestPlayersSchema.parse({ commandId: "0d1f6d2e-4b1a-4c2e-9f3a-1b2c3d4e5f60", clubName: " DC Musterdorf ", names: [" Anna ", "Beat"] });
    expect(parsed.clubName).toBe("DC Musterdorf");
    expect(parsed.names).toEqual(["Anna", "Beat"]);
    expect(createGuestPlayersSchema.safeParse({ commandId: "0d1f6d2e-4b1a-4c2e-9f3a-1b2c3d4e5f60", clubName: "DC", names: ["Anna", "anna"] }).success).toBe(false);
    expect(createGuestPlayersSchema.safeParse({ commandId: "0d1f6d2e-4b1a-4c2e-9f3a-1b2c3d4e5f60", clubName: "DC", names: [] }).success).toBe(false);
    expect(playerKindFilterSchema.parse(undefined)).toBe("MEMBER");
  });
});
```

- [ ] **Step 2: Tests ausführen – müssen scheitern**

Run: `cd packages/schemas && npx vitest run`

- [ ] **Step 3: `club-duel.ts` anlegen**

```ts
import { z } from "zod";

export const clubSideSchema = z.enum(["A", "B"]);

export const clubDuelParticipantInputSchema = z.object({
  playerId: z.uuid(),
  side: clubSideSchema,
});

/** Grenzen wie `CLUB_DUEL_LIMITS` in der Engine (Spec, Entscheide). */
export const clubDuelSettingsSchema = z.object({
  sideAName: z.string().trim().min(1).max(120),
  sideBName: z.string().trim().min(1).max(120),
  qualifyingRounds: z.number().int().min(1).max(15),
  finalRoundSize: z.number().int().min(2).max(6),
  thirdPlaceMatch: z.boolean().default(true),
});

export const clubDuelPreviewInputSchema = clubDuelSettingsSchema.pick({ qualifyingRounds: true, finalRoundSize: true, thirdPlaceMatch: true }).extend({
  sideACount: z.number().int().min(1).max(256),
  sideBCount: z.number().int().min(1).max(256),
  boardCount: z.number().int().min(1).max(64),
  bestOfLegs: z.number().int().min(1).max(21),
});

export const clubDuelPreviewSchema = z.object({
  qualifyingMatches: z.number().int().nonnegative(),
  finalRoundMatches: z.number().int().nonnegative(),
  finalMatches: z.number().int().nonnegative(),
  totalMatches: z.number().int().nonnegative(),
  matchesPerPlayer: z.object({
    sideA: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }),
    sideB: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }),
  }),
  estimatedMinutes: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export const clubStandingRowSchema = z.object({
  position: z.number().int().positive(),
  playerId: z.uuid(),
  displayName: z.string(),
  side: clubSideSchema,
  played: z.number().int().nonnegative(),
  won: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
  legsFor: z.number().int().nonnegative(),
  legsAgainst: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1),
  legDifferencePerMatch: z.number(),
  withdrawn: z.boolean(),
  /** Platz in der Finalrunde nach aktuellem Stand (nur Rangliste je Verein). */
  qualified: z.boolean(),
});

export const clubCrossStandingRowSchema = z.object({
  position: z.number().int().positive(),
  playerId: z.uuid(),
  displayName: z.string(),
  side: clubSideSchema,
  played: z.number().int().nonnegative(),
  won: z.number().int().nonnegative(),
  legDifference: z.number().int(),
  qualifyingRank: z.number().int().positive(),
});

export const clubCrossMatchSchema = z.object({
  matchId: z.uuid(),
  round: z.number().int().positive(),
  rankA: z.number().int().positive(),
  rankB: z.number().int().positive(),
  playerAId: z.uuid().nullable(),
  playerBId: z.uuid().nullable(),
  status: z.enum(["WAITING", "READY", "IN_PROGRESS", "COMPLETED", "BYE", "CANCELLED"]),
  winnerPlayerId: z.uuid().nullable(),
  /** Legs [A, B]; null solange nicht gespielt oder Walkover. */
  legs: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable(),
});

export const clubScoreSchema = z.object({
  pointsA: z.number().int().nonnegative(),
  pointsB: z.number().int().nonnegative(),
  legDifferenceA: z.number().int(),
  leader: z.enum(["A", "B", "TIED"]),
});

export const clubDuelDashboardSchema = clubDuelSettingsSchema.extend({
  /** Höchste bisher gepaarte Quali-Runde. */
  currentRound: z.number().int().nonnegative(),
  rounds: z.array(z.object({
    round: z.number().int().positive(),
    matchIds: z.array(z.uuid()),
    pausedPlayerIds: z.array(z.uuid()),
  })),
  standings: z.object({
    overall: z.array(clubStandingRowSchema),
    sideA: z.array(clubStandingRowSchema),
    sideB: z.array(clubStandingRowSchema),
  }),
  finalRound: z.object({
    sideA: z.array(clubCrossStandingRowSchema),
    sideB: z.array(clubCrossStandingRowSchema),
    matches: z.array(clubCrossMatchSchema),
  }),
  score: clubScoreSchema,
});

export type ClubSide = z.infer<typeof clubSideSchema>;
export type ClubDuelPreviewInput = z.infer<typeof clubDuelPreviewInputSchema>;
export type ClubDuelPreviewResponse = z.infer<typeof clubDuelPreviewSchema>;
export type ClubDuelDashboard = z.infer<typeof clubDuelDashboardSchema>;
export type ClubStandingRowResponse = z.infer<typeof clubStandingRowSchema>;
export type ClubCrossStandingRowResponse = z.infer<typeof clubCrossStandingRowSchema>;
export type ClubCrossMatchResponse = z.infer<typeof clubCrossMatchSchema>;
export type ClubScoreResponse = z.infer<typeof clubScoreSchema>;
```

- [ ] **Step 4: `tournament.ts` anpassen**

```ts
import { clubDuelDashboardSchema, clubDuelParticipantInputSchema, clubDuelSettingsSchema, clubSideSchema } from "./club-duel";

export const tournamentStatusSchema = z.enum(["DRAFT", "READY", "GROUP_STAGE", "FINAL_ROUND", "KNOCKOUT", "COMPLETED"]);

export const classicTournamentFormatSchema = z.enum(["GROUPS_THEN_KNOCKOUT", "ROUND_ROBIN", "SINGLE_ELIMINATION"]);
export const tournamentFormatSchema = z.enum(["GROUPS_THEN_KNOCKOUT", "ROUND_ROBIN", "SINGLE_ELIMINATION", "CLUB_DUEL"]);
```

Das bisherige `createTournamentSchema` in `createClassicTournamentSchema` umbenennen und dort `format: classicTournamentFormatSchema` setzen. Die gemeinsamen Match-Felder in ein `tournamentMatchSettingsSchema` ziehen (name, startsAt, startingScore, inRule, outRule, maxRounds, bestOfLegs, bestOfSets, boardIds) und in beiden Zweigen per `.extend` nutzen. Dann:

```ts
export const createClubDuelTournamentSchema = tournamentMatchSettingsSchema
  .extend({
    format: z.literal("CLUB_DUEL"),
    participants: z.array(clubDuelParticipantInputSchema).min(2).max(256),
  })
  .extend(clubDuelSettingsSchema.shape)
  .refine((value) => new Set(value.participants.map((entry) => entry.playerId)).size === value.participants.length, {
    message: "A participant may only be entered once.",
    path: ["participants"],
  })
  .refine((value) => new Set(value.boardIds).size === value.boardIds.length, {
    message: "A board may only be selected once.",
    path: ["boardIds"],
  })
  .refine(
    (value) => {
      const sideA = value.participants.filter((entry) => entry.side === "A").length;
      const sideB = value.participants.length - sideA;
      return Math.min(sideA, sideB) >= value.finalRoundSize;
    },
    { message: "Jeder Verein braucht mindestens so viele Spieler wie die Finalrunde Plätze hat.", path: ["participants"] },
  );

export const createTournamentSchema = z.discriminatedUnion("format", [
  createClassicTournamentSchema,
  createClubDuelTournamentSchema,
]);
```

Falls Zod die verfeinerten Objekte in `discriminatedUnion` ablehnt (Laufzeitfehler beim Import), stattdessen `z.union([...])` verwenden – der `format`-Wert trennt die Zweige zur Laufzeit ohnehin.

Im Dashboard:

```ts
const tournamentDashboardParticipantSchema = z.object({
  // bestehende Felder …
  side: clubSideSchema.nullable(),
});

export const tournamentDashboardSchema = z.object({
  // bestehende Felder …
  clubDuel: clubDuelDashboardSchema.nullable(),
  generatedAt: z.coerce.date(),
});

export const publicTournamentDashboardSchema = z.object({
  // bestehende Felder …
  clubDuel: tournamentDashboardSchema.shape.clubDuel,
  generatedAt: tournamentDashboardSchema.shape.generatedAt,
});
```

Typen am Dateiende ergänzen:

```ts
export type ClassicTournamentFormat = z.infer<typeof classicTournamentFormatSchema>;
export type CreateClassicTournamentInput = z.infer<typeof createClassicTournamentSchema>;
export type CreateClubDuelTournamentInput = z.infer<typeof createClubDuelTournamentSchema>;
export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;
```

- [ ] **Step 5: `player.ts` anpassen**

```ts
export const playerKindSchema = z.enum(["MEMBER", "GUEST"]);
export const playerKindFilterSchema = z.enum(["MEMBER", "GUEST", "ALL"]).default("MEMBER");

export const createGuestPlayersSchema = z
  .object({
    commandId: z.uuid(),
    clubName: z.string().trim().min(1).max(120),
    names: z.array(z.string().trim().min(1).max(255)).min(1).max(64),
  })
  .refine((value) => new Set(value.names.map((name) => name.toLowerCase())).size === value.names.length, {
    message: "Jeder Name darf nur einmal vorkommen.",
    path: ["names"],
  });
```

`playerSchema` um `kind: playerKindSchema` und `guestClubName: z.string().nullable()` ergänzen. Typen: `PlayerKind`, `PlayerKindFilter`, `CreateGuestPlayersInput`.

- [ ] **Step 6: `index.ts` ergänzen**

Neue Exporte aus `./club-duel` (alle Schemas und Typen von oben), aus `./tournament` (`classicTournamentFormatSchema`, `createClassicTournamentSchema`, `createClubDuelTournamentSchema`, `type ClassicTournamentFormat`, `type CreateClassicTournamentInput`, `type CreateClubDuelTournamentInput`), aus `./player` (`playerKindSchema`, `playerKindFilterSchema`, `createGuestPlayersSchema`, `type PlayerKind`, `type PlayerKindFilter`, `type CreateGuestPlayersInput`).

- [ ] **Step 7: Tests, Typecheck, Build, Commit**

```bash
cd packages/schemas && npx vitest run && cd ../..
pnpm --filter @darts-platform/schemas typecheck
pnpm --filter @darts-platform/schemas build
git add packages/schemas
git commit -m "feat(schemas): Vertraege fuer Vereinsduell und Gastspieler"
```

---

### Task 6: Datenbank – Schema, Migration 0037, Constraint-Test

**Files:**
- Modify: `packages/database/src/schema.ts` (`players`, `tournaments`, `tournamentParticipants`, `tournamentStages`, `tournamentMatches`)
- Create: `packages/database/drizzle/0037_club_duel.sql`
- Modify: `packages/database/drizzle/meta/_journal.json`
- Create: `packages/database/src/club-duel-constraints.integration.spec.ts`

**Interfaces (Produces):** neue Spalten `players.kind`, `players.guestClubName`, `players.guestCommandId`, `tournaments.sideAName`, `tournaments.sideBName`, `tournaments.qualifyingRounds`, `tournaments.finalRoundSize`, `tournaments.thirdPlaceMatch`, `tournamentParticipants.side`.

- [ ] **Step 1: Failing Constraint-Test**

`packages/database/src/club-duel-constraints.integration.spec.ts` (Muster: `tournament-visibility.integration.spec.ts` – gleiche Verbindung, eigene Organisation mit zufälliger ID, `afterAll` räumt auf):

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabaseConnection, organizations, players, tournaments, users, type Database } from "./index";

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined) throw new Error("DATABASE_URL fehlt (.env laden).");
const connection = createDatabaseConnection(databaseUrl);
const database: Database = connection.database;
const organizationId = randomUUID();
const userId = randomUUID();

beforeAll(async () => {
  await database.insert(organizations).values({ id: organizationId, name: `club-duel-${organizationId}`, slug: `club-duel-${organizationId}` });
  await database.insert(users).values({ id: userId, email: `club-duel-${userId}@example.test`, name: "Konto", emailVerified: false });
});

afterAll(async () => {
  await database.delete(organizations).where(eq(organizations.id, organizationId));
  await database.delete(users).where(eq(users.id, userId));
  await connection.close();
});

describe("Vereinsduell-Constraints", () => {
  it("ein Gast braucht einen Vereinsnamen und darf kein Konto tragen", async () => {
    await expect(database.insert(players).values({ organizationId, displayName: "Gast ohne Verein", status: "ACTIVE", kind: "GUEST" }))
      .rejects.toThrow(/players_guest_club_name_check/);
    await expect(database.insert(players).values({ organizationId, displayName: "Gast mit Konto", status: "ACTIVE", kind: "GUEST", guestClubName: "DC Musterdorf", userId }))
      .rejects.toThrow(/players_guest_no_account_check/);
    await expect(database.insert(players).values({ organizationId, displayName: "Mitglied mit Gastverein", status: "ACTIVE", kind: "MEMBER", guestClubName: "DC Musterdorf" }))
      .rejects.toThrow(/players_guest_club_name_check/);
  });

  it("ein Vereinsduell braucht Vereinsnamen, Runden und Finalrunde; andere Formate dürfen sie nicht tragen", async () => {
    const base = { organizationId, name: "Duell", format: "CLUB_DUEL", groupCount: 1, qualifyPerGroup: 1, knockoutSize: 2, seeding: "SEEDED", startsAt: new Date() } as const;
    await expect(database.insert(tournaments).values({ ...base })).rejects.toThrow(/tournaments_club_duel_settings_check/);
    await expect(database.insert(tournaments).values({ ...base, sideAName: "VFC", sideBName: "DC", qualifyingRounds: 16, finalRoundSize: 4 })).rejects.toThrow(/tournaments_qualifying_rounds_check/);
    await expect(database.insert(tournaments).values({ ...base, format: "ROUND_ROBIN", sideAName: "VFC", sideBName: "DC", qualifyingRounds: 4, finalRoundSize: 4 })).rejects.toThrow(/tournaments_club_duel_settings_check/);
    const [created] = await database.insert(tournaments).values({ ...base, sideAName: "VFC", sideBName: "DC", qualifyingRounds: 4, finalRoundSize: 4 }).returning();
    expect(created?.thirdPlaceMatch).toBe(true);
    expect(created?.status).toBe("READY");
  });
});
```

Prüfe die Pflichtfelder von `organizations` und `users` in `schema.ts` und ergänze die `values(...)`, falls dort weitere `notNull`-Spalten ohne Default stehen.

- [ ] **Step 2: Test ausführen – muss scheitern (Spalten unbekannt)**

Run: `cd packages/database && npx dotenv -e ../../.env -- npx vitest run src/club-duel-constraints.integration.spec.ts`

- [ ] **Step 3: `schema.ts` ändern**

`players` (Spalten nach `userId`):

```ts
    /**
     * Gastspieler eines anderen Vereins fuer Vereinsduelle (Spec 2026-10-01-
     * vereinsduell). Sie leben in der Organisation des Gastgebers, ohne Konto.
     */
    kind: varchar("kind", { length: 10 }).default("MEMBER").notNull(),
    guestClubName: varchar("guest_club_name", { length: 120 }),
    /** Idempotenz der Schnellerfassung: dieselbe commandId legt keine zweite Reihe an. */
    guestCommandId: uuid("guest_command_id"),
```

Checks/Indexe von `players` ergänzen:

```ts
    check("players_kind_check", sql`${table.kind} in ('MEMBER', 'GUEST')`),
    check(
      "players_guest_club_name_check",
      sql`(${table.kind} = 'GUEST' and ${table.guestClubName} is not null and length(trim(${table.guestClubName})) > 0) or (${table.kind} = 'MEMBER' and ${table.guestClubName} is null)`,
    ),
    check("players_guest_no_account_check", sql`${table.kind} = 'MEMBER' or ${table.userId} is null`),
    uniqueIndex("players_guest_command_name_unique")
      .on(table.organizationId, table.guestCommandId, table.displayName)
      .where(sql`${table.guestCommandId} is not null`),
    index("players_organization_kind_idx").on(table.organizationId, table.kind),
```

`tournaments` (Spalten nach `seeding`):

```ts
    sideAName: varchar("side_a_name", { length: 120 }),
    sideBName: varchar("side_b_name", { length: 120 }),
    qualifyingRounds: integer("qualifying_rounds"),
    finalRoundSize: integer("final_round_size"),
    thirdPlaceMatch: boolean("third_place_match").default(true).notNull(),
```

Checks von `tournaments` ändern/ergänzen:

```ts
    check("tournaments_status_check", sql`${table.status} in ('READY', 'GROUP_STAGE', 'FINAL_ROUND', 'KNOCKOUT', 'COMPLETED')`),
    check("tournaments_format_check", sql`${table.format} in ('GROUPS_THEN_KNOCKOUT', 'ROUND_ROBIN', 'SINGLE_ELIMINATION', 'CLUB_DUEL')`),
    check("tournaments_qualifying_rounds_check", sql`${table.qualifyingRounds} is null or ${table.qualifyingRounds} between 1 and 15`),
    check("tournaments_final_round_size_check", sql`${table.finalRoundSize} is null or ${table.finalRoundSize} between 2 and 6`),
    check(
      "tournaments_club_duel_settings_check",
      sql`(${table.format} = 'CLUB_DUEL' and ${table.sideAName} is not null and ${table.sideBName} is not null and ${table.qualifyingRounds} is not null and ${table.finalRoundSize} is not null) or (${table.format} <> 'CLUB_DUEL' and ${table.sideAName} is null and ${table.sideBName} is null and ${table.qualifyingRounds} is null and ${table.finalRoundSize} is null)`,
    ),
```

`boolean` aus `drizzle-orm/pg-core` importieren, falls noch nicht.

`tournamentParticipants`: Spalte `side: char("side", { length: 1 })` plus `check("tournament_participants_side_check", sql`${table.side} is null or ${table.side} in ('A', 'B')`)`.

`tournamentStages`: Typ-Check auf `('GROUP', 'ROUND_ROBIN', 'SINGLE_ELIMINATION', 'CLUB_SWISS', 'CLUB_CROSS_ROUND_ROBIN')`.

`tournamentMatches`: zwei partielle Unique-Indexe

```ts
    uniqueIndex("tournament_matches_stage_round_participant_one_unique")
      .on(table.stageId, table.round, table.participantOneId)
      .where(sql`${table.participantOneId} is not null and ${table.status} <> 'CANCELLED'`),
    uniqueIndex("tournament_matches_stage_round_participant_two_unique")
      .on(table.stageId, table.round, table.participantTwoId)
      .where(sql`${table.participantTwoId} is not null and ${table.status} <> 'CANCELLED'`),
```

**Achtung Bestand:** In K.-o.-Phasen steht ein Spieler je Runde nur einmal, in Gruppen (`stageId` = Gruppenphase, Runden pro Gruppe) aber mehrfach: Gruppe A Runde 1 und Gruppe B Runde 1 teilen `stageId` und `round`. Deshalb die Indexe zusätzlich auf `group_id is null` einschränken: `.where(sql`${table.participantOneId} is not null and ${table.groupId} is null and ${table.status} <> 'CANCELLED'`)`. Vor dem Schreiben der Migration mit einer Abfrage auf der lokalen DB prüfen, dass kein bestehender Datensatz verletzt wird:

```sql
select stage_id, round, participant_one_id, count(*) from tournament_matches
 where participant_one_id is not null and group_id is null and status <> 'CANCELLED'
 group by 1,2,3 having count(*) > 1;
```

- [ ] **Step 4: Migration `0037_club_duel.sql` schreiben**

```sql
-- Vereinsduell (Spec 2026-10-01-vereinsduell-design): Gastspieler, Format
-- CLUB_DUEL mit Vereinsnamen/Runden/Finalrunde, Seite je Teilnehmer, neue
-- Phasentypen, Status FINAL_ROUND, ein Spieler je Runde nur einmal.
ALTER TABLE "players" ADD COLUMN "kind" varchar(10) DEFAULT 'MEMBER' NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "guest_club_name" varchar(120);--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "guest_command_id" uuid;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_kind_check" CHECK ("players"."kind" in ('MEMBER', 'GUEST'));--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_guest_club_name_check" CHECK (("players"."kind" = 'GUEST' and "players"."guest_club_name" is not null and length(trim("players"."guest_club_name")) > 0) or ("players"."kind" = 'MEMBER' and "players"."guest_club_name" is null));--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_guest_no_account_check" CHECK ("players"."kind" = 'MEMBER' or "players"."user_id" is null);--> statement-breakpoint
CREATE UNIQUE INDEX "players_guest_command_name_unique" ON "players" ("organization_id", "guest_command_id", "display_name") WHERE "players"."guest_command_id" is not null;--> statement-breakpoint
CREATE INDEX "players_organization_kind_idx" ON "players" ("organization_id", "kind");--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "side_a_name" varchar(120);--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "side_b_name" varchar(120);--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "qualifying_rounds" integer;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "final_round_size" integer;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "third_place_match" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" DROP CONSTRAINT "tournaments_status_check";--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_status_check" CHECK ("tournaments"."status" in ('READY', 'GROUP_STAGE', 'FINAL_ROUND', 'KNOCKOUT', 'COMPLETED'));--> statement-breakpoint
ALTER TABLE "tournaments" DROP CONSTRAINT "tournaments_format_check";--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_format_check" CHECK ("tournaments"."format" in ('GROUPS_THEN_KNOCKOUT', 'ROUND_ROBIN', 'SINGLE_ELIMINATION', 'CLUB_DUEL'));--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_qualifying_rounds_check" CHECK ("tournaments"."qualifying_rounds" is null or "tournaments"."qualifying_rounds" between 1 and 15);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_final_round_size_check" CHECK ("tournaments"."final_round_size" is null or "tournaments"."final_round_size" between 2 and 6);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_club_duel_settings_check" CHECK (("tournaments"."format" = 'CLUB_DUEL' and "tournaments"."side_a_name" is not null and "tournaments"."side_b_name" is not null and "tournaments"."qualifying_rounds" is not null and "tournaments"."final_round_size" is not null) or ("tournaments"."format" <> 'CLUB_DUEL' and "tournaments"."side_a_name" is null and "tournaments"."side_b_name" is null and "tournaments"."qualifying_rounds" is null and "tournaments"."final_round_size" is null));--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD COLUMN "side" char(1);--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_side_check" CHECK ("tournament_participants"."side" is null or "tournament_participants"."side" in ('A', 'B'));--> statement-breakpoint
ALTER TABLE "tournament_stages" DROP CONSTRAINT "tournament_stages_type_check";--> statement-breakpoint
ALTER TABLE "tournament_stages" ADD CONSTRAINT "tournament_stages_type_check" CHECK ("tournament_stages"."type" in ('GROUP', 'ROUND_ROBIN', 'SINGLE_ELIMINATION', 'CLUB_SWISS', 'CLUB_CROSS_ROUND_ROBIN'));--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_matches_stage_round_participant_one_unique" ON "tournament_matches" ("stage_id", "round", "participant_one_id") WHERE "tournament_matches"."participant_one_id" is not null and "tournament_matches"."group_id" is null and "tournament_matches"."status" <> 'CANCELLED';--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_matches_stage_round_participant_two_unique" ON "tournament_matches" ("stage_id", "round", "participant_two_id") WHERE "tournament_matches"."participant_two_id" is not null and "tournament_matches"."group_id" is null and "tournament_matches"."status" <> 'CANCELLED';
```

Journal-Eintrag in `meta/_journal.json` anhängen:

```json
    {
      "idx": 37,
      "version": "7",
      "when": 1791000000000,
      "tag": "0037_club_duel",
      "breakpoints": true
    }
```

Die exakten Constraint-Namen der bestehenden Checks (`tournaments_status_check`, `tournaments_format_check`, `tournament_stages_type_check`) vor dem Schreiben in der lokalen DB mit `\d tournaments` bestätigen.

- [ ] **Step 5: Migration lokal anwenden, Test ausführen**

```bash
cd packages/database && npx dotenv -e ../../.env -- pnpm db:migrate
npx dotenv -e ../../.env -- npx vitest run src/club-duel-constraints.integration.spec.ts
npx dotenv -e ../../.env -- npx vitest run
```
Expected: PASS, auch die bestehenden DB-Tests.

- [ ] **Step 6: Build, Commit**

```bash
pnpm --filter @darts-platform/database typecheck && pnpm --filter @darts-platform/database build
git add packages/database
git commit -m "feat(database): Migration 0037 Vereinsduell und Gastspieler"
```

---

### Task 7: Web kompiliert weiter (Labels, klassisches Anlage-Schema)

**Files:**
- Modify: `apps/web/src/lib/tournament-format.ts`, `apps/web/src/lib/tournament-format.spec.ts`
- Modify: `apps/web/src/components/tournament/setup-sheet.tsx:17-21,143,180`

Die eigentliche Oberfläche kommt in Plan 2. Hier nur: exhaustive `switch`-Anweisungen und Record-Typen, die über `TournamentStatus`/`TournamentFormat` gehen, dürfen nicht brechen, und das bestehende Formular bleibt am klassischen Schema.

- [ ] **Step 1: Failing Test**

In `tournament-format.spec.ts`:

```ts
  it("benennt die Finalrunde des Vereinsduells", () => {
    expect(statusLabel("FINAL_ROUND")).toBe("Finalrunde");
    expect(formatLabel("CLUB_DUEL")).toBe("Vereinsduell");
  });
```

- [ ] **Step 2: Implementieren**

In `tournament-format.ts`:

```ts
    case "FINAL_ROUND":
      return "Finalrunde";
```

und neu:

```ts
export function formatLabel(format: TournamentFormat): string {
  switch (format) {
    case "GROUPS_THEN_KNOCKOUT":
      return "Gruppen + K.-o.";
    case "ROUND_ROBIN":
      return "Jeder gegen jeden";
    case "SINGLE_ELIMINATION":
      return "K.-o.";
    case "CLUB_DUEL":
      return "Vereinsduell";
  }
}
```

Falls in `apps/web` bereits eine Format-Beschriftung existiert (`grep -rn "GROUPS_THEN_KNOCKOUT" apps/web/src --include=*.tsx`), dort `CLUB_DUEL: "Vereinsduell"` ergänzen und `formatLabel` nur anlegen, wenn es keine gibt.

In `setup-sheet.tsx` `createTournamentSchema` → `createClassicTournamentSchema` und `CreateTournamentInput` → `CreateClassicTournamentInput` (Import und beide Verwendungsstellen).

- [ ] **Step 3: Prüfen und Commit**

```bash
pnpm --filter @darts-platform/web typecheck
cd apps/web && npx vitest run src/lib/tournament-format.spec.ts && cd ../..
git add apps/web
git commit -m "chore(web): Vereinsduell-Vokabular, Formular bleibt am klassischen Schema"
```

Scheitert der Typecheck an weiteren Stellen (z. B. `Record<TournamentStatus, …>` in `dashboard-header.tsx`), dort den Fall `FINAL_ROUND`/`CLUB_DUEL` mit demselben Label ergänzen – ausschliesslich Beschriftungen, keine Logik.

---

### Task 8: API – Gastspieler erfassen, Liste filtern, Kontoverknüpfung sperren

**Files:**
- Modify: `apps/api/src/players/players.repository.ts:36-53,236-247,270-320`
- Modify: `apps/api/src/players/players.service.ts:74-93`
- Modify: `apps/api/src/players/players.controller.ts:43-75`
- Modify: `apps/api/src/organizations/organizations.repository.ts` (Stelle um Zeile 1100–1115, `set({ userId: input.userId … })`)
- Modify: `apps/api/src/security/tenant-isolation-matrix.integration.spec.ts:70-80` (`bodies`)
- Create: `apps/api/src/players/guest-players.integration.spec.ts`

**Interfaces:**
- Consumes: `createGuestPlayersSchema`, `playerKindFilterSchema`, `type CreateGuestPlayersInput`, `type PlayerKindFilter` aus `@darts-platform/schemas`
- Produces:
  - `POST /api/v1/organizations/:organizationId/players/guests` → `PlayerResponse[]` (201), Recht `player:create`
  - `GET /api/v1/organizations/:organizationId/players?kind=MEMBER|GUEST|ALL` (Default `MEMBER`)
  - `PlayersRepository.createGuests({ organizationId, data, userId, audit }): Promise<PlayerResponse[]>`
  - `PlayersRepository.list(organizationId, kind: PlayerKindFilter)`

- [ ] **Step 1: Failing Integrationstest**

`apps/api/src/players/guest-players.integration.spec.ts` (Aufbau wie `tenant-isolation.integration.spec.ts` im selben Ordner: Organisation, OWNER-Mitgliedschaft, `PlayersService` direkt instanziieren):

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { auditEvents, memberships, organizations, players, users } from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { PlayersRepository } from "./players.repository.js";
import { PlayersService } from "./players.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const service = new PlayersService(new PlayersRepository(databaseService), access);
const organizationId = randomUUID();
const userId = randomUUID();
const auth: AuthContext = {
  user: { id: userId, email: `guests-${userId}@example.test`, name: "Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

beforeAll(async () => {
  await databaseService.database.insert(users).values({ id: userId, email: auth.user.email, name: auth.user.name, emailVerified: true });
  await databaseService.database.insert(organizations).values({ id: organizationId, name: `Guests ${organizationId}`, slug: `guests-${organizationId}` });
  await databaseService.database.insert(memberships).values({ organizationId, userId, role: "OWNER", status: "ACTIVE" });
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.close();
});

describe("Gastspieler-Schnellerfassung", () => {
  it("legt Gäste idempotent an, auditiert einmal und blendet sie aus der Standardliste aus", async () => {
    const commandId = randomUUID();
    const input = { organizationId, data: { commandId, clubName: "DC Musterdorf", names: ["Anna Muster", "Beat Beispiel"] }, auth, audit };
    const [first, second] = await Promise.all([service.createGuests(input), service.createGuests(input)]);
    expect(first.map((player) => player.displayName).sort()).toEqual(["Anna Muster", "Beat Beispiel"]);
    expect(second.map((player) => player.id).sort()).toEqual(first.map((player) => player.id).sort());
    expect(first.every((player) => player.kind === "GUEST" && player.guestClubName === "DC Musterdorf" && player.hasAccount === false)).toBe(true);

    const rows = await databaseService.database.select().from(players).where(and(eq(players.organizationId, organizationId), eq(players.kind, "GUEST")));
    expect(rows).toHaveLength(2);
    const audits = await databaseService.database.select().from(auditEvents).where(and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.action, "PLAYERS_GUESTS_CREATED")));
    expect(audits).toHaveLength(1);

    await service.create({ organizationId, data: { displayName: "Mitglied", status: "ACTIVE" }, auth, audit });
    expect((await service.list({ organizationId, auth })).map((player) => player.displayName)).toEqual(["Mitglied"]);
    expect((await service.list({ organizationId, auth, kind: "GUEST" })).map((player) => player.displayName).sort()).toEqual(["Anna Muster", "Beat Beispiel"]);
    expect(await service.list({ organizationId, auth, kind: "ALL" })).toHaveLength(3);
  });

  it("verlangt player:create", async () => {
    const stranger: AuthContext = { user: { id: randomUUID(), email: "x@example.test", name: "X" }, session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } };
    await expect(service.createGuests({ organizationId, data: { commandId: randomUUID(), clubName: "DC", names: ["Carla"] }, auth: stranger, audit })).rejects.toThrow();
  });
});
```

Die genauen Pflichtfelder für `users`/`organizations`/`memberships` aus `tenant-isolation.integration.spec.ts` im selben Ordner übernehmen; `databaseService.close()` nur, wenn `DatabaseService` eine solche Methode hat (sonst wie dort verfahren).

- [ ] **Step 2: Test ausführen – muss scheitern**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/players/guest-players.integration.spec.ts`

- [ ] **Step 3: Repository**

`toPlayerResponse` um `kind: row.kind, guestClubName: row.guestClubName` ergänzen. `list`:

```ts
  public async list(organizationId: string, kind: PlayerKindFilter = "MEMBER") {
    const rows = await this.databaseService.database
      .select({ player: players, avatarChecksum: playerAvatars.checksum })
      .from(players)
      .leftJoin(playerAvatars, eq(playerAvatars.playerId, players.id))
      .where(and(eq(players.organizationId, organizationId), kind === "ALL" ? undefined : eq(players.kind, kind)))
      .orderBy(players.displayName);
    return rows.map((row) => toPlayerResponse(row.player, row.avatarChecksum ?? null));
  }
```

Neu:

```ts
  /**
   * Schnellerfassung von Gastspielern eines anderen Vereins (Spec 2026-10-01-
   * vereinsduell). Idempotent ueber `guest_command_id`: der partielle Unique-
   * Index `players_guest_command_name_unique` laesst dieselbe commandId keine
   * zweite Reihe je Name anlegen; bei Kollision wird der Bestand gelesen.
   */
  public async createGuests(
    input: TenantActorInput & { readonly data: CreateGuestPlayersInput },
  ): Promise<ReturnType<typeof toPlayerResponse>[]> {
    const existing = await this.guestsByCommand(input.organizationId, input.data.commandId);
    if (existing.length > 0) return existing;
    try {
      return await this.databaseService.database.transaction(async (transaction) => {
        const rows = await transaction
          .insert(players)
          .values(input.data.names.map((displayName) => ({
            organizationId: input.organizationId,
            displayName,
            status: "ACTIVE",
            kind: "GUEST",
            guestClubName: input.data.clubName,
            guestCommandId: input.data.commandId,
          })))
          .returning();
        await transaction.insert(auditEvents).values({
          organizationId: input.organizationId,
          actorUserId: input.userId,
          action: "PLAYERS_GUESTS_CREATED",
          entityType: "Player",
          entityId: input.data.commandId,
          newValue: { clubName: input.data.clubName, playerIds: rows.map((row) => row.id), names: input.data.names },
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
          correlationId: input.audit.correlationId,
        });
        return rows.map((row) => toPlayerResponse(row, null));
      });
    } catch (error) {
      // Zwei gleichzeitige Wiederholungen: die zweite laeuft in den Unique-Index.
      if (isUniqueViolation(error, "players_guest_command_name_unique")) {
        return this.guestsByCommand(input.organizationId, input.data.commandId);
      }
      throw error;
    }
  }

  private async guestsByCommand(organizationId: string, commandId: string) {
    const rows = await this.databaseService.database
      .select()
      .from(players)
      .where(and(eq(players.organizationId, organizationId), eq(players.guestCommandId, commandId)))
      .orderBy(players.displayName);
    return rows.map((row) => toPlayerResponse(row, null));
  }
```

`isUniqueViolation(error, constraintName)` gibt es womöglich schon (`grep -rn "23505" apps/api/src/common`); sonst in `apps/api/src/common/postgres-errors.ts` anlegen:

```ts
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return typeof error === "object" && error !== null
    && "code" in error && (error as { code?: unknown }).code === "23505"
    && "constraint_name" in error && (error as { constraint_name?: unknown }).constraint_name === constraint;
}
```

Prüfe, ob `entityId` in `auditEvents` ein UUID-Feld ist – die `commandId` ist eine UUID, das passt.

- [ ] **Step 4: Service und Controller**

Service:

```ts
  public async list(input: { readonly organizationId: string; readonly auth: AuthContext; readonly kind?: PlayerKindFilter }): Promise<PlayerResponse[]> {
    // bestehende Rechteprüfung …
    return playerListSchema.parse(await this.playersRepository.list(input.organizationId, input.kind ?? "MEMBER"));
  }

  public async createGuests(input: {
    readonly organizationId: string;
    readonly data: CreateGuestPlayersInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<PlayerResponse[]> {
    await this.organizationAccessService.requirePermission({ organizationId: input.organizationId, userId: input.auth.user.id, permission: "player:create" });
    return playerListSchema.parse(await this.playersRepository.createGuests({ organizationId: input.organizationId, data: input.data, userId: input.auth.user.id, audit: input.audit }));
  }
```

Controller: `@Get()` erhält `@Query("kind") kind: unknown` und parst `playerKindFilterSchema.parse(kind ?? undefined)` (bei ungültigem Wert `BadRequestException` wie `parseBody`). Neue Route **vor** `@Get(":playerId")`/`@Post()`-Konflikten platzieren:

```ts
  @Post("guests")
  public async createGuests(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<PlayerResponse[]> {
    const data: CreateGuestPlayersInput = parseBody(createGuestPlayersSchema, body);
    return this.playersService.createGuests({ organizationId, data, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
  }
```

- [ ] **Step 5: Kontoverknüpfung für Gäste sperren**

In `organizations.repository.ts` an der Stelle, die `players.userId` setzt (um Zeile 1100–1115): vor dem `update` den Spieler lesen; ist `kind === "GUEST"`, den bestehenden Ergebnistyp um die Variante `"player-is-guest"` erweitern und zurückgeben. Im zugehörigen Service diesen Wert auf `ConflictException({ code: "PLAYER_IS_GUEST", message: "Ein Gastspieler kann nicht mit einem Konto verknüpft werden." })` abbilden (gleiches Muster wie die übrigen Varianten dort). Testfall im bestehenden Spec der Verknüpfung ergänzen: Gast anlegen → verknüpfen → 409.

- [ ] **Step 6: Isolationsmatrix-Körper**

In `tenant-isolation-matrix.integration.spec.ts` bei `bodies` ergänzen:

```ts
  "POST /api/v1/organizations/:organizationId/players/guests": { commandId: "0d1f6d2e-4b1a-4c2e-9f3a-1b2c3d4e5f60", clubName: "Fremder Verein", names: ["Gast"] },
```

- [ ] **Step 7: Tests, Commit**

```bash
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/players/guest-players.integration.spec.ts src/players src/security/tenant-isolation-matrix.integration.spec.ts src/testing/route-inventory.integration.spec.ts && cd ../..
git add apps/api/src/players apps/api/src/organizations apps/api/src/security apps/api/src/common
git commit -m "feat(api): Gastspieler eines anderen Vereins erfassen und filtern"
```

---

### Task 9: API – Vereinsduell anlegen, Vorschau, Dashboard-Daten

**Files:**
- Modify: `apps/api/src/tournaments/tournaments.repository.ts` (`TournamentDashboardData`, `stageLabel`, `getDashboardData`, `create`)
- Modify: `apps/api/src/tournaments/tournaments.service.ts` (`clubDuelPreview`, `create`)
- Modify: `apps/api/src/tournaments/tournaments.controller.ts` (Route `club-duel-preview`)
- Modify: `apps/api/src/tournaments/update-tournament-progress.ts` (Casts)
- Modify: `apps/api/src/security/tenant-isolation-matrix.integration.spec.ts` (`bodies`)
- Create: `apps/api/src/tournaments/club-duel.integration.spec.ts`

**Interfaces:**
- Consumes: `planClubDuel`, `previewClubDuel`, `CLUB_DUEL_STAGE_KEYS`, `TournamentFormatKey`, `PlannedStageType` (Engine); `createClubDuelTournamentSchema`, `clubDuelPreviewInputSchema/Schema` (Schemas)
- Produces:
  - `POST /tournaments` mit `format: "CLUB_DUEL"` legt Turnier, Teilnehmer mit `side`, drei Stages, Quali-Runde 1 (READY), Finalrunde und Final (WAITING, `SIDE_RANK`) an; Status `GROUP_STAGE`
  - `POST /tournaments/club-duel-preview` → `ClubDuelPreviewResponse`, Recht `tournament:read`
  - `TournamentDashboardData.stages`, `participants[].side`
  - `qualifyingRoundLabel(round)`, `clubDuelStageLabel(match)` exportiert aus `apps/api/src/tournaments/club-duel-labels.ts` (neu, winzig – wird von Task 10 wiederverwendet)

- [ ] **Step 1: Failing Integrationstest (Anlage)**

`apps/api/src/tournaments/club-duel.integration.spec.ts` – Kopf wie `tournaments.integration.spec.ts` (Services direkt instanziieren, Organisation/Boards/Spieler in `beforeAll`), 13 Mitglieder (`a-…`) und 9 Gäste (`b-…`), 3 Boards:

```ts
describe("Vereinsduell anlegen", () => {
  it("legt 13 gegen 9 an: Runde 1 mit 9 Spielen und 4 Pausen, Finalrunde und Final als Platzhalter", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2 }), auth, audit });
    expect(created.format).toBe("CLUB_DUEL");
    expect(created.status).toBe("GROUP_STAGE");
    const dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    const stages = await databaseService.database.select().from(tournamentStages).where(eq(tournamentStages.tournamentId, created.id)).orderBy(tournamentStages.sequence);
    expect(stages.map((stage) => [stage.key, stage.type, stage.status])).toEqual([
      ["qualifying", "CLUB_SWISS", "OPEN"],
      ["final-round", "CLUB_CROSS_ROUND_ROBIN", "WAITING"],
      ["final", "SINGLE_ELIMINATION", "WAITING"],
    ]);
    const matches = await databaseService.database.select().from(tournamentMatches).where(eq(tournamentMatches.tournamentId, created.id));
    const qualifying = matches.filter((match) => match.stageId === stages[0]?.id);
    expect(qualifying).toHaveLength(9);
    expect(qualifying.every((match) => match.status === "READY" && match.round === 1 && match.stageLabel === "Quali · Runde 1")).toBe(true);
    for (const match of qualifying) {
      expect(sideOf(match.participantOneId)).toBe("A");
      expect(sideOf(match.participantTwoId)).toBe("B");
    }
    expect(matches.filter((match) => match.stageId === stages[1]?.id)).toHaveLength(4);
    expect(matches.filter((match) => match.stageId === stages[2]?.id).map((match) => match.stageLabel).sort()).toEqual(["Final", "Spiel um Platz 3"]);
    expect(dashboard.participants.filter((participant) => participant.side === "A")).toHaveLength(13);
    expect(dashboard.queue.some((entry) => entry.readiness === "READY")).toBe(true);
  });

  it("lehnt Spieler fremder Organisationen und zu kleine Seiten ab", async () => {
    const foreign = clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2 });
    foreign.participants[0] = { playerId: foreignPlayerId, side: "A" };
    await expect(service.create({ organizationId, data: foreign, auth, audit })).rejects.toMatchObject({ response: { code: "INVALID_TOURNAMENT_PARTICIPANTS" } });
    await expect(service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 6, sideBCount: 5 }), auth, audit })).rejects.toMatchObject({ response: { code: "CLUB_DUEL_SIDE_TOO_SMALL" } });
  });

  it("rechnet die Vorschau", async () => {
    const preview = await service.clubDuelPreview({ organizationId, auth, data: { sideACount: 13, sideBCount: 9, qualifyingRounds: 4, finalRoundSize: 4, thirdPlaceMatch: true, boardCount: 8, bestOfLegs: 3 } });
    expect(preview.totalMatches).toBe(54);
    expect(preview.matchesPerPlayer.sideB).toEqual({ min: 4, max: 4 });
  });
});
```

`clubDuelInput(options)` baut den Körper aus den in `beforeAll` angelegten IDs (`sideBCount` begrenzt die Gäste); `sideOf(playerId)` schlägt in einer `Map` nach. `foreignPlayerId` gehört einer zweiten Organisation. **Der Test, der 13/9 durchspielt, folgt in Task 10** – er liegt in derselben Datei.

- [ ] **Step 2: Test ausführen – muss scheitern**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/club-duel.integration.spec.ts`

- [ ] **Step 3: Labels**

`apps/api/src/tournaments/club-duel-labels.ts`:

```ts
import type { PlannedMatch } from "@darts-platform/tournament-engine";
import { CLUB_DUEL_STAGE_KEYS } from "@darts-platform/tournament-engine";

export function qualifyingRoundLabel(round: number): string {
  return `Quali · Runde ${round}`;
}

/** Beschriftung der Vereinsduell-Phasen; null für Spiele anderer Formate. */
export function clubDuelStageLabel(match: Pick<PlannedMatch, "stageKey" | "round" | "position">): string | null {
  if (match.stageKey === CLUB_DUEL_STAGE_KEYS.qualifying) return qualifyingRoundLabel(match.round);
  if (match.stageKey === CLUB_DUEL_STAGE_KEYS.finalRound) return `Finalrunde · Runde ${match.round}`;
  if (match.stageKey === CLUB_DUEL_STAGE_KEYS.final) return match.position === 1 ? "Final" : "Spiel um Platz 3";
  return null;
}
```

In `tournaments.repository.ts` `stageLabel(...)` zuerst `clubDuelStageLabel(match)` fragen und das Ergebnis zurückgeben, wenn es nicht null ist.

- [ ] **Step 4: `update-tournament-progress.ts`**

Casts auf die neuen Unions: `tournament.format as TournamentFormatKey`, `stage.type as PlannedStageType` (beide aus `@darts-platform/tournament-engine` importieren).

- [ ] **Step 5: Dashboard-Daten erweitern**

`TournamentDashboardData`: `participants[]` um `readonly side: string | null`, neu `readonly stages: readonly (typeof tournamentStages.$inferSelect)[]`. In `getDashboardData` in der Teilnehmerabfrage `side: tournamentParticipants.side` ergänzen und im `Promise.all` eine Abfrage anfügen:

```ts
        this.databaseService.database
          .select()
          .from(tournamentStages)
          .where(and(eq(tournamentStages.organizationId, organizationId), eq(tournamentStages.tournamentId, tournamentId)))
          .orderBy(asc(tournamentStages.sequence)),
```

Im Service, wo Teilnehmer ins Dashboard gemappt werden, `side: participant.side === "A" || participant.side === "B" ? participant.side : null` ergänzen; `clubDuel: null` vorerst ins Dashboard und in die öffentliche Projektion setzen (Task 11 füllt es).

- [ ] **Step 6: `create` verzweigen**

Am Anfang von `TournamentsRepository.create`:

```ts
    if (input.data.format === "CLUB_DUEL") return this.createClubDuel({ ...input, data: input.data });
```

Danach ist `input.data` auf `CreateClassicTournamentInput` verengt; die Typannotation des Parameters bleibt `CreateTournamentInput`. Neue private Methode:

```ts
  private async createClubDuel(input: {
    readonly organizationId: string;
    readonly data: CreateClubDuelTournamentInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<string> {
    const engineParticipants = input.data.participants.map((participant, index) => ({
      playerId: participant.playerId,
      seed: index + 1,
      side: participant.side,
    }));
    if (engineParticipants.some((participant) => participant.side !== "A" && participant.side !== "B")) {
      throw new TournamentValidationError("CLUB_DUEL_SIDE_REQUIRED", "Jeder Teilnehmer braucht eine Seite.");
    }
    const plan = planClubDuel({
      participants: engineParticipants,
      qualifyingRounds: input.data.qualifyingRounds,
      finalRoundSize: input.data.finalRoundSize,
      thirdPlaceMatch: input.data.thirdPlaceMatch,
    });

    return this.databaseService.database.transaction(async (transaction) => {
      // Spieler- und Board-Prüfung wörtlich wie in `create` (aktiv, eigene Organisation) –
      // in eine private Methode `assertParticipantsAndBoards(transaction, organizationId, playerIds, boardIds)` ziehen und von beiden Pfaden nutzen.
      await this.assertParticipantsAndBoards(transaction, input.organizationId, engineParticipants.map((participant) => participant.playerId), input.data.boardIds);

      const [created] = await transaction.insert(tournaments).values({
        organizationId: input.organizationId,
        name: input.data.name,
        status: "GROUP_STAGE",
        format: "CLUB_DUEL",
        startingScore: input.data.startingScore,
        inRule: input.data.inRule,
        outRule: input.data.outRule,
        maxRounds: input.data.maxRounds,
        bestOfLegs: input.data.bestOfLegs,
        legsToWinSet: Math.floor(input.data.bestOfLegs / 2) + 1,
        setsToWin: Math.floor(input.data.bestOfSets / 2) + 1,
        // Neutrale Werte: die Gruppen-Constraints bleiben unangetastet (Spec, Datenmodell).
        groupCount: 1,
        qualifyPerGroup: 1,
        knockoutSize: 2,
        seeding: "SEEDED",
        sideAName: input.data.sideAName,
        sideBName: input.data.sideBName,
        qualifyingRounds: input.data.qualifyingRounds,
        finalRoundSize: input.data.finalRoundSize,
        thirdPlaceMatch: input.data.thirdPlaceMatch,
        startsAt: input.data.startsAt,
      }).returning();
      if (created === undefined) throw new Error("Tournament insert did not return a row.");

      await transaction.insert(tournamentParticipants).values(engineParticipants.map((participant) => ({
        organizationId: input.organizationId,
        tournamentId: created.id,
        playerId: participant.playerId,
        seed: participant.seed,
        side: participant.side,
      })));
      await transaction.insert(tournamentBoards).values(input.data.boardIds.map((boardId, index) => ({
        organizationId: input.organizationId, tournamentId: created.id, boardId, ringNumber: index + 1,
      })));

      const createdStages = await transaction.insert(tournamentStages).values([
        { key: CLUB_DUEL_STAGE_KEYS.qualifying, sequence: 1, name: "Qualifikation", type: "CLUB_SWISS", status: "OPEN" },
        { key: CLUB_DUEL_STAGE_KEYS.finalRound, sequence: 2, name: "Finalrunde", type: "CLUB_CROSS_ROUND_ROBIN", status: "WAITING" },
        { key: CLUB_DUEL_STAGE_KEYS.final, sequence: 3, name: "Final", type: "SINGLE_ELIMINATION", status: "WAITING" },
      ].map((stage) => ({ ...stage, organizationId: input.organizationId, tournamentId: created.id }))).returning();
      const stageByKey = new Map(createdStages.map((stage) => [stage.key, stage]));

      await transaction.insert(tournamentMatches).values(plan.matches.map((match) => {
        const stage = stageByKey.get(match.stageKey);
        if (stage === undefined) throw new Error(`Stage ${match.stageKey} was not stored.`);
        return {
          organizationId: input.organizationId,
          tournamentId: created.id,
          stageId: stage.id,
          groupId: null,
          key: match.key,
          stageLabel: stageLabel(match, new Map()),
          round: match.round,
          position: match.position,
          status: match.state,
          resultType: null,
          participantOneId: playerIdFrom(match.participantOne),
          participantTwoId: playerIdFrom(match.participantTwo),
          participantOneRef: match.participantOne,
          participantTwoRef: match.participantTwo,
          winnerPlayerId: null,
        };
      }));

      await transaction.insert(outboxEvents).values({
        organizationId: input.organizationId, aggregateType: "Tournament", aggregateId: created.id,
        eventType: "TOURNAMENT_CREATED", payload: { tournamentId: created.id, format: created.format },
      });
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId, actorUserId: input.auth.user.id, action: "TOURNAMENT_CREATED",
        entityType: "Tournament", entityId: created.id,
        newValue: { ...created, roundOne: { pairings: plan.roundOne.pairings, pausedPlayerIds: plan.roundOne.pausedPlayerIds } },
        ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId,
      });
      return created.id;
    });
  }
```

- [ ] **Step 7: Vorschau-Route**

Service:

```ts
  public async clubDuelPreview(input: { readonly organizationId: string; readonly data: ClubDuelPreviewInput; readonly auth: AuthContext }): Promise<ClubDuelPreviewResponse> {
    await this.require(input, "tournament:read");
    try {
      return clubDuelPreviewSchema.parse(previewClubDuel(input.data));
    } catch (error) {
      this.rethrowDomainError(error);
    }
  }
```

Controller (vor `@Post()`):

```ts
  @Post("club-duel-preview")
  public clubDuelPreview(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ClubDuelPreviewResponse> {
    const data: ClubDuelPreviewInput = parseBody(clubDuelPreviewInputSchema, body);
    return this.service.clubDuelPreview({ organizationId, data, auth });
  }
```

Isolationsmatrix-`bodies`:

```ts
  "POST /api/v1/organizations/:organizationId/tournaments/club-duel-preview": { sideACount: 4, sideBCount: 4, qualifyingRounds: 2, finalRoundSize: 2, thirdPlaceMatch: true, boardCount: 2, bestOfLegs: 3 },
```

- [ ] **Step 8: Tests, Typecheck, Commit**

```bash
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/club-duel.integration.spec.ts src/tournaments/tournaments.integration.spec.ts src/security/tenant-isolation-matrix.integration.spec.ts && cd ../..
pnpm --filter @darts-platform/api typecheck
git add apps/api/src
git commit -m "feat(api): Vereinsduell anlegen und Vorschau rechnen"
```

---

### Task 10: API – Rundenpaarung und Platzhalter-Auflösung nach jedem Abschluss

**Files:**
- Create: `apps/api/src/tournaments/completed-match-results.ts`
- Modify: `apps/api/src/tournaments/resolve-completed-group.ts:60-92` (nutzt den Helfer)
- Create: `apps/api/src/tournaments/advance-club-duel.ts`
- Modify: `apps/api/src/matches/matches.repository.ts` (`syncTournamentProgress`, Zeilen ~1680–1760)
- Modify: `apps/api/src/tournaments/tournaments.repository.ts:1030-1040` (Rückzugspfad)
- Modify: `apps/api/src/tournaments/club-duel.integration.spec.ts`

**Interfaces:**
- Produces:
  - `loadCompletedMatchResults(transaction, organizationId, matches): Promise<{ results: GroupMatchResult[]; unopposedWalkoverWinnerIds: string[] }>`
  - `advanceClubDuel(transaction, input: { organizationId; tournamentId; now: Date; actor: { principal: Principal; audit: AuditContext } }): Promise<void>` – no-op für andere Formate; sperrt `tournaments` FOR UPDATE, **danach** liest sie Stages/Teilnehmer/Matches
  - Outbox-Event `TOURNAMENT_ROUND_PAIRED`, Audit-Aktion `TOURNAMENT_ROUND_PAIRED`
- Consumes: Engine-Funktionen aus Task 1–3, `qualifyingRoundLabel` (Task 9), `auditActor` (`../common/audit-actor.js`)

- [ ] **Step 1: Failing Durchlauf-Test**

In `club-duel.integration.spec.ts` ergänzen. Helfer:

```ts
/** Spielt ein READY-Turniermatch auf `boardId` bis zum Sieg von `winnerPlayerId` durch (501, Double Out, Best of 1). */
async function playMatch(tournamentId: string, tournamentMatchId: string, winnerPlayerId: string, boardId: string): Promise<void> {
  let dashboard = await service.dashboard({ organizationId, tournamentId, auth });
  dashboard = await service.assign({ organizationId, tournamentId, data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, matchId: tournamentMatchId, boardId }, auth, audit });
  const [scheduled] = await databaseService.database.select().from(tournamentMatches).where(eq(tournamentMatches.id, tournamentMatchId));
  if (!scheduled?.scoringMatchId || !scheduled.participantOneId || !scheduled.participantTwoId) throw new Error("Expected an active scoring match.");
  let state = await matchesService.get({ organizationId, matchId: scheduled.scoringMatchId, auth });
  const order = [scheduled.participantOneId, scheduled.participantTwoId]; // Sitz 1 beginnt
  const winnerVisits = [180, 180, 101];
  const script: { playerId: string; points: number; finish: boolean }[] = [];
  for (let turn = 0, winnerTurns = 0; winnerTurns <= 3; turn += 1) {
    const playerId = order[turn % 2];
    if (playerId === undefined) throw new Error("Turn order invariant violated.");
    if (playerId === winnerPlayerId) {
      script.push(winnerTurns < 3 ? { playerId, points: winnerVisits[winnerTurns] ?? 0, finish: false } : { playerId, points: 40, finish: true });
      winnerTurns += 1;
    } else {
      script.push({ playerId, points: 0, finish: false });
    }
  }
  for (const step of script) {
    state = await matchesService.submitVisit({
      organizationId, matchId: state.id, auth, audit,
      data: {
        commandId: randomUUID(), expectedVersion: state.version, playerId: step.playerId, points: step.points,
        dartsThrown: step.finish ? 1 : 3,
        ...(step.finish ? { checkoutSegment: { segment: 20, multiplier: 2 } } : {}),
      },
    });
  }
  expect(state.status).toBe("COMPLETED");
}

/** Deterministische, aber durchmischte Siegerwahl: wer den kleineren Wert hat, gewinnt. */
function pickWinner(playerOneId: string, playerTwoId: string): string {
  const score = (id: string) => (seedOf.get(id) ?? 0) * 7 % 11;
  return score(playerOneId) <= score(playerTwoId) ? playerOneId : playerTwoId;
}

/** Spielt alle READY-Matches, bis das Turnier COMPLETED ist; gibt die Anzahl gespielter Spiele zurück. */
async function playOut(tournamentId: string): Promise<number> {
  let played = 0;
  for (let guard = 0; guard < 200; guard += 1) {
    const rows = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, tournamentId), eq(tournamentMatches.status, "READY")));
    const next = rows[0];
    if (next === undefined) {
      const [tournament] = await databaseService.database.select().from(tournaments).where(eq(tournaments.id, tournamentId));
      if (tournament?.status === "COMPLETED") return played;
      throw new Error(`Keine READY-Spiele, Turnier aber ${tournament?.status ?? "unbekannt"}.`);
    }
    if (!next.participantOneId || !next.participantTwoId) throw new Error("READY match without participants.");
    await playMatch(tournamentId, next.id, pickWinner(next.participantOneId, next.participantTwoId), boardIds[0]);
    played += 1;
  }
  throw new Error("Durchlauf abgebrochen.");
}
```

Im Kopf der Spec-Datei liegen aus `beforeAll`: `sideA: string[]` (13 Mitglieder-IDs), `sideB: string[]` (9 Gast-IDs), `seedOf: Map<string, number>` (Position in `[...sideA, ...sideB]` + 1 – dieselbe Reihenfolge, in der `clubDuelInput` die Teilnehmer übergibt, also der spätere Seed), `sideOf(playerId: string | null): "A" | "B" | null`. `clubDuelInput({ qualifyingRounds, finalRoundSize, sideACount = 13, sideBCount = 9 })` setzt `thirdPlaceMatch: true`, `bestOfLegs: 1`, `bestOfSets: 1`, `startingScore: 501`, `outRule: "DOUBLE"`, `sideAName: "VFC"`, `sideBName: "DC Musterdorf"` und alle drei `boardIds`. Test:

```ts
describe("Vereinsduell Ablauf", () => {
  it("spielt 13 gegen 9 mit 2 Quali-Runden und Finalrunde 2 bis COMPLETED durch", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2 }), auth, audit });
    const roundOne = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.round, 1), eq(tournamentMatches.stageLabel, "Quali · Runde 1")));
    for (const match of roundOne.slice(0, 8)) {
      if (!match.participantOneId || !match.participantTwoId) throw new Error("unexpected");
      await playMatch(created.id, match.id, pickWinner(match.participantOneId, match.participantTwoId), boardIds[0]);
    }
    // Vor dem letzten Spiel der Runde gibt es noch keine Runde 2.
    expect(await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 2")))).toHaveLength(0);
    const last = roundOne[8];
    if (!last?.participantOneId || !last.participantTwoId) throw new Error("unexpected");
    await playMatch(created.id, last.id, pickWinner(last.participantOneId, last.participantTwoId), boardIds[0]);

    const roundTwo = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 2")));
    expect(roundTwo).toHaveLength(9);
    expect(roundTwo.every((match) => match.status === "READY")).toBe(true);
    const pausedRoundOne = new Set(sideA.filter((id) => !roundOne.some((match) => match.participantOneId === id)));
    const pausedRoundTwo = new Set(sideA.filter((id) => !roundTwo.some((match) => match.participantOneId === id)));
    expect(pausedRoundOne.size).toBe(4);
    expect(pausedRoundTwo.size).toBe(4);
    expect([...pausedRoundTwo].some((id) => pausedRoundOne.has(id))).toBe(false);
    for (const match of roundTwo) {
      expect(sideOf(match.participantOneId)).toBe("A");
      expect(sideOf(match.participantTwoId)).toBe("B");
      expect(roundOne.some((previous) => previous.participantOneId === match.participantOneId && previous.participantTwoId === match.participantTwoId)).toBe(false);
    }
    const pairedEvents = await databaseService.database.select().from(outboxEvents).where(and(eq(outboxEvents.aggregateId, created.id), eq(outboxEvents.eventType, "TOURNAMENT_ROUND_PAIRED")));
    expect(pairedEvents).toHaveLength(1);
    const pairedAudits = await databaseService.database.select().from(auditEvents).where(and(eq(auditEvents.entityId, created.id), eq(auditEvents.action, "TOURNAMENT_ROUND_PAIRED")));
    expect(pairedAudits).toHaveLength(1);

    const total = 9 + await playOut(created.id);
    expect(total).toBe(18 + 4 + 2);
    const dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    expect(dashboard.tournament.status).toBe("COMPLETED");
    const finalMatches = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Final")));
    expect(finalMatches[0]?.status).toBe("COMPLETED");
    expect(sideOf(finalMatches[0]?.participantOneId)).toBe("A");
    expect(sideOf(finalMatches[0]?.participantTwoId)).toBe("B");
  }, 120_000);

  it("wechselt den Status: GROUP_STAGE → FINAL_ROUND → KNOCKOUT", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 1, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    const statuses: string[] = [];
    for (let guard = 0; guard < 20; guard += 1) {
      const [tournament] = await databaseService.database.select().from(tournaments).where(eq(tournaments.id, created.id));
      if (tournament === undefined) throw new Error("unexpected");
      if (statuses.at(-1) !== tournament.status) statuses.push(tournament.status);
      if (tournament.status === "COMPLETED") break;
      const [next] = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.status, "READY")));
      if (!next?.participantOneId || !next.participantTwoId) throw new Error("unexpected");
      await playMatch(created.id, next.id, pickWinner(next.participantOneId, next.participantTwoId), boardIds[0]);
    }
    expect(statuses).toEqual(["GROUP_STAGE", "FINAL_ROUND", "KNOCKOUT", "COMPLETED"]);
  }, 60_000);
});
```

- [ ] **Step 2: Test ausführen – muss scheitern (keine Runde 2, Turnier bleibt stehen)**

- [ ] **Step 3: `completed-match-results.ts`**

```ts
import { and, eq } from "drizzle-orm";

import { matchParticipantPlayers, matchParticipants, type tournamentMatches } from "@darts-platform/database";
import type { GroupMatchResult } from "@darts-platform/tournament-engine";

import type { DatabaseService } from "../database/database.service.js";

type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];
type TournamentMatchRow = typeof tournamentMatches.$inferSelect;

export interface CompletedMatchResults {
  readonly results: readonly GroupMatchResult[];
  /** Kampflose Siege ohne Gegner (Vereinsduell: unbesetzter Finalrunden-Platz). */
  readonly unopposedWalkoverWinnerIds: readonly string[];
}

/**
 * Resultate abgeschlossener Turniermatches: Walkover als 0:0 mit Sieger,
 * gespielte Matches mit den Legs aus der Scoring-Projektion. Gemeinsame Basis
 * fuer Gruppenaufloesung und Vereinsduell.
 */
export async function loadCompletedMatchResults(
  transaction: DatabaseTransaction,
  organizationId: string,
  matches: readonly TournamentMatchRow[],
): Promise<CompletedMatchResults> {
  const results: GroupMatchResult[] = [];
  const unopposedWalkoverWinnerIds: string[] = [];
  for (const match of matches) {
    if (match.status !== "COMPLETED" || match.winnerPlayerId === null) continue;
    if (match.participantOneId === null || match.participantTwoId === null) {
      if (match.resultType !== "WALKOVER") throw new Error("Completed tournament match invariant violated.");
      unopposedWalkoverWinnerIds.push(match.winnerPlayerId);
      continue;
    }
    if (match.resultType === "WALKOVER") {
      results.push({ type: "WALKOVER", playerOneId: match.participantOneId, playerTwoId: match.participantTwoId, playerOneLegs: 0, playerTwoLegs: 0, winnerPlayerId: match.winnerPlayerId });
      continue;
    }
    if (match.scoringMatchId === null) throw new Error("Completed tournament match invariant violated.");
    const rows = await transaction
      .select({ playerId: matchParticipantPlayers.playerId, legsWon: matchParticipants.legsWon })
      .from(matchParticipants)
      .innerJoin(matchParticipantPlayers, and(eq(matchParticipantPlayers.participantId, matchParticipants.id), eq(matchParticipantPlayers.organizationId, organizationId)))
      .where(and(eq(matchParticipants.organizationId, organizationId), eq(matchParticipants.matchId, match.scoringMatchId)));
    const first = rows.find((row) => row.playerId === match.participantOneId);
    const second = rows.find((row) => row.playerId === match.participantTwoId);
    if (first === undefined || second === undefined) throw new Error("Completed match participant invariant violated.");
    results.push({ type: "PLAYED", playerOneId: first.playerId, playerTwoId: second.playerId, playerOneLegs: first.legsWon, playerTwoLegs: second.legsWon, winnerPlayerId: match.winnerPlayerId });
  }
  return { results, unopposedWalkoverWinnerIds };
}
```

In `resolve-completed-group.ts` die Schleife über `completed` durch `const { results } = await loadCompletedMatchResults(transaction, organizationId, completed);` ersetzen; die Importe `matchParticipantPlayers`, `matchParticipants` dort entfernen. Bestehende Tests (`tournaments.integration.spec.ts`) müssen danach unverändert grün sein.

- [ ] **Step 4: `advance-club-duel.ts`**

```ts
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { auditEvents, outboxEvents, tournamentMatches, tournamentParticipants, tournamentStages, tournaments } from "@darts-platform/database";
import {
  CLUB_DUEL_STAGE_KEYS,
  calculateClubStandings,
  calculateCrossRoundStandings,
  pairClubSwissRound,
  plannedQualifyingMatch,
  type ClubSide,
} from "@darts-platform/tournament-engine";

import { auditActor } from "../common/audit-actor.js";
import type { AuditContext } from "../common/audit-context.js";
import type { Principal } from "../auth/auth.types.js";
import type { DatabaseService } from "../database/database.service.js";
import { qualifyingRoundLabel } from "./club-duel-labels.js";
import { loadCompletedMatchResults } from "./completed-match-results.js";

type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];
type MatchRow = typeof tournamentMatches.$inferSelect;

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["COMPLETED", "BYE", "CANCELLED"]);

const sideRankReferenceSchema = z.object({
  type: z.literal("SIDE_RANK"),
  stageKey: z.string(),
  side: z.enum(["A", "B"]),
  rank: z.number().int().positive(),
});

export interface AdvanceClubDuelInput {
  readonly organizationId: string;
  readonly tournamentId: string;
  readonly now: Date;
  readonly actor: { readonly principal: Principal; readonly audit: AuditContext };
}

function isOpen(match: MatchRow): boolean {
  return !TERMINAL_STATUSES.has(match.status);
}

function toSide(value: string | null): ClubSide {
  if (value === "A" || value === "B") return value;
  throw new Error("Club duel participant without side.");
}

/**
 * Treibt ein Vereinsduell nach einem Matchabschluss weiter (Spec, API und
 * Ablauf; ADR 0021). Laeuft in der Transaktion des Abschlusses, direkt vor
 * `updateTournamentProgress`. Die Turnierzeile wird FOR UPDATE gesperrt,
 * BEVOR offene Spiele gezaehlt werden: Zwei parallel abgeschlossene letzte
 * Spiele einer Runde sehen so nacheinander denselben Stand, und nur das
 * zweite paart. Fuer andere Formate ein No-op.
 */
export async function advanceClubDuel(transaction: DatabaseTransaction, input: AdvanceClubDuelInput): Promise<void> {
  const [tournament] = await transaction.select().from(tournaments).where(and(
    eq(tournaments.organizationId, input.organizationId),
    eq(tournaments.id, input.tournamentId),
  )).for("update").limit(1);
  if (tournament === undefined || tournament.format !== "CLUB_DUEL") return;
  if (tournament.qualifyingRounds === null || tournament.finalRoundSize === null) {
    throw new Error("Club duel configuration invariant violated.");
  }

  const [stages, participantRows, matchRows] = await Promise.all([
    transaction.select().from(tournamentStages).where(and(eq(tournamentStages.organizationId, input.organizationId), eq(tournamentStages.tournamentId, input.tournamentId))),
    transaction.select().from(tournamentParticipants).where(and(eq(tournamentParticipants.organizationId, input.organizationId), eq(tournamentParticipants.tournamentId, input.tournamentId))).orderBy(asc(tournamentParticipants.seed)),
    transaction.select().from(tournamentMatches).where(and(eq(tournamentMatches.organizationId, input.organizationId), eq(tournamentMatches.tournamentId, input.tournamentId))).orderBy(asc(tournamentMatches.round), asc(tournamentMatches.position)),
  ]);
  const stageByKey = new Map(stages.map((stage) => [stage.key, stage]));
  const qualifying = stageByKey.get(CLUB_DUEL_STAGE_KEYS.qualifying);
  const finalRound = stageByKey.get(CLUB_DUEL_STAGE_KEYS.finalRound);
  const final = stageByKey.get(CLUB_DUEL_STAGE_KEYS.final);
  if (qualifying === undefined || finalRound === undefined || final === undefined) throw new Error("Club duel stage invariant violated.");

  const participants = participantRows.map((row) => ({ playerId: row.playerId, seed: row.seed, side: toSide(row.side) }));
  const withdrawnPlayerIds = participantRows.filter((row) => row.status === "WITHDRAWN").map((row) => row.playerId);
  const activeIds = new Set(participantRows.filter((row) => row.status === "ACTIVE").map((row) => row.playerId));
  const sideOf = new Map(participants.map((participant) => [participant.playerId, participant.side]));

  const qualifyingMatches = matchRows.filter((match) => match.stageId === qualifying.id);
  if (qualifyingMatches.some(isOpen)) return;
  const playedRounds = qualifyingMatches.reduce((max, match) => Math.max(max, match.round), 0);
  const qualifyingResults = await loadCompletedMatchResults(transaction, input.organizationId, qualifyingMatches);
  const standings = calculateClubStandings({ participants, results: qualifyingResults.results, withdrawnPlayerIds });

  if (playedRounds < tournament.qualifyingRounds) {
    await pairNextRound(transaction, input, { stageId: qualifying.id, round: playedRounds + 1, standings, qualifyingMatches, activeIds, sideOf });
    return;
  }

  // Quali fertig → Finalrunde besetzen (Spec: fehlende Plaetze → Walkover fuer den Gegner)
  const finalRoundMatches = matchRows.filter((match) => match.stageId === finalRound.id);
  const qualifiers = {
    A: standings.sideA.filter((row) => !row.withdrawn).slice(0, tournament.finalRoundSize).map((row) => row.playerId),
    B: standings.sideB.filter((row) => !row.withdrawn).slice(0, tournament.finalRoundSize).map((row) => row.playerId),
  };
  if (finalRoundMatches.some((match) => match.status === "WAITING")) {
    await resolveSideRanks(transaction, input, CLUB_DUEL_STAGE_KEYS.qualifying, qualifiers, finalRoundMatches);
    return;
  }
  if (finalRoundMatches.some(isOpen)) return;

  // Finalrunde fertig → Final und Platz 3 besetzen
  const finalMatches = matchRows.filter((match) => match.stageId === final.id);
  if (!finalMatches.some((match) => match.status === "WAITING")) return;
  const crossResults = await loadCompletedMatchResults(transaction, input.organizationId, finalRoundMatches);
  const rankOf = (side: ClubSide) => (playerId: string) => {
    const rank = (side === "A" ? standings.sideA : standings.sideB).find((row) => row.playerId === playerId)?.position;
    if (rank === undefined) throw new Error("Qualifier rank invariant violated.");
    return { playerId, qualifyingRank: rank };
  };
  const cross = calculateCrossRoundStandings({
    sideA: qualifiers.A.map(rankOf("A")),
    sideB: qualifiers.B.map(rankOf("B")),
    results: crossResults.results,
    unopposedWalkoverWinnerIds: crossResults.unopposedWalkoverWinnerIds,
  });
  await resolveSideRanks(transaction, input, CLUB_DUEL_STAGE_KEYS.finalRound, {
    A: cross.sideA.map((row) => row.playerId),
    B: cross.sideB.map((row) => row.playerId),
  }, finalMatches);
}

async function pairNextRound(
  transaction: DatabaseTransaction,
  input: AdvanceClubDuelInput,
  context: {
    readonly stageId: string;
    readonly round: number;
    readonly standings: ReturnType<typeof calculateClubStandings>;
    readonly qualifyingMatches: readonly MatchRow[];
    readonly activeIds: ReadonlySet<string>;
    readonly sideOf: ReadonlyMap<string, ClubSide>;
  },
): Promise<void> {
  const ranked = (rows: ReturnType<typeof calculateClubStandings>["sideA"]) =>
    rows.filter((row) => context.activeIds.has(row.playerId)).map((row) => ({ playerId: row.playerId, seed: row.seed }));
  // Pausen: aktive Spieler ohne Spiel in einer bereits gepaarten Runde
  const pauses = new Map<string, number>();
  for (let round = 1; round < context.round; round += 1) {
    const inRound = new Set(context.qualifyingMatches.filter((match) => match.round === round).flatMap((match) => [match.participantOneId, match.participantTwoId]));
    for (const playerId of context.activeIds) {
      if (!inRound.has(playerId)) pauses.set(playerId, (pauses.get(playerId) ?? 0) + 1);
    }
  }
  const played = new Map(context.standings.overall.map((row) => [row.playerId, row.played]));
  const previousPairings = context.qualifyingMatches.flatMap((match) => {
    if (match.participantOneId === null || match.participantTwoId === null) return [];
    const [playerAId, playerBId] = context.sideOf.get(match.participantOneId) === "A"
      ? [match.participantOneId, match.participantTwoId]
      : [match.participantTwoId, match.participantOneId];
    return [{ playerAId, playerBId }];
  });
  const paired = pairClubSwissRound({
    round: context.round,
    sideA: ranked(context.standings.sideA),
    sideB: ranked(context.standings.sideB),
    previousPairings,
    pauses,
    played,
  });

  // Zweite Verteidigungslinie vor dem Schreiben (Spec, Datenmodell)
  const seen = new Set<string>();
  for (const pairing of paired.pairings) {
    if (context.sideOf.get(pairing.playerAId) !== "A" || context.sideOf.get(pairing.playerBId) !== "B") {
      throw new Error("Club duel pairing invariant violated: CLUB_DUEL_SAME_SIDE_PAIRING");
    }
    if (seen.has(pairing.playerAId) || seen.has(pairing.playerBId)) {
      throw new Error("Club duel pairing invariant violated: CLUB_DUEL_DUPLICATE_IN_ROUND");
    }
    seen.add(pairing.playerAId);
    seen.add(pairing.playerBId);
  }

  await transaction.insert(tournamentMatches).values(paired.pairings.map((pairing) => {
    const planned = plannedQualifyingMatch(context.round, pairing);
    return {
      organizationId: input.organizationId,
      tournamentId: input.tournamentId,
      stageId: context.stageId,
      groupId: null,
      key: planned.key,
      stageLabel: qualifyingRoundLabel(context.round),
      round: context.round,
      position: planned.position,
      status: "READY",
      participantOneId: pairing.playerAId,
      participantTwoId: pairing.playerBId,
      participantOneRef: planned.participantOne,
      participantTwoRef: planned.participantTwo,
    };
  }));
  const payload = {
    tournamentId: input.tournamentId,
    stageKey: CLUB_DUEL_STAGE_KEYS.qualifying,
    round: context.round,
    pairings: paired.pairings,
    pausedPlayerIds: paired.pausedPlayerIds,
    warnings: paired.warnings,
  };
  await transaction.insert(outboxEvents).values({
    organizationId: input.organizationId,
    aggregateType: "Tournament",
    aggregateId: input.tournamentId,
    eventType: "TOURNAMENT_ROUND_PAIRED",
    payload,
  });
  await transaction.insert(auditEvents).values({
    organizationId: input.organizationId,
    ...auditActor(input.actor.principal),
    action: "TOURNAMENT_ROUND_PAIRED",
    entityType: "Tournament",
    entityId: input.tournamentId,
    newValue: payload,
    ip: input.actor.audit.ip,
    userAgent: input.actor.audit.userAgent,
    correlationId: input.actor.audit.correlationId,
  });
}

/**
 * Setzt `SIDE_RANK`-Platzhalter einer Phase ein. Fehlt ein Rang (Seite hat
 * zu wenig aktive Spieler), gewinnt der Gegner kampflos; fehlen beide, ist
 * das Spiel abgesagt.
 */
async function resolveSideRanks(
  transaction: DatabaseTransaction,
  input: AdvanceClubDuelInput,
  stageKey: string,
  ranking: { readonly A: readonly string[]; readonly B: readonly string[] },
  matches: readonly MatchRow[],
): Promise<void> {
  for (const match of matches) {
    if (match.status !== "WAITING") continue;
    const first = sideRankReferenceSchema.safeParse(match.participantOneRef);
    const second = sideRankReferenceSchema.safeParse(match.participantTwoRef);
    if (!first.success || !second.success || first.data.stageKey !== stageKey || second.data.stageKey !== stageKey) continue;
    const playerOneId = ranking[first.data.side][first.data.rank - 1] ?? null;
    const playerTwoId = ranking[second.data.side][second.data.rank - 1] ?? null;
    const status = playerOneId !== null && playerTwoId !== null ? "READY" : playerOneId === null && playerTwoId === null ? "CANCELLED" : "COMPLETED";
    await transaction.update(tournamentMatches).set({
      participantOneId: playerOneId,
      participantTwoId: playerTwoId,
      participantOneRef: playerOneId === null ? null : match.participantOneRef,
      participantTwoRef: playerTwoId === null ? null : match.participantTwoRef,
      status,
      resultType: status === "COMPLETED" ? "WALKOVER" : null,
      winnerPlayerId: status === "COMPLETED" ? (playerOneId ?? playerTwoId) : null,
      completedAt: status === "COMPLETED" ? input.now : null,
      version: match.version + 1,
      updatedAt: input.now,
    }).where(and(eq(tournamentMatches.organizationId, input.organizationId), eq(tournamentMatches.id, match.id)));
  }
}
```

Falls `auditEvents` die Spalte `actorDeviceId` nicht kennt, aus dem Spread nur `actorUserId` verwenden (prüfen, wie die übrigen Audit-Inserts in `matches.repository.ts` `auditActor` nutzen).

- [ ] **Step 5: Hooks**

`matches.repository.ts`, `syncTournamentProgress`: Signatur um `actor: { readonly principal: Principal; readonly audit: AuditContext }` erweitern und an der Aufrufstelle (`submitVisit`-Pfad, dort liegen `input.auth`/`input.audit` bzw. der Principal vor) durchreichen. Zwischen `applyWithdrawalPropagation` und `updateTournamentProgress` einfügen:

```ts
    await advanceClubDuel(transaction, { organizationId, tournamentId: scheduled.tournamentId, now, actor });
```

`tournaments.repository.ts` Rückzugspfad (Zeile ~1034–1039): nach `resolveCompletedTournamentGroup` und vor `updateTournamentProgress` ebenso `advanceClubDuel(transaction, { organizationId: input.organizationId, tournamentId: input.tournamentId, now: withdrawnAt, actor: { principal: input.auth, audit: input.audit } })` einfügen (Rückzug kann die letzte offene Paarung per Walkover schliessen). Prüfen, dass `applyWithdrawalPropagation` dort vorher läuft; falls nicht, in dieser Reihenfolge aufrufen: Propagation → advance → progress.

- [ ] **Step 6: Tests, Commit**

```bash
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/club-duel.integration.spec.ts src/tournaments/tournaments.integration.spec.ts src/matches/matches.integration.spec.ts && cd ../..
pnpm --filter @darts-platform/api typecheck
git add apps/api/src
git commit -m "feat(api): Vereinsduell-Runden nach Abschluss paaren und Finalrunde besetzen"
```

---

### Task 11: API – `clubDuel`-Block im Dashboard (intern und öffentlich)

**Files:**
- Create: `apps/api/src/tournaments/club-duel-projection.ts`
- Modify: `apps/api/src/tournaments/tournaments.service.ts` (`projectDashboard`, öffentliche Projektion)
- Modify: `apps/api/src/tournaments/club-duel.integration.spec.ts`

**Interfaces:**
- Produces: `projectClubDuel(input: { data: TournamentDashboardData; legsOf: (scoringMatchId: string, playerId: string) => number | undefined }): ClubDuelDashboard | null` – null für andere Formate
- Consumes: `calculateClubStandings`, `calculateCrossRoundStandings`, `calculateClubScore`, `CLUB_DUEL_STAGE_KEYS` (Engine); `clubDuelDashboardSchema` (Schemas); `TournamentDashboardData` (Task 9)

- [ ] **Step 1: Failing Test**

In `club-duel.integration.spec.ts`, im Durchlauf-Test nach dem Spielen von Runde 1 (vor `playOut`) ergänzen:

```ts
    const afterRoundOne = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    const block = afterRoundOne.clubDuel;
    if (block === null) throw new Error("clubDuel block missing");
    expect(block.sideAName).toBe("VFC");
    expect(block.currentRound).toBe(2);
    expect(block.rounds.map((round) => [round.round, round.matchIds.length, round.pausedPlayerIds.length])).toEqual([[1, 9, 4], [2, 9, 4]]);
    expect(block.standings.overall).toHaveLength(22);
    expect(block.standings.sideA.filter((row) => row.qualified)).toHaveLength(2);
    expect(block.standings.sideB.filter((row) => row.qualified)).toHaveLength(2);
    expect(block.score.pointsA + block.score.pointsB).toBe(9);
    expect(block.finalRound.matches).toHaveLength(4);
    expect(block.finalRound.matches.every((match) => match.playerAId === null)).toBe(true);
```

und nach `playOut`:

```ts
    const finalBlock = dashboard.clubDuel;
    if (finalBlock === null) throw new Error("clubDuel block missing");
    expect(finalBlock.score.pointsA + finalBlock.score.pointsB).toBe(24);
    expect(finalBlock.finalRound.sideA.map((row) => row.position)).toEqual([1, 2]);
    expect(finalBlock.finalRound.matches.every((match) => match.status === "COMPLETED" && match.legs !== null)).toBe(true);
    // Öffentliche Sicht: erst nach Freigabe, dann mit demselben Block
    await expect(service.publicDashboard(afterRoundOne.tournament.publicId)).rejects.toBeInstanceOf(NotFoundException);
    await service.setVisibility({ organizationId, tournamentId: created.id, data: { visibility: "PUBLIC" }, auth, audit });
    const publicView = await service.publicDashboard(afterRoundOne.tournament.publicId);
    expect(publicView.clubDuel?.score).toEqual(finalBlock.score);
    expect(publicView.participants.every((participant) => participant.side === "A" || participant.side === "B")).toBe(true);
```

Die exakte Signatur von `service.publicDashboard` in `tournaments.service.ts:178` nachsehen und übernehmen.

- [ ] **Step 2: Test ausführen – muss scheitern (`clubDuel` ist null)**

- [ ] **Step 3: Projektion**

```ts
import {
  CLUB_DUEL_STAGE_KEYS,
  calculateClubScore,
  calculateClubStandings,
  calculateCrossRoundStandings,
  type ClubMatchResult,
  type ClubSide,
} from "@darts-platform/tournament-engine";
import type { ClubDuelDashboard } from "@darts-platform/schemas";

import type { TournamentDashboardData } from "./tournaments.repository.js";

type MatchRow = TournamentDashboardData["matches"][number];

interface SideRankReference { readonly type: "SIDE_RANK"; readonly side: ClubSide; readonly rank: number }

function sideRankOf(reference: unknown): SideRankReference | null {
  if (typeof reference !== "object" || reference === null) return null;
  const candidate = reference as { type?: unknown; side?: unknown; rank?: unknown };
  if (candidate.type !== "SIDE_RANK" || (candidate.side !== "A" && candidate.side !== "B") || typeof candidate.rank !== "number") return null;
  return { type: "SIDE_RANK", side: candidate.side, rank: candidate.rank };
}

function toSide(value: string | null): ClubSide {
  if (value === "A" || value === "B") return value;
  throw new Error("Club duel participant without side.");
}

function resultOf(match: MatchRow, legsOf: (scoringMatchId: string, playerId: string) => number | undefined): ClubMatchResult | "unopposed" | null {
  if (match.status !== "COMPLETED" || match.winnerPlayerId === null) return null;
  if (match.participantOneId === null || match.participantTwoId === null) return match.resultType === "WALKOVER" ? "unopposed" : null;
  if (match.resultType === "WALKOVER") {
    return { type: "WALKOVER", playerOneId: match.participantOneId, playerTwoId: match.participantTwoId, playerOneLegs: 0, playerTwoLegs: 0, winnerPlayerId: match.winnerPlayerId };
  }
  if (match.scoringMatchId === null) return null;
  const legsOne = legsOf(match.scoringMatchId, match.participantOneId);
  const legsTwo = legsOf(match.scoringMatchId, match.participantTwoId);
  if (legsOne === undefined || legsTwo === undefined) return null;
  return { type: "PLAYED", playerOneId: match.participantOneId, playerTwoId: match.participantTwoId, playerOneLegs: legsOne, playerTwoLegs: legsTwo, winnerPlayerId: match.winnerPlayerId };
}

function collect(matches: readonly MatchRow[], legsOf: Parameters<typeof resultOf>[1]): { results: ClubMatchResult[]; unopposedWalkoverWinnerIds: string[] } {
  const results: ClubMatchResult[] = [];
  const unopposedWalkoverWinnerIds: string[] = [];
  for (const match of matches) {
    const result = resultOf(match, legsOf);
    if (result === null) continue;
    if (result === "unopposed") {
      if (match.winnerPlayerId !== null) unopposedWalkoverWinnerIds.push(match.winnerPlayerId);
      continue;
    }
    results.push(result);
  }
  return { results, unopposedWalkoverWinnerIds };
}

/** Reine Projektion der gespeicherten Daten; entscheidet nichts, was nicht die Engine entscheidet. */
export function projectClubDuel(input: {
  readonly data: TournamentDashboardData;
  readonly legsOf: (scoringMatchId: string, playerId: string) => number | undefined;
}): ClubDuelDashboard | null {
  const { tournament } = input.data;
  if (tournament.format !== "CLUB_DUEL") return null;
  if (tournament.sideAName === null || tournament.sideBName === null || tournament.qualifyingRounds === null || tournament.finalRoundSize === null) {
    throw new Error("Club duel configuration invariant violated.");
  }
  const stageByKey = new Map(input.data.stages.map((stage) => [stage.key, stage.id]));
  const qualifyingId = stageByKey.get(CLUB_DUEL_STAGE_KEYS.qualifying);
  const finalRoundId = stageByKey.get(CLUB_DUEL_STAGE_KEYS.finalRound);
  if (qualifyingId === undefined || finalRoundId === undefined) throw new Error("Club duel stage invariant violated.");

  const names = new Map(input.data.participants.map((participant) => [participant.playerId, participant.displayName]));
  const nameOf = (playerId: string) => names.get(playerId) ?? "Unbekannter Teilnehmer";
  const participants = input.data.participants.map((participant) => ({ playerId: participant.playerId, seed: participant.seed, side: toSide(participant.side) }));
  const withdrawnPlayerIds = input.data.participants.filter((participant) => participant.status === "WITHDRAWN").map((participant) => participant.playerId);
  const activeIds = new Set(input.data.participants.filter((participant) => participant.status === "ACTIVE").map((participant) => participant.playerId));
  const sideOf = new Map(participants.map((participant) => [participant.playerId, participant.side]));

  const qualifyingMatches = input.data.matches.filter((match) => match.stageId === qualifyingId);
  const finalRoundMatches = input.data.matches.filter((match) => match.stageId === finalRoundId);
  const qualifyingResults = collect(qualifyingMatches, input.legsOf);
  const standings = calculateClubStandings({ participants, results: qualifyingResults.results, withdrawnPlayerIds });
  const qualified = {
    A: new Set(standings.sideA.filter((row) => !row.withdrawn).slice(0, tournament.finalRoundSize).map((row) => row.playerId)),
    B: new Set(standings.sideB.filter((row) => !row.withdrawn).slice(0, tournament.finalRoundSize).map((row) => row.playerId)),
  };
  const toRow = (row: (typeof standings.overall)[number]) => ({
    ...row,
    displayName: nameOf(row.playerId),
    qualified: qualified[row.side].has(row.playerId),
  });

  const currentRound = qualifyingMatches.reduce((max, match) => Math.max(max, match.round), 0);
  const rounds = Array.from({ length: currentRound }, (_, index) => {
    const round = index + 1;
    const inRound = qualifyingMatches.filter((match) => match.round === round);
    const playing = new Set(inRound.flatMap((match) => [match.participantOneId, match.participantTwoId]));
    return {
      round,
      matchIds: inRound.map((match) => match.id),
      pausedPlayerIds: [...activeIds].filter((playerId) => !playing.has(playerId)),
    };
  });

  const crossResults = collect(finalRoundMatches, input.legsOf);
  const entrants = (side: ClubSide) =>
    (side === "A" ? standings.sideA : standings.sideB)
      .filter((row) => qualified[side].has(row.playerId))
      .map((row) => ({ playerId: row.playerId, qualifyingRank: row.position }));
  const cross = calculateCrossRoundStandings({
    sideA: entrants("A"),
    sideB: entrants("B"),
    results: crossResults.results,
    unopposedWalkoverWinnerIds: crossResults.unopposedWalkoverWinnerIds,
  });
  const toCrossRow = (side: ClubSide) => (row: (typeof cross.sideA)[number]) => ({ ...row, side, displayName: nameOf(row.playerId) });

  const allResults = collect(input.data.matches, input.legsOf);
  const score = calculateClubScore({ sideOf, results: allResults.results, unopposedWalkoverWinnerIds: allResults.unopposedWalkoverWinnerIds });

  return {
    sideAName: tournament.sideAName,
    sideBName: tournament.sideBName,
    qualifyingRounds: tournament.qualifyingRounds,
    finalRoundSize: tournament.finalRoundSize,
    thirdPlaceMatch: tournament.thirdPlaceMatch,
    currentRound,
    rounds,
    standings: {
      overall: standings.overall.map(toRow),
      sideA: standings.sideA.map(toRow),
      sideB: standings.sideB.map(toRow),
    },
    finalRound: {
      sideA: cross.sideA.map(toCrossRow("A")),
      sideB: cross.sideB.map(toCrossRow("B")),
      matches: finalRoundMatches.map((match) => {
        const first = sideRankOf(match.participantOneRef);
        const second = sideRankOf(match.participantTwoRef);
        const result = resultOf(match, input.legsOf);
        return {
          matchId: match.id,
          round: match.round,
          rankA: first?.rank ?? match.position,
          rankB: second?.rank ?? ((match.position + match.round - 2) % tournament.finalRoundSize) + 1,
          playerAId: match.participantOneId,
          playerBId: match.participantTwoId,
          status: match.status as "WAITING" | "READY" | "IN_PROGRESS" | "COMPLETED" | "BYE" | "CANCELLED",
          winnerPlayerId: match.winnerPlayerId,
          legs: typeof result === "object" && result !== null && result.type === "PLAYED" ? [result.playerOneLegs, result.playerTwoLegs] : null,
        };
      }),
    },
    score,
  };
}
```

Hinweis zu `rankA`/`rankB`: Nach der Auflösung bleiben die `SIDE_RANK`-Referenzen erhalten (Task 10 setzt sie nur bei fehlendem Spieler auf null); die Fallbacks aus `position`/`round` greifen nur dann.

- [ ] **Step 4: Service**

In `projectDashboard` (nach `scoringById`):

```ts
    const legsOf = (scoringMatchId: string, playerId: string): number | undefined =>
      scoringById.get(scoringMatchId)?.participants.find((participant) => participant.playerId === playerId)?.legsWon;
    const clubDuel = projectClubDuel({ data, legsOf });
```

und `clubDuel` ins Rückgabeobjekt aufnehmen (statt `null` aus Task 9). In der öffentlichen Projektion (`publicDashboard`, Zeile ~178–220) `clubDuel: dashboard.clubDuel` durchreichen – der Block enthält nur Spieler-IDs, Namen und Resultate, die auch Rangliste und Tableau zeigen. `legsWon` in `MatchStateResponse.participants` ist die Summe gewonnener Legs; bei Best-of-Sets > 1 zählt sie über alle Sätze – für die Vereinswertung erwünscht.

- [ ] **Step 5: Tests, Commit**

```bash
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/club-duel.integration.spec.ts src/tournaments/public-tournaments.controller.spec.ts && cd ../..
pnpm --filter @darts-platform/api typecheck
git add apps/api/src
git commit -m "feat(api): Ranglisten, Finalrunde und Vereinswertung im Turnier-Dashboard"
```

---

### Task 12: API – Korrektur-Sperre, Parallelität, Rückzug

**Files:**
- Create: `apps/api/src/tournaments/club-duel-correction-lock.ts`
- Modify: `apps/api/src/matches/matches.repository.ts:638-720` (`correctTournamentResult`, `TournamentCorrectionResult`)
- Modify: `apps/api/src/tournaments/tournaments.service.ts:300-365` (`mutate`)
- Modify: `apps/api/src/tournaments/club-duel.integration.spec.ts`

**Interfaces:**
- Produces: `isClubDuelResultLocked(transaction, organizationId, tournamentId, scheduled: MatchRow): Promise<boolean>`; `TournamentCorrectionResult` um `"club-duel-round-paired"`; HTTP 409 `CLUB_DUEL_ROUND_ALREADY_PAIRED`

- [ ] **Step 1: Failing Tests**

```ts
describe("Vereinsduell Korrektur und Rückzug", () => {
  it("sperrt die Korrektur eines Quali-Resultats, sobald die Folgerunde gepaart ist", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    const roundOne = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 1")));
    const [first, second] = roundOne;
    if (!first?.participantOneId || !second?.participantOneId || !first.participantTwoId || !second.participantTwoId) throw new Error("unexpected");
    await playMatch(created.id, first.id, first.participantOneId, boardIds[0]);
    // Runde noch offen → Korrektur erlaubt
    let dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    dashboard = await service.correctResult({ organizationId, tournamentId: created.id, data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, matchId: first.id, reason: "Falsch erfasst" }, auth, audit });
    expect(dashboard.boards.some((board) => board.match?.matchId === first.id)).toBe(true);
    // neu zu Ende spielen (Match läuft wieder; Rest-Score egal, der Helfer spielt neu ab)
    await finishReopenedMatch(created.id, first.id, first.participantOneId);
    await playMatch(created.id, second.id, second.participantTwoId, boardIds[0]);
    // Runde 2 ist gepaart → gesperrt
    dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    await expect(service.correctResult({ organizationId, tournamentId: created.id, data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, matchId: first.id, reason: "Zu spät" }, auth, audit }))
      .rejects.toMatchObject({ response: { code: "CLUB_DUEL_ROUND_ALREADY_PAIRED" } });
  }, 60_000);

  it("paart bei zwei gleichzeitig abgeschlossenen letzten Spielen genau eine Folgerunde", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2, sideACount: 2, sideBCount: 2 }), auth, audit });
    const roundOne = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 1")));
    const [first, second] = roundOne;
    if (!first?.participantOneId || !second?.participantOneId) throw new Error("unexpected");
    // beide Spiele starten (zwei Boards), bis auf den letzten Wurf spielen, dann die Checkouts parallel abschicken
    const firstFinish = await bringToCheckout(created.id, first.id, first.participantOneId, boardIds[0]);
    const secondFinish = await bringToCheckout(created.id, second.id, second.participantOneId, boardIds[1]);
    await Promise.all([firstFinish(), secondFinish()]);
    const roundTwo = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 2")));
    expect(roundTwo).toHaveLength(2);
    const audits = await databaseService.database.select().from(auditEvents).where(and(eq(auditEvents.entityId, created.id), eq(auditEvents.action, "TOURNAMENT_ROUND_PAIRED")));
    expect(audits).toHaveLength(1);
  }, 60_000);

  it("Rückzug in der Quali: offenes Spiel wird Walkover, Spieler wird nicht mehr gepaart, fehlender Finalrunden-Platz wird Walkover", async () => {
    const created = await service.create({ organizationId, data: clubDuelInput({ qualifyingRounds: 2, finalRoundSize: 2, sideACount: 3, sideBCount: 2 }), auth, audit });
    let dashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    const roundOne = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 1")));
    const victim = roundOne[0]?.participantTwoId; // ein B-Spieler
    if (!victim) throw new Error("unexpected");
    dashboard = await service.withdrawParticipant({ organizationId, tournamentId: created.id, data: { commandId: randomUUID(), expectedVersion: dashboard.tournament.version, playerId: victim, reason: "Verletzung" }, auth, audit });
    expect(dashboard.recentResults.find((entry) => entry.matchId === roundOne[0]?.id)?.resultType).toBe("WALKOVER");
    // zweites Spiel der Runde fertig spielen → Runde 2 ohne den Zurückgezogenen (B hat nur noch 1 Aktiven → 1 Spiel, 2 Pausen bei A)
    const other = roundOne[1];
    if (!other?.participantOneId || !other.participantTwoId) throw new Error("unexpected");
    await playMatch(created.id, other.id, other.participantOneId, boardIds[0]);
    const roundTwo = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Quali · Runde 2")));
    expect(roundTwo).toHaveLength(1);
    expect(roundTwo.some((match) => match.participantTwoId === victim)).toBe(false);
    const total = await playOut(created.id);
    // Finalrunde 2x2: B hat nur noch 1 Spieler → 2 Walkover für A ohne Gegner; Final/Platz 3 je nach Besetzung
    const finalRound = await databaseService.database.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournamentId, created.id), eq(tournamentMatches.stageLabel, "Finalrunde · Runde 1")));
    expect(finalRound.filter((match) => match.resultType === "WALKOVER" && match.participantTwoId === null)).toHaveLength(1);
    expect(total).toBeGreaterThan(0);
    const finalDashboard = await service.dashboard({ organizationId, tournamentId: created.id, auth });
    expect(finalDashboard.tournament.status).toBe("COMPLETED");
    expect(finalDashboard.clubDuel?.score.pointsA).toBeGreaterThanOrEqual(2);
  }, 90_000);
});
```

Helfer: `bringToCheckout(tournamentId, matchId, winnerPlayerId, boardId)` spielt wie `playMatch` bis **vor** den letzten Wurf und gibt eine Funktion zurück, die den Checkout schickt; `finishReopenedMatch(tournamentId, matchId, winnerPlayerId)` liest den laufenden Zustand (`matchesService.get`) und spielt den Rest-Score des Gewinners herunter: solange `remaining > 40` Visits zu 0 vom Verlierer und zum Gewinner `min(180, remaining − 40)` – bei `remaining ≤ 180` direkt `remaining − 40` –, danach `40` mit `checkoutSegment D20`. Den aktiven Spieler liefert `state.participants.find((p) => p.isActive)`; wer nicht dran ist, wirft 0.

- [ ] **Step 2: Tests ausführen – Korrektur-Test scheitert (Korrektur wird zugelassen)**

- [ ] **Step 3: Sperre**

`club-duel-correction-lock.ts`:

```ts
import { and, eq, isNotNull, ne, or } from "drizzle-orm";

import { CLUB_DUEL_STAGE_KEYS } from "@darts-platform/tournament-engine";
import { tournamentMatches, tournamentStages, tournaments } from "@darts-platform/database";

import type { DatabaseService } from "../database/database.service.js";

type DatabaseTransaction = Parameters<Parameters<DatabaseService["database"]["transaction"]>[0]>[0];

/**
 * Spec, Resultatkorrektur: gesperrt, sobald die Phase nach dem Spiel feststeht
 * – Folgerunde gepaart, Finalrunde besetzt oder Final besetzt. Fuer andere
 * Formate immer false.
 */
export async function isClubDuelResultLocked(
  transaction: DatabaseTransaction,
  organizationId: string,
  tournamentId: string,
  scheduled: { readonly stageId: string; readonly round: number },
): Promise<boolean> {
  const [tournament] = await transaction.select({ format: tournaments.format, qualifyingRounds: tournaments.qualifyingRounds }).from(tournaments)
    .where(and(eq(tournaments.organizationId, organizationId), eq(tournaments.id, tournamentId))).limit(1);
  if (tournament?.format !== "CLUB_DUEL") return false;
  const stages = await transaction.select().from(tournamentStages)
    .where(and(eq(tournamentStages.organizationId, organizationId), eq(tournamentStages.tournamentId, tournamentId)));
  const byId = new Map(stages.map((stage) => [stage.id, stage.key]));
  const byKey = new Map(stages.map((stage) => [stage.key, stage.id]));
  const stageKey = byId.get(scheduled.stageId);
  const occupied = async (stageId: string | undefined, minRound?: number): Promise<boolean> => {
    if (stageId === undefined) return false;
    const [row] = await transaction.select({ id: tournamentMatches.id }).from(tournamentMatches).where(and(
      eq(tournamentMatches.organizationId, organizationId),
      eq(tournamentMatches.stageId, stageId),
      minRound === undefined ? undefined : eq(tournamentMatches.round, minRound),
      or(isNotNull(tournamentMatches.participantOneId), isNotNull(tournamentMatches.participantTwoId), ne(tournamentMatches.status, "WAITING")),
    )).limit(1);
    return row !== undefined;
  };
  if (stageKey === CLUB_DUEL_STAGE_KEYS.qualifying) {
    if (tournament.qualifyingRounds !== null && scheduled.round < tournament.qualifyingRounds) {
      return occupied(byKey.get(CLUB_DUEL_STAGE_KEYS.qualifying), scheduled.round + 1);
    }
    return occupied(byKey.get(CLUB_DUEL_STAGE_KEYS.finalRound));
  }
  if (stageKey === CLUB_DUEL_STAGE_KEYS.finalRound) return occupied(byKey.get(CLUB_DUEL_STAGE_KEYS.final));
  return false;
}
```

In `matches.repository.ts`, `correctTournamentResult`, direkt nach der Prüfung `scheduled.status !== "COMPLETED" …` (vor dem Laden des Scoring-Matches):

```ts
      if (await isClubDuelResultLocked(transaction, input.organizationId, input.tournamentId, scheduled)) return "club-duel-round-paired";
```

`TournamentCorrectionResult` um `"club-duel-round-paired"` erweitern. In `tournaments.service.ts`, `mutate`:

```ts
      if (result === "club-duel-round-paired") {
        throw new ConflictException({
          code: "CLUB_DUEL_ROUND_ALREADY_PAIRED",
          message: "Die nächste Runde ist bereits gepaart. Dieses Resultat kann nicht mehr korrigiert werden.",
          details: { currentState: current },
        });
      }
```

- [ ] **Step 4: Alle Tests der Datei, Commit**

```bash
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/club-duel.integration.spec.ts && cd ../..
git add apps/api/src
git commit -m "feat(api): Resultatkorrektur im Vereinsduell nach Paarung sperren"
```

Schlägt der Parallelitätstest fehl, weil beide Transaktionen die jeweils andere Paarung als offen sehen: prüfen, dass `advanceClubDuel` die Turnierzeile **vor** dem Zählen offener Spiele sperrt und dass `lockTournamentScoringContext` (matches) dieselbe Zeile sperrt – siehe ADR 0021.

---

### Task 13: ADR 0021 und README

**Files:**
- Create: `docs/adr/0021-vereinsduell-rundenpaarung.md`
- Modify: `README.md:359-360` (ADR-Tabelle) und Abschnitt zu Turnierformaten

- [ ] **Step 1: ADR schreiben** (Form wie `0020-liga-resultatkorrektur.md`: Status, Datum, Kontext, Entscheidung, Konsequenzen)

Inhalt:
- Kontext: alle bisherigen Formate planen alle Spiele beim Start; Schweizer System braucht Paarung Runde für Runde; Anforderung «immer A gegen B» schliesst KO-Bäume aus (Begründung aus der Spec).
- Entscheidung: (1) Paarung in der Transaktion des letzten Rundenspiels, `tournaments FOR UPDATE` vor dem Zählen offener Spiele, Audit `TOURNAMENT_ROUND_PAIRED`, Outbox vor Realtime; (2) Zuordnungsproblem (ungarischer Algorithmus) mit Strafkosten für Wiederholungen statt Greedy – immer optimal, O(n³), deterministisch; (3) `SIDE_RANK`-Platzhalter analog `GROUP_RANK`; (4) Gastspieler als `players.kind = 'GUEST'` in der eigenen Organisation, kein Cross-Org; (5) Korrektur-Sperre nach Paarung; (6) Pausen abgeleitet statt gespeichert; Vereinswertung berechnet.
- Verworfen: Encounter-Modell, Vorab-Auslosung aller Runden, getrennte KO-Bäume, Turnier über zwei Organisationen (mit je einem Satz Begründung).
- Konsequenzen: Quali-Korrektur nur bei offener Runde; Gastspieler sind Personendaten (Verweis Spec, Datenschutz-Prüfung offen); Plan 2 (Web) folgt.

- [ ] **Step 2: README**

ADR-Tabelle: `| [ADR 0021](./docs/adr/0021-vereinsduell-rundenpaarung.md) | Vereinsduell: Paarung Runde für Runde, Kreuz-Finalrunde, Gastspieler |`. Im Abschnitt über Turnierformate einen Absatz «Vereinsduell» (drei Phasen, Vereinswertung, Gastspieler-Erfassung, Endpunkte `POST …/players/guests`, `POST …/tournaments/club-duel-preview`, Hinweis «Oberfläche folgt mit Plan 2»).

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0021-vereinsduell-rundenpaarung.md README.md
git commit -m "docs: ADR 0021 Vereinsduell und README-Abschnitt"
```

---

### Task 14: Gesamtsuite

- [ ] **Step 1: Alle Pakete bauen und prüfen**

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Expected: alles grün. `pnpm build` für `apps/web` braucht `NODE_ENV=production` (Memory `web-build-needs-node-env`). Rote Tests sind Befunde, keine Flakes – ausser sie betreffen die bekannten Shared-DB-Kollisionen (Memory `ci-shared-db-test-race`); dann einmal einzeln wiederholen.

- [ ] **Step 2: Routeninventar**

`cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/testing/route-inventory.integration.spec.ts src/security/permission-matrix.integration.spec.ts src/security/tenant-isolation-matrix.integration.spec.ts`
Expected: grün; die Isolationsmatrix meldet die zwei neuen Routen weder als `leaks` noch als `unproven`.

- [ ] **Step 3: Branch abschliessen**

Kein Commit nötig, wenn alles grün ist. Danach `superpowers:finishing-a-development-branch`: PR gegen `develop` mit Problem/Lösung/Architektur/Migration 0037/Tests/Security (neue Routen, `player:create` wiederverwendet, Gäste ohne Konto per DB-Check).

---

## Selbstprüfung gegen die Spec

| Spec-Abschnitt | Task |
|---|---|
| Datenmodell `players` (kind, guest_club_name, Checks, Listenfilter) | 6, 8 |
| Datenmodell `tournaments` (Format, Status, Vereinsnamen, Runden, Finalrunde, Platz 3, neutrale Gruppenwerte) | 6, 9 |
| `tournament_participants.side`, Stage-Typen, `SIDE_RANK`, Unique je Runde, Pausen abgeleitet | 1, 6, 9, 10, 11 |
| Engine: Plan, Paarung, Ranglisten, Finalrunde, Vereinswertung, Vorschau, Rückzug | 1–3, 10 |
| API: Anlage (Union, Serverprüfung), Gastspieler (idempotent, Audit), Folgerunde (FOR UPDATE, Audit, Outbox), Statuswechsel, Korrektur-Sperre, Lesen (intern/öffentlich), Fehlercodes | 5, 8–12 |
| Tests Engine (inkl. Property), API (Ablauf 13/9, Parallelität, Korrektur 409, Rückzug, Gäste, Mandantentrennung, PRIVATE→404, Realtime nach Commit) | 1–3, 8–12 |
| Realtime nur nach Commit / nicht bei Rollback | durch Outbox-Muster gegeben; Test in 10 prüft genau ein Event je Paarung |
| UI, E2E, Beamer | **Plan 2** (nicht Teil dieses Plans) |
| ADR 0021, README, Isolationsmatrix | 8, 9, 13 |
