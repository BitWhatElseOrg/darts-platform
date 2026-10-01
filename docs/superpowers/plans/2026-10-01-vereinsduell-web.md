# Vereinsduell – Plan 2: Web-Oberfläche, Beamer, E2E

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Vereinsduell (Format `CLUB_DUEL`, Backend aus Plan 1 / PR #96) wird in `apps/web` anlegbar, geleitet, öffentlich und auf dem Beamer angezeigt; Scoring-Fläche und Scheiben-Tablet zeigen das Vereinskürzel; ein E2E-Test fährt den Ablauf.

**Architecture:** Die UI enthält keine Turnierlogik; sie rendert, was `tournamentDashboardSchema.clubDuel` liefert. Neue Komponenten liegen in `apps/web/src/components/tournament/club-duel/` und werden von Kommandozentrale und Live-Ansicht gemeinsam genutzt. Das Anlegen hängt als Format-Zweig im bestehenden `SetupSheet`; die Gastspieler-Erfassung ist eine eigene Komponente. Einzige Backend-Änderung: der Match-Zustand trägt pro Person ein `clubLabel` (Kürzel), damit Scoreboard und Kiosk ohne Zusatzabfrage auskommen.

**Tech Stack:** Next.js (App Router, "use client"), React Hook Form, TanStack Query, Zod 4, `@darts-platform/ui` (Sektorenring-Primitive: `Wedge`, `Rule`, `SheetLabel`, `Table/Th/Td/Tr`, `StateTag`, `Control`, `Field`, `TextInput`, `SelectInput`, `RingSteps`), Vitest + Testing Library (`*.render.spec.tsx`, `// @vitest-environment happy-dom`), Playwright (`apps/web/tests`, 1 Worker).

**Spec:** `docs/superpowers/specs/2026-10-01-vereinsduell-design.md`, Abschnitt «UI (apps/web)», «Beamer», «Scoring-Fläche und Scheiben-Tablet», «Barrierefreiheit», «Tests → E2E». Backend-Vertrag: `packages/schemas/src/club-duel.ts` (Stand PR #96).

## Global Constraints

- Branch: `feature/vereinsduell-web`, abgezweigt von `feature/vereinsduell` (PR #96). PR gegen `feature/vereinsduell`; nach dem Merge von #96 auf `develop` umhängen.
- AGENTS.md §18/§19: Mobile First, Touch-Ziele ≥ `min-h-11`, Fehlerzustände sichtbar, keine Business-Logik in React, Formular-State in React Hook Form, Server-State in TanStack Query, semantisches HTML, keine Information nur über Farbe.
- DESIGN.md: nur `ring-green`/`ring-red` als Signalfarben, kein dritter Akzent. Vereine werden **nie** nur über Farbe unterschieden – immer Kürzel oder Name.
- Deutsche UI-Texte mit Umlauten, Schweizer Rechtschreibung (kein ß).
- Commits: Conventional Commits auf Deutsch, **kein** `Co-Authored-By`-Trailer.
- Keine neuen Abhängigkeiten.
- Vertrag (nicht ändern, nur lesen): `ClubDuelDashboard` = Settings (`sideAName`, `sideBName`, `qualifyingRounds`, `finalRoundSize`, `thirdPlaceMatch`) + `currentRound` + `rounds[{ round, matchIds, matches[{ matchId, position, playerAId, playerBId, status, resultType, winnerPlayerId, legs }], pausedPlayerIds }]` + `standings{ overall, sideA, sideB }` (Zeilen `{ position, playerId, displayName, side, played, won, lost, legsFor, legsAgainst, winRate, legDifferencePerMatch, withdrawn, qualified }`) + `finalRound{ sideA, sideB, matches[{ matchId, round, rankA, rankB, playerAId, playerBId, status, winnerPlayerId, legs }] }` + `finals{ final, thirdPlace }` + `score{ pointsA, pointsB, legDifferenceA, leader }`. Dashboard-Teilnehmer tragen `side: "A"|"B"|null`.
- Routen: `POST /organizations/:org/players/guests` (`{ commandId, clubName, names }` → `PlayerResponse[]`), `GET /organizations/:org/players?kind=MEMBER|GUEST|ALL` (Default MEMBER), `POST /organizations/:org/tournaments/club-duel-preview`, `POST /organizations/:org/tournaments` mit `format: "CLUB_DUEL"`.
- Bekannte Vertragslücken, die dieser Plan im Web ausgleicht: `bracket` enthält den Vereinsduell-Final nicht (Filter «K.-o.»), `groups` ist leer, `queue` listet alle `WAITING`-Platzhalter; `tournamentWinner` liefert für `CLUB_DUEL` null.
- Vor Abschluss: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`.
- Einzelne Web-Tests: `cd apps/web && npx vitest run src/<pfad>`; E2E: `pnpm test:e2e` (Root; baut die Pakete und startet Web 3100 / API 3101).

---

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `packages/domain/src/club-label.ts` (neu) + Export in `packages/domain/src/index.ts` | `clubAbbreviation(name)` – Kürzel aus Vereinsname (gemeinsam für API und Web) |
| `packages/schemas/src/match.ts` | `matchSidePlayerSchema.clubLabel: string \| null` (Default null) |
| `apps/api/src/matches/matches.repository.ts` | `buildState` setzt `clubLabel` für Vereinsduell-Matches |
| `apps/web/src/lib/tournament-format.ts` | `statusLabel` für `CLUB_DUEL` |
| `apps/web/src/lib/tournament-winner.ts` | Sieger aus `clubDuel.finals.final` |
| `apps/web/src/lib/api-client.ts` | Fehlertexte neuer Codes |
| `apps/web/src/lib/club-duel-view.ts` (neu) | reine Anzeige-Helfer: Namens-Map, Seitenname/-kürzel, Rundenstatus-Texte |
| `apps/web/src/components/players/guest-players-panel.tsx` (neu) | Gastspieler-Schnellerfassung |
| `apps/web/src/components/tournament/club-duel-setup.tsx` (neu) | Abschnitte «Vereine», «Spieler A/B», «Modus», Vorschau-Karte |
| `apps/web/src/components/tournament/club-duel-setup-values.ts` (neu) | `buildClubDuelCandidate(values)` – Formularwerte → API-Körper (pur, getestet) |
| `apps/web/src/components/tournament/setup-sheet.tsx`, `tournament-setup-route.tsx` | Format-Zweig, Spieler mit `?kind=ALL` |
| `apps/web/src/components/tournament/club-duel/club-score-banner.tsx`, `club-duel-tabs.tsx`, `club-duel-panel.tsx`, `club-rounds.tsx`, `club-standings.tsx`, `club-final-round.tsx` (neu) | gemeinsame Anzeige für Leitung, Publikum, Beamer |
| `apps/web/src/components/tournament/command-centre.tsx` | Banner, Panel statt `StandingsSheet`, Queue-Filter |
| `apps/web/src/components/live/live-tournament.tsx` | Publikum + Beamer-Zweig |
| `apps/web/src/components/match/scoreboard-sides.tsx`, `match-scoreboard.tsx`, `match-list.tsx` | Kürzel neben Namen; gemeinsamer `sideNames`-Helfer in `apps/web/src/lib/side-names.ts` (neu) |
| `apps/web/tests/club-duel.spec.ts` (neu) | E2E |
| `README.md` | Abschnitt Vereinsduell: Oberfläche vorhanden |

---

### Task 1: Vereinskürzel im Match-Zustand (Domain, Schema, API)

**Files:**
- Create: `packages/domain/src/club-label.ts`, `packages/domain/src/club-label.spec.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/schemas/src/match.ts:107-111`
- Modify: `apps/api/src/matches/matches.repository.ts` (`buildState`, ~Zeile 284–375)
- Modify: `apps/api/src/tournaments/club-duel.integration.spec.ts` (Assertion im Durchlauf-Test)

**Interfaces:**
- Produces: `clubAbbreviation(name: string): string` – 2–3 Grossbuchstaben: bei mehreren Wörtern die Initialen der ersten drei Wörter (ohne Wörter, die nur aus Zeichen wie «-» bestehen), bei einem Wort die ersten drei Buchstaben; Ziffern bleiben erhalten («DC Musterdorf» → «DM», «Dartclub 1880 Musterdorf» → «D1M», «VFC» → «VFC», «Musterdorf» → «MUS»).
- Produces: `matchSidePlayerSchema.clubLabel: z.string().nullable().default(null)` – im Vereinsduell das Kürzel des Vereins der Person, sonst null.

- [ ] **Step 1: Failing Domain-Test**

`packages/domain/src/club-label.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { clubAbbreviation } from "./club-label";

describe("clubAbbreviation", () => {
  it("bildet Initialen aus mehreren Wörtern, höchstens drei", () => {
    expect(clubAbbreviation("DC Musterdorf")).toBe("DM");
    expect(clubAbbreviation("Dartclub 1880 Musterdorf")).toBe("D1M");
    expect(clubAbbreviation("Verein für Freizeit und Chaos")).toBe("VFF");
  });

  it("nimmt bei einem Wort die ersten drei Zeichen in Grossbuchstaben", () => {
    expect(clubAbbreviation("VFC")).toBe("VFC");
    expect(clubAbbreviation("Musterdorf")).toBe("MUS");
    expect(clubAbbreviation("Öl")).toBe("ÖL");
  });

  it("ignoriert Trennzeichen und leere Teile", () => {
    expect(clubAbbreviation("  DC  -  Musterdorf ")).toBe("DM");
    expect(clubAbbreviation("")).toBe("");
  });
});
```

- [ ] **Step 2: Test ausführen – muss scheitern**

Run: `cd packages/domain && npx vitest run src/club-label.spec.ts`

- [ ] **Step 3: Implementieren**

`packages/domain/src/club-label.ts`:

```ts
/**
 * Kürzel eines Vereinsnamens für enge Flächen (Scoreboard, Tablet, Tabellen).
 * Rein darstellend – der Name bleibt die Wahrheit, das Kürzel steht nie
 * allein (Spec Vereinsduell, Barrierefreiheit).
 */
export function clubAbbreviation(name: string): string {
  const words = name
    .split(/\s+/u)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => word.length > 0);
  if (words.length === 0) return "";
  if (words.length === 1) return (words[0] ?? "").slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
```

In `packages/domain/src/index.ts`: `export { clubAbbreviation } from "./club-label.js";` (Endung wie die übrigen Exporte dort).

- [ ] **Step 4: Schema**

In `packages/schemas/src/match.ts`:

```ts
export const matchSidePlayerSchema = z.object({
  playerId: z.uuid(),
  displayName: z.string(),
  isThrowing: z.boolean(),
  /** Vereinsduell: Kürzel des Vereins dieser Person; sonst null. Default, damit ältere Antworten weiter parsen. */
  clubLabel: z.string().nullable().default(null),
});
```

- [ ] **Step 5: API – Kürzel im `buildState`**

In `matches.repository.ts` innerhalb `buildState`, nach `participantRows`: Wenn `liveTarget?.kind === "TOURNAMENT"`, Seite und Vereinsnamen laden:

```ts
    const clubLabels = liveTarget?.kind === "TOURNAMENT"
      ? await this.loadClubLabels(organizationId, liveTarget.tournamentId, participantRows.map((row) => row.playerId))
      : new Map<string, string>();
```

und in `participantState` bei `players`: `clubLabel: clubLabels.get(row.playerId) ?? null`. Neue private Methode:

```ts
  /** Vereinsduell: Kürzel je Person aus Seite und Vereinsnamen des Turniers; sonst leer. */
  private async loadClubLabels(organizationId: string, tournamentId: string, playerIds: readonly string[]): Promise<Map<string, string>> {
    const [tournament] = await this.databaseService.database
      .select({ format: tournaments.format, sideAName: tournaments.sideAName, sideBName: tournaments.sideBName })
      .from(tournaments)
      .where(and(eq(tournaments.organizationId, organizationId), eq(tournaments.id, tournamentId)))
      .limit(1);
    if (tournament?.format !== "CLUB_DUEL" || tournament.sideAName === null || tournament.sideBName === null) return new Map();
    const rows = await this.databaseService.database
      .select({ playerId: tournamentParticipants.playerId, side: tournamentParticipants.side })
      .from(tournamentParticipants)
      .where(and(
        eq(tournamentParticipants.organizationId, organizationId),
        eq(tournamentParticipants.tournamentId, tournamentId),
        inArray(tournamentParticipants.playerId, [...playerIds]),
      ));
    const labels = { A: clubAbbreviation(tournament.sideAName), B: clubAbbreviation(tournament.sideBName) };
    return new Map(rows.flatMap((row) => (row.side === "A" || row.side === "B" ? [[row.playerId, labels[row.side]] as const] : [])));
  }
```

Importe: `clubAbbreviation` aus `@darts-platform/domain`, `tournamentParticipants` aus `@darts-platform/database` (prüfen, ob schon importiert).

- [ ] **Step 6: API-Assertion**

In `club-duel.integration.spec.ts`, im Durchlauf-Test nach dem ersten `playMatch` (oder in `playMatch` selbst nach `matchesService.get`): `expect(state.participants.map((p) => p.players[0]?.clubLabel)).toEqual(expect.arrayContaining(["VFC", "DM"]))` – Seite A heisst «VFC», Seite B «DC Musterdorf».

- [ ] **Step 7: Bauen, Tests, Commit**

```bash
cd packages/domain && npx vitest run && cd ../..
pnpm --filter @darts-platform/domain build && pnpm --filter @darts-platform/schemas build
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/club-duel.integration.spec.ts src/matches/matches.integration.spec.ts && cd ../..
pnpm --filter @darts-platform/api typecheck && pnpm --filter @darts-platform/web typecheck
git add packages/domain packages/schemas/src/match.ts apps/api/src
git commit -m "feat(api): Vereinskuerzel je Person im Match-Zustand"
```

---

### Task 2: Anzeige-Helfer im Web (Status, Sieger, Fehlertexte, Namens-Map)

**Files:**
- Modify: `apps/web/src/lib/tournament-format.ts:82-95`, `tournament-format.spec.ts`
- Modify: `apps/web/src/lib/tournament-winner.ts`, `tournament-winner.spec.ts` (anlegen, falls nicht vorhanden)
- Modify: `apps/web/src/lib/api-client.ts:15-70` (`messages`)
- Create: `apps/web/src/lib/club-duel-view.ts`, `club-duel-view.spec.ts`
- Create: `apps/web/src/lib/side-names.ts`

**Interfaces (Produces):**
- `statusLabel("GROUP_STAGE","CLUB_DUEL") === "Qualifikation"`, `statusLabel("KNOCKOUT","CLUB_DUEL") === "Final"`, `statusLabel("FINAL_ROUND") === "Finalrunde"` (bleibt).
- `tournamentWinner(source)` berücksichtigt `source.clubDuel?.finals.final` (COMPLETED → Name des `winnerPlayerId` über `source.participants`).
- `club-duel-view.ts`:
  - `participantNames(participants: readonly { playerId: string; displayName: string }[]): ReadonlyMap<string, string>`
  - `sideLabel(clubDuel: Pick<ClubDuelDashboard,"sideAName"|"sideBName">, side: "A"|"B"): { name: string; short: string }` (short = `clubAbbreviation`)
  - `roundMatchStateLabel(status): { tone: StateTone; label: string }` – WAITING→waiting «offen», READY→free «bereit», IN_PROGRESS→live «läuft», COMPLETED→finish «gespielt», BYE→finish «Freilos», CANCELLED→blocked «abgesagt»
  - `scoreLine(clubDuel): string` → `"VFC 21 : 15 DC Musterdorf"`
  - `legsLabel(legs: readonly [number, number] | null): string` → `"2:1"` oder `"–"`
- `side-names.ts`: `sideNames(participant: MatchStateResponse["participants"][number]): string` (bisher dreifach dupliziert) und `sideNamesWithClub(participant): string` → `"Anna Muster (VFC)"`; mehrere Personen mit « und ».

- [ ] **Step 1: Failing Tests**

`tournament-format.spec.ts` ergänzen:

```ts
  it("benennt die Phasen des Vereinsduells", () => {
    expect(statusLabel("GROUP_STAGE", "CLUB_DUEL")).toBe("Qualifikation");
    expect(statusLabel("FINAL_ROUND", "CLUB_DUEL")).toBe("Finalrunde");
    expect(statusLabel("KNOCKOUT", "CLUB_DUEL")).toBe("Final");
  });
```

`apps/web/src/lib/club-duel-view.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { legsLabel, participantNames, roundMatchStateLabel, scoreLine, sideLabel } from "./club-duel-view";

const settings = { sideAName: "VFC", sideBName: "DC Musterdorf" };

describe("club-duel-view", () => {
  it("liefert Name und Kürzel je Seite", () => {
    expect(sideLabel(settings, "A")).toEqual({ name: "VFC", short: "VFC" });
    expect(sideLabel(settings, "B")).toEqual({ name: "DC Musterdorf", short: "DM" });
  });
  it("formatiert die Vereinswertung", () => {
    expect(scoreLine({ ...settings, score: { pointsA: 21, pointsB: 15, legDifferenceA: 4, leader: "A" } })).toBe("VFC 21 : 15 DC Musterdorf");
  });
  it("formatiert Legs", () => {
    expect(legsLabel([2, 1])).toBe("2:1");
    expect(legsLabel(null)).toBe("–");
  });
  it("übersetzt Matchstatus in Ton und Wort", () => {
    expect(roundMatchStateLabel("IN_PROGRESS")).toEqual({ tone: "live", label: "läuft" });
    expect(roundMatchStateLabel("CANCELLED")).toEqual({ tone: "blocked", label: "abgesagt" });
  });
  it("baut die Namens-Map", () => {
    expect(participantNames([{ playerId: "a", displayName: "Anna" }]).get("a")).toBe("Anna");
  });
});
```

`tournament-winner.spec.ts` (neu oder ergänzen):

```ts
  it("nennt im Vereinsduell den Sieger des Finals", () => {
    expect(tournamentWinner({
      tournament: { status: "COMPLETED" },
      bracket: [],
      groups: [],
      participants: [{ playerId: "a-1", displayName: "Anna" }, { playerId: "b-1", displayName: "Beat" }],
      clubDuel: { finals: { final: { status: "COMPLETED", winnerPlayerId: "b-1" }, thirdPlace: null } },
    })).toBe("Beat");
  });
```

- [ ] **Step 2: Ausführen – scheitern**

Run: `cd apps/web && npx vitest run src/lib/tournament-format.spec.ts src/lib/club-duel-view.spec.ts src/lib/tournament-winner.spec.ts`

- [ ] **Step 3: Implementieren**

`tournament-format.ts`, `statusLabel`:

```ts
    case "GROUP_STAGE":
      return format === "ROUND_ROBIN" ? "läuft" : format === "CLUB_DUEL" ? "Qualifikation" : "Gruppenphase";
    case "KNOCKOUT":
      return format === "CLUB_DUEL" ? "Final" : "K.-o.-Runde";
```

`tournament-winner.ts`: `WinnerSource` um optionale Felder erweitern und als erstes prüfen:

```ts
interface WinnerSource {
  readonly tournament: { readonly status: string };
  readonly bracket: readonly { readonly round: number; readonly status: string; readonly winnerDisplayName: string | null }[];
  readonly groups: readonly { readonly rows: readonly { readonly position: number; readonly displayName: string }[] }[];
  readonly participants?: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly clubDuel?: { readonly finals: { readonly final: { readonly status: string; readonly winnerPlayerId: string | null } | null } } | null;
}

export function tournamentWinner(source: WinnerSource): string | null {
  if (source.tournament.status !== "COMPLETED") return null;
  const final = source.clubDuel?.finals.final;
  if (final !== undefined && final !== null) {
    if (final.status !== "COMPLETED" || final.winnerPlayerId === null) return null;
    return source.participants?.find((participant) => participant.playerId === final.winnerPlayerId)?.displayName ?? null;
  }
  // bestehender Rumpf unverändert
```

`club-duel-view.ts`:

```ts
import { clubAbbreviation } from "@darts-platform/domain";
import type { ClubDuelDashboard } from "@darts-platform/schemas";
import type { StateTone } from "@darts-platform/ui";

/** Reine Darstellung. Nichts hier entscheidet etwas – alles kommt aus dem Dashboard. */
export type ClubSide = "A" | "B";
type RoundMatchStatus = ClubDuelDashboard["rounds"][number]["matches"][number]["status"];

export function participantNames(participants: readonly { readonly playerId: string; readonly displayName: string }[]): ReadonlyMap<string, string> {
  return new Map(participants.map((participant) => [participant.playerId, participant.displayName]));
}

export function sideLabel(settings: Pick<ClubDuelDashboard, "sideAName" | "sideBName">, side: ClubSide): { readonly name: string; readonly short: string } {
  const name = side === "A" ? settings.sideAName : settings.sideBName;
  return { name, short: clubAbbreviation(name) };
}

export function scoreLine(input: Pick<ClubDuelDashboard, "sideAName" | "sideBName" | "score">): string {
  return `${input.sideAName} ${input.score.pointsA} : ${input.score.pointsB} ${input.sideBName}`;
}

export function legsLabel(legs: readonly [number, number] | null): string {
  return legs === null ? "–" : `${legs[0]}:${legs[1]}`;
}

export function roundMatchStateLabel(status: RoundMatchStatus): { readonly tone: StateTone; readonly label: string } {
  switch (status) {
    case "WAITING": return { tone: "waiting", label: "offen" };
    case "READY": return { tone: "free", label: "bereit" };
    case "IN_PROGRESS": return { tone: "live", label: "läuft" };
    case "COMPLETED": return { tone: "finish", label: "gespielt" };
    case "BYE": return { tone: "finish", label: "Freilos" };
    case "CANCELLED": return { tone: "blocked", label: "abgesagt" };
  }
}
```

Prüfen, ob `StateTone` aus `@darts-platform/ui` exportiert ist (`packages/ui/src/index.ts`); sonst dort `type StateTone` exportieren.

`side-names.ts`:

```ts
import type { MatchStateResponse } from "@darts-platform/schemas";

type Participant = MatchStateResponse["participants"][number];

/** Eine Seite kann zwei Personen tragen; ihr Name ist beider Name. */
export function sideNames(participant: Participant): string {
  return participant.players.map((person) => person.displayName).join(" und ");
}

/** Im Vereinsduell mit Vereinskürzel: «Anna Muster (VFC)». */
export function sideNamesWithClub(participant: Participant): string {
  return participant.players
    .map((person) => (person.clubLabel === null ? person.displayName : `${person.displayName} (${person.clubLabel})`))
    .join(" und ");
}
```

`api-client.ts`, `messages` ergänzen:

```ts
    CLUB_DUEL_ROUND_ALREADY_PAIRED: "Die nächste Runde ist bereits gepaart. Dieses Resultat lässt sich nicht mehr korrigieren.",
    CLUB_DUEL_SIDE_TOO_SMALL: "Jeder Verein braucht mindestens so viele Spieler, wie die Finalrunde Plätze hat.",
    INVALID_CLUB_DUEL_ROUNDS: "Die Qualifikation braucht 1 bis 15 Runden.",
    PLAYER_IS_GUEST: "Ein Gastspieler kann nicht mit einem Konto verknüpft werden.",
```

- [ ] **Step 4: Tests, Typecheck, Commit**

```bash
cd apps/web && npx vitest run src/lib && cd ../..
pnpm --filter @darts-platform/web typecheck
git add apps/web/src/lib packages/ui/src/index.ts
git commit -m "feat(web): Anzeige-Helfer fuer das Vereinsduell"
```

---

### Task 3: Gastspieler-Schnellerfassung

**Files:**
- Create: `apps/web/src/components/players/guest-players-panel.tsx`, `guest-players-panel.render.spec.tsx`

**Interfaces (Produces):**
```ts
export function GuestPlayersPanel(props: {
  readonly organizationId: string;
  readonly clubName: string;            // vorbelegt aus dem Gastverein-Feld, hier änderbar
  readonly onCreated: (players: readonly PlayerResponse[]) => void;
}): JSX.Element
```
Verhalten: Textfeld «Gastspieler (ein Name pro Zeile)» (`<textarea id="guest-names">`), Feld «Verein der Gäste» (`id="guest-club"`), Button «Gastspieler erfassen». Leere Zeilen werden verworfen, Namen getrimmt, Duplikate (gross/klein) im Formular als Fehler gezeigt («Jeder Name darf nur einmal vorkommen.»). `commandId` wird beim ersten Absenden erzeugt und bis zum Erfolg wiederverwendet (Idempotenz bei Wiederholung nach Netzfehler); nach Erfolg neue `commandId`, Textfeld geleert, `queryClient.invalidateQueries({ queryKey: ["players", organizationId] })` (trifft auch `["players", organizationId, "ALL"]`), `onCreated(players)`. Fehler sichtbar unter dem Formular (`role="alert"`). Erfolg per `role="status"`: «3 Gastspieler erfasst.»

- [ ] **Step 1: Failing Render-Test**

```tsx
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/environment", () => ({ publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" } }));
const client = vi.hoisted(() => ({ apiRequest: vi.fn(), userFacingErrorMessage: vi.fn((error: unknown) => String(error)) }));
vi.mock("@/lib/api-client", () => client);

