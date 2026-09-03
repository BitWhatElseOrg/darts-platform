# Phase 6: Web-UI der Team-Begegnung — Umsetzungsplan

> **Für ausführende Agenten:** Dieser Plan wird Task für Task abgearbeitet.
> Schritte tragen Checkboxen (`- [ ]`). Die Roadmap verbietet Subagents
> (Sessionregel 5); die Ausführung läuft inline in derselben Session.

**Ziel:** Die Liga wird über die Oberfläche bedienbar — Wettbewerb mit
Begegnungsvorlage anlegen, Teams und Kader führen, Begegnung ansetzen, beide
Meldungen erfassen, achtzehn Slots auf Boards ausspielen, Doppelpaarungen
melden, auswechseln, Ergebnis sehen; öffentlich live mitlesen.

**Architektur:** `apps/web` spricht ausschliesslich über `apiRequest` mit den
in Phase 4 gebauten Endpunkten und parst jede Antwort mit den Zod-Verträgen
aus `@darts-platform/schemas`. Keine Liga-Logik in Komponenten: alles, was
mehr ist als Darstellung, liegt als reine Funktion in `apps/web/src/lib` und
wird dort mit Vitest geprüft. Aktualisierung über TanStack Query, angestossen
vom Socket-Kanal `encounter:changed` aus Phase 5.

**Tech Stack:** Next.js 16 (App Router), React 19, TanStack Query 5,
React Hook Form 7 + Zod 4, Tailwind 4, `@darts-platform/ui`
(Sektorenring-Primitive), socket.io-client, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-02-team-encounter-league-design.md`
**Roadmap:** `docs/superpowers/plans/2026-09-02-team-encounter-roadmap.md`

---

## Global Constraints

Diese Vorgaben gelten für jeden Task und werden nicht je Task wiederholt.

- **Kein `any`.** `strict: true`; `unknown` statt `any` (AGENTS.md §5).
- **Keine Business-Logik in React-Komponenten** (AGENTS.md §4). Ableitungen
  gehören nach `apps/web/src/lib/*` als reine Funktionen mit Tests.
- **Der Server entscheidet.** Ausgeblendete Bedienelemente sind keine
  Autorisierungsgrenze (Spec, Abschnitt „Berechtigungen"). Die Oberfläche
  spiegelt die Rolle mit `hasOrganizationPermission` aus
  `@darts-platform/domain` — derselben Tabelle, die der Server benutzt.
- **Jede Mutation an Begegnung und Wettbewerb trägt `commandId` (frisch aus
  `generateId()`) und `expectedVersion`** (AGENTS.md §11, §12). Ein 409 wird
  sichtbar aufgelöst, nie still wiederholt.
- **Copy Deutsch (Schweiz, kein Eszett), Dart-Fachbegriffe englisch.** Die
  Oberfläche spricht Reglementssprache: Begegnung, Spiel, Satz — nicht
  Encounter, Slot, Leg (Spec, Begriffstabelle). Im Code bleiben die
  englischen Bezeichner.
- **Mobile First**, Touch-Ziele `min-h-11`, sichtbarer Fokus
  (`focus-visible:outline-2`).
- **Accessibility:** semantisches HTML, Tastaturbedienung der
  Leitungsansichten, keine Information ausschliesslich über Farbe — ein
  Slotstatus steht immer als Wort da (Spec, Abschnitt „Accessibility").
- **Designsprache:** Leitungsflächen im Sektorenring (`Wedge`, `Control`,
  `StateTag`, `SheetLabel`, `Rule`, `Field`, `TextInput`, `SelectInput`,
  `Score` aus `@darts-platform/ui`, Klasse `sektorenring` auf `main`), wie
  `apps/web/src/components/tournament/*`. Öffentliche Live-Ansichten dunkel
  wie `apps/web/src/components/live/live-tournament.tsx`.
- **Während der Arbeit kein `pnpm test` oder `pnpm build` im Root**
  (Roadmap-Sessionregel 3). Nur gezielt:
  `pnpm --filter @darts-platform/web test`. Testcontainers-Tests erst am
  Phasenende.
- **Commits** nach Conventional Commits, klein und grün (AGENTS.md §22).
  Kein `Co-Authored-By`-Trailer.

## Vorgefundener Zustand (geprüft, nicht vermutet)

- Alle Endpunkte der Spec existieren: `apps/api/src/teams`,
  `apps/api/src/competitions`, `apps/api/src/encounters` (inklusive
  `public-encounters.controller.ts`). **Jede** Mutation an einer Begegnung
  antwortet mit `EncounterDetail`, jede an einem Wettbewerb mit
  `CompetitionDetail`, jede an einem Team mit `TeamResponse`.
- Die Verträge liegen vollständig in `packages/schemas/src/league.ts`
  (`teamListSchema`, `competitionListSchema`, `competitionDetailSchema`,
  `encounterListSchema`, `encounterDetailSchema`, `publicEncounterSchema`
  und die Eingabeschemata).
- `EncounterVersionConflictException` liefert
  `details.currentState` als `EncounterDetail` — dieselbe Systematik wie
  `TOURNAMENT_VERSION_CONFLICT` in `command-centre.tsx`.
- Fehlercodes nach aussen stehen in `apps/api/src/common/league-error.ts`
  und den Services: `NOMINATION_INCOMPLETE`,
  `NOMINATION_DUPLICATE_PLAYER`, `NOMINATION_PLAYER_NOT_IN_SQUAD`,
  `DOUBLES_PAIRING_INCOMPLETE`, `DOUBLES_PLAYER_LIMIT_EXCEEDED`,
  `SUBSTITUTION_LIMIT_EXCEEDED`, `SUBSTITUTION_PLAYER_BLOCKED`,
  `SUBSTITUTION_SLOT_RUNNING`, `TEMPLATE_INVALID`,
  `TEMPLATE_ROUND_ROBIN_INCOMPLETE`, `LEAGUE_VALIDATION_ERROR`,
  `ENCOUNTER_VERSION_CONFLICT`, `COMPETITION_VERSION_CONFLICT`,
  `COMPETITION_SLUG_TAKEN`, `COMPETITION_TEMPLATE_LOCKED`,
  `ENCOUNTER_CLOSED`, `ENCOUNTER_STATUS_INVALID`,
  `ENCOUNTER_SLOT_NOT_READY`, `ENCOUNTER_SLOT_RUNNING`,
  `BOARD_UNAVAILABLE`, `PLAYER_BUSY`, `COMMAND_ID_ALREADY_USED`,
  `TEAM_PLAYER_ALREADY_MEMBER`.
- Der Server setzt einen Slot **nie** auf `READY`. Ein Slot steht auf
  `WAITING`, bis er einem Board zugewiesen wird (`IN_PROGRESS`), oder er
  wird `WALKOVER` / `CANCELLED` / `COMPLETED`. Die Oberfläche zeigt darum
  aus den vom Server gelieferten Feldern (`status`, `home.complete`,
  `away.complete`, `encounter.status`), warum ein Slot noch nicht starten
  kann — sie berechnet keine Freigabe.
- `apps/web` hat heute **kein** `test`-Skript; `pnpm test` läuft dort ins
  Leere. Task 1 ergänzt Vitest.
- `apps/web/src/lib/realtime.ts` kennt nur `connectTournamentRealtime`.
- `matchStateSchema.participants[].players[]` trägt bereits
  `{ playerId, displayName, isThrowing }`; `currentPlayerId` ist der
  tatsächliche Werfer. Das Scoreboard nutzt beides noch nicht.
- `packages/database/src/schema.ts:936` hat
  `pointsDeciderBonus.default(1)`, was zusammen mit
  `deciderRule.default('NONE')` die eigene Check-Constraint verletzt — der
  von Phase 5 nach Phase 6 gereichte Befund.

## Dateien

**Neu — reine Logik mit Tests**

| Datei | Verantwortung |
| --- | --- |
| `apps/web/src/lib/league-format.ts` | Beschriftungen und Tonwerte für Liga-Zustände. Keine Entscheidung, nur Sprache. |
| `apps/web/src/lib/league-format.spec.ts` | Test dazu. |
| `apps/web/src/lib/encounter-view.ts` | Ableitungen für die Begegnungsleitung aus `EncounterDetail`. |
| `apps/web/src/lib/encounter-view.spec.ts` | Test dazu. |
| `apps/web/src/lib/league-template.ts` | Erzeugt die Begegnungsvorlage (Rundenturnier) für das Wettbewerbsformular. |
| `apps/web/src/lib/league-template.spec.ts` | Test dazu. |

**Neu — Komponenten**

| Datei | Verantwortung |
| --- | --- |
| `apps/web/src/components/league/team-roster.tsx` | `/teams`: Teams anlegen, Kader führen. |
| `apps/web/src/components/league/competition-list.tsx` | `/liga`: Wettbewerbe. |
| `apps/web/src/components/league/competition-setup.tsx` | `/liga/neu`: Wettbewerb mit Vorlage anlegen. |
| `apps/web/src/components/league/competition-detail.tsx` | `/liga/[id]`: Vorlage, Begegnungen, Ansetzen. |
| `apps/web/src/components/league/encounter-route.tsx` | Organisation und Rechte auflösen. |
| `apps/web/src/components/league/encounter-command-centre.tsx` | `/liga/begegnungen/[id]`: Query, Realtime, Kommandos, Layout. |
| `apps/web/src/components/league/use-encounter-command.ts` | Kommandohook: `commandId`, `expectedVersion`, 409-Auflösung. |
| `apps/web/src/components/league/encounter-scoreline.tsx` | Kopf: Teams, Punkte/Spiele/Sätze, Zustand, Fortschritt. |
| `apps/web/src/components/league/lineup-panel.tsx` | Meldung je Seite, verdeckt bis beide gemeldet haben. |
| `apps/web/src/components/league/doubles-panel.tsx` | Doppelpaarungen je Seite. |
| `apps/web/src/components/league/substitution-panel.tsx` | Auswechslung und Historie. |
| `apps/web/src/components/league/slot-list.tsx` | Die achtzehn Spiele: Besetzung, Zustand, Board, Walkover. |
| `apps/web/src/components/live/live-encounter.tsx` | Öffentliche Begegnungsansicht. |

**Neu — Routen**

`apps/web/src/app/teams/page.tsx`, `apps/web/src/app/liga/page.tsx`,
`apps/web/src/app/liga/neu/page.tsx`, `apps/web/src/app/liga/[id]/page.tsx`,
`apps/web/src/app/liga/begegnungen/[id]/page.tsx`,
`apps/web/src/app/live/begegnungen/[publicId]/page.tsx`.

**Geändert**

| Datei | Änderung |
| --- | --- |
| `apps/web/package.json` | `test`-Skript und Vitest. |
| `apps/web/src/lib/api-client.ts` | Liga-Fehlercodes in `localizedMessage`. |
| `apps/web/src/lib/realtime.ts` | `connectEncounterRealtime`. |
| `apps/web/src/components/match/match-scoreboard.tsx` | Doppel: beide Namen, Werfer hervorgehoben. |
| `apps/web/src/components/tenant-dashboard.tsx` | Navigationseinträge Liga und Teams. |
| `packages/database/src/schema.ts` | `pointsDeciderBonus` Vorgabe `0`. |
| `packages/database/drizzle/0019_league_decider_bonus_default.sql` | Neue Vorwärtsmigration (neu). |
| `apps/api/src/competitions/competitions.integration.spec.ts` | Test auf die Vorgaben. |
| `docs/superpowers/plans/2026-09-02-team-encounter-roadmap.md` | Offenen Punkt als erledigt streichen. |

## Nicht in dieser Phase

- E2E-Tests (Phase 7). Diese Phase liefert stabile `id`-Attribute und
  Beschriftungen, damit Phase 7 daran greifen kann, schreibt aber keine
  Playwright-Spezifikation.
- Saison, Spielplangenerierung, Ligatabelle, Doppelstatistik.
- Self-Service für Team-Captains.
- Nachträgliche Ergebniskorrektur einer abgeschlossenen Begegnung.

---

## Task 0: Arbeitszweig

- [ ] **Schritt 1: Zweig anlegen**

```bash
git checkout develop
git status --short
git checkout -b feature/phase-6-web-ui
```

Erwartet: `git status` ist leer, bevor der Zweig entsteht. `develop` ist der
Integrationszweig dieser Phasenreihe und bleibt lokal.

---

## Task 1: Vitest in `apps/web`, Vokabular und Fehlertexte

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/lib/league-format.ts`
- Test: `apps/web/src/lib/league-format.spec.ts`
- Modify: `apps/web/src/lib/api-client.ts:26-40`

**Interfaces:**
- Consumes: Typen aus `@darts-platform/schemas`, `StateTone` aus
  `@darts-platform/ui`.
- Produces: `encounterStatusLabel`, `slotStatusLabel`,
  `competitionStatusLabel`, `disciplineLabel`, `sideLabel`,
  `slotOutcomeLabel`, `encounterOutcomeLabel`, `originLabel`,
  `variantLabel`, `slotTone`, `encounterTone` — alle in
  `apps/web/src/lib/league-format.ts`.

- [ ] **Schritt 1: Vitest verfügbar machen**

`apps/web/package.json`: in `scripts` `"test": "vitest run"` ergänzen, in
`devDependencies` `"vitest": "catalog:"`. Danach einmal
`pnpm install --filter @darts-platform/web` ausführen.

Kein `vitest.config.ts`. Die geprüften Module importieren einander relativ
und aus `@darts-platform/schemas`/`@darts-platform/ui` nur Typen; der
Alias `@/` kommt in ihnen nicht vor, deshalb braucht Vitest keine
Auflösungsregel. Wer das später bricht, merkt es sofort am roten Lauf.

- [ ] **Schritt 2: Den fehlschlagenden Test schreiben**

`apps/web/src/lib/league-format.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  competitionStatusLabel,
  disciplineLabel,
  encounterOutcomeLabel,
  encounterStatusLabel,
  encounterTone,
  originLabel,
  sideLabel,
  slotOutcomeLabel,
  slotStatusLabel,
  slotTone,
  variantLabel,
} from "./league-format";

describe("league-format", () => {
  it("spricht die Reglementssprache statt der Tabellennamen", () => {
    expect(encounterStatusLabel("LINEUPS_OPEN")).toBe("Meldung offen");
    expect(encounterStatusLabel("RUNNING")).toBe("läuft");
    expect(slotStatusLabel("WAITING")).toBe("wartet");
    expect(slotStatusLabel("WALKOVER")).toBe("kampflos");
    expect(competitionStatusLabel("DRAFT")).toBe("Entwurf");
    expect(disciplineLabel("DOUBLES")).toBe("Doppel");
    expect(sideLabel("HOME")).toBe("Heim");
    expect(originLabel("GUEST")).toBe("Aushilfe");
  });

  it("benennt jeden Ausgang, nicht nur den regulären", () => {
    expect(slotOutcomeLabel({ winnerSide: "HOME", resultType: "PLAYED" })).toBe("Heim gewinnt");
    expect(slotOutcomeLabel({ winnerSide: "AWAY", resultType: "WALKOVER" })).toBe(
      "Gast gewinnt kampflos",
    );
    expect(slotOutcomeLabel({ winnerSide: null, resultType: null })).toBe("offen");
    expect(encounterOutcomeLabel({ result: "DRAW", resultType: "PLAYED" })).toBe("Unentschieden");
    expect(encounterOutcomeLabel({ result: "HOME_WIN", resultType: "DECIDER" })).toBe(
      "Heim gewinnt nach Entscheidungsdoppel",
    );
    expect(encounterOutcomeLabel({ result: "AWAY_WIN", resultType: "FORFEIT" })).toBe(
      "Gast gewinnt nach Nichtantritt",
    );
    expect(encounterOutcomeLabel({ result: null, resultType: null })).toBe("offen");
  });

  it("nennt die Spielvariante beim Namen, den das Reglement benutzt", () => {
    expect(variantLabel({ startingScore: 501, inRule: "DOUBLE", outRule: "DOUBLE" })).toBe(
      "501 Double In / Double Out",
    );
    expect(variantLabel({ startingScore: 701, inRule: "STRAIGHT", outRule: "MASTER" })).toBe(
      "701 Straight In / Master Out",
    );
    expect(variantLabel({ startingScore: 301, inRule: "STRAIGHT", outRule: "SINGLE" })).toBe(
      "301 Straight In / Single Out",
    );
  });

  it("paart jeden Zustand mit einem Tonwert, der eine Marke traegt", () => {
    expect(slotTone("IN_PROGRESS")).toBe("live");
    expect(slotTone("COMPLETED")).toBe("finish");
    expect(slotTone("WAITING")).toBe("waiting");
    expect(slotTone("WALKOVER")).toBe("blocked");
    expect(slotTone("CANCELLED")).toBe("blocked");
    expect(slotTone("READY")).toBe("free");
    expect(encounterTone("RUNNING")).toBe("live");
    expect(encounterTone("COMPLETED")).toBe("finish");
    expect(encounterTone("CANCELLED")).toBe("conflict");
  });
});
```

- [ ] **Schritt 3: Lauf zur Bestätigung, dass er fehlschlägt**

```bash
pnpm --filter @darts-platform/web test
```

Erwartet: FAIL, `Failed to load ./league-format`.

- [ ] **Schritt 4: `league-format.ts` schreiben**

```ts
import type {
  CompetitionStatus,
  Discipline,
  EncounterResult,
  EncounterResultType,
  EncounterSide,
  EncounterSlotStatus,
  EncounterStatus,
  InRule,
  NominationOrigin,
  OutRule,
  SlotResultType,
} from "@darts-platform/schemas";
import type { StateTone } from "@darts-platform/ui";

/**
 * Nur Sprache. Nichts hier entscheidet etwas: jeder Wert wurde vom Server
 * entschieden. Die Oberfläche zeigt die Reglementssprache (Spec,
 * Begriffstabelle) — „Spiel" für einen Slot, „Satz" für ein Leg.
 */

