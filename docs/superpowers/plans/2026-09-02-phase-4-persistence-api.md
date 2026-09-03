# Phase 4 — Persistenz und API für Teams, Wettbewerbe und Begegnungen

**Roadmap:** `docs/superpowers/plans/2026-09-02-team-encounter-roadmap.md`
**Spec:** `docs/superpowers/specs/2026-09-02-team-encounter-league-design.md`
**Branch:** `feature/phase-4-persistence-api` von `develop`

Phase 4 legt die Begegnung in der Datenbank ab und macht sie über `/api/v1`
bedienbar. Die Fachlogik liegt bereits in `@darts-platform/league-engine`
(Phase 3) und wird hier **aufgerufen, nicht nachgebaut**: Service und
Repository rufen die Engine und legen deren Ergebnis ab.

## Nicht in dieser Phase

Realtime-Verteilung und Worker-Fortschreibung (Phase 5), Web-UI (Phase 6),
E2E (Phase 7), Saison-Tabellenberechnung. Die Outbox-Zeilen entstehen hier,
verteilt werden sie in Phase 5.

## Verbindliche Schnittstellen nach aussen

Diese Namen sind der Vertrag zu Phase 5 und 6. Wer sie ändert, ändert die
Roadmap.

- Tabellen `teams`, `team_players`, `competitions`, `competition_slots`,
  `encounters`, `encounter_slots`, `encounter_nominations`,
  `encounter_lineup_entries`, `encounter_substitutions`,
  `encounter_commands`. (`match_participant_players` existiert bereits aus
  Phase 1.)
- REST wie im Spec-Abschnitt „API".
- Outbox-Ereignisse `ENCOUNTER_STARTED`, `ENCOUNTER_SLOT_ASSIGNED`,
  `ENCOUNTER_SLOT_COMPLETED`, `ENCOUNTER_COMPLETED` mit
  `aggregate_type = 'Encounter'`.

## Vorgefundener Zustand (geprüft, nicht vermutet)

- `match_participant_players` steht bereits in `schema.ts` (Phase 1).
- `matches`/`tournaments` tragen `in_rule`, `out_rule`, `max_rounds`;
  `double_out` ist mit Migration `0017_public_black_bird` entfallen.
- `score_commands.type` erlaubt heute nur
  `SUBMIT_VISIT`, `UNDO_LAST_VISIT`, `ABORT_MATCH`. Die Phase-2-Kommandos
  `DECIDE_LEG_START` und `DECIDE_LEG_BY_BULL` existieren in der
  Scoring-Engine, haben aber weder Endpunkt noch Ablage. Das ist die aus
  Phase 2 verschobene Arbeit.
- `matches.repository.submitVisit` baut das Aggregat aus `score_commands`
  (nicht aus `visits`); ein Kommando ohne Visit-Zeile passt also bereits in
  den bestehenden Weg.
- Repository-Muster: Transaktion, `commandId`-Duplikatprüfung zuerst,
  `.for("update")`, Ergebnis als String-Union statt Exception, Outbox und
  Audit in derselben Transaktion. Vorbild `TournamentsRepository.assign`.
- Service-Muster: `require(permission)` über `OrganizationAccessService`,
  `mutate()` übersetzt die String-Union in HTTP-Ausnahmen mit `code`,
  `message`, `details.currentState`.

## Fehlercode-Abbildung

Die Engine wirft `LeagueValidationError` mit **engine-internen** Codes
(`NOT_ENOUGH_NOMINATIONS`, `PLAYER_NOT_IN_SQUAD`, …). Die Spec schreibt für
die API **andere** Codes vor (`NOMINATION_INCOMPLETE`,
`NOMINATION_PLAYER_NOT_IN_SQUAD`, …). Eine Übersetzungstabelle im
Encounter-Service ist deshalb Pflicht, keine Kür — sie ist die einzige Stelle,
an der die beiden Vokabulare aufeinandertreffen.