import { GuestPlayersPanel } from "./guest-players-panel";

const organizationId = "00000000-0000-4000-8000-000000000001";
const guest = (id: string, displayName: string) => ({
  id, organizationId, publicId: id, firstName: null, lastName: null, displayName, nickname: null, email: null,
  externalReference: null, status: "ACTIVE", kind: "GUEST", guestClubName: "DC Musterdorf", hasAccount: false,
  avatarChecksum: null, createdAt: new Date(), updatedAt: new Date(),
});

function renderPanel(onCreated = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(createElement(QueryClientProvider, { client: queryClient }, createElement(GuestPlayersPanel, { organizationId, clubName: "DC Musterdorf", onCreated })));
  return { onCreated, queryClient };
}

afterEach(() => { cleanup(); client.apiRequest.mockReset(); });

describe("GuestPlayersPanel", () => {
  it("schickt getrimmte Namen mit derselben commandId und meldet den Erfolg", async () => {
    const created = [guest("00000000-0000-4000-8000-000000000010", "Anna Muster"), guest("00000000-0000-4000-8000-000000000011", "Beat Beispiel")];
    client.apiRequest.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(created);
    const { onCreated } = renderPanel();
    fireEvent.change(screen.getByLabelText("Gastspieler (ein Name pro Zeile)"), { target: { value: " Anna Muster \n\nBeat Beispiel" } });
    fireEvent.click(screen.getByRole("button", { name: "Gastspieler erfassen" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Gastspieler erfassen" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    const [first, second] = client.apiRequest.mock.calls.map((call) => call[0] as { path: string; body: { commandId: string; clubName: string; names: string[] } });
    expect(first?.path).toBe(`/organizations/${organizationId}/players/guests`);
    expect(first?.body.names).toEqual(["Anna Muster", "Beat Beispiel"]);
    expect(first?.body.clubName).toBe("DC Musterdorf");
    expect(second?.body.commandId).toBe(first?.body.commandId);
    expect(screen.getByRole("status")).toHaveTextContent("2 Gastspieler erfasst.");
  });

  it("weist doppelte Namen vor dem Senden ab", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Gastspieler (ein Name pro Zeile)"), { target: { value: "Anna\nanna" } });
    fireEvent.click(screen.getByRole("button", { name: "Gastspieler erfassen" }));
    expect(screen.getByText("Jeder Name darf nur einmal vorkommen.")).toBeTruthy();
    expect(client.apiRequest).not.toHaveBeenCalled();
  });
});
```

`PlayerResponse`-Felder gegen `packages/schemas/src/player.ts` prüfen und das Fixture anpassen.

- [ ] **Step 2: Ausführen – scheitern**

- [ ] **Step 3: Implementieren**

```tsx
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createGuestPlayersSchema, playerListSchema, type PlayerResponse } from "@darts-platform/schemas";
import { Control, Field, Rule, SheetLabel, TextInput, Wedge } from "@darts-platform/ui";
import { useRef, useState } from "react";

import { apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { generateId } from "@/lib/id";

const DUPLICATE_MESSAGE = "Jeder Name darf nur einmal vorkommen.";

/**
 * Gastspieler eines anderen Vereins in einem Schritt erfassen (Spec
 * Vereinsduell). Die commandId bleibt bis zum Erfolg dieselbe: eine
 * Wiederholung nach einem Netzfehler legt keine Dubletten an.
 */
export function GuestPlayersPanel({ organizationId, clubName, onCreated }: {
  readonly organizationId: string;
  readonly clubName: string;
  readonly onCreated: (players: readonly PlayerResponse[]) => void;
}) {
  const queryClient = useQueryClient();
  const [club, setClub] = useState(clubName);
  const [namesText, setNamesText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const commandId = useRef(generateId());

  const mutation = useMutation({
    mutationFn: (body: { commandId: string; clubName: string; names: string[] }) => apiRequest({
      path: `/organizations/${organizationId}/players/guests`,
      method: "POST",
      body,
      schema: playerListSchema,
    }),
    onSuccess: (players) => {
      commandId.current = generateId();
      setNamesText("");
      setNotice(`${players.length} Gastspieler erfasst.`);
      void queryClient.invalidateQueries({ queryKey: ["players", organizationId] });
      onCreated(players);
    },
  });

  function submit() {
    const names = namesText.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0);
    const candidate = { commandId: commandId.current, clubName: club, names };
    const parsed = createGuestPlayersSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setFormError(issue?.path[0] === "names" && names.length > 0 ? DUPLICATE_MESSAGE : (issue?.message ?? "Eingaben prüfen."));
      return;
    }
    setFormError(null);
    setNotice(null);
    mutation.mutate(parsed.data);
  }

  return (
    <Wedge className="p-4" tone="plate">
      <SheetLabel as="h3">Gastspieler erfassen</SheetLabel>
      <Rule className="mt-2" tone="faint" />
      <div className="mt-3 grid gap-3">
        <Field htmlFor="guest-club" label="Verein der Gäste">
          <TextInput id="guest-club" onChange={(event) => setClub(event.target.value)} value={club} />
        </Field>
        <Field error={formError} hint="Leere Zeilen werden übersprungen." htmlFor="guest-names" label="Gastspieler (ein Name pro Zeile)">
          <textarea
            aria-describedby={formError ? "guest-names-error" : "guest-names-hint"}
            className="min-h-32 w-full border border-sisal-400 bg-sisal-100 p-3 font-plate text-body text-wedge-900"
            id="guest-names"
            onChange={(event) => setNamesText(event.target.value)}
            value={namesText}
          />
        </Field>
        <Control disabled={mutation.isPending} onClick={submit} type="button" variant="plate">
          Gastspieler erfassen
        </Control>
        {mutation.error ? <p className="font-plate text-caption text-ring-red-deep" role="alert">{userFacingErrorMessage(mutation.error)}</p> : null}
        <p aria-live="polite" className="font-plate text-caption text-sisal-500" role="status">{notice ?? ""}</p>
      </div>
    </Wedge>
  );
}
```

Die `textarea`-Klassen an `TextInput` in `packages/ui/src/sektorenring/field.tsx` angleichen (dieselben Klassen übernehmen). Der Zod-Fehlerpfad bei Duplikaten ist `["names"]` (Refine in `createGuestPlayersSchema`); bei leerer Liste greift `min(1)` – dann Meldung «Mindestens einen Namen eingeben.» statt des Zod-Textes: `names.length === 0 ? "Mindestens einen Namen eingeben." : DUPLICATE_MESSAGE`.

- [ ] **Step 4: Tests, Commit**

```bash
cd apps/web && npx vitest run src/components/players/guest-players-panel.render.spec.tsx && cd ../..
pnpm --filter @darts-platform/web typecheck
git add apps/web/src/components/players
git commit -m "feat(web): Gastspieler eines anderen Vereins erfassen"
```

---

### Task 4: Vereinsduell anlegen (Format-Zweig im SetupSheet)

**Files:**
- Create: `apps/web/src/components/tournament/club-duel-setup-values.ts`, `club-duel-setup-values.spec.ts`
- Create: `apps/web/src/components/tournament/club-duel-setup.tsx`
- Modify: `apps/web/src/components/tournament/setup-sheet.tsx` (Formularwerte, Format-Option, Zweig, Submit, Vorschau, Schritte)
- Modify: `apps/web/src/components/tournament/tournament-setup-route.tsx` (Spieler mit `?kind=ALL`)
- Modify: `apps/web/src/components/tournament/setup-sheet.render.spec.tsx`

**Interfaces:**
- Consumes: `GuestPlayersPanel` (Task 3), `createClubDuelTournamentSchema`, `clubDuelPreviewInputSchema`, `clubDuelPreviewSchema`, `type ClubDuelPreviewResponse`, `type CreateClubDuelTournamentInput`, `type PlayerResponse` (`kind`, `guestClubName`).
- Produces:
  - `SetupFormValues` erhält `sideAName: string; sideBName: string; qualifyingRounds: string; finalRoundSize: string; thirdPlaceMatch: boolean; sideAIds: string[]; sideBIds: string[]`.
  - `buildClubDuelCandidate(values: SetupFormValues): unknown` (pur) – baut den Körper für `createClubDuelTournamentSchema.safeParse`.
  - `club-duel-setup.tsx` exportiert `ClubSidesSection`, `ClubParticipantsSection`, `ClubModeSection`, `ClubDuelPreviewCard` (Props unten).
  - Formular-Labels (E2E verlässt sich darauf): Format-Option `<option value="CLUB_DUEL">Vereinsduell</option>`, Felder «Eigener Verein», «Gastverein», «Quali-Runden», «Finalrunde (Spieler je Verein)», Checkbox «Spiel um Platz 3», Spalten-Überschriften «Spieler {sideAName}» / «Spieler {sideBName}», Checkbox-Labels = Anzeigename.

- [ ] **Step 1: Failing Test für den Kandidaten-Builder**

`club-duel-setup-values.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createClubDuelTournamentSchema } from "@darts-platform/schemas";