export function encounterStatusLabel(status: EncounterStatus): string {
  switch (status) {
    case "DRAFT":
      return "Entwurf";
    case "LINEUPS_OPEN":
      return "Meldung offen";
    case "READY":
      return "startbereit";
    case "RUNNING":
      return "läuft";
    case "COMPLETED":
      return "beendet";
    case "CANCELLED":
      return "abgesagt";
  }
}

export function slotStatusLabel(status: EncounterSlotStatus): string {
  switch (status) {
    case "WAITING":
      return "wartet";
    case "READY":
      return "bereit";
    case "IN_PROGRESS":
      return "läuft";
    case "COMPLETED":
      return "gespielt";
    case "WALKOVER":
      return "kampflos";
    case "CANCELLED":
      return "entfällt";
  }
}

export function competitionStatusLabel(status: CompetitionStatus): string {
  switch (status) {
    case "DRAFT":
      return "Entwurf";
    case "ACTIVE":
      return "laufend";
    case "COMPLETED":
      return "beendet";
    case "CANCELLED":
      return "abgesagt";
  }
}

export function disciplineLabel(discipline: Discipline): string {
  return discipline === "SINGLES" ? "Einzel" : "Doppel";
}

export function sideLabel(side: EncounterSide): string {
  return side === "HOME" ? "Heim" : "Gast";
}

export function originLabel(origin: NominationOrigin): string {
  return origin === "SQUAD" ? "Kader" : "Aushilfe";
}

export function slotOutcomeLabel(input: {
  readonly winnerSide: EncounterSide | null;
  readonly resultType: SlotResultType | null;
}): string {
  if (input.winnerSide === null) return "offen";
  const winner = sideLabel(input.winnerSide);
  return input.resultType === "WALKOVER" ? `${winner} gewinnt kampflos` : `${winner} gewinnt`;
}

export function encounterOutcomeLabel(input: {
  readonly result: EncounterResult | null;
  readonly resultType: EncounterResultType | null;
}): string {
  if (input.result === null) return "offen";
  if (input.result === "DRAW") return "Unentschieden";
  const winner = input.result === "HOME_WIN" ? "Heim" : "Gast";
  switch (input.resultType) {
    case "DECIDER":
      return `${winner} gewinnt nach Entscheidungsdoppel`;
    case "FORFEIT":
      return `${winner} gewinnt nach Nichtantritt`;
    default:
      return `${winner} gewinnt`;
  }
}

const inRuleWords: Readonly<Record<InRule, string>> = {
  STRAIGHT: "Straight In",
  DOUBLE: "Double In",
};

const outRuleWords: Readonly<Record<OutRule, string>> = {
  SINGLE: "Single Out",
  DOUBLE: "Double Out",
  MASTER: "Master Out",
};

/** Reglement 1.1 kennt vier Ligavarianten; sie werden ausgeschrieben. */
export function variantLabel(input: {
  readonly startingScore: number;
  readonly inRule: InRule;
  readonly outRule: OutRule;
}): string {
  return `${input.startingScore} ${inRuleWords[input.inRule]} / ${outRuleWords[input.outRule]}`;
}

/** Jeder Tonwert bringt in `StateTag` eine gezeichnete Marke und ein Wort mit. */
export function slotTone(status: EncounterSlotStatus): StateTone {
  switch (status) {
    case "WAITING":
      return "waiting";
    case "READY":
      return "free";
    case "IN_PROGRESS":
      return "live";
    case "COMPLETED":
      return "finish";
    case "WALKOVER":
    case "CANCELLED":
      return "blocked";
  }
}

export function encounterTone(status: EncounterStatus): StateTone {
  switch (status) {
    case "DRAFT":
    case "LINEUPS_OPEN":
      return "waiting";
    case "READY":
      return "free";
    case "RUNNING":
      return "live";
    case "COMPLETED":
      return "finish";
    case "CANCELLED":
      return "conflict";
  }
}
```

`InRule` und `OutRule` sind bereits exportiert
(`packages/schemas/src/tournament.ts:363-364`, weitergereicht von
`packages/schemas/src/index.ts:79,82`).

- [ ] **Schritt 5: Lauf zur Bestätigung, dass er besteht**

```bash
pnpm --filter @darts-platform/web test
```

Erwartet: PASS, 4 Tests.

- [ ] **Schritt 6: Fehlertexte ergänzen**

In `apps/web/src/lib/api-client.ts`, im Objekt `messages` innerhalb von
`localizedMessage`, hinter die bestehenden Einträge:

```ts
    ENCOUNTER_VERSION_CONFLICT:
      "Der Zustand der Begegnung hat sich geändert. Übernimm den Serverstand.",
    COMPETITION_VERSION_CONFLICT:
      "Der Wettbewerb hat sich geändert. Lade ihn neu und versuche es erneut.",
    COMPETITION_SLUG_TAKEN: "Diesen Kurznamen gibt es in der Organisation bereits.",
    COMPETITION_TEMPLATE_LOCKED:
      "Die Vorlage ist gesperrt, sobald eine Begegnung angesetzt ist.",
    NOMINATION_INCOMPLETE: "Die Meldung ist unvollständig.",
    NOMINATION_DUPLICATE_PLAYER: "Diese Person ist zweimal gemeldet.",
    NOMINATION_PLAYER_NOT_IN_SQUAD:
      "Diese Person gehört nicht zum Kader. Melde sie als Aushilfe.",
    DOUBLES_PAIRING_INCOMPLETE: "Ein Doppel braucht genau zwei gemeldete Personen je Seite.",
    DOUBLES_PLAYER_LIMIT_EXCEEDED:
      "Diese Person spielt bereits ein reguläres Doppel dieser Begegnung.",
    SUBSTITUTION_LIMIT_EXCEEDED: "Das Auswechselkontingent dieser Begegnung ist erschöpft.",
    SUBSTITUTION_PLAYER_BLOCKED:
      "Diese Auswechslung ist nicht zulässig. Eine ausgewechselte Person bleibt für die Einzel gesperrt.",
    SUBSTITUTION_SLOT_RUNNING: "Während einer laufenden Paarung wird nicht gewechselt.",
    TEMPLATE_INVALID: "Die Begegnungsvorlage ist widersprüchlich.",
    TEMPLATE_ROUND_ROBIN_INCOMPLETE:
      "Die Einzel bilden kein vollständiges Rundenturnier über alle Aufstellungspositionen.",
    LEAGUE_VALIDATION_ERROR: "Die Eingabe verletzt eine Ligaregel.",
    ENCOUNTER_CLOSED: "Die Begegnung ist beendet oder abgebrochen.",
    ENCOUNTER_STATUS_INVALID: "Der Zustand der Begegnung lässt diesen Schritt nicht zu.",
    ENCOUNTER_SLOT_NOT_READY: "Dieses Spiel ist noch nicht bereit.",
    ENCOUNTER_SLOT_RUNNING: "Dieses Spiel läuft bereits.",
    BOARD_UNAVAILABLE: "Das gewählte Board ist belegt.",
    PLAYER_BUSY: "Mindestens eine Person spielt bereits an einem anderen Board.",
    COMMAND_ID_ALREADY_USED: "Dieser Befehl wurde bereits ausgeführt.",
    TEAM_PLAYER_ALREADY_MEMBER: "Diese Person gehört bereits zum Kader.",
```

- [ ] **Schritt 7: Typecheck und Commit**

```bash
pnpm --filter @darts-platform/web typecheck
git add apps/web/package.json apps/web/src/lib pnpm-lock.yaml
git commit -m "feat: give the web client a league vocabulary and its own test cycle"
```

---

## Task 2: Ableitungen der Begegnungsleitung

Die Fläche muss vier Fragen beantworten, die nicht in einem Feld der Antwort
stehen: *Kann dieses Spiel jetzt auf ein Board?* — *Für welches Doppel fehlt
meine Paarung?* — *Wen darf ich für wen einwechseln, und ab welchem Spiel?* —
*Wie weit ist die Begegnung?* Alle vier folgen ausschliesslich aus Feldern,
die der Server geschickt hat. Sie stehen als reine Funktionen hier, nicht in
den Komponenten.

**Files:**
- Create: `apps/web/src/lib/encounter-view.ts`
- Test: `apps/web/src/lib/encounter-view.spec.ts`

**Interfaces:**
- Consumes: `EncounterDetail`, `EncounterSlotView`, `EncounterSide` aus
  `@darts-platform/schemas`; `sideLabel` aus `./league-format`.
- Produces:
  ```ts
  interface SlotAvailability { readonly assignable: boolean; readonly reason: string | null }
  function slotAvailability(encounter: EncounterDetail, slot: EncounterSlotView): SlotAvailability
  function openDoublesSlots(encounter: EncounterDetail, side: EncounterSide): readonly EncounterSlotView[]
  interface SubstitutionContext {
    readonly minimumSequence: number;
    readonly used: number;
    readonly remaining: number;
    readonly positions: readonly { readonly position: number; readonly playerId: string; readonly displayName: string }[];
    readonly available: readonly { readonly playerId: string; readonly displayName: string }[];
  }
  function substitutionContext(encounter: EncounterDetail, side: EncounterSide): SubstitutionContext
  interface EncounterTally { readonly decided: number; readonly total: number; readonly running: number }
  function encounterTally(encounter: EncounterDetail): EncounterTally
  function deciderNotice(encounter: EncounterDetail): string | null
  ```

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`apps/web/src/lib/encounter-view.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { EncounterDetail, EncounterSlotView } from "@darts-platform/schemas";

import {
  deciderNotice,
  encounterTally,
  openDoublesSlots,
  slotAvailability,
  substitutionContext,
} from "./encounter-view";

function player(id: string, name: string) {
  return { playerId: id, displayName: name };
}