| Engine-Code | API-Code | Status |
| --- | --- | --- |
| `NOT_ENOUGH_NOMINATIONS`, `INVALID_NOMINATION`, `INVALID_LINEUP_POSITION`, `DUPLICATE_LINEUP_POSITION` | `NOMINATION_INCOMPLETE` | 422 |
| `DUPLICATE_NOMINATION` | `NOMINATION_DUPLICATE_PLAYER` | 422 |
| `PLAYER_NOT_IN_SQUAD` | `NOMINATION_PLAYER_NOT_IN_SQUAD` | 422 |
| `INVALID_DOUBLES_SIZE`, `DUPLICATE_DOUBLES_SLOT`, `PLAYER_NOT_NOMINATED`, `DUPLICATE_DOUBLES_PLAYER` | `DOUBLES_PAIRING_INCOMPLETE` | 422 |
| `DOUBLES_LIMIT_EXCEEDED` | `DOUBLES_PLAYER_LIMIT_EXCEEDED` | 422 |
| `SUBSTITUTION_LIMIT_EXCEEDED` | `SUBSTITUTION_LIMIT_EXCEEDED` | 422 |
| `PLAYER_SUBSTITUTED_OUT`, `PLAYER_ALREADY_IN_LINEUP` | `SUBSTITUTION_PLAYER_BLOCKED` | 422 |
| `SUBSTITUTION_DURING_RUNNING_SLOT` | `SUBSTITUTION_SLOT_RUNNING` | **409** |
| `INCOMPLETE_ROUND_ROBIN`, `DUPLICATE_SINGLES_PAIRING`, `MISSING_SINGLES_SLOTS` | `TEMPLATE_ROUND_ROBIN_INCOMPLETE` | 422 |
| alle übrigen Template-Codes | `TEMPLATE_INVALID` | 422 |
| Rest | `LEAGUE_VALIDATION_ERROR` | 422 |

422 verlangt `UnprocessableEntityException`; der bestehende
`ApiExceptionFilter` reicht `code` und `message` bereits durch und ergänzt
`correlationId`. Ein Default-Mapping für 422 fehlt in `errorCodes` — der
Filter fällt dann auf den mitgegebenen `code` zurück, also ist nichts zu
ändern.

Repositoriale Zustände ohne Engine-Beteiligung:
`ENCOUNTER_VERSION_CONFLICT` (409 mit aktuellem Zustand), `BOARD_UNAVAILABLE`
(409), `PLAYER_BUSY` (409), `ENCOUNTER_CLOSED` (409), `NOT_FOUND` (404).

## Tasks

### Task 1 — Schema und Migration

`packages/database/src/schema.ts`, Stil wie die bestehenden Tabellen: `check`
mit `sql`-Template auf Spaltenreferenzen, benannte Indexe im Muster
`<tabelle>_<zweck>_(unique|idx)`.

1. Zehn neue `pgTable`-Definitionen exakt nach Spec-Abschnitt „Datenmodell",
   inklusive aller `CHECK`- und Unique-Constraints. Partielle Unique-Indexe
   (`WHERE valid_to IS NULL`, `WHERE role = 'DECIDER'`,
   `WHERE discipline = 'SINGLES'`, `WHERE status = 'IN_PROGRESS'`) über
   `uniqueIndex(...).on(...).where(sql\`…\`)`.
2. `encounters.public_id` mit `defaultRandom()`, Unique — Vorbild
   `players.public_id`.
3. `score_commands_type_check` um `DECIDE_LEG_START` und
   `DECIDE_LEG_BY_BULL` erweitern.
4. `$inferSelect`-Typen am Dateiende ergänzen.
5. Migration `0018_*` mit `pnpm db:generate` erzeugen, SQL lesen und die
   partiellen Indexe prüfen. Der `score_commands`-Constraint muss als
   `DROP CONSTRAINT` + `ADD CONSTRAINT` erscheinen; falls drizzle-kit ihn
   nicht erzeugt, von Hand in dieselbe Migration ergänzen. Bestehende
   Migrationen bleiben unangetastet.