import { buildClubDuelCandidate } from "./club-duel-setup-values";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("buildClubDuelCandidate", () => {
  it("baut aus Formularwerten einen gültigen Vereinsduell-Körper", () => {
    const candidate = buildClubDuelCandidate({
      name: "Duell", startsAt: "2026-10-10", format: "CLUB_DUEL", startingScore: "501", inRule: "STRAIGHT", outRule: "DOUBLE",
      mode: "MATCHPLAY", bestOfLegs: "3", bestOfSets: "3", participantIds: [], groupCount: "1", qualifyPerGroup: "1", knockoutSize: "2", seeding: "SEEDED",
      boardIds: [id(90)], sideAName: " VFC ", sideBName: "DC Musterdorf", qualifyingRounds: "4", finalRoundSize: "2", thirdPlaceMatch: true,
      sideAIds: [id(1), id(2)], sideBIds: [id(3), id(4)],
    });
    const parsed = createClubDuelTournamentSchema.safeParse(candidate);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.participants).toEqual([
      { playerId: id(1), side: "A" }, { playerId: id(2), side: "A" }, { playerId: id(3), side: "B" }, { playerId: id(4), side: "B" },
    ]);
    expect(parsed.data.sideAName).toBe("VFC");
    expect(parsed.data.bestOfSets).toBe(1);
    expect(parsed.data.thirdPlaceMatch).toBe(true);
  });
});
```

- [ ] **Step 2: Ausführen – scheitern**

- [ ] **Step 3: Builder**

In `setup-sheet.tsx` das Interface `SetupFormValues` **exportieren** und erweitern (siehe Interfaces). `club-duel-setup-values.ts`:

```ts
import type { SetupFormValues } from "./setup-sheet";

