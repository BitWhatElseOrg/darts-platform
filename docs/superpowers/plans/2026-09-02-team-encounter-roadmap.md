# Team-Begegnung: Phasen-Roadmap

**Spec:** `docs/superpowers/specs/2026-09-02-team-encounter-league-design.md`

Diese Datei ist der **Index**, nicht der Arbeitsplan. Sie legt die
Phasengrenzen, die Schnittstellen zwischen den Phasen und das Sessionbudget
fest. Der eigentliche Arbeitsplan je Phase ist eine eigene Datei
`docs/superpowers/plans/2026-09-02-phase-N-<name>.md`.

## Warum aufgeteilt

Der Gesamtumfang liegt bei rund 11.400 neuen oder geänderten LOC, also knapp
der Hälfte des heutigen Repos (24.411 LOC). Die Umsetzung in einer einzigen
Session würde geschätzt 13,5 bis 23,5 Mio. Tokens verbrauchen und damit das
Budget von 15 Mio. reissen. Jede einzelne Phase passt mit Faktor 2 bis 3
Reserve.

**Regel: eine Phase = eine Session.** Danach beenden, nicht weiterarbeiten.

## Phasen

**Stand 3. September 2026: alle sieben Phasen sind umgesetzt und auf
`develop` gemergt. Das Abnahmeprotokoll steht im Abschnitt „Ergebnis" von
`docs/superpowers/plans/2026-09-02-phase-7-e2e.md`.**

| # | Deliverable | Kern-Dateien | LOC | Tokens | hängt ab von | Stand |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Seitenmodell im Match + Migration | `scoring-engine`, `schema.ts`, `matches.repository.ts` | ~1.800 | 2,5–4,5M | — | fertig |
| 2 | Scoring-Regeln des Reglements | `scoring-engine` | ~800 | 1,0–1,5M | 1 | fertig |
| 3 | `packages/league-engine` | neues Paket | ~1.500 | 1,5–2,5M | — | fertig |
| 4 | Persistenz + API | `apps/api/src/{teams,competitions,encounters}` | ~4.000 | 4,0–7,0M | 1, 2, 3 | fertig |
| 5 | Realtime + Fortschreibung | `encounters`, `apps/worker` | ~400 | 0,5–1,0M | 4 | fertig |
| 6 | Web-UI | `apps/web` | ~2.500 | 3,0–5,0M | 4, 5 | fertig |
| 7 | E2E + Abnahme | `apps/web/tests` | ~400 | 1,0–2,0M | 6 | fertig |

Die Aufklärung zu Phase 7 steht in
`docs/superpowers/plans/2026-09-02-phase-7-vorbereitung.md`, der Arbeitsplan
mit dem Abnahmeprotokoll in
`docs/superpowers/plans/2026-09-02-phase-7-e2e.md`.

Phase 3 hat keine Abhängigkeit und könnte vor Phase 1 laufen. Empfohlen ist
trotzdem die Reihenfolge 1 → 2 → 3 → 4 → 5 → 6 → 7, weil Phase 1 die riskante
ist und das meiste Budget verdient, solange noch nichts darauf aufbaut.

Phasen 1 bis 5 liefern einen über API und Tests vollständig bedienbaren Kern
für 9,5 bis 16 Mio. Tokens. Wenn das Budget knapp wird, ist der Schnitt nach
Phase 5 der richtige.

## Schnittstellen zwischen den Phasen

Was eine Phase produziert, auf das die nächste sich verlässt. Diese Namen sind
verbindlich; wer sie ändert, ändert auch diese Datei.

### Phase 1 → 2, 4

```ts
// @darts-platform/scoring-engine
interface X01Side {
  readonly seat: 1 | 2;
  readonly playerIds: readonly string[];
}
function createX01Match(input: {
  sides: readonly [X01Side, X01Side];
  startingSeat?: 1 | 2;
  rules?: X01Rules;
}): X01Match;
interface SubmitVisitCommand {
  type: "SUBMIT_VISIT"; commandId: string;
  seat: 1 | 2; throwerPlayerId: string;
  points: number; dartsThrown: 1 | 2 | 3;
  checkoutDouble?: number; checkoutAttempts?: number;
}
```

Datenbank: `match_participant_players`, `matches.starting_seat|current_seat|winner_seat`,
`legs.starting_seat|winner_seat`, `visits.seat|thrower_player_id`.

### Phase 2 → 4

```ts
interface X01Rules {
  readonly startingScore: number;
  readonly inRule: "STRAIGHT" | "DOUBLE";
  readonly outRule: "SINGLE" | "DOUBLE" | "MASTER";
  readonly maxRounds: number | null;
  readonly legsToWinSet: number;
  readonly setsToWin: number;
}
interface DecideLegByBullCommand {
  type: "DECIDE_LEG_BY_BULL";
  commandId: string;
  winnerSeat: 1 | 2;
}
interface DecideLegStartCommand {
  type: "DECIDE_LEG_START";
  commandId: string;
  legNumber: number;
  startingSeat: 1 | 2;
}
```

Datenbank: `matches.in_rule|out_rule|max_rounds` statt `matches.double_out`,
dieselben drei Spalten auf `tournaments`.

Die Ablage der beiden neuen Kommandos gehört zu Phase 4. `matches.repository`
baut die Kommandoliste aus `visits`; ein durch Ausbullen entschiedenes Leg
erzeugt keine Visit-Zeile. Solange `max_rounds` überall `NULL` ist, kann kein
Bestandsmatch ein solches Kommando tragen.