Wichtig: `encounter_slots.board_id` verweist auf `boards` mit
`ON DELETE SET NULL`, `match_id` auf `matches` mit `ON DELETE SET NULL` und
ist unique — ein Match gehört zu höchstens einem Slot.

### Task 2 — Berechtigungen

`packages/domain/src/permissions.ts`: `team:read`, `team:manage`,
`competition:read`, `competition:manage`, `encounter:read`,
`encounter:manage`, `encounter:lineup` an `organizationPermissions` anhängen.
Rollen nach Spec: `OWNER`/`ADMIN`/`TOURNAMENT_DIRECTOR` alles, `SCORER` die
drei Leserechte plus `encounter:lineup`, `MEMBER`/`VIEWER` die drei
Leserechte. `permissions.spec.ts` entsprechend erweitern.

### Task 3 — Zod-Verträge

Neu `packages/schemas/src/league.ts`, Stil wie `tournament.ts`: Enums zuerst,
dann Antwort-Schemata, dann Eingabe-Schemata, `z.infer`-Typen am Ende. Export
über `packages/schemas/src/index.ts`.

Enums: `teamStatus`, `teamPlayerRole`, `competitionType`, `competitionStatus`,
`deciderRule`, `slotRole`, `discipline`, `encounterStatus`, `encounterSide`,
`encounterResult`, `encounterResultType`, `encounterSlotStatus`,
`slotResultType`, `nominationOrigin`.

Eingaben: `createTeamSchema`, `updateTeamSchema`, `addTeamMemberSchema`,
`createCompetitionSchema` (mit `slots`-Array), `updateCompetitionSchema`,
`createEncounterSchema`, `submitNominationsSchema`, `submitDoublesSchema`,
`substitutePlayerSchema`, `startEncounterSchema`, `assignEncounterSlotSchema`,
`releaseEncounterSlotSchema`, `declareSlotWalkoverSchema`,
`declareEncounterForfeitSchema`, `cancelEncounterSchema`. Jede
Begegnungsmutation trägt `commandId: z.uuid()` und
`expectedVersion: z.number().int().nonnegative()`; Teams sind CRUD ohne
Version.

Antworten: `teamSchema`/`teamListSchema`, `competitionSummarySchema`/
`competitionListSchema`/`competitionDetailSchema` (mit Slots),
`encounterSummarySchema`/`encounterListSchema`, `encounterDetailSchema`
(Begegnung, Slots mit abgeleiteter Besetzung, Meldungen, Doppel,
Auswechslungen, Zwischenstand) und `publicEncounterSchema` (dieselbe Sicht
ohne Personen-IDs von Ersatzleuten und ohne Auditfelder).

**Verdeckte Meldung:** `encounterDetailSchema` trägt je Seite ein Feld
`revealed: boolean`. Solange nur eine Seite gemeldet hat, liefert der Service
die Meldung der Gegenseite als leeres Array mit `revealed: false`
(Reglement 2.1.1). Das ist eine Serverentscheidung, keine UI-Entscheidung.

### Task 4 — `apps/api/src/teams`

`teams.repository.ts`, `teams.service.ts`, `teams.controller.ts`,
`teams.module.ts`. Gewöhnliches CRUD, jede Funktion nimmt `organizationId`
explizit, jede Mutation schreibt `audit_events`
(`TEAM_CREATED`, `TEAM_UPDATED`, `TEAM_MEMBER_ADDED`, `TEAM_MEMBER_REMOVED`).
Kaderpflege über `valid_from`/`valid_to`: Entfernen setzt `valid_to = now()`,
es wird nicht gelöscht. Rechte `team:read` / `team:manage`.

### Task 5 — `apps/api/src/competitions`

`competitions.repository.ts`, `competitions.service.ts`,
`competitions.controller.ts`, `competitions.module.ts`.