/** Formularwerte → API-Körper; die Zod-Prüfung macht `createClubDuelTournamentSchema` beim Absenden. */
export function buildClubDuelCandidate(values: SetupFormValues): unknown {
  return {
    name: values.name,
    startsAt: new Date(`${values.startsAt}T18:00:00.000Z`),
    format: "CLUB_DUEL",
    startingScore: Number(values.startingScore),
    inRule: values.inRule,
    outRule: values.outRule,
    maxRounds: null,
    bestOfLegs: Number(values.bestOfLegs),
    bestOfSets: values.mode === "MATCHPLAY" ? 1 : Number(values.bestOfSets),
    boardIds: [...values.boardIds],
    sideAName: values.sideAName,
    sideBName: values.sideBName,
    qualifyingRounds: Number(values.qualifyingRounds),
    finalRoundSize: Number(values.finalRoundSize),
    thirdPlaceMatch: values.thirdPlaceMatch,
    participants: [
      ...values.sideAIds.map((playerId) => ({ playerId, side: "A" as const })),
      ...values.sideBIds.map((playerId) => ({ playerId, side: "B" as const })),
    ],
  };
}
```

Zirkulärer Typ-Import (`setup-sheet.tsx` ↔ `club-duel-setup-values.ts`) ist nur ein `import type` und damit zulässig; alternativ `SetupFormValues` in eine eigene Datei `setup-form-values.ts` ziehen – dann dort hin.

- [ ] **Step 4: Abschnitte (`club-duel-setup.tsx`)**

```tsx
"use client";

import type { ClubDuelPreviewResponse, PlayerResponse } from "@darts-platform/schemas";
import { Control, Field, Rule, SelectInput, SheetLabel, StateTag, TextInput, Wedge } from "@darts-platform/ui";
import type { ReactNode } from "react";
import type { UseFormRegister } from "react-hook-form";

import { GuestPlayersPanel } from "@/components/players/guest-players-panel";
import type { SetupFormValues } from "./setup-sheet";

type Errors = Record<string, string>;

export function ClubSidesSection({ errors, register }: { readonly errors: Errors; readonly register: UseFormRegister<SetupFormValues> }) {
  return (
    <section aria-labelledby="setup-clubs" className="flex flex-col gap-4">
      <SheetLabel as="h2" id="setup-clubs">2 · Vereine</SheetLabel>
      <Rule />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field error={errors.sideAName ?? null} htmlFor="sideAName" label="Eigener Verein">
          <TextInput id="sideAName" {...register("sideAName")} />
        </Field>
        <Field error={errors.sideBName ?? null} htmlFor="sideBName" label="Gastverein">
          <TextInput id="sideBName" {...register("sideBName")} />
        </Field>
      </div>
    </section>
  );
}

/**
 * Zwei Spalten A | B; auf dem Telefon untereinander. Links die Mitglieder,
 * rechts die Gäste – zuerst die des eingetragenen Gastvereins, die übrigen
 * ausklappbar. Neue Gäste landen sofort in der Auswahl.
 */