function slot(overrides: Partial<EncounterSlotView> & { readonly sequence: number }): EncounterSlotView {
  return {
    id: `00000000-0000-4000-8000-${String(overrides.sequence).padStart(12, "0")}`,
    sequence: overrides.sequence,
    role: "REGULAR",
    discipline: "SINGLES",
    label: `Spiel ${overrides.sequence}`,
    homePosition: 1,
    awayPosition: 1,
    startingScore: 501,
    inRule: "DOUBLE",
    outRule: "DOUBLE",
    maxRounds: null,
    bestOfLegs: 3,
    legsToWinSet: 2,
    setsToWin: 1,
    status: "WAITING",
    boardId: null,
    boardName: null,
    matchId: null,
    winnerSide: null,
    resultType: null,
    homeLegs: 0,
    awayLegs: 0,
    version: 0,
    completedAt: null,
    home: { players: [player("h1", "Heim Eins")], complete: true },
    away: { players: [player("a1", "Gast Eins")], complete: true },
    ...overrides,
  };
}

function encounter(overrides: Partial<EncounterDetail> = {}): EncounterDetail {
  return {
    id: "00000000-0000-4000-8000-00000000000e",
    publicId: "00000000-0000-4000-8000-00000000000f",
    organizationId: "00000000-0000-4000-8000-000000000001",
    competitionId: "00000000-0000-4000-8000-000000000002",
    competitionName: "Gruppe STSO S 2",
    matchday: 3,
    homeTeamId: "00000000-0000-4000-8000-000000000003",
    homeTeamName: "Bulls Ost",
    awayTeamId: "00000000-0000-4000-8000-000000000004",
    awayTeamName: "Oche West",
    scheduledAt: new Date("2026-09-10T18:30:00.000Z"),
    venue: "Clublokal",
    status: "RUNNING",
    version: 7,
    homePoints: 0,
    awayPoints: 0,
    homeGames: 0,
    awayGames: 0,
    homeLegs: 0,
    awayLegs: 0,
    result: null,
    resultType: null,
    completedAt: null,
    deciderRule: "EXTRA_SLOT",
    lineupPositions: 4,
    minNominations: 4,
    minNominationsShorthanded: 3,
    maxSubstitutionsPerEncounter: 4,
    maxDoublesPerPlayer: 1,
    decider: { status: "REGULAR_SLOTS_PENDING", required: false, slotSequence: 19 },
    home: {
      side: "HOME",
      teamId: "00000000-0000-4000-8000-000000000003",
      teamName: "Bulls Ost",
      submitted: true,
      revealed: true,
      nominations: [
        { playerId: "h1", displayName: "Heim Eins", position: 1, origin: "SQUAD" },
        { playerId: "h2", displayName: "Heim Zwei", position: 2, origin: "SQUAD" },
        { playerId: "h5", displayName: "Heim Fünf", position: null, origin: "SQUAD" },
      ],
      substitutions: [],
    },
    away: {
      side: "AWAY",
      teamId: "00000000-0000-4000-8000-000000000004",
      teamName: "Oche West",
      submitted: true,
      revealed: true,
      nominations: [{ playerId: "a1", displayName: "Gast Eins", position: 1, origin: "SQUAD" }],
      substitutions: [],
    },
    slots: [slot({ sequence: 1 })],
    ...overrides,
  };
}

describe("slotAvailability", () => {
  it("gibt ein wartendes, beidseitig besetztes Spiel einer laufenden Begegnung frei", () => {
    expect(slotAvailability(encounter(), slot({ sequence: 1 }))).toEqual({
      assignable: true,
      reason: null,
    });
  });

  it("nennt die fehlende Seite beim Namen", () => {
    const result = slotAvailability(
      encounter(),
      slot({ sequence: 9, discipline: "DOUBLES", homePosition: null, awayPosition: null, away: { players: [], complete: false } }),
    );
    expect(result.assignable).toBe(false);
    expect(result.reason).toBe("Gast hat die Doppelpaarung noch nicht gemeldet.");
  });

  it("laesst vor dem Anwurf kein Spiel zu", () => {
    const result = slotAvailability(encounter({ status: "READY" }), slot({ sequence: 1 }));
    expect(result.assignable).toBe(false);
    expect(result.reason).toBe("Die Begegnung ist noch nicht gestartet.");
  });

  it("gibt ein laufendes oder entschiedenes Spiel nicht erneut frei", () => {
    expect(slotAvailability(encounter(), slot({ sequence: 1, status: "IN_PROGRESS" })).reason).toBe(
      "Das Spiel läuft bereits.",
    );
    expect(slotAvailability(encounter(), slot({ sequence: 1, status: "COMPLETED" })).reason).toBe(
      "Das Spiel ist entschieden.",
    );
    expect(slotAvailability(encounter(), slot({ sequence: 1, status: "WALKOVER" })).reason).toBe(
      "Das Spiel ist entschieden.",
    );
  });

  it("haelt den Entscheidungsslot zurueck, solange er nicht gebraucht wird", () => {
    const decider = slot({ sequence: 19, role: "DECIDER", discipline: "DOUBLES", homePosition: null, awayPosition: null });
    const result = slotAvailability(encounter(), decider);
    expect(result.assignable).toBe(false);
    expect(result.reason).toBe("Das Entscheidungsdoppel wird erst bei Gleichstand gebraucht.");
  });

  it("gibt den Entscheidungsslot frei, sobald der Server ihn verlangt", () => {
    const decider = slot({ sequence: 19, role: "DECIDER", discipline: "DOUBLES", homePosition: null, awayPosition: null });
    const result = slotAvailability(
      encounter({ decider: { status: "REQUIRED", required: true, slotSequence: 19 } }),
      decider,
    );
    expect(result).toEqual({ assignable: true, reason: null });
  });
});

describe("openDoublesSlots", () => {
  it("fuehrt nur die Doppel, fuer die diese Seite noch melden muss", () => {
    const slots = [
      slot({ sequence: 1 }),
      slot({ sequence: 9, discipline: "DOUBLES", homePosition: null, awayPosition: null, home: { players: [], complete: false } }),
      slot({ sequence: 10, discipline: "DOUBLES", homePosition: null, awayPosition: null }),
    ];
    expect(openDoublesSlots(encounter({ slots }), "HOME").map((entry) => entry.sequence)).toEqual([9]);
    expect(openDoublesSlots(encounter({ slots }), "AWAY")).toEqual([]);
  });

  it("nimmt den Entscheidungsslot erst auf, wenn er verlangt ist", () => {
    const decider = slot({
      sequence: 19,
      role: "DECIDER",
      discipline: "DOUBLES",
      homePosition: null,
      awayPosition: null,
      home: { players: [], complete: false },
    });
    expect(openDoublesSlots(encounter({ slots: [decider] }), "HOME")).toEqual([]);
    expect(
      openDoublesSlots(
        encounter({ slots: [decider], decider: { status: "REQUIRED", required: true, slotSequence: 19 } }),
        "HOME",
      ).map((entry) => entry.sequence),
    ).toEqual([19]);
  });
});

describe("substitutionContext", () => {
  it("wechselt nie in eine laufende oder gespielte Paarung hinein", () => {
    const slots = [
      slot({ sequence: 1, status: "COMPLETED" }),
      slot({ sequence: 2, status: "IN_PROGRESS" }),
      slot({ sequence: 3 }),
    ];
    expect(substitutionContext(encounter({ slots }), "HOME").minimumSequence).toBe(3);
  });

  it("bietet die gemeldeten Ersatzpersonen an und zaehlt das Kontingent", () => {
    const context = substitutionContext(encounter(), "HOME");
    expect(context.positions).toEqual([
      { position: 1, playerId: "h1", displayName: "Heim Eins" },
      { position: 2, playerId: "h2", displayName: "Heim Zwei" },
    ]);
    expect(context.available).toEqual([{ playerId: "h5", displayName: "Heim Fünf" }]);
    expect(context.remaining).toBe(4);
  });

  it("rechnet erfolgte Auswechslungen gegen das Kontingent und die Aufstellung", () => {
    const withSubstitution = encounter({
      home: {
        ...encounter().home,
        substitutions: [
          {
            id: "00000000-0000-4000-8000-0000000000aa",
            side: "HOME",
            position: 2,
            outPlayerId: "h2",
            outDisplayName: "Heim Zwei",
            inPlayerId: "h5",
            inDisplayName: "Heim Fünf",
            effectiveFromSequence: 3,
            reason: "Verletzung",
            createdAt: new Date("2026-09-10T19:10:00.000Z"),
          },
        ],
      },
    });
    const context = substitutionContext(withSubstitution, "HOME");
    expect(context.used).toBe(1);
    expect(context.remaining).toBe(3);
    expect(context.positions).toEqual([
      { position: 1, playerId: "h1", displayName: "Heim Eins" },
      { position: 2, playerId: "h5", displayName: "Heim Fünf" },
    ]);
    expect(context.available).toEqual([]);
  });
});

describe("encounterTally und deciderNotice", () => {
  it("zaehlt entschiedene, laufende und zu spielende Spiele ohne den ungenutzten Entscheidungsslot", () => {
    const slots = [
      slot({ sequence: 1, status: "COMPLETED" }),
      slot({ sequence: 2, status: "WALKOVER" }),
      slot({ sequence: 3, status: "IN_PROGRESS" }),
      slot({ sequence: 4 }),
      slot({ sequence: 19, role: "DECIDER", status: "CANCELLED", discipline: "DOUBLES", homePosition: null, awayPosition: null }),
    ];
    expect(encounterTally(encounter({ slots }))).toEqual({ decided: 2, running: 1, total: 4 });
  });

  it("sagt, ob das Entscheidungsdoppel gebraucht wird", () => {
    expect(deciderNotice(encounter())).toBeNull();
    expect(deciderNotice(encounter({ decider: { status: "REQUIRED", required: true, slotSequence: 19 } }))).toBe(
      "Gleichstand nach den regulären Spielen. Das Entscheidungsdoppel (Spiel 19) wird gebraucht; beide Seiten melden dafür eine Paarung.",
    );
    expect(deciderNotice(encounter({ decider: { status: "NOT_REQUIRED", required: false, slotSequence: 19 } }))).toBe(
      "Das Entscheidungsdoppel wird nicht gebraucht.",
    );
  });
});
```

- [ ] **Schritt 2: Lauf zur Bestätigung, dass er fehlschlägt**

```bash
pnpm --filter @darts-platform/web test encounter-view
```

Erwartet: FAIL, `Failed to load ./encounter-view`.

- [ ] **Schritt 3: `encounter-view.ts` schreiben**

```ts
import type {
  EncounterDetail,
  EncounterSide,
  EncounterSideLineup,
  EncounterSlotView,
} from "@darts-platform/schemas";

import { sideLabel } from "./league-format";

/**
 * Ableitungen für die Begegnungsleitung. Jede folgt ausschliesslich aus
 * Feldern, die der Server geschickt hat — die Oberfläche entscheidet nichts,
 * sie erklärt. Der Server prüft jede Zuweisung erneut (AGENTS.md §13).
 */

export interface SlotAvailability {
  readonly assignable: boolean;
  readonly reason: string | null;
}

function lineupOf(encounter: EncounterDetail, side: EncounterSide): EncounterSideLineup {
  return side === "HOME" ? encounter.home : encounter.away;
}

export function slotAvailability(
  encounter: EncounterDetail,
  slot: EncounterSlotView,
): SlotAvailability {
  if (slot.status === "IN_PROGRESS") return { assignable: false, reason: "Das Spiel läuft bereits." };
  if (slot.status === "COMPLETED" || slot.status === "WALKOVER") {
    return { assignable: false, reason: "Das Spiel ist entschieden." };
  }
  if (slot.status === "CANCELLED") return { assignable: false, reason: "Das Spiel entfällt." };
  if (encounter.status !== "RUNNING") {
    return { assignable: false, reason: "Die Begegnung ist noch nicht gestartet." };
  }
  if (slot.role === "DECIDER" && !encounter.decider.required) {
    return {
      assignable: false,
      reason: "Das Entscheidungsdoppel wird erst bei Gleichstand gebraucht.",
    };
  }
  for (const side of ["HOME", "AWAY"] as const) {
    const occupancy = side === "HOME" ? slot.home : slot.away;
    if (occupancy.complete) continue;
    const what =
      slot.discipline === "DOUBLES"
        ? "hat die Doppelpaarung noch nicht gemeldet"
        : "hat diese Aufstellungsposition nicht besetzt";
    return { assignable: false, reason: `${sideLabel(side)} ${what}.` };
  }
  return { assignable: true, reason: null };
}

/** Die Doppel, für die diese Seite noch eine Paarung schuldet. */
export function openDoublesSlots(
  encounter: EncounterDetail,
  side: EncounterSide,
): readonly EncounterSlotView[] {
  return encounter.slots.filter((slot) => {
    if (slot.discipline !== "DOUBLES") return false;
    if (slot.status !== "WAITING") return false;
    if (slot.role === "DECIDER" && !encounter.decider.required) return false;
    return !(side === "HOME" ? slot.home : slot.away).complete;
  });
}

export interface SubstitutionPosition {
  readonly position: number;
  readonly playerId: string;
  readonly displayName: string;
}

export interface SubstitutionContext {
  readonly minimumSequence: number;
  readonly used: number;
  readonly remaining: number;
  readonly positions: readonly SubstitutionPosition[];
  readonly available: readonly { readonly playerId: string; readonly displayName: string }[];
}

/**
 * Reglement 2.2.4 und 2.2.10: nie während einer laufenden Paarung, höchstens
 * `maxSubstitutionsPerEncounter` je Begegnung, und die einwechselnde Person
 * muss gemeldet sein.
 */