- Anlegen: `validateEncounterTemplate` über die Slots **vor** der
  Transaktion, danach Wettbewerb und `competition_slots` in einer
  Transaktion, Audit `COMPETITION_CREATED`.
- `PATCH`: `expectedVersion` gegen `competitions.version`; eine Änderung der
  Slots ist nur zulässig, solange keine Begegnung des Wettbewerbs den Status
  `RUNNING` oder `COMPLETED` hat. Die Kopie in `encounter_slots` schützt
  bereits angesetzte Begegnungen; die Sperre verhindert, dass eine laufende
  Saison ihre Vorlage unter sich wegzieht.
- Rechte `competition:read` / `competition:manage`.

### Task 6 — `apps/api/src/encounters`

Das Herzstück. `encounters.repository.ts` (gross),
`encounters.service.ts`, `encounters.controller.ts`,
`public-encounters.controller.ts`, `encounters.module.ts`,
`update-encounter-progress.ts`.

Jede Mutation folgt demselben Rahmen:

```text
BEGIN
  encounter_commands auf commandId prüfen  → Wiederholung liefert "ok"
  encounter FOR UPDATE, Status- und Versionsprüfung
  Fachprüfung über league-engine
  schreiben
  version + 1, encounter_commands, audit_event, ggf. outbox_event
COMMIT
```

Reihenfolge der Umsetzung:

1. `schedule` — Begegnung anlegen, `encounter_slots` aus
   `competition_slots` kopieren, Status `DRAFT` → `LINEUPS_OPEN`, Audit
   `ENCOUNTER_SCHEDULED`. Kein Outbox-Ereignis (die Roadmap kennt nur vier).
2. `submitNominations` — Kader beider Teams **zum `scheduled_at`** laden
   (`valid_from <= scheduled_at and (valid_to is null or valid_to > scheduled_at)`),
   `validateNominations`, Meldungen der Seite ersetzen. Beide Seiten
   gemeldet → `READY`.
3. `submitDoubles` — `validateDoublesPairings`, betroffene Slots müssen
   `WAITING` sein, `encounter_lineup_entries` der Seite für den Slot
   ersetzen.
4. `substitute` — `validateSubstitution` mit den bereits gestarteten
   Sequenzen, Zeile in `encounter_substitutions`.
5. `start` — Meldungen nachzählen; für jede Seite mit genau
   `min_nominations_shorthanded` besetzten Positionen die Slots der
   fehlenden Position **und ein reguläres Doppel** sofort als `WALKOVER`
   gegen diese Seite werten (Reglement 2.2.5; die Auslegung aus Phase 3:
   Nichtantritt wird aus der Vorlage abgeleitet, Walkover-Legs sind
   `legsToWinSet * setsToWin`). Status `RUNNING`, Outbox
   `ENCOUNTER_STARTED`.
6. `assignSlot` — Board gegen `tournament_matches` **und**
   `encounter_slots` prüfen, Board-Zeile `FOR UPDATE`,
   `resolveSlotOccupancy` für die Besetzung, `evaluateMatchReadiness` über
   beide Seiten, dann `matches` + `match_participants` (Sitz 1 = HOME,
   Sitz 2 = AWAY) + `match_participant_players` + erstes `legs` anlegen,
   Slot auf `IN_PROGRESS`. Outbox `ENCOUNTER_SLOT_ASSIGNED`.
7. `releaseSlot` — Gegenstück, Board frei, Slot zurück auf `WAITING`.
8. `declareSlotWalkover` — Begründung Pflicht (`min(3).max(500)`), kein
   laufendes Match, Slot auf `WALKOVER` mit `winner_side`, Legs
   `legsToWinSet * setsToWin` für den Sieger. Danach Fortschreibung.
9. `declareForfeit` — ganze Begegnung: alle Slots `CANCELLED`, Ergebnis über
   `calculateEncounterResult({ forfeitSide })`, Status `COMPLETED`,
   `result_type = 'FORFEIT'`, Outbox `ENCOUNTER_COMPLETED`.