### Phase 3 → 4

```ts
// @darts-platform/league-engine
function validateEncounterTemplate(slots: readonly TemplateSlot[]): void;
function validateNominations(input: NominationInput): void;
function validateDoublesPairings(input: DoublesInput): void;
function validateSubstitution(input: SubstitutionInput): void;
function resolveSlotOccupancy(input: OccupancyInput): SlotOccupancy;
function calculateEncounterResult(input: ResultInput): EncounterResult;
function resolveDeciderRequirement(input: ResultInput): DeciderDecision;
class LeagueValidationError extends Error { readonly code: string; }
```

### Phase 4 → 5, 6

REST unter `/api/v1` wie im Spec-Abschnitt „API", Outbox-Ereignisse
`ENCOUNTER_STARTED`, `ENCOUNTER_SLOT_ASSIGNED`, `ENCOUNTER_SLOT_COMPLETED`,
`ENCOUNTER_SLOT_REOPENED`, `ENCOUNTER_COMPLETED` mit
`aggregate_type = 'Encounter'`.

`ENCOUNTER_SLOT_REOPENED` kam in Phase 4 dazu: Rücknahme einer
Board-Zuweisung und Matchabbruch. Es trägt den Abbruch in den
Begegnungsraum, weil das Match seinen Slotbezug in derselben Transaktion
verliert und `MATCH_ABORTED` danach keinem Raum mehr zuzuordnen ist.

### Phase 5 → 6

Socket-Kanal `encounter:subscribe` mit `{ encounterId }`, Ereignis
`encounter:changed` mit `{ eventId, eventType, encounterId, occurredAt }`.
Turnierräume und `tournament:changed` bleiben unverändert.

## Offene Punkte, die eine Phase mitnimmt

Befunde aus einer abgeschlossenen Phase, die dort nicht hingehörten. Wer den
Plan der genannten Phase schreibt, nimmt sie als Task auf.

### Phase 6: Vorgaben von `competitions` widersprechen einer Constraint

**Erledigt in Phase 6** durch die Migration
`0019_league_decider_bonus_default`, die die Vorgabe von
`points_decider_bonus` auf `0` setzt. Ein Test in
`apps/api/src/competitions/competitions.integration.spec.ts` legt eine
Wettbewerbszeile allein aus den Vorgaben an und hält den Befund fest. Der
Rest dieses Abschnitts bleibt als Herkunft stehen.

Gefunden in Phase 5 beim Aufbau der Realtime-Integrationstests.

`competitions.points_decider_bonus` hat die Vorgabe `1`,
`competitions.decider_rule` die Vorgabe `'NONE'`. Zusammen verletzen sie die
Check-Constraint der eigenen Tabelle:

```sql
competitions_decider_bonus_rule_check:
  points_decider_bonus = 0 or decider_rule = 'EXTRA_SLOT'
```

Ein `INSERT`, der sich allein auf die Vorgaben verlässt, ist damit unmöglich.
Über die API fällt das nicht auf, weil `competitions.repository` beide Werte
immer explizit setzt — der Fehler trifft nur, wer direkt in die Tabelle
schreibt (Tests, Seeds, spätere Migrationen).

Behebung: eine versionierte Migration, die die Vorgabe von
`points_decider_bonus` auf `0` setzt. Bestandsdaten sind nicht betroffen,
weil jede vorhandene Zeile die Constraint bereits erfüllt. Nach AGENTS.md §21
wird keine bestehende Migration umgeschrieben, sondern eine neue ergänzt. Ein
Test, der eine Wettbewerbszeile allein aus den Vorgaben anlegt, hält den
Befund fest.

Warum nicht in Phase 5: eine Schemaänderung gehört nicht in eine Phase, deren
Grenze „Realtime + Fortschreibung" heisst, und Phase 6 fasst die Wettbewerbs-
oberfläche ohnehin an.

## Sessionregeln

Diese Regeln halten das Budget ein. Sie sind Teil des Plans, nicht Beiwerk.

1. Zu Beginn einer Phasensession: **nur** diese Roadmap, die Spec und den
   Phasenplan lesen. Nicht das ganze Repo erkunden.
2. Der Phasenplan wird zu Beginn seiner eigenen Session geschrieben, nicht auf
   Vorrat. Pläne für Phase 4 bis 7 gegen Code zu schreiben, den es noch nicht
   gibt, erzeugt Drift und kostet doppelt.
3. Während der Arbeit **kein** `pnpm test` oder `pnpm build` im Root. Nur
   `pnpm --filter <paket> test -- <datei>`. Ein Full-Suite-Lauf kostet 5–15k
   Tokens, und man läuft ihn zwanzigmal.
4. Testcontainers-Integrationstests ans Phasenende, nicht im Minutentakt.
5. Keine Subagents. Jeder Start liest den Kontext kalt neu.
6. Grosse Dateien gezielt lesen. `apps/api/src/tournaments` am Stück sind 33k
   Tokens, `apps/api/src/matches` 22k.
7. Das Reglement-PDF nicht erneut anhängen; es kostet allein 35–45k. Die Spec
   trägt alle Paragraphenverweise.
8. Bei etwa 60 Prozent Verbrauch: Zwischenstand committen, Session beenden.
   Eine Kompaktierung mitten in einer Phase zahlt man doppelt.

## Vollverifikation

Am Ende jeder Phase, nicht zwischendurch:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Ab Phase 6 zusätzlich `pnpm test:e2e`.