export function substitutionContext(
  encounter: EncounterDetail,
  side: EncounterSide,
): SubstitutionContext {
  const lineup = lineupOf(encounter, side);
  const startedSequences = encounter.slots
    .filter((slot) => slot.status !== "WAITING" && slot.status !== "READY")
    .map((slot) => slot.sequence);
  const minimumSequence = startedSequences.length === 0 ? 1 : Math.max(...startedSequences) + 1;

  const current = new Map<number, { readonly playerId: string; readonly displayName: string }>();
  for (const nomination of lineup.nominations) {
    if (nomination.position === null) continue;
    current.set(nomination.position, {
      playerId: nomination.playerId,
      displayName: nomination.displayName,
    });
  }
  const ordered = [...lineup.substitutions].sort(
    (first, second) => first.effectiveFromSequence - second.effectiveFromSequence,
  );
  const replaced = new Set<string>();
  for (const substitution of ordered) {
    current.set(substitution.position, {
      playerId: substitution.inPlayerId,
      displayName: substitution.inDisplayName,
    });
    replaced.add(substitution.outPlayerId);
  }

  const inLineup = new Set([...current.values()].map((entry) => entry.playerId));
  const used = lineup.substitutions.length;
  return {
    minimumSequence,
    used,
    remaining: Math.max(0, encounter.maxSubstitutionsPerEncounter - used),
    positions: [...current.entries()]
      .map(([position, entry]) => ({ position, ...entry }))
      .sort((first, second) => first.position - second.position),
    available: lineup.nominations
      .filter((entry) => !inLineup.has(entry.playerId) && !replaced.has(entry.playerId))
      .map((entry) => ({ playerId: entry.playerId, displayName: entry.displayName })),
  };
}

export interface EncounterTally {
  readonly decided: number;
  readonly running: number;
  readonly total: number;
}

/** Ein abbestellter Entscheidungsslot zählt nirgends mit (Spec, A1.4). */
export function encounterTally(encounter: EncounterDetail): EncounterTally {
  const counted = encounter.slots.filter((slot) => slot.status !== "CANCELLED");
  return {
    decided: counted.filter((slot) => slot.status === "COMPLETED" || slot.status === "WALKOVER")
      .length,
    running: counted.filter((slot) => slot.status === "IN_PROGRESS").length,
    total: counted.length,
  };
}

export function deciderNotice(encounter: EncounterDetail): string | null {
  switch (encounter.decider.status) {
    case "REQUIRED":
      return `Gleichstand nach den regulären Spielen. Das Entscheidungsdoppel (Spiel ${encounter.decider.slotSequence}) wird gebraucht; beide Seiten melden dafür eine Paarung.`;
    case "NOT_REQUIRED":
      return "Das Entscheidungsdoppel wird nicht gebraucht.";
    case "COMPLETED":
      return "Das Entscheidungsdoppel ist gespielt.";
    default:
      return null;
  }
}
```

- [ ] **Schritt 4: Lauf zur Bestätigung, dass er besteht**

```bash
pnpm --filter @darts-platform/web test
```

Erwartet: PASS, alle Tests aus Task 1 und 2.

- [ ] **Schritt 5: Commit**

```bash
git add apps/web/src/lib/encounter-view.ts apps/web/src/lib/encounter-view.spec.ts
git commit -m "feat: derive the encounter leadership view from the server state"
```

---

## Task 3: Vorlagengenerator für den Wettbewerb

Die achtzehn Slots von Hand einzutippen ist die Stelle, an der ein
Rundenturnier schiefgeht. `validateEncounterTemplate` im `league-engine`
verlangt: jede Heimposition tritt gegen jede Gastposition genau einmal an,
lückenlose Sequenz ab 1, höchstens ein Entscheidungsslot mit höchster
Sequenz, Doppel. Der Generator erzeugt genau das; das Formular zeigt das
Ergebnis und lässt es ändern.

**Files:**
- Create: `apps/web/src/lib/league-template.ts`
- Test: `apps/web/src/lib/league-template.spec.ts`

**Interfaces:**
- Consumes: `CompetitionSlotInput` aus `@darts-platform/schemas`.
- Produces:
  ```ts
  interface TemplateOptions {
    readonly lineupPositions: number;
    readonly singlesStartingScore: 301 | 501 | 701;
    readonly doublesStartingScore: 301 | 501 | 701;
    readonly inRule: "STRAIGHT" | "DOUBLE";
    readonly outRule: "SINGLE" | "DOUBLE" | "MASTER";
    readonly bestOfLegs: number;
    readonly maxRounds: number | null;
    readonly regularDoubles: number;
    readonly withDecider: boolean;
  }
  const vfcTemplateOptions: TemplateOptions;
  function buildEncounterTemplate(options: TemplateOptions): readonly CompetitionSlotInput[];
  ```

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`apps/web/src/lib/league-template.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildEncounterTemplate, vfcTemplateOptions } from "./league-template";

describe("buildEncounterTemplate", () => {
  const slots = buildEncounterTemplate(vfcTemplateOptions);

  it("baut den Modus aus Reglement 2.2.8", () => {
    expect(slots).toHaveLength(19);
    expect(slots.map((slot) => slot.sequence)).toEqual(
      Array.from({ length: 19 }, (_, index) => index + 1),
    );
    const disciplines = slots.map((slot) => slot.discipline);
    expect(disciplines.slice(0, 8)).toEqual(Array.from({ length: 8 }, () => "SINGLES"));
    expect(disciplines.slice(8, 10)).toEqual(["DOUBLES", "DOUBLES"]);
    expect(disciplines.slice(10, 18)).toEqual(Array.from({ length: 8 }, () => "SINGLES"));
    expect(disciplines[18]).toBe("DOUBLES");
  });

  it("spielt jede Heimposition genau einmal gegen jede Gastposition", () => {
    const pairings = slots
      .filter((slot) => slot.discipline === "SINGLES")
      .map((slot) => `${slot.homePosition}-${slot.awayPosition}`);
    expect(pairings).toHaveLength(16);
    expect(new Set(pairings).size).toBe(16);
  });

  it("gibt jeder Person vier Einzel, verteilt ueber alle vier Runden", () => {
    for (let position = 1; position <= 4; position += 1) {
      const asHome = slots.filter((slot) => slot.homePosition === position);
      const asAway = slots.filter((slot) => slot.awayPosition === position);
      expect(asHome).toHaveLength(4);
      expect(asAway).toHaveLength(4);
    }
  });

  it("traegt genau einen Entscheidungsslot, als Doppel mit hoechster Sequenz", () => {
    const deciders = slots.filter((slot) => slot.role === "DECIDER");
    expect(deciders).toHaveLength(1);
    expect(deciders[0]).toMatchObject({
      sequence: 19,
      discipline: "DOUBLES",
      startingScore: 701,
      homePosition: null,
      awayPosition: null,
    });
  });

  it("setzt Startscore und Variante je Disziplin", () => {
    expect(slots[0]).toMatchObject({
      startingScore: 501,
      inRule: "DOUBLE",
      outRule: "DOUBLE",
      bestOfLegs: 3,
      legsToWinSet: 2,
      setsToWin: 1,
      maxRounds: null,
    });
    expect(slots[8]).toMatchObject({ startingScore: 701, discipline: "DOUBLES" });
  });

  it("beschriftet die Spiele so, wie der Spielrapport sie fuehrt", () => {
    expect(slots[0].label).toBe("Einzel 1 · Heim 1 gegen Gast 1");
    expect(slots[8].label).toBe("Doppel 1");
    expect(slots[18].label).toBe("Entscheidungsdoppel");
  });

  it("kommt auch ohne Entscheidungsdoppel und mit anderer Groesse aus", () => {
    const small = buildEncounterTemplate({
      ...vfcTemplateOptions,
      lineupPositions: 2,
      regularDoubles: 1,
      withDecider: false,
    });
    expect(small).toHaveLength(5);
    expect(small.filter((slot) => slot.discipline === "SINGLES")).toHaveLength(4);
    expect(small.filter((slot) => slot.role === "DECIDER")).toHaveLength(0);
    expect(small.map((slot) => slot.sequence)).toEqual([1, 2, 3, 4, 5]);
  });
});
```

- [ ] **Schritt 2: Lauf zur Bestätigung, dass er fehlschlägt**

```bash
pnpm --filter @darts-platform/web test league-template
```

Erwartet: FAIL, `Failed to load ./league-template`.

- [ ] **Schritt 3: `league-template.ts` schreiben**

```ts
import type { CompetitionSlotInput, InRule, OutRule } from "@darts-platform/schemas";

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
 * Reglement 2.2.8, Nationalliga (1.1): vier Runden zu vier Einzel 501
 * DI/DO, die beiden Doppel 701 nach Runde 2, bei Gleichstand ein
 * Entscheidungsdoppel. Jedes Spiel geht auf zwei Gewinnsätze (A1.2).
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
 * Die Einzel sind ein vollständiges Rundenturnier: in Runde `r` trifft
 * Heimposition `i` auf Gastposition `((i + r - 2) mod n) + 1`. Über `n`
 * Runden tritt damit jede Heimposition genau einmal gegen jede
 * Gastposition an — die Bedingung, die `validateEncounterTemplate` prüft.
 * Die Doppel folgen der Hälfte der Runden, wie es der Modus vorsieht.
 */