10. `cancel` — Status `CANCELLED`, Slots `CANCELLED`, belegte Boards frei.

`update-encounter-progress.ts` nach Vorbild `update-tournament-progress.ts`:
lädt alle Slots der Begegnung, ruft `calculateEncounterResult` und
`resolveDeciderRequirement`, schreibt `home_games`, `away_games`,
`home_legs`, `away_legs`; ist die Begegnung fertig, zusätzlich Punkte,
`result`, `result_type`, `status = 'COMPLETED'`, `completed_at` und das
Outbox-Ereignis `ENCOUNTER_COMPLETED`. Wird der Entscheidungsslot gebraucht,
geht er von `WAITING` nicht weiter — er wartet auf seine Doppelmeldung; wird
er nicht gebraucht, endet er auf `CANCELLED`.

### Task 7 — Anschluss an den Scoring-Pfad

`apps/api/src/matches/matches.repository.ts`:

- Neben `syncTournamentProgress` eine `syncEncounterProgress`, aufgerufen an
  derselben Stelle in `submitVisit`, wenn das Match zu einem
  `encounter_slots.match_id` gehört: Slot auf `COMPLETED`, `winner_side` aus
  dem Sitz (1 = HOME), `result_type = 'PLAYED'`, `home_legs`/`away_legs` aus
  dem Endstand, Board freigeben, Outbox `ENCOUNTER_SLOT_COMPLETED`, dann
  `updateEncounterProgress`.
- `abort-match.ts`: gehört das Match zu einem Slot, Slot zurück auf
  `WAITING`, `match_id`/`board_id` auf `null`, Board frei — dieselbe
  Systematik wie bei Turniermatches.

Damit `encounters` und `matches` einander nicht zyklisch importieren, wohnt
`update-encounter-progress.ts` im Encounter-Modul und wird von
`matches.repository.ts` importiert — genau wie
`update-tournament-progress.ts` heute.

### Task 8 — `DECIDE_LEG_START` und `DECIDE_LEG_BY_BULL`

Die aus Phase 2 verschobene Ablage.

- `packages/schemas`: `decideLegStartSchema`, `decideLegByBullSchema` in
  `match.ts`.
- `matches.controller.ts`: `POST :matchId/leg-start`,
  `POST :matchId/leg-by-bull`.
- `matches.repository.ts`: eine gemeinsame private Methode nach dem Muster
  von `submitVisit`, aber ohne `visits`-Zeile: Aggregat aus
  `score_commands` bauen, `executeX01Command`, Legs und Match projizieren,
  `score_commands` schreiben, Outbox `LEG_DECIDED` bzw. `MATCH_COMPLETED`.
  Bei Matchende laufen `syncTournamentProgress` und `syncEncounterProgress`
  wie beim Visit.
- `ROUND_LIMIT_NOT_REACHED` aus der Scoring-Engine wird als 409 abgebildet
  (die Fehlerfälle-Tabelle der Spec).

### Task 9 — Modul-Verdrahtung

`app.module.ts` um `TeamsModule`, `CompetitionsModule`, `EncountersModule`
erweitern. `apps/api/package.json` bekommt
`"@darts-platform/league-engine": "workspace:*"`, danach `pnpm install`.

### Task 10 — Tests

Unit, ohne Infrastruktur:
- `permissions.spec.ts` (Task 2),
- `packages/schemas/src/league.spec.ts` — Grenzen der Eingabeschemata,
- `apps/api/src/encounters/league-error-mapping.spec.ts` — die Tabelle aus
  diesem Plan, jede Zeile ein Fall.

Integration mit laufender Datenbank, **am Phasenende in einem Lauf**
(`docker compose` läuft bereits, `DATABASE_URL` steht in `.env`):
`apps/api/src/encounters/encounters.integration.spec.ts` nach Vorbild
`tournaments.integration.spec.ts`, mit den Fällen aus dem Spec-Abschnitt
„Tests und Abnahmekriterien":