export function ClubParticipantsSection({ error, members, guests, organizationId, sideAName, sideBName, sideAIds, sideBIds, onToggle, onGuestsCreated }: {
  readonly error: string | null;
  readonly members: readonly PlayerResponse[];
  readonly guests: readonly PlayerResponse[];
  readonly organizationId: string;
  readonly sideAName: string;
  readonly sideBName: string;
  readonly sideAIds: readonly string[];
  readonly sideBIds: readonly string[];
  readonly onToggle: (side: "A" | "B", playerId: string) => void;
  readonly onGuestsCreated: (players: readonly PlayerResponse[]) => void;
}) {
  const sameClub = guests.filter((guest) => (guest.guestClubName ?? "").trim().toLowerCase() === sideBName.trim().toLowerCase());
  const otherGuests = guests.filter((guest) => !sameClub.includes(guest));
  return (
    <section aria-labelledby="setup-club-participants" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <SheetLabel as="h2" id="setup-club-participants">3 · Spieler</SheetLabel>
        <span className="font-numerals text-counter font-bold tabular text-sisal-500">{sideAIds.length} : {sideBIds.length}</span>
      </div>
      <Rule />
      {error !== null ? <p className="font-plate text-caption text-ring-red-deep" id="participants-error" role="alert">{error}</p> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <PlayerColumn heading={`Spieler ${sideAName || "Verein A"}`} players={members} selected={sideAIds} onToggle={(id) => onToggle("A", id)} />
        <div className="flex flex-col gap-4">
          <PlayerColumn heading={`Spieler ${sideBName || "Gastverein"}`} players={sameClub} selected={sideBIds} onToggle={(id) => onToggle("B", id)} />
          {otherGuests.length > 0 ? (
            <details>
              <summary className="cursor-pointer font-plate text-caption text-sisal-500">Weitere Gastspieler ({otherGuests.length})</summary>
              <PlayerColumn heading="Andere Vereine" players={otherGuests} selected={sideBIds} onToggle={(id) => onToggle("B", id)} />
            </details>
          ) : null}
          <GuestPlayersPanel clubName={sideBName} onCreated={onGuestsCreated} organizationId={organizationId} />
        </div>
      </div>
    </section>
  );
}

function PlayerColumn({ heading, players, selected, onToggle }: {
  readonly heading: string;
  readonly players: readonly PlayerResponse[];
  readonly selected: readonly string[];
  readonly onToggle: (playerId: string) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="font-plate text-label font-semibold uppercase tracking-[0.14em] text-sisal-500">{heading}</legend>
      {players.length === 0 ? <p className="mt-2 font-plate text-caption text-sisal-500">Noch keine Spieler.</p> : null}
      <ul className="mt-2 flex flex-col gap-1">
        {players.map((player) => (
          <li key={player.id}>
            <label className="flex min-h-11 items-center gap-3 font-plate text-body text-wedge-900">
              <input checked={selected.includes(player.id)} className="h-5 w-5" onChange={() => onToggle(player.id)} type="checkbox" />
              <span className="truncate">{player.displayName}</span>
              {player.kind === "GUEST" && player.guestClubName !== null ? <span className="ml-auto truncate font-plate text-caption text-sisal-500">{player.guestClubName}</span> : null}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

export function ClubModeSection({ errors, register, finalRoundMax }: { readonly errors: Errors; readonly register: UseFormRegister<SetupFormValues>; readonly finalRoundMax: number }) {
  return (
    <section aria-labelledby="setup-club-mode" className="flex flex-col gap-4">
      <SheetLabel as="h2" id="setup-club-mode">4 · Modus</SheetLabel>
      <Rule />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field error={errors.qualifyingRounds ?? null} htmlFor="qualifyingRounds" label="Quali-Runden">
          <SelectInput id="qualifyingRounds" {...register("qualifyingRounds")}>
            {Array.from({ length: 15 }, (_, index) => index + 1).map((count) => <option key={count} value={String(count)}>{count}</option>)}
          </SelectInput>
        </Field>
        <Field error={errors.finalRoundSize ?? null} hint={`Höchstens ${finalRoundMax} (kleinerer Verein).`} htmlFor="finalRoundSize" label="Finalrunde (Spieler je Verein)">
          <SelectInput id="finalRoundSize" {...register("finalRoundSize")}>
            {[2, 3, 4, 5, 6].map((count) => <option key={count} value={String(count)}>{count}</option>)}
          </SelectInput>
        </Field>
        <label className="flex min-h-11 items-center gap-3 self-end font-plate text-body text-wedge-900" htmlFor="thirdPlaceMatch">
          <input className="h-5 w-5" id="thirdPlaceMatch" type="checkbox" {...register("thirdPlaceMatch")} />
          Spiel um Platz 3
        </label>
      </div>
    </section>
  );
}

export function ClubDuelPreviewCard({ preview, sideAName, sideBName, error }: {
  readonly preview: ClubDuelPreviewResponse | null;
  readonly sideAName: string;
  readonly sideBName: string;
  readonly error: string | null;
}) {
  const row = (label: string, value: ReactNode) => (
    <div key={label}>
      <dt className="font-plate text-label font-semibold uppercase tracking-[0.14em] text-sisal-500">{label}</dt>
      <dd className="font-numerals text-title font-bold tabular text-wedge-900">{value}</dd>
    </div>
  );
  const perPlayer = (range: { min: number; max: number }) => (range.min === range.max ? String(range.min) : `${range.min}–${range.max}`);
  return (
    <Wedge className="p-5" tone="plate">
      <SheetLabel as="h2">Vorschau Vereinsduell</SheetLabel>
      <Rule className="mt-2" tone="faint" />
      {preview === null ? (
        <p className="mt-3 font-plate text-caption text-sisal-500">{error ?? "Wähle auf beiden Seiten mindestens so viele Spieler, wie die Finalrunde Plätze hat."}</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            {row("Quali-Spiele", preview.qualifyingMatches)}
            {row("Finalrunde", preview.finalRoundMatches)}
            {row(`Spiele/Person ${sideAName || "A"}`, perPlayer(preview.matchesPerPlayer.sideA))}
            {row(`Spiele/Person ${sideBName || "B"}`, perPlayer(preview.matchesPerPlayer.sideB))}
          </dl>
          <Rule className="mt-4" tone="faint" />
          <p className="mt-3 flex items-baseline justify-between gap-3">
            <span className="font-plate text-body font-semibold text-wedge-900">Spiele insgesamt</span>
            <span className="font-numerals text-data font-bold tabular text-wedge-900">{preview.totalMatches}</span>
          </p>
          <p className="mt-2 font-plate text-caption text-sisal-500">ca. {Math.round(preview.estimatedMinutes / 60 * 10) / 10} Std.</p>
          {preview.warnings.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-2">
              {preview.warnings.map((warning) => <li className="flex flex-col gap-1" key={warning}><StateTag label="prüfen" tone="blocked" /><span className="font-plate text-caption text-wedge-900">{warning}</span></li>)}
            </ul>
          ) : <p className="mt-4"><StateTag label="Plan geht auf" tone="free" /></p>}
        </>
      )}
    </Wedge>
  );
}
```

`Control` nur importieren, wenn genutzt (sonst Lint-Fehler) – oben entfernen.

- [ ] **Step 5: `SetupSheet` verzweigen**

In `setup-sheet.tsx`:
1. `defaultValues` ergänzen: `sideAName: ""`, `sideBName: ""`, `qualifyingRounds: "4"`, `finalRoundSize: "4"`, `thirdPlaceMatch: true`, `sideAIds: []`, `sideBIds: []`. Neue Prop `organizationName?: string` zum Vorbelegen von `sideAName` (Route reicht `organization.name`).
2. `MESSAGES` ergänzen: `sideAName: "Trage den Namen des eigenen Vereins ein."`, `sideBName: "Trage den Namen des Gastvereins ein."`, `qualifyingRounds: "Die Qualifikation braucht 1 bis 15 Runden."`, `finalRoundSize: "Jeder Verein braucht mindestens so viele Spieler, wie die Finalrunde Plätze hat."`, `participants: "Jeder Verein braucht mindestens so viele Spieler, wie die Finalrunde Plätze hat."`.
3. Format-Select: `<option value="CLUB_DUEL">Vereinsduell</option>` ergänzen. `const clubDuel = values.format === "CLUB_DUEL";`
4. Spieler trennen: `const members = players.filter((p) => p.kind === "MEMBER"); const guests = players.filter((p) => p.kind === "GUEST");` – der **klassische** Zweig bekommt nur `members` (Default `participantIds` ebenfalls aus `members`).
5. Abschnitte: bei `clubDuel` statt «2 · Teilnehmer» und «3 · Struktur» die drei neuen Abschnitte rendern, «Boards» wird «5 · Boards»; `RingSteps` bei clubDuel `["Turnier","Vereine","Spieler","Modus","Boards"]` mit Zuständen: Vereine done wenn beide Namen gefüllt; Spieler done wenn `min(sideAIds, sideBIds) >= finalRoundSize`; Modus done wenn Vorschau ohne Warnungen.
6. Toggle: `onToggle(side, id)` entfernt die ID aus der anderen Seite und schaltet sie auf der gewählten um (`setValue("sideAIds"/"sideBIds", …, { shouldDirty: true })`). `onGuestsCreated(players)` fügt alle neuen IDs zu `sideBIds` hinzu.
7. Vorschau: zweite Query, nur bei clubDuel aktiv:

```ts
  const sideACount = values.sideAIds?.length ?? 0;
  const sideBCount = values.sideBIds?.length ?? 0;
  const clubPreviewQuery = useQuery({
    queryKey: ["club-duel-preview", organizationId, sideACount, sideBCount, values.qualifyingRounds, values.finalRoundSize, values.thirdPlaceMatch, boardCount, values.bestOfLegs],
    queryFn: ({ signal }) => apiRequest({
      path: `/organizations/${organizationId}/tournaments/club-duel-preview`,
      method: "POST",
      body: {
        sideACount, sideBCount,
        qualifyingRounds: Number(values.qualifyingRounds) || 1,
        finalRoundSize: Number(values.finalRoundSize) || 2,
        thirdPlaceMatch: values.thirdPlaceMatch ?? true,
        boardCount: Math.max(boardCount, 1),
        bestOfLegs: Number(values.bestOfLegs) || 1,
      },
      schema: clubDuelPreviewSchema,
      signal,
    }),
    enabled: clubDuel && Math.min(sideACount, sideBCount) >= (Number(values.finalRoundSize) || 2),
  });
```

   Die klassische `previewQuery` bekommt `enabled: !clubDuel && participantCount >= 2`. In der Seitenspalte bei clubDuel `<ClubDuelPreviewCard error={clubPreviewQuery.error ? userFacingErrorMessage(clubPreviewQuery.error) : null} preview={clubPreviewQuery.data ?? null} sideAName sideBName />` statt der klassischen Karte.
8. Submit: `const candidate = clubDuel ? buildClubDuelCandidate(formValues) : { …bisher… }; const parsed = clubDuel ? createClubDuelTournamentSchema.safeParse(candidate) : createClassicTournamentSchema.safeParse(candidate);` – `createMutation.mutationFn` nimmt `CreateTournamentInput` (Union). Fehlerpfad `participants` → Meldung `MESSAGES.participants`, Scroll zu `participants-error`.
9. `revealInvalidField`: `participants` wie `participantIds` behandeln (kein `setFocus`).

`tournament-setup-route.tsx`: `queryKey: ["players", organization?.id, "ALL"]`, Pfad `…/players?kind=ALL`; `organizationName={organization.name}` an `SetupSheet`. Prüfen, ob `organization.name` im Typ von `useTournamentOrganization` vorhanden ist (sonst `slug`/Name aus `organizationSummarySchema`).

- [ ] **Step 6: Render-Test ergänzen**

In `setup-sheet.render.spec.tsx` einen Fall: Format `CLUB_DUEL` wählen → Felder «Eigener Verein», «Gastverein», «Quali-Runden» sichtbar, Spalte «Spieler Gastverein» zeigt nur Gäste, «Turnier starten» ohne Vereinsnamen zeigt «Trage den Namen des eigenen Vereins ein.»; mit zwei Mitgliedern A, zwei Gästen B, `finalRoundSize` 2 und gemocktem `apiRequest` (Vorschau → `{ qualifyingMatches: 8, … }`, Create → Summary) wird `POST …/tournaments` mit `format: "CLUB_DUEL"` und vier `participants` aufgerufen. Fixtures für Spieler brauchen `kind`/`guestClubName`.

- [ ] **Step 7: Tests, Commit**

```bash
cd apps/web && npx vitest run src/components/tournament && cd ../..
pnpm --filter @darts-platform/web typecheck
git add apps/web/src/components/tournament
git commit -m "feat(web): Vereinsduell anlegen mit Vereinen, Spielerseiten und Vorschau"
```

---

### Task 5: Gemeinsame Vereinsduell-Anzeige (Banner, Tabs, Runden, Ranglisten, Finalrunde)

**Files:**
- Create: `apps/web/src/components/tournament/club-duel/club-score-banner.tsx`
- Create: `apps/web/src/components/tournament/club-duel/club-duel-tabs.tsx`
- Create: `apps/web/src/components/tournament/club-duel/club-rounds.tsx`
- Create: `apps/web/src/components/tournament/club-duel/club-standings.tsx`
- Create: `apps/web/src/components/tournament/club-duel/club-final-round.tsx`
- Create: `apps/web/src/components/tournament/club-duel/club-duel-panel.tsx`
- Create: `apps/web/src/components/tournament/club-duel/club-duel-panel.render.spec.tsx`

**Interfaces:**
- Consumes: Helfer aus Task 2; `ClubDuelDashboard`, Teilnehmer `{ playerId, displayName, status, side }`.
- Produces:
  - `ClubScoreBanner({ clubDuel, size?: "default" | "tv" })` – `<section aria-label="Vereinswertung">`, zeigt `scoreLine`, bei `leader !== "TIED"` den Zusatz «{Name} führt», bei `TIED` «Gleichstand», `legDifferenceA` als «Legs ±n». Zahlen `font-numerals`, `aria-live="polite"`.
  - `ClubDuelTabs({ tabs: readonly { id: string; label: string; panel: ReactNode }[]; initial?: string })` – `role="tablist"`/`role="tab"`/`role="tabpanel"`, `aria-selected`, Pfeiltasten links/rechts, Home/End; Tab-Buttons `min-h-11`.
  - `ClubRounds({ clubDuel, names })` – aktuelle Runde offen, frühere in `<details>`: je Runde eine Liste der Spiele «A-Name – B-Name · Legs · StateTag» und «Pausieren: …» (Namen der `pausedPlayerIds`).
  - `ClubStandings({ clubDuel })` – Umschalter Gesamt | {sideAName} | {sideBName} (Buttons `role="radio"` in `role="radiogroup"`, Muster wie `InputModeSwitch` in `scoreboard-settings-dialog.tsx`), `Table` mit Spalten Rang, Name, Verein (Kürzel + Titel = Name), Spiele, Siege, Quote (%), Legdiff./Spiel (eine Dezimale, Vorzeichen); Zeilen mit `qualified` über `Tr qualified` (nur in den Vereinsranglisten), `withdrawn` → Zusatz «· Ausgefallen».
  - `ClubFinalRound({ clubDuel, names })` – Kreuztabelle `<table>`: Zeilenköpfe `<th scope="row">` = A-Spieler (nach `rankA`), Spaltenköpfe `<th scope="col">` = B-Spieler (nach `rankB`), Zellen Legs oder StateTag; daneben Rangliste je Verein (`finalRound.sideA/sideB`: Rang, Name, Siege, Legdiff.); darunter «Final» und «Spiel um Platz 3» aus `finals` als Zeilen «A – B · Legs · StateTag», fehlender Platz → «offen».
  - `ClubDuelPanel({ clubDuel, participants, defaultTab? })` – setzt die drei Tabs zusammen («Runden», «Rangliste», «Finalrunde»). Default-Tab: `FINAL_ROUND`/`KNOCKOUT`/`COMPLETED` → «Finalrunde», sonst «Runden» (Aufrufer gibt den Turnierstatus als `defaultTab` vor).

- [ ] **Step 1: Failing Render-Test**

`club-duel-panel.render.spec.tsx` (Fixture: 2 gegen 2, Runde 1 gespielt, Runde 2 READY, Finalrunde WAITING):

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ClubDuelDashboard } from "@darts-platform/schemas";

import { ClubDuelPanel } from "./club-duel-panel";
import { ClubScoreBanner } from "./club-score-banner";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const participants = [
  { playerId: id(1), displayName: "Anna", status: "ACTIVE" as const, side: "A" as const },
  { playerId: id(2), displayName: "Aron", status: "ACTIVE" as const, side: "A" as const },
  { playerId: id(3), displayName: "Beat", status: "ACTIVE" as const, side: "B" as const },
  { playerId: id(4), displayName: "Bia", status: "WITHDRAWN" as const, side: "B" as const },
];
const row = (position: number, playerId: string, displayName: string, side: "A" | "B", won: number) => ({
  position, playerId, displayName, side, played: 1, won, lost: 1 - won, legsFor: won * 2, legsAgainst: (1 - won) * 2,
  winRate: won, legDifferencePerMatch: won === 1 ? 2 : -2, withdrawn: playerId === id(4), qualified: true,
});
const clubDuel: ClubDuelDashboard = {
  sideAName: "VFC", sideBName: "DC Musterdorf", qualifyingRounds: 2, finalRoundSize: 2, thirdPlaceMatch: true, currentRound: 2,
  rounds: [
    { round: 1, matchIds: [id(10), id(11)], pausedPlayerIds: [], matches: [
      { matchId: id(10), position: 1, playerAId: id(1), playerBId: id(3), status: "COMPLETED", resultType: "PLAYED", winnerPlayerId: id(1), legs: [2, 0] },
      { matchId: id(11), position: 2, playerAId: id(2), playerBId: id(4), status: "COMPLETED", resultType: "PLAYED", winnerPlayerId: id(4), legs: [1, 2] },
    ] },
    { round: 2, matchIds: [id(12), id(13)], pausedPlayerIds: [], matches: [
      { matchId: id(12), position: 1, playerAId: id(1), playerBId: id(4), status: "READY", resultType: null, winnerPlayerId: null, legs: null },
      { matchId: id(13), position: 2, playerAId: id(2), playerBId: id(3), status: "READY", resultType: null, winnerPlayerId: null, legs: null },
    ] },
  ],
  standings: {
    overall: [row(1, id(1), "Anna", "A", 1), row(2, id(4), "Bia", "B", 1), row(3, id(2), "Aron", "A", 0), row(4, id(3), "Beat", "B", 0)],
    sideA: [row(1, id(1), "Anna", "A", 1), row(2, id(2), "Aron", "A", 0)],
    sideB: [row(1, id(4), "Bia", "B", 1), row(2, id(3), "Beat", "B", 0)],
  },
  finalRound: { sideA: [], sideB: [], matches: [
    { matchId: id(20), round: 1, rankA: 1, rankB: 1, playerAId: null, playerBId: null, status: "WAITING", winnerPlayerId: null, legs: null },
    { matchId: id(21), round: 1, rankA: 2, rankB: 2, playerAId: null, playerBId: null, status: "WAITING", winnerPlayerId: null, legs: null },
    { matchId: id(22), round: 2, rankA: 1, rankB: 2, playerAId: null, playerBId: null, status: "WAITING", winnerPlayerId: null, legs: null },
    { matchId: id(23), round: 2, rankA: 2, rankB: 1, playerAId: null, playerBId: null, status: "WAITING", winnerPlayerId: null, legs: null },
  ] },
  finals: { final: { matchId: id(30), position: 1, playerAId: null, playerBId: null, status: "WAITING", resultType: null, winnerPlayerId: null, legs: null }, thirdPlace: null },
  score: { pointsA: 1, pointsB: 1, legDifferenceA: 1, leader: "A" },
};

afterEach(cleanup);

describe("ClubDuelPanel", () => {
  it("zeigt Runden mit Spielen, Legs und Status, frühere Runden aufklappbar", () => {
    render(createElement(ClubDuelPanel, { clubDuel, participants, defaultTab: "rounds" }));
    const panel = screen.getByRole("tabpanel", { name: "Runden" });
    expect(within(panel).getByRole("heading", { name: "Runde 2" })).toBeTruthy();
    expect(within(panel).getAllByText("bereit")).toHaveLength(2);
    const earlier = within(panel).getByText("Runde 1").closest("details");
    expect(earlier).not.toBeNull();
    expect(within(earlier as HTMLElement).getByText("2:0")).toBeTruthy();
  });

  it("schaltet die Rangliste zwischen Gesamt und Verein um und markiert Ausgefallene", () => {
    render(createElement(ClubDuelPanel, { clubDuel, participants, defaultTab: "standings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Rangliste" }));
    expect(screen.getAllByRole("row")).toHaveLength(5); // Kopf + 4
    fireEvent.click(screen.getByRole("radio", { name: "DC Musterdorf" }));
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText(/Bia/).closest("tr")?.textContent).toContain("Ausgefallen");
  });

  it("rendert die Finalrunde als Kreuztabelle mit Zeilen- und Spaltenköpfen", () => {
    render(createElement(ClubDuelPanel, { clubDuel, participants, defaultTab: "final" }));
    fireEvent.click(screen.getByRole("tab", { name: "Finalrunde" }));
    const table = screen.getByRole("table", { name: "Kreuztabelle" });
    expect(within(table).getAllByRole("rowheader")).toHaveLength(2);
    expect(within(table).getAllByRole("columnheader").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Final")).toBeTruthy();
  });

  it("Tabs sind per Pfeiltaste erreichbar", () => {
    render(createElement(ClubDuelPanel, { clubDuel, participants, defaultTab: "rounds" }));
    const first = screen.getByRole("tab", { name: "Runden" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Rangliste" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("ClubScoreBanner", () => {
  it("nennt Stand, Führung und Legdifferenz in Worten", () => {
    render(createElement(ClubScoreBanner, { clubDuel }));
    const banner = screen.getByRole("region", { name: "Vereinswertung" });
    expect(banner.textContent).toContain("VFC 1 : 1 DC Musterdorf");
    expect(banner.textContent).toContain("VFC führt");
    expect(banner.textContent).toContain("Legs +1");
  });
});
```

- [ ] **Step 2: Ausführen – scheitern**

- [ ] **Step 3: Implementieren**

`club-score-banner.tsx`:

```tsx
import type { ClubDuelDashboard } from "@darts-platform/schemas";
import { Rule, SheetLabel, Wedge } from "@darts-platform/ui";

import { scoreLine } from "@/lib/club-duel-view";

/** Vereinswertung – Zahlen, Führung und Legdifferenz immer in Worten (AGENTS.md §19). */
export function ClubScoreBanner({ clubDuel, size = "default" }: { readonly clubDuel: ClubDuelDashboard; readonly size?: "default" | "tv" }) {
  const { score } = clubDuel;
  const leader = score.leader === "TIED" ? "Gleichstand" : `${score.leader === "A" ? clubDuel.sideAName : clubDuel.sideBName} führt`;
  const legs = `Legs ${score.legDifferenceA > 0 ? "+" : ""}${score.legDifferenceA}`;
  return (
    <Wedge aria-label="Vereinswertung" aria-live="polite" as="section" className={size === "tv" ? "p-8" : "p-4"} tone="plate">
      <SheetLabel as="h2">Vereinswertung</SheetLabel>
      <Rule className="mt-2" tone="faint" />
      <p className={`mt-3 font-numerals font-bold tabular text-wedge-900 ${size === "tv" ? "text-display" : "text-title"}`}>{scoreLine(clubDuel)}</p>
      <p className="mt-1 font-plate text-body text-sisal-500">{leader} · {legs}</p>
    </Wedge>
  );
}
```

Prüfen, ob `Wedge` die Prop `as` unterstützt (ja, `WedgeProps` hat `as`); sonst ein `<section>` um das `Wedge` legen.

`club-duel-tabs.tsx`:

```tsx
"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface ClubDuelTab { readonly id: string; readonly label: string; readonly panel: ReactNode }

/** Zugängliche Tabs (WAI-ARIA Tabs Pattern): Pfeiltasten wechseln, Home/End springen. */
export function ClubDuelTabs({ tabs, initial }: { readonly tabs: readonly ClubDuelTab[]; readonly initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id ?? "");
  const baseId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[next];
    if (tab === undefined) return;
    setActive(tab.id);
    buttons.current[next]?.focus();
  }

  return (
    <div>
      <div aria-label="Ansicht" className="flex flex-wrap gap-2" role="tablist">
        {tabs.map((tab, index) => {
          const selected = tab.id === active;
          return (
            <button
              aria-controls={`${baseId}-${tab.id}-panel`}
              aria-selected={selected}
              className={`min-h-11 border px-4 font-plate text-body font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-green ${selected ? "border-ring-green bg-ring-green text-chalk" : "border-sisal-400 bg-sisal-100 text-spider hover:bg-wedge-900"}`}
              id={`${baseId}-${tab.id}-tab`}
              key={tab.id}
              onClick={() => setActive(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              ref={(element) => { buttons.current[index] = element; }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          aria-labelledby={`${baseId}-${tab.id}-tab`}
          className="mt-4"
          hidden={tab.id !== active}
          id={`${baseId}-${tab.id}-panel`}
          key={tab.id}
          role="tabpanel"
          tabIndex={0}
        >
          {tab.id === active ? tab.panel : null}
        </div>
      ))}
    </div>
  );
}
```

`club-rounds.tsx`:

```tsx
import type { ClubDuelDashboard } from "@darts-platform/schemas";
import { Rule, SheetLabel, StateTag } from "@darts-platform/ui";

import { legsLabel, roundMatchStateLabel } from "@/lib/club-duel-view";

type Round = ClubDuelDashboard["rounds"][number];

export function ClubRounds({ clubDuel, names }: { readonly clubDuel: ClubDuelDashboard; readonly names: ReadonlyMap<string, string> }) {
  const current = clubDuel.rounds.find((round) => round.round === clubDuel.currentRound) ?? null;
  const earlier = clubDuel.rounds.filter((round) => round.round !== clubDuel.currentRound).sort((left, right) => right.round - left.round);
  const name = (playerId: string | null) => (playerId === null ? "offen" : (names.get(playerId) ?? "Unbekannt"));
  const renderRound = (round: Round, heading: "h3" | "span") => (
    <div>
      {heading === "h3" ? <h3 className="font-numerals text-title-sm font-bold text-wedge-900">Runde {round.round}</h3> : null}
      <ul className="mt-2 flex flex-col">
        {round.matches.map((match) => {
          const state = roundMatchStateLabel(match.status);
          return (
            <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-sisal-300 py-2 font-plate text-body text-wedge-900" key={match.matchId}>
              <span className="min-w-0 flex-1 truncate">{name(match.playerAId)} – {name(match.playerBId)}</span>
              <span className="font-numerals tabular">{legsLabel(match.legs)}</span>
              <StateTag label={state.label} tone={state.tone} />
            </li>
          );
        })}
      </ul>
      {round.pausedPlayerIds.length > 0 ? (
        <p className="mt-2 font-plate text-caption text-sisal-500">Pausieren: {round.pausedPlayerIds.map((playerId) => names.get(playerId) ?? "Unbekannt").join(", ")}</p>
      ) : null}
    </div>
  );
  return (
    <div className="flex flex-col gap-6">
      {current !== null ? renderRound(current, "h3") : <p className="font-plate text-body text-sisal-500">Noch keine Runde gepaart.</p>}
      {earlier.length > 0 ? (
        <div>
          <SheetLabel as="h3">Frühere Runden</SheetLabel>
          <Rule className="mt-2" tone="faint" />
          {earlier.map((round) => (
            <details className="mt-2" key={round.round}>
              <summary className="min-h-11 cursor-pointer font-plate text-body font-semibold text-wedge-900">Runde {round.round}</summary>
              {renderRound(round, "span")}
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

`club-standings.tsx` – Umschalter nach dem Vorbild `InputModeSwitch` (`scoreboard-settings-dialog.tsx:37`, Klassen übernehmen), danach:

```tsx
import type { ClubDuelDashboard } from "@darts-platform/schemas";
import { Table, Td, Th, Tr } from "@darts-platform/ui";
import { useState } from "react";

import { sideLabel } from "@/lib/club-duel-view";

type View = "overall" | "sideA" | "sideB";

export function ClubStandings({ clubDuel }: { readonly clubDuel: ClubDuelDashboard }) {
  const [view, setView] = useState<View>("overall");
  const rows = clubDuel.standings[view];
  const options: readonly { readonly id: View; readonly label: string }[] = [
    { id: "overall", label: "Gesamt" }, { id: "sideA", label: clubDuel.sideAName }, { id: "sideB", label: clubDuel.sideBName },
  ];
  const percent = (rate: number) => `${Math.round(rate * 100)} %`;
  const diff = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
  return (
    <div className="flex flex-col gap-4">
      <div aria-label="Rangliste" className="flex flex-wrap gap-2" role="radiogroup">
        {options.map((option) => (
          <button aria-checked={view === option.id} className={/* Klassen wie InputModeSwitch */ ""} key={option.id} onClick={() => setView(option.id)} role="radio" type="button">{option.label}</button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <Table>
          <thead><tr><Th>Rang</Th><Th>Name</Th><Th>Verein</Th><Th className="text-right">Spiele</Th><Th className="text-right">Siege</Th><Th className="text-right">Quote</Th><Th className="text-right">Legdiff./Spiel</Th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const club = sideLabel(clubDuel, row.side);
              return (
                <Tr key={row.playerId} qualified={view !== "overall" && row.qualified && !row.withdrawn}>
                  <Td className="font-numerals">{row.position}</Td>
                  <Td>{row.displayName}{row.withdrawn ? <span className="text-sisal-500"> · Ausgefallen</span> : null}</Td>
                  <Td><abbr className="no-underline" title={club.name}>{club.short}</abbr></Td>
                  <Td className="text-right font-numerals">{row.played}</Td>
                  <Td className="text-right font-numerals">{row.won}</Td>
                  <Td className="text-right font-numerals">{percent(row.winRate)}</Td>
                  <Td className="text-right font-numerals">{diff(row.legDifferencePerMatch)}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
```

Pfeiltasten-Navigation des Radiogroups wie im Vorbild übernehmen. `club-final-round.tsx`:

```tsx
import type { ClubDuelDashboard } from "@darts-platform/schemas";
import { Rule, SheetLabel, StateTag, Table, Td, Th } from "@darts-platform/ui";

import { legsLabel, roundMatchStateLabel, sideLabel } from "@/lib/club-duel-view";

type FinalMatch = NonNullable<ClubDuelDashboard["finals"]["final"]>;

export function ClubFinalRound({ clubDuel, names }: { readonly clubDuel: ClubDuelDashboard; readonly names: ReadonlyMap<string, string> }) {
  const size = clubDuel.finalRoundSize;
  const ranks = Array.from({ length: size }, (_, index) => index + 1);
  const name = (playerId: string | null) => (playerId === null ? "offen" : (names.get(playerId) ?? "Unbekannt"));
  const playerAt = (side: "A" | "B", rank: number) => {
    const match = clubDuel.finalRound.matches.find((entry) => (side === "A" ? entry.rankA : entry.rankB) === rank);
    return match === undefined ? null : (side === "A" ? match.playerAId : match.playerBId);
  };
  const cell = (rankA: number, rankB: number) => {
    const match = clubDuel.finalRound.matches.find((entry) => entry.rankA === rankA && entry.rankB === rankB);
    if (match === undefined) return <Td>–</Td>;
    const state = roundMatchStateLabel(match.status);
    return (
      <Td className="text-center">
        {match.legs !== null ? <span className="font-numerals tabular">{legsLabel(match.legs)}</span> : <StateTag label={state.label} tone={state.tone} />}
      </Td>
    );
  };
  const finalLine = (label: string, match: FinalMatch | null) => {
    if (match === null) return null;
    const state = roundMatchStateLabel(match.status);
    return (
      <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-sisal-300 py-2 font-plate text-body text-wedge-900" key={label}>
        <span className="font-semibold">{label}</span>
        <span className="min-w-0 flex-1 truncate">{name(match.playerAId)} – {name(match.playerBId)}</span>
        <span className="font-numerals tabular">{legsLabel(match.legs)}</span>
        <StateTag label={state.label} tone={state.tone} />
      </li>
    );
  };
  const ranking = (side: "A" | "B") => {
    const rows = side === "A" ? clubDuel.finalRound.sideA : clubDuel.finalRound.sideB;
    return (
      <div>
        <SheetLabel as="h3">{sideLabel(clubDuel, side).name}</SheetLabel>
        <ol className="mt-2 flex flex-col">
          {rows.map((row) => <li className="flex justify-between gap-3 border-b border-sisal-300 py-1.5 font-plate text-body text-wedge-900" key={row.playerId}><span>{row.position}. {row.displayName}</span><span className="font-numerals tabular">{row.won} S · {row.legDifference > 0 ? "+" : ""}{row.legDifference}</span></li>)}
          {rows.length === 0 ? <li className="font-plate text-caption text-sisal-500">Noch offen.</li> : null}
        </ol>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="overflow-x-auto">
        <Table aria-label="Kreuztabelle">
          <thead>
            <tr>
              <Th>{sideLabel(clubDuel, "A").short} \ {sideLabel(clubDuel, "B").short}</Th>
              {ranks.map((rank) => <Th className="text-center" key={rank}>{name(playerAt("B", rank))}</Th>)}
            </tr>
          </thead>
          <tbody>
            {ranks.map((rankA) => (
              <tr key={rankA}>
                <Th scope="row">{name(playerAt("A", rankA))}</Th>
                {ranks.map((rankB) => <Fragment key={rankB}>{cell(rankA, rankB)}</Fragment>)}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">{ranking("A")}{ranking("B")}</div>
      <div>
        <SheetLabel as="h3">Final</SheetLabel>
        <Rule className="mt-2" tone="faint" />
        <ul className="mt-2 flex flex-col">
          {finalLine("Final", clubDuel.finals.final)}
          {finalLine("Spiel um Platz 3", clubDuel.finals.thirdPlace)}
        </ul>
      </div>
    </div>
  );
}
```

`Fragment` aus `react` importieren. `club-duel-panel.tsx`:

```tsx
"use client";

import type { ClubDuelDashboard } from "@darts-platform/schemas";

import { participantNames } from "@/lib/club-duel-view";
import { ClubDuelTabs } from "./club-duel-tabs";
import { ClubFinalRound } from "./club-final-round";
import { ClubRounds } from "./club-rounds";
import { ClubStandings } from "./club-standings";

export type ClubDuelTabId = "rounds" | "standings" | "final";

export function ClubDuelPanel({ clubDuel, participants, defaultTab = "rounds" }: {
  readonly clubDuel: ClubDuelDashboard;
  readonly participants: readonly { readonly playerId: string; readonly displayName: string }[];
  readonly defaultTab?: ClubDuelTabId;
}) {
  const names = participantNames(participants);
  return (
    <ClubDuelTabs
      initial={defaultTab}
      tabs={[
        { id: "rounds", label: "Runden", panel: <ClubRounds clubDuel={clubDuel} names={names} /> },
        { id: "standings", label: "Rangliste", panel: <ClubStandings clubDuel={clubDuel} /> },
        { id: "final", label: "Finalrunde", panel: <ClubFinalRound clubDuel={clubDuel} names={names} /> },
      ]}
    />
  );
}

/** Welcher Tab zum Turnierstatus passt – Aufrufer reichen das Ergebnis als `defaultTab`. */
export function clubDuelTabForStatus(status: string): ClubDuelTabId {
  return status === "FINAL_ROUND" || status === "KNOCKOUT" || status === "COMPLETED" ? "final" : "rounds";
}
```

- [ ] **Step 4: Tests, Commit**

```bash
cd apps/web && npx vitest run src/components/tournament/club-duel && cd ../..
pnpm --filter @darts-platform/web typecheck
git add apps/web/src/components/tournament/club-duel
git commit -m "feat(web): Vereinsduell-Anzeige mit Vereinswertung, Runden, Ranglisten und Finalrunde"
```

---

### Task 6: Kommandozentrale

**Files:**
- Modify: `apps/web/src/components/tournament/command-centre.tsx` (Render ab ~Zeile 625)
- Modify: `apps/web/src/components/tournament/dashboard-header.tsx` (Sieger über `tournamentWinner(dashboard)` – Signatur prüfen)
- Modify: `apps/web/src/components/tournament/dashboard-header.render.spec.tsx`

**Interfaces:** Consumes `ClubScoreBanner`, `ClubDuelPanel`, `clubDuelTabForStatus` (Task 5), `tournamentWinner` (Task 2).

- [ ] **Step 1: Failing Render-Test**

In `dashboard-header.render.spec.tsx`: Fixture mit `format: "CLUB_DUEL"`, `status: "COMPLETED"`, `participants` (zwei, mit `side`), `clubDuel` (Minimalobjekt wie in Task 5 mit `finals.final.status "COMPLETED"`, `winnerPlayerId` = Teilnehmer B) → Header zeigt «Turniersieg: {Name B}» und Zustand «beendet». Zweiter Fall `status: "GROUP_STAGE"` → Zustand «Qualifikation».

- [ ] **Step 2: Ausführen – scheitern**

- [ ] **Step 3: Implementieren**

`command-centre.tsx`:
- Unter `<DashboardHeader …/>`: `{dashboard.clubDuel !== null ? <div className="mt-5"><ClubScoreBanner clubDuel={dashboard.clubDuel} /></div> : null}`.
- `QueuePanel`: `queue={dashboard.tournament.format === "CLUB_DUEL" ? dashboard.queue.filter((entry) => entry.readiness !== "BLOCKED_PARTICIPANT_UNDECIDED") : dashboard.queue}` – die N²+2 Platzhalter der Finalrunde verstopfen sonst die Liste; der Server behält die Wahrheit.
- Statt `<StandingsSheet …/>` bei `CLUB_DUEL`:

```tsx
        <div className="mt-9">
          {dashboard.clubDuel !== null ? (
            <section aria-labelledby="club-duel-heading">
              <SheetLabel as="h2" id="club-duel-heading">Vereinsduell</SheetLabel>
              <Rule className="mt-2" />
              <div className="mt-4"><ClubDuelPanel clubDuel={dashboard.clubDuel} defaultTab={clubDuelTabForStatus(dashboard.tournament.status)} participants={dashboard.participants} /></div>
            </section>
          ) : <StandingsSheet format={dashboard.tournament.format} groups={dashboard.groups} />}
        </div>
```

`dashboard-header.tsx`: `tournamentWinner(dashboard)` erhält bereits das ganze Dashboard (prüfen) – damit greift Task 2 ohne Änderung; sonst `participants` und `clubDuel` mitgeben.

- [ ] **Step 4: Tests, Commit**

```bash
cd apps/web && npx vitest run src/components/tournament && cd ../..
pnpm --filter @darts-platform/web typecheck
git add apps/web/src/components/tournament
git commit -m "feat(web): Vereinsduell in der Kommandozentrale anzeigen"
```

---

### Task 7: Öffentliche Live-Ansicht und Beamer

**Files:**
- Modify: `apps/web/src/components/live/live-tournament.tsx` (Render ab ~Zeile 193)
- Modify: `apps/web/src/components/live/live-tournament.render.spec.tsx`

**Interfaces:** Consumes `ClubScoreBanner`, `ClubDuelPanel`, `clubDuelTabForStatus`, `participantNames`, `legsLabel`, `roundMatchStateLabel`.

- [ ] **Step 1: Failing Render-Test**

In `live-tournament.render.spec.tsx` zwei Fälle mit einer `CLUB_DUEL`-Fixture (publicDashboard mit `clubDuel` aus Task 5, `groups: []`, `bracket: []`):
- `mode: "publikum"`: Region «Vereinswertung» sichtbar, Tabs «Runden/Rangliste/Finalrunde» vorhanden, Überschrift «Vereinsduell».
- `mode: "tv"`: Region «Vereinswertung» mit `text-display`-Klasse, Abschnitt «Laufende Spiele» listet IN_PROGRESS-Spiele (Fixture: eines auf IN_PROGRESS setzen), Abschnitt «Nächste Spiele» listet READY-Spiele; keine Tabs.

- [ ] **Step 2: Ausführen – scheitern**

- [ ] **Step 3: Implementieren**

In `live-tournament.tsx` nach `bracketSection`:

```tsx
  const clubDuel = dashboard.clubDuel;
  const clubNames = clubDuel === null ? null : participantNames(dashboard.participants);
  const currentRound = clubDuel?.rounds.find((round) => round.round === clubDuel.currentRound) ?? null;
  const roundList = (matches: readonly NonNullable<typeof currentRound>["matches"][number][], empty: string) => (
    matches.length === 0 ? <p className="text-body text-sisal-500">{empty}</p> : (
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {matches.map((match) => {
          const state = roundMatchStateLabel(match.status);
          return (
            <li className="flex items-center justify-between gap-3 rounded-lg border border-sisal-400 bg-sisal-100 px-4 py-3 text-body" key={match.matchId}>
              <span className="truncate">{clubNames?.get(match.playerAId ?? "") ?? "offen"} – {clubNames?.get(match.playerBId ?? "") ?? "offen"}</span>
              <span className="shrink-0 font-numerals tabular">{legsLabel(match.legs)}</span>
              <StateTag label={state.label} on="ink" tone={state.tone} />
            </li>
          );
        })}
      </ul>
    )
  );
  const clubDuelSection = clubDuel === null ? null : mode === "tv" ? (
    <>
      <LiveSection title="Vereinswertung"><ClubScoreBanner clubDuel={clubDuel} size="tv" /></LiveSection>
      <LiveSection title="Laufende Spiele">{roundList(currentRound?.matches.filter((match) => match.status === "IN_PROGRESS") ?? [], "Kein Spiel läuft.")}</LiveSection>
      <LiveSection title="Nächste Spiele">{roundList(currentRound?.matches.filter((match) => match.status === "READY") ?? [], "Keine Spiele bereit.")}</LiveSection>
    </>
  ) : (
    <>
      <LiveSection title="Vereinswertung"><ClubScoreBanner clubDuel={clubDuel} /></LiveSection>
      <LiveSection title="Vereinsduell"><ClubDuelPanel clubDuel={clubDuel} defaultTab={clubDuelTabForStatus(dashboard.tournament.status)} participants={dashboard.participants} /></LiveSection>
    </>
  );
```

Im JSX bei `mode !== "board"`: `{clubDuelSection}` **vor** `groupsSection`/`bracketSection` einfügen (die beiden sind beim Vereinsduell leer). Im `mode === "tv"`-Zweig die Boards-Sektion wie bisher darüber lassen («Vereinswertung gross, darunter laufende Spiele und nächste Runde» – Boards bleiben als erstes, weil sie die Live-Scores tragen; die Vereinswertung folgt direkt darunter). Falls die `StateTag`-Töne auf dem dunklen Grund der Live-Ansicht schlecht lesbar sind: `on="ink"` verwenden (siehe Memory «on=ink vs sisal»).

- [ ] **Step 4: Tests, Commit**

```bash
cd apps/web && npx vitest run src/components/live && cd ../..
pnpm --filter @darts-platform/web typecheck
git add apps/web/src/components/live
git commit -m "feat(web): Vereinsduell in Live-Ansicht und Beamer-Modus"
```

---

### Task 8: Vereinskürzel auf Scoring-Fläche und Scheiben-Tablet

**Files:**
- Modify: `apps/web/src/components/match/scoreboard-sides.tsx:9-13, 91-103`
- Modify: `apps/web/src/components/match/match-scoreboard.tsx` (`sideNames` ~Zeile 34, Kopfzeile ~410, `LegDecisionDialog` ~602)
- Modify: `apps/web/src/components/match/match-list.tsx:10, 63-66`
- Modify: `apps/web/src/components/match/scoreboard-sides.render.spec.tsx`

**Interfaces:** Consumes `sideNames`, `sideNamesWithClub` aus `@/lib/side-names` (Task 2); `players[].clubLabel` (Task 1).

- [ ] **Step 1: Failing Render-Test**

In `scoreboard-sides.render.spec.tsx`: Fixture-Match mit `participants[0].players[0].clubLabel = "VFC"`, `participants[1].players[0].clubLabel = "DM"` → neben jedem Namen steht das Kürzel als `<abbr title="…">`? Der Vereinsname ist im Match-Zustand nicht enthalten, deshalb kein `title`; stattdessen `<span aria-label="Verein VFC">VFC</span>` – Test: `screen.getByLabelText("Verein VFC")` sichtbar, `title` des Namens enthält «(VFC)». Zweiter Fall ohne `clubLabel` (null): kein Kürzel-Element.

- [ ] **Step 2: Ausführen – scheitern**

- [ ] **Step 3: Implementieren**

- Die drei lokalen `sideNames`-Kopien durch `import { sideNames, sideNamesWithClub } from "@/lib/side-names";` ersetzen.
- `scoreboard-sides.tsx`, Namenszeile: `title={sideNamesWithClub(participant)}`; nach `{person.displayName}`:

```tsx
                  {person.clubLabel !== null ? (
                    <span aria-label={`Verein ${person.clubLabel}`} className="ml-1.5 font-plate text-caption font-semibold uppercase tracking-[0.12em] text-sisal-500">
                      {person.clubLabel}
                    </span>
                  ) : null}
```

- `match-scoreboard.tsx`: Kopfzeile «{A} – {B}» und `LegDecisionDialog sideNames` auf `sideNamesWithClub` umstellen; Gewinnername bleibt `sideNames`.
- `match-list.tsx`: Listeneinträge mit `sideNamesWithClub`.
- Das Scheiben-Tablet (`kiosk-route.tsx`) rendert `MatchScoreboard` und erbt die Änderung; nichts weiter.

- [ ] **Step 4: Tests, Commit**

```bash
cd apps/web && npx vitest run src/components/match src/components/kiosk && cd ../..
pnpm --filter @darts-platform/web typecheck
git add apps/web/src/components/match apps/web/src/lib/side-names.ts
git commit -m "feat(web): Vereinskuerzel neben Spielernamen auf Scoreboard und Tablet"
```

---

### Task 9: E2E – Vereinsduell 5 gegen 4

**Files:**
- Create: `apps/web/tests/club-duel.spec.ts`

**Interfaces:** Consumes Helfer `createRegistrationInvitation`, `signUpWithOrganization` (`tests/registration-invitation.ts`, `tests/sign-up.ts`), `decideLegStart`, `typeRoundScore`, `setScoreboardSwitch` (`tests/scoreboard-entry.ts`); Formular-Labels aus Task 3/4; Button «Auf {Board} starten» (bestehend); Scoreboard-Ablauf wie `tests/foundation.spec.ts:468-512`.

- [ ] **Step 1: Spec schreiben**

```ts
import { expect, test } from "./fixtures";
import { randomUUID } from "node:crypto";

import { createRegistrationInvitation, type RegistrationInvitationSeed } from "./registration-invitation";
import { decideLegStart, setScoreboardSwitch, typeRoundScore } from "./scoreboard-entry";
import { signUpWithOrganization } from "./sign-up";

/**
 * Spec Vereinsduell (Plan 2): 5 Mitglieder gegen 4 Gäste. Die Gäste werden in
 * der Anlage per Schnellerfassung angelegt. Nach dem letzten Spiel von Runde 1
 * paart der Server Runde 2; die Vereinswertung steht im Banner.
 */
const registrationSeeds: RegistrationInvitationSeed[] = [];

test.afterEach(async () => {
  await Promise.all(registrationSeeds.splice(0).map((seed) => seed.cleanup()));
});

test("Vereinsduell: Gäste erfassen, Runde 1 spielen, Runde 2 erscheint", async ({ page }) => {
  test.slow();
  const suffix = randomUUID();
  const short = suffix.slice(0, 8);
  const email = `e2e-duell-${suffix}@example.test`;
  const boardName = `E2E Duell Board ${short}`;
  const tournamentName = `E2E Vereinsduell ${short}`;

  const invitation = await createRegistrationInvitation(email);
  registrationSeeds.push(invitation);
  const { organizationId } = await signUpWithOrganization(page, {
    claimToken: invitation.claimToken, email,
    organizationName: `E2E Duell Club ${short}`, organizationSlug: `e2e-duell-club-${suffix}`, ownerName: `E2E Duell Leitung ${short}`,
  });

  await page.goto(`/spieler?organisation=${organizationId}`);
  const members = ["Eins", "Zwei", "Drei", "Vier", "Fünf"].map((index) => `E2E Heim ${index} ${short}`);
  for (const name of members) {
    await page.getByLabel("Anzeigename", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Spieler hinzufügen" }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }

  await page.goto(`/matches?organisation=${organizationId}`);
  await page.getByLabel("Neues Board").fill(boardName);
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await expect(page.locator("li").filter({ hasText: boardName }).filter({ hasText: "frei" })).toBeVisible();

  await page.goto(`/turniere/neu?organisation=${organizationId}`);
  await page.getByLabel("Format").selectOption("CLUB_DUEL");
  await page.getByLabel("Name").fill(tournamentName);
  await page.getByLabel("Best of Legs").selectOption("1");
  await page.getByLabel("Eigener Verein").fill("VFC");
  await page.getByLabel("Gastverein").fill(`DC Gast ${short}`);
  const guests = ["Alpha", "Beta", "Gamma", "Delta"].map((index) => `E2E Gast ${index} ${short}`);
  await page.getByLabel("Gastspieler (ein Name pro Zeile)").fill(guests.join("\n"));
  await page.getByRole("button", { name: "Gastspieler erfassen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "4 Gastspieler erfasst." })).toBeVisible();
  for (const name of members) await page.getByRole("checkbox", { name }).check();
  for (const name of guests) await expect(page.getByRole("checkbox", { name })).toBeChecked();
  await page.getByLabel("Quali-Runden").selectOption("2");
  await page.getByLabel("Finalrunde (Spieler je Verein)").selectOption("2");
  await expect(page.getByText("Spiele insgesamt")).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/turniere\/[^/?]+\?organisation=/u),
    page.getByRole("button", { name: "Turnier starten" }).click(),
  ]);
  const tournamentUrl = page.url();
  await expect(page.getByRole("region", { name: "Vereinswertung" })).toContainText(`VFC 0 : 0 DC Gast ${short}`);
  await expect(page.getByRole("tab", { name: "Runden" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Runde 2" })).toHaveCount(0);

  // Runde 1 hat vier Spiele (4 Gäste); jedes wird auf dem Board gestartet und von der Scoring-Fläche aus beendet.
  for (let played = 0; played < 4; played += 1) {
    await page.goto(tournamentUrl);
    await page.getByRole("button", { name: `Auf ${boardName} starten` }).click();
    await page.goto(`/matches?organisation=${organizationId}`);
    await page.getByRole("link").filter({ hasText: "läuft" }).first().click();
    await expect(page.getByRole("region", { name: "Match-Scoreboard" })).toBeVisible();
    await expect(page.getByText(/\(VFC\)/).first()).toBeVisible();
    await decideLegStart(page);
    await setScoreboardSwitch(page, "Checkout-Darts bestätigen", false);
    for (const points of [180, 0, 180, 0]) {
      await typeRoundScore(page, points);
      await expect(page.getByRole("button", { name: "Ziffer 0" })).toBeEnabled();
    }
    await typeRoundScore(page, 141);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Checkout-Feld").selectOption("12");
    await dialog.getByRole("button", { name: "Checkout speichern" }).click();
    await expect(page.getByText("Match beendet")).toBeVisible();
  }

  await page.goto(tournamentUrl);
  await expect(page.getByRole("heading", { name: "Runde 2" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Vereinswertung" })).toContainText("VFC 4 : 0");
  await page.getByRole("tab", { name: "Rangliste" }).click();
  await expect(page.getByRole("radio", { name: "VFC" })).toBeVisible();
});
```

Hinweise für die Umsetzung: `setScoreboardSwitch` ist je Gerät gespeichert – ab dem zweiten Match gegebenenfalls nur aufrufen, wenn der Schalter noch an ist (Helfer liest den Zustand; siehe `scoreboard-entry.ts:46`). Die Wurfreihenfolge nach `decideLegStart` beginnt bei Sitz 1 (= Spieler A), deshalb gewinnt immer A und die Wertung steht 4:0. Wenn das Scoreboard den Checkout-Dialog ohne «Checkout-Feld» zeigt (weil «Checkout-Darts bestätigen» noch an ist), die Reihenfolge aus `foundation.spec.ts:496-512` übernehmen.

- [ ] **Step 2: Lauf**

Run: `pnpm test:e2e` (Root; baut und startet Web/API). Bei Rot: zuerst die Labels gegen die Komponenten aus Task 3–5 prüfen, dann den Lauf **einzeln** wiederholen (`cd apps/web && npx playwright test tests/club-duel.spec.ts` nach dem Start der Server über das Root-Skript, siehe `scripts/run-e2e.mjs`). Bekannt: sporadische Rot-Läufe sind Kontention gegen `next dev` (Memory `e2e-single-worker`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/club-duel.spec.ts
git commit -m "test(web): E2E Vereinsduell mit Gastspieler-Erfassung und Rundenpaarung"
```

---

### Task 10: Gesamtsuite, README, PR

**Files:**
- Modify: `README.md` (Absatz Vereinsduell: «Oberfläche folgt mit Plan 2» → «Anlage, Kommandozentrale, Live-Ansicht, Beamer-Modus und Vereinskürzel auf dem Scoreboard sind vorhanden»)

- [ ] **Step 1: Gates**

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
```

Alles grün. Rote Tests sind Befunde; bekannte Kontention bei E2E einmal einzeln wiederholen.

- [ ] **Step 2: README und Commit**

```bash
git add README.md
git commit -m "docs: README Vereinsduell um Oberflaeche ergaenzen"
```

- [ ] **Step 3: Branch abschliessen**

`superpowers:finishing-a-development-branch`: PR gegen `feature/vereinsduell` (solange #96 offen), mit Screenshots von Anlage, Kommandozentrale (Banner + Tabs), Live-Ansicht und Beamer. Nach dem Merge von #96 den PR auf `develop` umhängen.

---

## Selbstprüfung gegen die Spec (UI-Abschnitt)

| Spec | Task |
|---|---|
| Formatkachel «Vereinsduell» (hier: Format-Option im bestehenden Select) | 4 |
| Schritt Vereine (eigener Verein vorbelegt, Gastverein) | 4 |
| Schritt Spieler: Spalten A/B, mobil untereinander, Gastspieler erfassen, frühere Gäste vorgeschlagen | 3, 4 |
| Schritt Modus: Runden, Finalrunde, Platz 3, ein Spielmodus, Live-Vorschau | 4 |
| Banner Vereinswertung live | 5, 6, 7 (Realtime über bestehendes Invalidate) |
| Tab Runden (aktuelle Runde, Pausen, frühere aufklappbar) | 5 |
| Tab Rangliste (Gesamt / A / B, Spalten, Finalrunden-Plätze markiert, Ausgefallene) | 5 |
| Tab Finalrunde (Kreuztabelle `<table>` mit `<th scope>`, Rangliste, Final, Platz 3) | 5 |
| Beamer: Vereinswertung gross, laufende Spiele, nächste Spiele | 7 |
| Scoreboard/Tablet: Kürzel neben dem Namen | 1, 8 |
| Barrierefreiheit: nie nur Farbe, Tabs/Radiogroup per Tastatur, Fokus sichtbar | 5 |
| E2E 5/4 mit Schnellerfassung, eine Runde, Folgerunde + Banner | 9 |
| Vertragslücken (Sieger, Status-Labels, Queue-Platzhalter, Fehlertexte) | 2, 6 |

Bewusst nicht enthalten: eine Kachel-Optik für die Formatauswahl (die bestehende Anlage nutzt ein Select; eine Umgestaltung aller Formate ist ein eigenes Thema), manuelles Umpaaren, Spielmodus je Phase.