export function buildEncounterTemplate(
  options: TemplateOptions,
): readonly CompetitionSlotInput[] {
  const positions = options.lineupPositions;
  const doublesAfterRound = Math.ceil(positions / 2);
  const slots: CompetitionSlotInput[] = [];
  let sequence = 1;
  let singlesNumber = 1;
  let doublesNumber = 1;

  const singles = (homePosition: number, awayPosition: number): CompetitionSlotInput => ({
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
    legsToWinSet: (options.bestOfLegs + 1) / 2,
    setsToWin: 1,
  });

  const doubles = (role: "REGULAR" | "DECIDER"): CompetitionSlotInput => ({
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
    legsToWinSet: (options.bestOfLegs + 1) / 2,
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

- [ ] **Schritt 4: Lauf zur Bestätigung, dass er besteht**

```bash
pnpm --filter @darts-platform/web test
```

Erwartet: PASS.

- [ ] **Schritt 5: Commit**

```bash
git add apps/web/src/lib/league-template.ts apps/web/src/lib/league-template.spec.ts
git commit -m "feat: generate the round robin encounter template"
```

---

## Task 4: Realtime-Kanal der Begegnung

**Files:**
- Modify: `apps/web/src/lib/realtime.ts`

**Interfaces:**
- Produces:
  ```ts
  function connectEncounterRealtime(input: {
    readonly encounterId: string;
    readonly onChange: () => void;
    readonly onConnection: (connection: RealtimeConnection) => void;
  }): () => void
  ```

- [ ] **Schritt 1: `connectEncounterRealtime` ergänzen**

In `apps/web/src/lib/realtime.ts`, hinter `connectTournamentRealtime`. Die
gemeinsame Verbindungsmechanik wird herausgezogen, damit beide Räume
denselben Weg gehen und nur der Kanalname sich unterscheidet:

```ts
function connectRoom(input: {
  readonly subscribeEvent: string;
  readonly subscribePayload: Record<string, string>;
  readonly changeEvent: string;
  readonly onChange: () => void;
  readonly onConnection: (connection: RealtimeConnection) => void;
}): () => void {
  const endpoint = new URL(publicEnvironment.NEXT_PUBLIC_API_URL);
  endpoint.pathname = "";
  const socket: Socket = io(endpoint.origin, { withCredentials: true });
  input.onConnection("verbindet");
  socket.on("connect", () => {
    input.onConnection("verbunden");
    socket.emit(input.subscribeEvent, input.subscribePayload);
  });
  socket.on("disconnect", () => input.onConnection("getrennt"));
  socket.on("connect_error", () => input.onConnection("getrennt"));
  socket.on(input.changeEvent, input.onChange);
  return () => socket.disconnect();
}

export function connectTournamentRealtime(input: {
  readonly tournamentId: string;
  readonly onChange: () => void;
  readonly onConnection: (connection: RealtimeConnection) => void;
}): () => void {
  return connectRoom({
    subscribeEvent: "tournament:subscribe",
    subscribePayload: { tournamentId: input.tournamentId },
    changeEvent: "tournament:changed",
    onChange: input.onChange,
    onConnection: input.onConnection,
  });
}

/** Phase-5-Schnittstelle: Raum `encounter:<id>`, Ereignis `encounter:changed`. */
export function connectEncounterRealtime(input: {
  readonly encounterId: string;
  readonly onChange: () => void;
  readonly onConnection: (connection: RealtimeConnection) => void;
}): () => void {
  return connectRoom({
    subscribeEvent: "encounter:subscribe",
    subscribePayload: { encounterId: input.encounterId },
    changeEvent: "encounter:changed",
    onChange: input.onChange,
    onConnection: input.onConnection,
  });
}
```

- [ ] **Schritt 2: Gegen den Server prüfen**

```bash
grep -n "encounter:subscribe\|encounter:changed" apps/realtime/src/*.ts apps/api/src/realtime/*.ts
```

Erwartet: beide Namen kommen serverseitig genau so vor. Weichen sie ab, gilt
der Server, und dieser Schritt wird angepasst statt der Server.

- [ ] **Schritt 3: Typecheck und Commit**

```bash
pnpm --filter @darts-platform/web typecheck
git add apps/web/src/lib/realtime.ts
git commit -m "feat: subscribe the web client to the encounter room"
```

---

## Task 5: Teams und Kader

**Files:**
- Create: `apps/web/src/components/league/team-roster.tsx`
- Create: `apps/web/src/app/teams/page.tsx`

**Interfaces:**
- Consumes: `teamListSchema`, `teamSchema`, `playerListSchema`,
  `createTeamSchema`, `addTeamMemberSchema` aus `@darts-platform/schemas`;
  `WorkspaceShell` ist hier **nicht** passend (dunkles Thema) — die Fläche
  läuft im Sektorenring wie `tournament-list.tsx`.
- Produces: `TeamRoster` (Props:
  `{ readonly requestedOrganizationId: string | undefined }`).

- [ ] **Schritt 1: Route anlegen**

`apps/web/src/app/teams/page.tsx`:

```tsx
import type { Metadata } from "next";

import { TeamRoster } from "@/components/league/team-roster";

export const metadata: Metadata = {
  title: "Teams",
  description: "Mannschaften und ihre Kader für den Ligabetrieb.",
};

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function TeamsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const organizationId = typeof query.organisation === "string" ? query.organisation : undefined;
  return <TeamRoster requestedOrganizationId={organizationId} />;
}
```

- [ ] **Schritt 2: `team-roster.tsx` schreiben**

Aufbau, `"use client"` an erster Stelle:

1. `useTournamentOrganization(requestedOrganizationId)` aus
   `@/components/tournament/use-tournament-organization` liefert die
   Organisation und die Auswahl bei mehreren.
2. `canManage = hasOrganizationPermission(organization.role, "team:manage")`.
3. Queries:
   - `["teams", organizationId]` → `GET /organizations/${id}/teams`,
     `teamListSchema`.
   - `["players", organizationId]` → `GET /organizations/${id}/players`,
     `playerListSchema` (für die Kaderauswahl).
4. Mutationen, alle mit `queryClient.invalidateQueries({ queryKey: ["teams", organizationId] })`
   im `onSuccess` und `userFacingErrorMessage(error)` im `onError`:
   - Team anlegen: `POST /organizations/${id}/teams`, Body
     `{ name, shortName }`, Antwortschema `teamSchema`.
   - Mitglied aufnehmen: `POST /organizations/${id}/teams/${teamId}/members`,
     Body `{ playerId, role }`, Antwortschema `teamSchema`.
   - Mitglied entfernen: `DELETE
     /organizations/${id}/teams/${teamId}/members/${playerId}`,
     Antwortschema `teamSchema`.
   - Team archivieren: `PATCH /organizations/${id}/teams/${teamId}`, Body
     `{ status: "ARCHIVED" }`.
5. Formular „Team anlegen" mit React Hook Form und
   `zodResolver(createTeamSchema)`, Felder `name` und `shortName`
   (`Field` + `TextInput`), Absenden mit `Control variant="go"`.
   Fehlermeldungen als Text am Feld über `Field error={...}` — nie nur
   farblich.
6. Je Team ein `Wedge tone="plate"` mit Kopfzeile (Name, Kurzname,
   `StateTag` `ACTIVE` → `tone="free"` / `ARCHIVED` → `tone="blocked"`),
   Kaderliste als `<ul>` mit Name, `PLAYER`/`CAPTAIN` als Wort, Gültigkeit
   `validFrom` über `calendarDate`, und je Zeile ein `Control
   variant="wire" density="tight"` „Aus dem Kader nehmen". Darunter eine
   Auswahl (`SelectInput`) über alle Spieler der Organisation, die noch
   nicht im Kader sind, mit Rollenwahl und `Control` „Aufnehmen".
7. Nur aktive Mitglieder zeigen: `member.validTo === null`. Die Zeitgültigkeit
   ist Serverwissen; die Fläche filtert nur die Anzeige.
8. Zustände, die vorkommen und alle einen Text bekommen: lädt · keine
   Organisation · kein Team angelegt · Team ohne Kader · keine Spieler in der
   Organisation (mit Link auf `/spieler?organisation=…`) · Fehler ·
   fehlende Berechtigung (Listen sichtbar, Bedienelemente nicht gerendert).
9. Am Seitenfuss `Rule` und die Herkunftszeile wie in `tournament-list.tsx`.

- [ ] **Schritt 3: Prüfen**

```bash
pnpm --filter @darts-platform/web typecheck
pnpm lint --max-warnings 0 apps/web/src/components/league apps/web/src/app/teams
```

Erwartet: beide grün.

- [ ] **Schritt 4: Commit**

```bash
git add apps/web/src/app/teams apps/web/src/components/league/team-roster.tsx
git commit -m "feat: manage teams and squads in the web client"
```

---

## Task 6: Wettbewerbe — Liste und Anlage

**Files:**
- Create: `apps/web/src/components/league/competition-list.tsx`
- Create: `apps/web/src/components/league/competition-setup.tsx`
- Create: `apps/web/src/app/liga/page.tsx`
- Create: `apps/web/src/app/liga/neu/page.tsx`

**Interfaces:**
- Consumes: `competitionListSchema`, `competitionDetailSchema`,
  `createCompetitionSchema` aus `@darts-platform/schemas`;
  `buildEncounterTemplate`, `vfcTemplateOptions` aus
  `@/lib/league-template`; `competitionStatusLabel`, `disciplineLabel`,
  `variantLabel` aus `@/lib/league-format`.
- Produces: `CompetitionList`, `CompetitionSetup` (beide Props
  `{ readonly requestedOrganizationId: string | undefined }`).

- [ ] **Schritt 1: Routen anlegen**

`apps/web/src/app/liga/page.tsx` und `apps/web/src/app/liga/neu/page.tsx`
nach demselben Muster wie `apps/web/src/app/teams/page.tsx`:
`searchParams` auflösen, `organisation` durchreichen, `metadata` mit Titel
„Liga" beziehungsweise „Wettbewerb anlegen".

- [ ] **Schritt 2: `competition-list.tsx` schreiben**

Aufbau wie `tournament-list.tsx`, mit denselben Primitiven:

- Query `["competitions", organizationId]` →
  `GET /organizations/${id}/competitions`, `competitionListSchema`.
- `canManage = hasOrganizationPermission(organization.role, "competition:manage")`
  steuert den Link „Wettbewerb anlegen" (`/liga/neu?organisation=…`).
- Je Wettbewerb eine Listenzeile mit Link auf
  `/liga/${competition.id}?organisation=${organization.id}`: Name,
  `slug`, `StateTag` mit `competitionStatusLabel(status)`
  (`ACTIVE` → `live`, `DRAFT` → `waiting`, `COMPLETED` → `finish`,
  `CANCELLED` → `blocked`), `slotCount` Spiele je Begegnung,
  `encounterCount` angesetzte Begegnungen.
- Leerzustand: „Noch kein Wettbewerb angelegt" mit einem Satz, was ein
  Ligawettbewerb trägt (Begegnungsvorlage, Aufstellungs- und Wertungsregeln)
  und dem Anlegen-Control, falls `canManage`.

- [ ] **Schritt 3: `competition-setup.tsx` schreiben**

Ein Formular, dessen Vorlage aus Task 3 kommt und sichtbar bleibt:

1. React Hook Form, Werte:
   ```ts
   interface SetupValues {
     readonly name: string;
     readonly slug: string;
     readonly lineupPositions: number;
     readonly regularDoubles: number;
     readonly withDecider: boolean;
     readonly singlesStartingScore: 301 | 501 | 701;
     readonly doublesStartingScore: 301 | 501 | 701;
     readonly inRule: "STRAIGHT" | "DOUBLE";
     readonly outRule: "SINGLE" | "DOUBLE" | "MASTER";
     readonly bestOfLegs: number;
     readonly maxRounds: number | null;
     readonly pointsWin: number;
     readonly pointsDraw: number;
     readonly pointsLoss: number;
     readonly pointsDeciderBonus: number;
     readonly maxSubstitutionsPerEncounter: number;
     readonly maxDoublesPerPlayer: number;
     readonly minNominations: number;
     readonly minNominationsShorthanded: number;
   }
   ```
   Vorbelegung aus `vfcTemplateOptions` plus `pointsWin: 3`,
   `pointsDraw: 1`, `pointsLoss: 0`, `pointsDeciderBonus: 1`,
   `maxSubstitutionsPerEncounter: 4`, `maxDoublesPerPlayer: 1`,
   `minNominations: 4`, `minNominationsShorthanded: 3`.
2. `slug` wird beim Tippen des Namens vorgeschlagen, solange das Feld nicht
   von Hand geändert wurde: kleinbuchstaben, Umlaute aufgelöst
   (`ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`), alles andere zu `-`, Ränder
   getrimmt — die Regex des Vertrags ist
   `/^[a-z0-9]+(?:-[a-z0-9]+)*$/u`.
3. `useWatch` über die Vorlagenfelder, daraus
   `const slots = useMemo(() => buildEncounterTemplate({...}), [...])`.
   Die erzeugten Slots stehen als Tabelle (`Table`, `Th`, `Td`, `Tr` aus
   `@darts-platform/ui`) unter dem Formular: Sequenz, Beschriftung,
   Disziplin, Paarung (`Heim 1 gegen Gast 1` oder `—`), Variante über
   `variantLabel`, Distanz `Best of {bestOfLegs}`. Darüber eine Zeile
   „{n} Spiele je Begegnung, davon {k} Einzel und {m} Doppel".
4. `deciderRule` ist kein eigenes Feld: `withDecider` setzt
   `deciderRule: "EXTRA_SLOT"` und behält den Zusatzpunkt, sonst
   `deciderRule: "NONE"` und `pointsDeciderBonus: 0`. Das ist die
   Check-Constraint der Tabelle, in einer Bedienung ausgedrückt.
5. Absenden: `POST /organizations/${id}/competitions` mit
   `{ type: "LEAGUE", status: "ACTIVE", ...regeln, slots }`,
   Antwortschema `competitionDetailSchema`, danach
   `router.push(`/liga/${created.id}?organisation=${organization.id}`)`.
6. Fehler aus der API stehen als `Wedge tone="alarm"` über dem Formular mit
   `userFacingErrorMessage(error)` — `TEMPLATE_ROUND_ROBIN_INCOMPLETE` und
   `COMPETITION_SLUG_TAKEN` sind hier die erwarteten Fälle und haben in
   Task 1 ihren Text bekommen.
7. Ohne `competition:manage` wird das Formular nicht gerendert, sondern ein
   Hinweis, dass diese Rolle Wettbewerbe nicht anlegt.

- [ ] **Schritt 4: Prüfen und committen**

```bash
pnpm --filter @darts-platform/web typecheck
pnpm lint --max-warnings 0 apps/web/src/components/league apps/web/src/app/liga
git add apps/web/src/app/liga apps/web/src/components/league
git commit -m "feat: create league competitions with a generated encounter template"
```

---

## Task 7: Wettbewerbsdetail und Begegnung ansetzen

**Files:**
- Create: `apps/web/src/components/league/competition-detail.tsx`
- Create: `apps/web/src/app/liga/[id]/page.tsx`

**Interfaces:**
- Consumes: `competitionDetailSchema`, `encounterListSchema`,
  `encounterDetailSchema`, `teamListSchema`, `createEncounterSchema`.
- Produces: `CompetitionDetail` (Props
  `{ readonly requestedOrganizationId: string | undefined; readonly competitionId: string }`).

- [ ] **Schritt 1: Route anlegen**

`apps/web/src/app/liga/[id]/page.tsx` wie
`apps/web/src/app/turniere/[id]/page.tsx`: `params` und `searchParams`
parallel auflösen, `competitionId={id}` durchreichen.

- [ ] **Schritt 2: `competition-detail.tsx` schreiben**

Drei Abschnitte auf einer Fläche:

1. **Kopf:** Name, `slug`, `StateTag` mit `competitionStatusLabel`,
   Wertungsregeln in einem Satz: „{pointsWin} Punkte für den Sieg, bei
   Gleichstand je {pointsDraw}{Zusatz}. {lineupPositions} Aufstellungs-
   positionen, höchstens {maxSubstitutionsPerEncounter} Auswechslungen je
   Begegnung." Zusatz nur bei `deciderRule === "EXTRA_SLOT"`: „ und ein
   Zusatzpunkt für den Sieger des Entscheidungsdoppels".
2. **Vorlage:** dieselbe Tabelle wie im Setup, aus
   `competitionDetailSchema.slots`. In einem `<details>` zusammengeklappt,
   Zusammenfassung „Begegnungsvorlage · {slots.length} Spiele".
3. **Begegnungen:** Query `["encounters", organizationId, competitionId]` →
   `GET /organizations/${id}/competitions/${competitionId}/encounters`,
   `encounterListSchema`. Liste, absteigend nach `matchday`, je Zeile Link
   auf `/liga/begegnungen/${encounter.id}?organisation=${id}`:
   Spieltag, `homeTeamName` gegen `awayTeamName`, `calendarDate` und
   `clockTime` aus `@/lib/tournament-format`, `venue`, `StateTag` mit
   `encounterStatusLabel`/`encounterTone`, und der Stand
   „{homePoints}:{awayPoints} Punkte · {homeGames}:{awayGames} Spiele ·
   {homeLegs}:{awayLegs} Sätze".
4. **Ansetzen** (nur mit `encounter:manage`): Formular mit
   `zodResolver(createEncounterSchema)` — `matchday` (Zahl),
   `homeTeamId`/`awayTeamId` (`SelectInput` über
   `GET /organizations/${id}/teams`, nur `status === "ACTIVE"`),
   `scheduledAt` (`TextInput type="datetime-local"`, beim Absenden über
   `new Date(value)`), `venue`. `POST
   /organizations/${id}/competitions/${competitionId}/encounters`,
   Antwortschema `encounterDetailSchema`, danach auf die neue Begegnung
   navigieren. Gleiche Mannschaft auf beiden Seiten wird im Formular
   verhindert (die Gastauswahl blendet das gewählte Heimteam aus) — der
   Server prüft es ohnehin über die Check-Constraint.
5. Leerzustand „Noch keine Begegnung angesetzt" mit einem Satz zum Ablauf:
   ansetzen, beide Meldungen erfassen, starten.

- [ ] **Schritt 3: Prüfen und committen**

```bash
pnpm --filter @darts-platform/web typecheck
pnpm lint --max-warnings 0 apps/web/src/components/league apps/web/src/app/liga
git add apps/web/src/app/liga apps/web/src/components/league/competition-detail.tsx
git commit -m "feat: show a competition and schedule its encounters"
```

---

## Task 8: Kommandohook der Begegnung

Jede der zehn Mutationen an einer Begegnung folgt derselben Mechanik:
frische `commandId`, `expectedVersion` aus dem zuletzt gesehenen Zustand,
Antwort ist der neue `EncounterDetail`, ein 409 trägt den Serverzustand im
Fehler. Sie steht einmal hier, nicht zehnmal in Komponenten.

**Files:**
- Create: `apps/web/src/components/league/use-encounter-command.ts`

**Interfaces:**
- Produces:
  ```ts
  interface EncounterConflict { readonly expected: number; readonly server: number; readonly currentState: EncounterDetail }
  interface EncounterCommands {
    readonly encounter: EncounterDetail | undefined;
    readonly isPending: boolean;
    readonly busy: boolean;
    readonly error: string | null;
    readonly conflict: EncounterConflict | null;
    readonly announcement: string;
    readonly realtime: RealtimeConnection;
    readonly acceptServerState: () => void;
    readonly run: (input: {
      readonly path: string;
      readonly body: Record<string, unknown>;
      readonly announce: string;
    }) => Promise<boolean>;
  }
  function useEncounterCommand(input: {
    readonly organizationId: string;
    readonly encounterId: string;
  }): EncounterCommands
  ```

- [ ] **Schritt 1: Hook schreiben**

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { encounterDetailSchema, type EncounterDetail } from "@darts-platform/schemas";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiClientError, apiRequest, userFacingErrorMessage } from "@/lib/api-client";
import { generateId } from "@/lib/id";
import { connectEncounterRealtime, type RealtimeConnection } from "@/lib/realtime";
```

Inhalt:

1. `queryKey = useMemo(() => ["encounter", organizationId, encounterId] as const, [...])`.
2. `useQuery` auf `GET /organizations/${organizationId}/encounters/${encounterId}`
   mit `encounterDetailSchema`. `refetchInterval: realtime === "verbunden" ? false : 5_000`
   — dieselbe Regel wie in `live-tournament.tsx`: Polling nur, solange die
   Echtzeitverbindung fehlt.
3. `useEffect(() => connectEncounterRealtime({ encounterId, onChange: () => void queryClient.invalidateQueries({ queryKey }), onConnection: setRealtime }), [...])`.
4. `run` schickt `{ commandId: generateId(), expectedVersion: encounter.version, ...body }`
   als `POST` an `path`, parst die Antwort mit `encounterDetailSchema`,
   schreibt sie mit `queryClient.setQueryData(queryKey, next)`, setzt
   `announcement` auf `announce` und gibt `true` zurück.
   Ohne geladenen `encounter` oder während `busy` bricht `run` mit `false`
   ab, ohne zu senden.
5. Fehlerbehandlung in `run`, nach dem Vorbild von `conflictState` in
   `command-centre.tsx`:
   ```ts
   function conflictFrom(error: unknown, expected: number): EncounterConflict | null {
     if (!(error instanceof ApiClientError) || error.code !== "ENCOUNTER_VERSION_CONFLICT") return null;
     const details = error.details as { readonly currentState?: unknown } | undefined;
     const parsed = encounterDetailSchema.safeParse(details?.currentState);
     return parsed.success
       ? { expected, server: parsed.data.version, currentState: parsed.data }
       : null;
   }
   ```
   Bei Konflikt `setConflict(...)`, sonst `setError(userFacingErrorMessage(error))`.
   `run` gibt in beiden Fällen `false` zurück.
6. `acceptServerState` schreibt `conflict.currentState` in den Cache, leert
   `conflict` und `error` und meldet „Serverzustand übernommen."

- [ ] **Schritt 2: Typecheck und Commit**

```bash
pnpm --filter @darts-platform/web typecheck
git add apps/web/src/components/league/use-encounter-command.ts
git commit -m "feat: give every encounter command one idempotent path"
```

---

## Task 9: Begegnungsleitung — Gerüst, Kopf und Slotliste

**Files:**
- Create: `apps/web/src/components/league/encounter-route.tsx`
- Create: `apps/web/src/components/league/encounter-command-centre.tsx`
- Create: `apps/web/src/components/league/encounter-scoreline.tsx`
- Create: `apps/web/src/components/league/slot-list.tsx`
- Create: `apps/web/src/app/liga/begegnungen/[id]/page.tsx`

**Interfaces:**
- Consumes: `useEncounterCommand` (Task 8), `slotAvailability`,
  `encounterTally`, `deciderNotice` (Task 2), `slotStatusLabel`, `slotTone`,
  `disciplineLabel`, `slotOutcomeLabel`, `variantLabel`,
  `encounterOutcomeLabel`, `encounterStatusLabel`, `encounterTone` (Task 1),
  `boardListSchema` aus `@darts-platform/schemas`.
- Produces:
  ```ts
  interface EncounterAbilities { readonly manage: boolean; readonly lineup: boolean; readonly score: boolean }
  function EncounterCommandCentre(props: {
    readonly organizationId: string;
    readonly encounterId: string;
    readonly abilities: EncounterAbilities;
  }): ReactElement
  function SlotList(props: {
    readonly encounter: EncounterDetail;
    readonly boards: readonly BoardResponse[];
    readonly organizationId: string;
    readonly canManage: boolean;
    readonly busy: boolean;
    readonly onAssign: (slotId: string, boardId: string) => void;
    readonly onRelease: (slotId: string) => void;
    readonly onWalkover: (slotId: string, winnerSide: EncounterSide, reason: string) => void;
  }): ReactElement
  ```

- [ ] **Schritt 1: Route und `encounter-route.tsx`**

Die Route reicht `id` und `organisation` durch. `encounter-route.tsx` löst
wie `tournament-dashboard-route.tsx` die Organisation auf und bildet die
Rechte exakt wie der Server:

```tsx
const abilities = {
  manage: hasOrganizationPermission(organization.role, "encounter:manage"),
  lineup: hasOrganizationPermission(organization.role, "encounter:lineup"),
  score: hasOrganizationPermission(organization.role, "match:score"),
};
```

- [ ] **Schritt 2: `encounter-scoreline.tsx` schreiben**

Ein `Wedge tone="plate"`, der die Frage „wie steht es?" in einem Blick
beantwortet:

- Zeile 1: `homeTeamName` — `Score` mit `homePoints` — `:` — `awayPoints` —
  `awayTeamName`. Darunter klein „Punkte".
- Zeile 2: zwei weitere Paare in `Score` kleinerer Grösse:
  „{homeGames}:{awayGames} Spiele" und „{homeLegs}:{awayLegs} Sätze".
  Die Reglementswörter, nicht Slots und Legs.
- Zeile 3: `StateTag` mit `encounterStatusLabel(status)` und
  `encounterTone(status)`; `matchday` als „Spieltag {n}"; `calendarDate` und
  `clockTime` von `scheduledAt`; `venue`; `competitionName` als Link auf
  `/liga/${competitionId}?organisation=…`.
- Zeile 4: Fortschritt aus `encounterTally`: „{decided} von {total}
  Spielen entschieden, {running} laufen" mit demselben Balken wie in
  `tournament-list.tsx` (`aria-hidden` auf dem Balken, die Zahl steht als
  Text daneben).
- Ist die Begegnung beendet: eine Zeile `encounterOutcomeLabel({ result, resultType })`
  als Überschrift in `Wedge tone="free"`.

- [ ] **Schritt 3: `slot-list.tsx` schreiben**

Die Arbeitsfläche des Abends. Je Slot eine Zeile in einer `Table`; auf
schmalen Geräten dieselben Angaben als gestapelte `Wedge`-Karten
(`hidden sm:table` / `sm:hidden`, beide aus denselben Daten):

- **Spalte Spiel:** `sequence`, `label`, `disciplineLabel(discipline)`,
  `variantLabel({...})`, „Best of {bestOfLegs}".
- **Spalte Heim / Gast:** die Namen aus `slot.home.players` beziehungsweise
  `slot.away.players`, mit `·` verbunden. Ist `complete === false`, steht
  dort „noch offen" statt eines Namens.
- **Spalte Sätze:** `{homeLegs}:{awayLegs}`.
- **Spalte Zustand:** `StateTag tone={slotTone(status)} label={slotStatusLabel(status)}`,
  darunter bei entschiedenen Spielen `slotOutcomeLabel({ winnerSide, resultType })`
  und bei laufenden der `boardName`.
- **Spalte Handlung**, nur mit `canManage`:
  - Ist `slotAvailability(encounter, slot).assignable`: `SelectInput` über
    die Boards mit `status === "AVAILABLE"` und ein `Control variant="go"`
    „Auf Board starten". Gibt es kein freies Board, steht dort „kein Board
    frei" statt der Auswahl.
  - Sonst der Text aus `slotAvailability(...).reason` — das ist die Antwort
    auf „warum geht das nicht", die sonst niemand gibt.
  - Läuft der Slot (`IN_PROGRESS`): `Control variant="wire"` „Board
    freigeben" (ruft `onRelease`; der Server bricht dabei das Match ab und
    stellt den Slot auf `WAITING` zurück — der Bestätigungstext sagt das:
    „Das laufende Match wird abgebrochen und das Spiel wieder geöffnet.")
    und, mit `abilities.score`, ein Link auf
    `/matches/${slot.matchId}?organisation=…` mit dem Wort „Scoreboard".
  - Ist der Slot `WAITING` und die Begegnung `RUNNING`: ein
    aufklappbares `<details>` „Kampflos werten" mit Seitenwahl
    (`SelectInput` Heim/Gast) und Pflichtbegründung (`TextInput`,
    mindestens 3 Zeichen, Fehlertext am Feld) und `Control variant="danger"`.
    Reglement 2.2.6 verlangt die Begründung; der Vertrag
    `declareSlotWalkoverSchema` erzwingt sie.
- Über der Liste `deciderNotice(encounter)`, wenn es etwas zu sagen hat, in
  einem `Wedge tone="plate"`.

- [ ] **Schritt 4: `encounter-command-centre.tsx` schreiben**

Setzt die Teile zusammen und hält die Kommandos:

1. `const commands = useEncounterCommand({ organizationId, encounterId })`.
2. Query `["boards", organizationId]` →
   `GET /organizations/${organizationId}/boards`, `boardListSchema`.
3. Kommandos als dünne Aufrufe von `commands.run`:
   ```ts
   const start = () => void commands.run({
     path: `/organizations/${organizationId}/encounters/${encounterId}/start`,
     body: {},
     announce: "Die Begegnung läuft.",
   });
   const assign = (slotId: string, boardId: string) => void commands.run({
     path: `/organizations/${organizationId}/encounters/${encounterId}/slots/${slotId}/assign`,
     body: { boardId },
     announce: "Spiel gestartet.",
   });
   const release = (slotId: string) => void commands.run({
     path: `/organizations/${organizationId}/encounters/${encounterId}/slots/${slotId}/release`,
     body: {},
     announce: "Board freigegeben.",
   });
   const walkover = (slotId: string, winnerSide: EncounterSide, reason: string) => void commands.run({
     path: `/organizations/${organizationId}/encounters/${encounterId}/slots/${slotId}/walkover`,
     body: { winnerSide, reason },
     announce: "Spiel kampflos gewertet.",
   });
   const forfeit = (forfeitSide: EncounterSide, reason: string) => void commands.run({
     path: `/organizations/${organizationId}/encounters/${encounterId}/forfeit`,
     body: { forfeitSide, reason },
     announce: "Nichtantritt gewertet.",
   });
   const cancel = (reason: string) => void commands.run({
     path: `/organizations/${organizationId}/encounters/${encounterId}/cancel`,
     body: { reason },
     announce: "Begegnung abgesagt.",
   });
   ```
   Nach jeder Board-Zuweisung müssen auch die Boards neu geladen werden:
   `void queryClient.invalidateQueries({ queryKey: ["boards", organizationId] })`.
4. Banner in dieser Reihenfolge über der Fläche, wie in `command-centre.tsx`:
   Versionskonflikt (`Wedge tone="alarm"` mit „Deine Eingabe ging von Version
   {expected} aus, der Server steht auf {server}." und `Control`
   „Serverzustand übernehmen" → `commands.acceptServerState`), dann
   Befehlsfehler, dann `deciderNotice`.
5. „Begegnung starten": ein `Control variant="go"`, sichtbar mit `manage`,
   aktiv nur bei `status === "READY"`. Daneben der Satz, was beim Start
   passiert: „Meldet eine Seite nur drei Positionen, gelten deren Einzel und
   ein Doppel sofort als kampflos verloren." (Reglement 2.2.5). Bei
   `status === "LINEUPS_OPEN"` stattdessen der Grund: „Es fehlt noch die
   Meldung von {Seite}."
6. „Nichtantritt werten" und „Begegnung absagen" als `<details>` am Fuss der
   Fläche mit Seitenwahl beziehungsweise nur Begründung, jeweils
   `Control variant="danger"` und Pflichttext. Der Hinweis dazu: „Ein
   Nichtantritt wertet die ganze Begegnung 0:3 Punkte, 0:18 Spiele, 0:36
   Sätze." (Reglement 2.1.1, 2.5.1).
7. Layout wie das Turnierpendant: `sektorenring min-h-screen`, oben eine
   Navigation mit Links auf `/liga/{competitionId}` und die öffentliche
   Ansicht `/live/begegnungen/{publicId}`, dann `EncounterScoreline`, dann
   das Raster `xl:grid-cols-[minmax(0,1fr)_24rem]` mit `SlotList` links und
   den Panels aus Task 10 rechts.
8. Am Fuss `Rule` und „Serverstand · Echtzeit {commands.realtime}", dazu
   `<p aria-live="polite" className="sr-only" role="status">{commands.announcement}</p>`.

- [ ] **Schritt 5: Prüfen und committen**

```bash
pnpm --filter @darts-platform/web typecheck
pnpm lint --max-warnings 0 apps/web/src/components/league apps/web/src/app/liga
git add apps/web/src/app/liga apps/web/src/components/league
git commit -m "feat: run an encounter from the web leadership surface"
```

---

## Task 10: Meldung, Doppelpaarungen und Auswechslung

**Files:**
- Create: `apps/web/src/components/league/lineup-panel.tsx`
- Create: `apps/web/src/components/league/doubles-panel.tsx`
- Create: `apps/web/src/components/league/substitution-panel.tsx`
- Modify: `apps/web/src/components/league/encounter-command-centre.tsx`

**Interfaces:**
- Consumes: `substitutionContext`, `openDoublesSlots` (Task 2),
  `originLabel`, `sideLabel` (Task 1), `teamSchema` für den Kader.
- Produces:
  ```ts
  function LineupPanel(props: {
    readonly encounter: EncounterDetail;
    readonly side: EncounterSide;
    readonly squad: readonly TeamMember[];
    readonly players: readonly PlayerResponse[];
    readonly canEdit: boolean;
    readonly busy: boolean;
    readonly onSubmit: (side: EncounterSide, nominations: readonly { position: number | null; playerId: string; origin: "SQUAD" | "GUEST" }[]) => void;
  }): ReactElement
  function DoublesPanel(props: {
    readonly encounter: EncounterDetail;
    readonly side: EncounterSide;
    readonly canEdit: boolean;
    readonly busy: boolean;
    readonly onSubmit: (side: EncounterSide, pairings: readonly { sequence: number; playerIds: readonly [string, string] }[]) => void;
  }): ReactElement
  function SubstitutionPanel(props: {
    readonly encounter: EncounterDetail;
    readonly side: EncounterSide;
    readonly canEdit: boolean;
    readonly busy: boolean;
    readonly onSubmit: (input: { side: EncounterSide; position: number; outPlayerId: string; inPlayerId: string; effectiveFromSequence: number; reason: string | null }) => void;
  }): ReactElement
  ```

- [ ] **Schritt 1: `lineup-panel.tsx` schreiben**

Der Spielrapport einer Seite, in der Reihenfolge des Abends:

1. Kopf: `sideLabel(side)`, `teamName`, und der Meldezustand als Wort:
   „gemeldet" (`submitted`), „offen" sonst.
2. **Verdeckte gegnerische Meldung.** Ist `submitted === true` und
   `revealed === false`, zeigt das Panel keine Namen, sondern den Satz:
   „Gemeldet. Die Aufstellung wird sichtbar, sobald beide Seiten gemeldet
   haben (Reglement 2.1.1)." Die Liste bleibt leer, weil der Server sie leer
   liefert — die Oberfläche versteckt nichts selbst, sie erklärt die Lücke.
3. Ist `revealed === true`: `<ol>` mit den Positionen 1 bis
   `lineupPositions` (Name oder „nicht besetzt") und darunter die Meldungen
   ohne Position als „Ersatz: …", jeweils mit `originLabel(origin)`, wenn
   `origin === "GUEST"`.
4. **Formular** (nur mit `canEdit` und solange
   `status === "DRAFT" | "LINEUPS_OPEN" | "READY"`): je Aufstellungsposition
   eine `SelectInput` über den Kader des Teams zum Ansetzungszeitpunkt
   (`squad`, gefiltert auf `validTo === null`) plus, unter der Trennlinie
   „Aushilfe (Reglement 1.2.3)", die übrigen Spieler der Organisation. Wer
   aus dem zweiten Block gewählt wird, geht mit `origin: "GUEST"` mit, alle
   anderen mit `"SQUAD"`. Darunter ein Feld „Ersatz" mit derselben Auswahl,
   das mit `position: null` gemeldet wird; per `Control variant="wire"`
   „Weitere Person" lassen sich mehrere anlegen.
5. Eine Position darf leer bleiben: der Vertrag lässt drei Positionen zu
   (`minNominationsShorthanded`). Bleiben weniger als
   `minNominationsShorthanded` besetzt, ist das Absenden gesperrt und der
   Hinweis lautet: „Mit weniger als {n} Personen wird die Begegnung nicht
   gestartet, sondern als Nichtantritt gewertet." Bleiben genau drei besetzt:
   „Mit drei Personen gelten die Einzel der vierten Position und ein Doppel
   als kampflos verloren (Reglement 2.2.5)." — als Text, bevor gesendet wird.
6. Doppelt gewählte Personen werden im Formular erkannt und stehen als
   Fehler am zweiten Feld: „Diese Person ist bereits an Position {k}
   gemeldet." Der Server weist es zusätzlich mit
   `NOMINATION_DUPLICATE_PLAYER` ab.
7. Absenden ruft `onSubmit(side, nominations)`; die Komponente selbst schickt
   nichts.

- [ ] **Schritt 2: `doubles-panel.tsx` schreiben**

1. `const open = openDoublesSlots(encounter, side)`. Ist die Liste leer und
   sind alle Doppel besetzt: „Alle Doppelpaarungen sind gemeldet."
2. Je offenem Slot ein Block mit `label` und zwei `SelectInput` über alle
   **gemeldeten** Personen dieser Seite (`encounter[side].nominations`) —
   auch die Ersatzpersonen, denn nach Reglement 2.2.1 sind sie
   spielberechtigt. Dieselbe Person in beiden Feldern wird im Formular als
   Fehler am zweiten Feld abgewiesen.
3. Über der Liste der Hinweis, der die Regel trägt: bei einem regulären
   Doppel „Jede Person spielt höchstens {maxDoublesPerPlayer} reguläres
   Doppel."; beim Entscheidungsslot „Im Entscheidungsdoppel darf jede
   gemeldete Person erneut antreten (Reglement 2.2.1)."
4. Personen, die bereits in einem anderen **regulären** Doppel dieser Seite
   stehen, werden in der Auswahl mit dem Zusatz „· spielt Doppel {k}"
   geführt und für weitere reguläre Doppel nicht angeboten; für den
   Entscheidungsslot bleiben sie wählbar.
5. Absenden schickt alle ausgefüllten Paarungen dieser Seite in einem
   Aufruf: `onSubmit(side, pairings)`.

- [ ] **Schritt 3: `substitution-panel.tsx` schreiben**

1. `const context = substitutionContext(encounter, side)`.
2. Kopf: „{context.used} von {maxSubstitutionsPerEncounter} Auswechslungen
   verbraucht".
3. Historie als `<ol>`: „{outDisplayName} → {inDisplayName}, Position
   {position}, ab Spiel {effectiveFromSequence}" plus `reason`, wenn
   vorhanden.
4. Formular (nur mit `canEdit`, `status === "RUNNING"` und
   `context.remaining > 0`): Position (`SelectInput` über
   `context.positions`, zeigt „Position {n} · {displayName}"),
   Ersatzperson (`SelectInput` über `context.available`), „ab Spiel"
   (`TextInput type="number"`, Vorgabe und Minimum `context.minimumSequence`),
   Begründung (optional, 3 bis 200 Zeichen). `outPlayerId` kommt aus der
   gewählten Position, nicht aus einem eigenen Feld — die Person an einer
   Position ist Serverwissen.
5. Ist `context.available` leer: „Für diese Seite ist keine weitere Person
   gemeldet. Nur gemeldete Personen dürfen eingewechselt werden."
6. Ist `context.remaining === 0`: „Das Kontingent dieser Begegnung ist
   erschöpft." und kein Formular.
7. Der Hinweis unter dem Formular trägt die Regel, die sonst überrascht:
   „Eine ausgewechselte Person bestreitet an diesem Abend kein weiteres
   Einzel, bleibt für die Doppel aber spielberechtigt (Reglement 2.2.4)."

- [ ] **Schritt 4: Panels einhängen**

In `encounter-command-centre.tsx` die drei Kommandos ergänzen und die Panels
in der rechten Spalte rendern, Heim vor Gast:

```ts
const submitNominations = (side, nominations) => void commands.run({
  path: `/organizations/${organizationId}/encounters/${encounterId}/nominations`,
  body: { side, nominations },
  announce: `Meldung ${side === "HOME" ? "Heim" : "Gast"} erfasst.`,
});
const submitDoubles = (side, pairings) => void commands.run({
  path: `/organizations/${organizationId}/encounters/${encounterId}/doubles`,
  body: { side, pairings },
  announce: "Doppelpaarung erfasst.",
});
const substitute = (input) => void commands.run({
  path: `/organizations/${organizationId}/encounters/${encounterId}/substitutions`,
  body: input,
  announce: "Auswechslung erfasst.",
});
```

Der Kader je Seite kommt aus `GET /organizations/${organizationId}/teams`
(Query `["teams", organizationId]`, `teamListSchema`), gefiltert auf
`homeTeamId` beziehungsweise `awayTeamId`; die Aushilfen-Auswahl aus
`GET /organizations/${organizationId}/players` (`playerListSchema`).

- [ ] **Schritt 5: Prüfen und committen**

```bash
pnpm --filter @darts-platform/web typecheck
pnpm lint --max-warnings 0 apps/web/src/components/league
git add apps/web/src/components/league
git commit -m "feat: capture nominations, doubles pairings and substitutions"
```

---

## Task 11: Scoreboard im Doppel

Das bestehende Scoreboard zeigt je Seite genau einen Namen. Im Doppel muss es
beide zeigen und die werfende Person hervorheben; bedient wird es unverändert
(Spec, Abschnitt „Scoring").

**Files:**
- Modify: `apps/web/src/components/match/match-scoreboard.tsx:143-170`

- [ ] **Schritt 1: Die Seitenanzeige umbauen**

Heute steht dort ein Name je Seite (`participant.displayName`). Künftig
werden `participant.players` gerendert:

```tsx
<p className="truncate text-sm font-semibold text-slate-300">
  {participant.players.map((person, index) => (
    <span key={person.playerId}>
      {index > 0 ? <span aria-hidden="true"> · </span> : null}
      <span className={person.isThrowing ? "text-white underline decoration-emerald-400 decoration-2 underline-offset-4" : ""}>
        {person.displayName}
        {person.isThrowing ? <span className="sr-only"> (am Wurf)</span> : null}
      </span>
    </span>
  ))}
</p>
```

Die Hervorhebung trägt Unterstreichung **und** Text für Screenreader; Farbe
allein wäre nach AGENTS.md §19 zu wenig.

- [ ] **Schritt 2: `aria-label` des Restscores mitziehen**

`aria-label={`${participant.displayName}, Restscore`}` wird zu
`aria-label={`${participant.players.map((person) => person.displayName).join(" und ")}, Restscore`}`.

- [ ] **Schritt 3: Den Gewinnersatz auf die Seite beziehen**

`match.participants.find((player) => player.playerId === match.winnerPlayerId)?.displayName`
findet im Doppel nur die erste Person. Künftig:

```tsx
{match.participants
  .find((participant) => participant.players.some((person) => person.playerId === match.winnerPlayerId))
  ?.players.map((person) => person.displayName)
  .join(" und ")} gewinnt
```

- [ ] **Schritt 4: Prüfen und committen**

Der Visit-Pfad bleibt unverändert: `playerId: match.currentPlayerId` ist
bereits der tatsächliche Werfer (`matches.repository.ts:167` setzt
`currentPlayerId` auf `activeThrowerPlayerId`).

```bash
pnpm --filter @darts-platform/web typecheck
pnpm lint --max-warnings 0 apps/web/src/components/match
git add apps/web/src/components/match/match-scoreboard.tsx
git commit -m "feat: show both names of a side and the thrower on the scoreboard"
```

---

## Task 12: Öffentliche Begegnungsansicht

**Files:**
- Create: `apps/web/src/components/live/live-encounter.tsx`
- Create: `apps/web/src/app/live/begegnungen/[publicId]/page.tsx`

**Interfaces:**
- Consumes: `publicEncounterSchema`; `slotStatusLabel`, `slotOutcomeLabel`,
  `disciplineLabel`, `encounterOutcomeLabel` aus `@/lib/league-format`.
- Produces: `LiveEncounter` (Props `{ readonly publicId: string }`).

- [ ] **Schritt 1: Route anlegen**

```tsx
import type { Metadata } from "next";

import { LiveEncounter } from "@/components/live/live-encounter";

export const metadata: Metadata = { title: "Begegnung live · DartBase" };

export default async function LiveEncounterPage({
  params,
}: {
  readonly params: Promise<{ readonly publicId: string }>;
}) {
  const { publicId } = await params;
  return <LiveEncounter publicId={publicId} />;
}
```

- [ ] **Schritt 2: `live-encounter.tsx` schreiben**

Dunkles Thema wie `live-tournament.tsx`, ohne Bedienelemente:

1. Query `["public-encounter", publicId]` → `GET /public/encounters/${publicId}`,
   `publicEncounterSchema`, `refetchInterval: 15_000`. Die öffentliche
   Ansicht kennt die interne `encounterId` nicht und tritt deshalb keinem
   Socket-Raum bei; sie aktualisiert über das Intervall. Das ist bewusst:
   der Socket-Raum heisst nach der internen id, und die gehört nicht ins
   Publikum.
2. Kopf: `competitionName`, „Spieltag {matchday}", `homeTeamName` gegen
   `awayTeamName`, Datum und Zeit, `venue`, dazu der Verbindungspunkt wie in
   `live-tournament.tsx` — hier mit dem Wort „aktualisiert alle 15 Sekunden".
3. Grosser Stand: Punkte, darunter Spiele und Sätze, jeweils beschriftet.
   Ist `result !== null`, darunter `encounterOutcomeLabel({ result, resultType })`.
4. Die Spiele als Liste, in Sequenzreihenfolge: `label`,
   `disciplineLabel`, die Namen beider Seiten (`home.players`,
   `away.players`, verbunden mit „ · "), `{homeLegs}:{awayLegs}`,
   `slotStatusLabel(status)` als Wort und `slotOutcomeLabel(...)`. Ein
   laufendes Spiel trägt zusätzlich `boardName` und eine sichtbare Marke,
   die **nicht** nur farblich ist („läuft" steht als Wort da).
5. `CANCELLED`-Slots — der ungenutzte Entscheidungsslot — werden mit dem
   Wort „entfällt" gezeigt und nicht ausgeblendet, damit die Zählung der
   achtzehn Spiele aufgeht.
6. Zustände: lädt · nicht gefunden (der Endpunkt antwortet 404, der Text
   lautet „Diese Begegnung gibt es nicht oder sie ist nicht öffentlich.") ·
   noch nicht gestartet · beendet.

- [ ] **Schritt 3: Prüfen und committen**

```bash
pnpm --filter @darts-platform/web typecheck
pnpm lint --max-warnings 0 apps/web/src/components/live apps/web/src/app/live
git add apps/web/src/app/live apps/web/src/components/live/live-encounter.tsx
git commit -m "feat: publish the encounter live view"
```

---

## Task 13: Wege zu den neuen Flächen

Ohne Navigation ist die Fläche unerreichbar. Zwei Einträge, an derselben
Stelle wie „Spieler & Team" und „Matches".

**Files:**
- Modify: `apps/web/src/components/tenant-dashboard.tsx:293-303`

- [ ] **Schritt 1: Einträge ergänzen**

Im `<nav className="grid gap-3 sm:grid-cols-2">` hinter „Matches":

```tsx
<OverviewLink
  href={`/liga${organisationParam}`}
  title="Liga"
  description="Wettbewerbe, Begegnungen und Spielrapporte"
/>
<OverviewLink
  href={`/teams${organisationParam}`}
  title="Teams"
  description="Mannschaften und Kader für den Ligabetrieb"
/>
```

Beide sind Leseflächen und darum für jede Rolle sichtbar; die
Bedienelemente darin richten sich nach `hasOrganizationPermission`.

- [ ] **Schritt 2: Prüfen und committen**

```bash
pnpm --filter @darts-platform/web typecheck
git add apps/web/src/components/tenant-dashboard.tsx
git commit -m "feat: reach the league surfaces from the organization overview"
```

---

## Task 14: Der aus Phase 5 gereichte Vorgabenkonflikt

`competitions.points_decider_bonus` hat die Vorgabe `1`,
`competitions.decider_rule` die Vorgabe `'NONE'`; zusammen verletzen sie
`competitions_decider_bonus_rule_check`. Ein `INSERT` allein aus den
Vorgaben ist damit unmöglich. Behebung nach AGENTS.md §21: **neue**
Vorwärtsmigration, keine bestehende umschreiben.

**Files:**
- Modify: `packages/database/src/schema.ts:936`
- Create: `packages/database/drizzle/0019_league_decider_bonus_default.sql`
- Modify: `packages/database/drizzle/meta/_journal.json`
- Test: `apps/api/src/competitions/competitions.integration.spec.ts`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

In `apps/api/src/competitions/competitions.integration.spec.ts`, im
bestehenden `describe`, ein Fall, der die Vorgaben allein benutzt. Er greift
auf die im Spec-File bereits vorhandene Datenbankverbindung und
`organizationId` zurück (die Namen der bestehenden Hilfen dort übernehmen,
nicht neue erfinden):

```ts
it("legt eine Wettbewerbszeile allein aus den Tabellenvorgaben an", async () => {
  await expect(
    database
      .insert(competitions)
      .values({
        organizationId,
        type: "LEAGUE",
        name: "Nur Vorgaben",
        slug: `nur-vorgaben-${Date.now()}`,
        status: "DRAFT",
      })
      .returning({ id: competitions.id }),
  ).resolves.toHaveLength(1);
});
```

- [ ] **Schritt 2: Lauf zur Bestätigung, dass er fehlschlägt**

```bash
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/competitions/competitions.integration.spec.ts
```

Erwartet: FAIL mit
`new row for relation "competitions" violates check constraint "competitions_decider_bonus_rule_check"`.

- [ ] **Schritt 3: Migration schreiben**

`packages/database/drizzle/0019_league_decider_bonus_default.sql`:

```sql
--> statement-breakpoint
ALTER TABLE "competitions" ALTER COLUMN "points_decider_bonus" SET DEFAULT 0;
```

Und den Eintrag in `packages/database/drizzle/meta/_journal.json` ergänzen —
Aufbau und `idx`/`when`-Felder von `0018_big_zeigeist` übernehmen, `idx` um
eins erhöhen, `tag` auf `0019_league_decider_bonus_default`.

- [ ] **Schritt 4: Schema angleichen**

`packages/database/src/schema.ts:936`:

```ts
    pointsDeciderBonus: integer("points_decider_bonus").default(0).notNull(),
```

Die Anwendung ist nicht betroffen: `competitions.repository` setzt beide
Werte immer explizit, und `createCompetitionSchema` leitet
`pointsDeciderBonus` ohnehin aus `deciderRule` ab. Bestandsdaten erfüllen die
Constraint bereits, weil jede vorhandene Zeile über die API entstanden ist.

- [ ] **Schritt 5: Lauf zur Bestätigung, dass er besteht**

```bash
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/competitions/competitions.integration.spec.ts
```

Erwartet: PASS, alle Fälle der Datei.

- [ ] **Schritt 6: Commit**

```bash
git add packages/database apps/api/src/competitions/competitions.integration.spec.ts
git commit -m "fix: let a competition row be inserted from its own defaults"
```

---

## Task 15: Vollverifikation und Phasenabschluss

- [ ] **Schritt 1: Vollverifikation**

Erst jetzt, nicht zwischendurch (Roadmap-Sessionregel 3):

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Erwartet: alle vier grün. Fehlschläge werden behoben, nicht übergangen
(AGENTS.md §20).

- [ ] **Schritt 2: Bestehende E2E-Suite als Rückversicherung**

```bash
pnpm test:e2e
```

Die Phase schreibt keine neuen Playwright-Fälle (das ist Phase 7), aber die
bestehende `apps/web/tests/foundation.spec.ts` muss die neuen Routen
überleben. Erwartet: grün.

- [ ] **Schritt 3: Roadmap berichtigen**

In `docs/superpowers/plans/2026-09-02-team-encounter-roadmap.md` den
Abschnitt „Phase 6: Vorgaben von `competitions` widersprechen einer
Constraint" als erledigt kennzeichnen: die Überschrift bleibt stehen, darunter
kommt ein Satz mit der Migrationsnummer, damit die Herkunft des Befunds
nachvollziehbar bleibt.

- [ ] **Schritt 4: Ergebnis festhalten**

An diesen Plan einen Abschnitt „Ergebnis" anhängen: was umgesetzt wurde,
jede Abweichung von diesem Plan mit Begründung, und was für Phase 7 offen
bleibt (mindestens: die E2E-Fälle aus dem Spec-Abschnitt „Browser-Tests" und
die Abnahme).

- [ ] **Schritt 5: Committen und nach `develop` mergen**

```bash
git add docs/superpowers/plans/
git commit -m "docs: record the phase 6 result"
git checkout develop
git merge --no-ff feature/phase-6-web-ui
git branch -d feature/phase-6-web-ui
```

Nicht nach `origin` pushen — `develop` ist der lokale Integrationsbranch.

---

## Abnahmekriterien

- Eine Turnierleitung kann ohne API-Werkzeug: Team anlegen, Kader füllen,
  Wettbewerb mit 19-Slot-Vorlage anlegen, Begegnung ansetzen, beide
  Meldungen erfassen, starten, Spiele auf Boards zuweisen, Doppelpaarungen
  melden, auswechseln, kampflos werten, Ergebnis sehen.
- Die gegnerische Meldung bleibt unsichtbar, bis beide Seiten gemeldet
  haben; die Fläche sagt, warum.
- Ein Slot, der nicht startbar ist, nennt den Grund im Klartext.
- Ein 409 zeigt beide Versionsnummern und lässt den Serverzustand
  übernehmen; kein Befehl wird still wiederholt.
- Jeder Zustand steht als Wort da, nicht nur als Farbe.
- Das Scoreboard zeigt im Doppel beide Namen und markiert die werfende
  Person sichtbar und für Screenreader.
- `/live/begegnungen/:publicId` zeigt Stand und alle Spiele ohne manuelles
  Neuladen und ohne Anmeldung.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` und
  `pnpm test:e2e` sind grün.
- Eine Wettbewerbszeile lässt sich allein aus den Tabellenvorgaben anlegen.

## Sessionbudget

Geschätzt 3,0 bis 5,0 Mio. Token (Roadmap). Bei etwa 60 Prozent Verbrauch:
Zwischenstand committen und die Session beenden statt in eine Kompaktierung
zu laufen (Sessionregel 8).

---

## Ergebnis

Umgesetzt am 3. September 2026 auf `feature/phase-6-web-ui`, vierzehn Commits.
4.633 Zeilen in `apps/web/src`, `apps/api/src` und `packages/database/src`
(dazu der generierte Drizzle-Snapshot). Die Schätzung der Roadmap lag bei
~2.500 LOC; der Mehraufwand steckt in den Formularen, die jeden Fehlerfall als
Text tragen, statt ihn nur farblich zu zeigen.

### Was jetzt geht

- `/teams` — Mannschaften anlegen, archivieren, Kader führen; nur offene
  Mitgliedschaften (`validTo === null`) gelten als Kader.
- `/liga` und `/liga/neu` — Wettbewerbe listen und anlegen. Die
  Begegnungsvorlage wird aus den Eckwerten erzeugt statt getippt; die
  neunzehn Slots stehen als Tabelle unter dem Formular.
- `/liga/[id]` — Wertungsregeln in einem Satz, die eingefrorene Vorlage
  aufklappbar, die Begegnungen als Liste, Ansetzen als Formular.
- `/liga/begegnungen/[id]` — die Begegnungsleitung: Stand in Punkten, Spielen
  und Sätzen, die Spiele mit abgeleiteter Besetzung und Grund, wenn eines
  nicht starten kann, Board zuweisen und freigeben, kampflos werten,
  Meldung je Seite (verdeckt bis beide gemeldet haben), Doppelpaarungen,
  Auswechslung, Nichtantritt, Absage, 409-Auflösung, Echtzeitstatus.
- `/live/begegnungen/[publicId]` — die öffentliche Ansicht ohne Anmeldung.
- Das Scoreboard zeigt im Doppel beide Namen je Seite und markiert die
  werfende Person; die Matchliste nennt beide Namen einer Seite.
- `apps/web` hat ein eigenes Testziel: 29 Vitest-Fälle über die drei reinen
  Module.

### Abweichungen vom Plan, mit Begründung

1. **`vitest run --dir src` statt `vitest run`.** Ohne die Einschränkung
   sammelt Vitest auch `apps/web/tests/foundation.spec.ts` ein, die
   Playwright-Suite. `--dir src` hält beide Läufe getrennt, ohne eine
   Konfigurationsdatei zu brauchen.
2. **Formularvalidierung über `schema.safeParse` statt `zodResolver`.**
   `exactOptionalPropertyTypes: true` und die Defaults der Verträge
   (`shortName.default(null)`, der Transform in `createCompetitionSchema`)
   machen Eingabe- und Ausgabetyp verschieden, was `zodResolver` nicht
   typsicher überbrückt. `apps/web/src/components/tournament/setup-sheet.tsx`
   löst dasselbe Problem seit Phase 2 mit Zeichenketten im Formular und einem
   `safeParse` beim Absenden; diese Phase folgt der bestehenden Konvention,
   statt eine zweite einzuführen.
3. **`slugFromName` kam dazu.** Der Vertrag verlangt
   `^[a-z0-9]+(?:-[a-z0-9]+)*$`; einen solchen Wert von Hand zu tippen ist die
   Stelle, an der das Anlegen scheitert. Umlaute werden ausgeschrieben, nicht
   verschluckt. Reine Funktion mit Test.
4. **`components/league/template-table.tsx` kam dazu.** Setup und Detail
   zeigen dieselbe Tabelle; sie zweimal zu schreiben wäre Drift gewesen.
5. **Zwei Fehler im Bestand mitgenommen.**
   `match-scoreboard.tsx` bestimmte die Seite am Oche über
   `participant.playerId === match.currentPlayerId`. Im Doppel ist
   `currentPlayerId` die werfende Person, die auch die zweite der Seite sein
   kann — dann fand der Vergleich niemanden, und der Checkout-Dialog wäre bei
   einem Finish nicht aufgegangen. Jetzt entscheidet `participant.isActive`.
   Derselbe Vergleich stand hinter der Gewinnerzeile; sie geht jetzt über
   `players.some(...)`.
6. **Kein `TemplateOptions.legsToWinSet`.** Der Generator leitet
   `legsToWinSet` aus `bestOfLegs` ab (`ceil(bestOfLegs / 2)`), weil zwei
   widersprechbare Quellen derselben Distanz genau die Art Fehler erzeugen,
   die `INCONSISTENT_LEG_DISTANCE` meldet.
7. **Zwei Verträgetests statt nur Engine-Prüfung.** Die erzeugte Vorlage läuft
   im Test durch `createCompetitionSchema`, zusätzlich wurde sie einmalig
   gegen `validateEncounterTemplate` der League-Engine geprüft. Beide Wege
   nehmen sie an.

### Was geprüft ist

```text
pnpm lint       grün
pnpm typecheck  grün (23 Tasks)
pnpm test       grün — 150 API-Tests, 29 Web-Tests, 79 League-Engine-Tests
pnpm build      grün (13 Tasks, 20 Routen)
pnpm test:e2e   grün (6 Playwright-Fälle, unverändert)
```

Zusätzlich gegen die laufende Anwendung: alle sieben neuen Routen antworten
mit HTTP 200 und ohne Laufzeitfehler im Serverprotokoll.

`pnpm build` braucht `NODE_ENV=production`; ohne die Variable bricht der
Prerender von `/` mit `Cannot read properties of null (reading 'useState')`
ab. Das Wurzelskript setzt sie, ein direktes
`pnpm --filter @darts-platform/web build` nicht — wer so baut, sucht sonst
lange an der falschen Stelle.

### Für Phase 7 offen

- Die Browser-Tests aus dem Spec-Abschnitt „Browser-Tests": Begegnung
  ansetzen, beide Meldungen erfassen, zwei Slots parallel auf zwei Boards
  spielen, Doppelpaarungen vor Slot 9 melden, ein Doppel ausspielen, Ergebnis
  prüfen. Die Flächen tragen dafür stabile `id`-Attribute an allen
  Formularfeldern.
- Ein Impeccable-Audit der Begegnungsleitung. Diese Phase hält sich an
  DESIGN.md (Typenrampe, Zustandswort neben jeder Farbe, Touch-Ziele), hat
  aber keine eigene `.impeccable/surfaces`-Datei bekommen.
- Saison-Tabelle, Doppelstatistik und Self-Service für Team-Captains bleiben
  ausdrücklich ausserhalb.