1. vollständige Begegnung über achtzehn Slots bis zum Ergebnis,
2. 9:9 mit Entscheidungsdoppel zu 2:1 Punkten und 10:9 Spielen,
3. Versionskonflikt bei gleichzeitiger Meldung,
4. doppelte `commandId` ohne zweiten Effekt,
5. Walkover eines Slots und Nichtantritt einer Mannschaft,
6. Auswechslung zwischen zwei Runden, gespielte Slots unverändert,
7. Board nicht doppelt vergeben, wenn ein Turnier es nutzt,
8. fremde `organizationId` liefert 404 für Team, Wettbewerb, Begegnung, Slot.

### Task 11 — Vollverifikation

Einmal am Ende: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
Kein `pnpm test` im Root während der Arbeit; einzelne Dateien über
`pnpm --filter <paket> test -- <datei>`.

## Sessionbudget

Bei etwa 60 Prozent Verbrauch: Zwischenstand committen, hier festhalten,
welche Tasks offen sind, Session beenden.

## Ausgeführt

Alle elf Tasks sind umgesetzt. Vollverifikation am Ende grün: `pnpm lint`,
`pnpm typecheck`, `pnpm test` (118 Tests im API-Paket, davon 10 neue
Integrationstests der Begegnung), `pnpm build`.

Migration `0018_big_zeigeist` legt die zehn Tabellen an und erweitert
`score_commands_type_check` um die beiden Reglementskommandos.

### Abweichungen vom Plan, mit Begründung

1. **Widerspruch in der Spec zu `competitions`.** Die Spaltendefaults
   `points_decider_bonus = 1` und `decider_rule = 'NONE'` verletzen den in
   derselben Spec geforderten Constraint
   `points_decider_bonus = 0 or decider_rule = 'EXTRA_SLOT'`. Der Constraint
   ist die inhaltliche Regel und bleibt; `createCompetitionSchema` leitet den
   Zusatzpunkt aus der Wertungsregel ab (1 bei `EXTRA_SLOT`, sonst 0), statt
   ihn stur auf 1 zu setzen. Das Repository schreibt beide Spalten immer
   explizit, die Defaults treffen also ohnehin nie aufeinander.

2. **`evaluateSlotReadiness` in `packages/scheduling-engine`.** Das
   vorhandene `evaluateMatchReadiness` nimmt genau zwei Teilnehmer; ein
   Doppelslot trägt vier Personen. Der Spec-Abschnitt „Tests und
   Abnahmekriterien" verlangt für die scheduling-engine ausdrücklich die
   Fälle „Seite mit zwei Personen" und „Person in zwei Slots gleichzeitig" —
   also gehört die Entscheidung dorthin und nicht ins Repository. Sieben neue
   Engine-Tests.

3. **Fünftes Outbox-Ereignis `ENCOUNTER_SLOT_REOPENED`.** Wird ein Match über
   `match:abort` beendet, fällt sein Slot auf `WAITING` zurück. Die vier
   verbindlichen Ereignisse bleiben unverändert; ein „assigned" für eine
   Rücknahme wäre irreführend. Vorbild ist das bestehende
   `TOURNAMENT_MATCH_REOPENED`.

4. **`matchParticipantStateSchema` trägt jetzt `seat` und `players`.**
   `MatchesRepository.getState` warf bei vier Teilnehmerzeilen
   „Match participant invariant violated" — das Seitenmodell aus Phase 1 war
   im Lesepfad noch auf eine Person je Sitz verdrahtet. `playerId` und
   `displayName` benennen weiterhin die erste Person der Seite, damit das
   bestehende Web unverändert baut.

5. **`storedCommandSchema` liest die beiden neuen Kommandos.** Ohne diese
   Erweiterung liessen sich `DECIDE_LEG_START` und `DECIDE_LEG_BY_BULL` zwar
   schreiben, aber beim nächsten Aufbau des Aggregats nicht mehr lesen. Der
   Integrationstest hat den Fehler gefunden.

6. **Nichtantritt schreibt Status und Ergebnis in einer Anweisung.**
   `(status = 'COMPLETED') = (result is not null)` ist ein Row-Constraint und
   greift sofort; die Trennung in zwei Updates war nicht haltbar.

7. **Die Fortschreibung erhöht die Version der Begegnung nicht.** Sie ist
   kein Kommando. Sonst erzeugte ein nebenan fertig werdender Slot
   Versionskonflikte in laufenden Meldeformularen. Gleiche Systematik wie
   `update-tournament-progress.ts`.

8. **Match-Endpunkte für die Reglementskommandos.** Der Spec-Abschnitt „API"
   führt sie nicht auf, weil sie zum Match gehören und nicht zur Begegnung:
   `POST /organizations/:organizationId/matches/:matchId/leg-start` und
   `.../leg-by-bull`. `ROUND_LIMIT_NOT_REACHED` antwortet als einziger
   Scoring-Fehler mit 409, wie es die Fehlerfälle-Tabelle verlangt.

### Nachgezogen am 2026-09-03

Beim Prüfen der Definition of Done („Tests vorhanden", „Fehlerfälle
behandelt") fielen drei Lücken auf, die zu Phase 4 gehören:

9. **`releaseSlot` war unerreichbar.** Nach `assign` läuft immer ein Match,
   und der einzige andere Weg — `match:abort` — setzt den Slot bereits selbst
   zurück; die Bedingung „Match nicht mehr `IN_PROGRESS`" konnte nie eintreten.
   Der Endpunkt hat jetzt die Bedeutung, die der Spielabend braucht: eine
   Board-Zuweisung zurücknehmen, **solange niemand geworfen hat**. Das leere
   Match wird über `abortScoringMatch` mit abgeleiteter `commandId` beendet
   (Vorbild `TournamentsRepository.withdrawParticipant`), das Board wird frei,
   der Slot geht auf `WAITING`. Sobald eine Visit-Zeile existiert, bleibt
   `match:abort` der Weg.

10. **`releaseSlot` sendete kein Outbox-Ereignis.** Der Abbruchpfad schickte
    bereits `ENCOUNTER_SLOT_REOPENED`; eine Rücknahme der Board-Zuweisung
    blieb für Phase 5 unsichtbar. Beide Wege senden es jetzt.

11. **`SUBSTITUTION_SLOT_RUNNING` stand am falschen Ort.** Der Code der Spec
    gehört der Auswechslung und kommt aus der Engine. Doppelmeldung,
    Rücknahme, Walkover und Abbruch auf einem laufenden Slot antworten jetzt
    mit `ENCOUNTER_SLOT_RUNNING` (409) statt einen Auswechselcode für einen
    fremden Vorgang zu borgen.

Dazu zwanzig neue Integrationstests: `teams.integration.spec.ts` (Kader mit
`valid_to` statt Löschen, doppelte Mitgliedschaft, fremde Person, Rolle
`SCORER` liest aber verwaltet nicht), `competitions.integration.spec.ts`
(Vorlagenfehler mit den Codes der Spec, Versionskonflikt, gesperrte Vorlage
nach der ersten gespielten Begegnung) und in
`encounters.integration.spec.ts` die bislang ungetesteten Reglementspfade:
verdeckte Meldung (2.1.1), Aushilfe `origin = 'GUEST'` (1.2.3), Antritt zu
dritt mit vier Einzel- und einem Doppelwalkover (2.2.5), Doppelkontingent,
Rücknahme einer Board-Zuweisung und Absage einer Begegnung.

### Für Phase 5 und 6 offen

- Realtime-Verteilung der fünf Encounter-Ereignisse und die
  Worker-Fortschreibung (Phase 5).
- Web-UI (Phase 6), E2E (Phase 7).
- Saison-Tabellenberechnung und die Kontingente für Aushilfen
  (`origin = 'GUEST'`) sind weiterhin ausdrücklich nicht im Umfang.
