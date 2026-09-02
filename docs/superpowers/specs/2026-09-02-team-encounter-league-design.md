# Team-Begegnung als Ligamodus

**Datum:** 2. September 2026
**Status:** Entwurf, zur fachlichen Freigabe durch die Turnierleitung
**Geltungsbereich:** Teams, Ligawettbewerbe, Team-Begegnungen, Doppelspiele,
Seitenmodell im Match, Scoring- und Scheduling-Engine

## Ziel

Die Plattform unterstützt den wöchentlichen Ligabetrieb: zwei Teams treffen an
einem Spieltag aufeinander und tragen eine **Begegnung** aus, die aus mehreren
Einzel- und Doppelspielen besteht. Der Auslöser ist der real gespielte Modus

```text
8x Einzel 501
2x Doppel 701
8x Einzel 501
```

also achtzehn Spiele in fester Reihenfolge mit wechselnder Disziplin und
wechselndem Startscore.

Nach der Umsetzung kann eine Organisation einen Ligawettbewerb mit einer
Begegnungsvorlage anlegen, Teams mit Kader führen, eine Begegnung ansetzen,
beide Aufstellungen erfassen, die achtzehn Spiele auf mehreren Boards
ausspielen und das Ergebnis der Begegnung automatisch ermitteln lassen.

Saison, Spielplangenerierung und Ligatabelle sind **nicht** Teil dieser Spec.
Sie bauen auf dem hier entworfenen Fundament auf und erhalten eine eigene Spec.

## Fachliche Begriffe

- **Wettbewerb** (`competition`): Klammer über mehrere Begegnungen, hier vom
  Typ `LEAGUE`. Trägt die Begegnungsvorlage, die Aufstellungsregeln und die
  Wertungsregeln.
- **Begegnungsvorlage**: die nummerierten Slots eines Wettbewerbs. Für den
  Auslöser dieser Spec: Slot 1 bis 8 Einzel 501, Slot 9 und 10 Doppel 701,
  Slot 11 bis 18 Einzel 501.
- **Begegnung** (`encounter`): ein Aufeinandertreffen zweier Teams an einem
  Spieltag. Besteht aus einer eingefrorenen Kopie der Vorlage.
- **Slot**: eine Position innerhalb einer Begegnung. Ein Slot wird zu genau
  einer Scoring-Session (`matches`) oder als Walkover gewertet.
- **Seite** (`match_participants`): eine Hälfte eines Matches. Sie besteht aus
  einer Person im Einzel und aus zwei Personen im Doppel. Der bestehende
  `seat`-Wert 1 oder 2 identifiziert sie innerhalb des Matches.
- **Aufstellung** (`lineup`): die Zuordnung von Personen zu den Slots einer
  Seite der Begegnung.
- **Kader** (`team_players`): die zu einem Zeitpunkt gültigen Mitglieder eines
  Teams.

Ein Slot ist kein Match, solange er kein Board hat. Eine Seite ist kein
Spieler. Ein Werfer ist eine Person, eine Seite kann zwei davon haben.

## Ausgangslage im Code

- `matches` und `legs` verweisen heute direkt auf `players`
  (`starting_player_id`, `current_player_id`, `winner_player_id`).
- `match_participants` besitzt bereits `seat` mit `UNIQUE (match_id, seat)` und
  `CHECK seat in (1, 2)`, trägt aber zusätzlich eine harte `player_id`.
- `matches.starting_score` liegt bereits **pro Match** vor. Gemischte
  Startscores innerhalb einer Veranstaltung sind daher kein Schemaproblem;
  einzig die Turnier-Defaults sind auf einen Wert festgelegt.
- `visits.player_id` trägt den Werfer, ist aber an die Seite gekoppelt, weil
  eine Seite genau eine Person ist.
- `matches.status` kennt nur `IN_PROGRESS`, `COMPLETED` und `ABORTED`. Eine
  Zeile in `matches` bedeutet „läuft" — es gibt keinen Wartezustand.
- Die Turnierlogik erzeugt die Scoring-Session deshalb erst bei der
  Board-Zuweisung und verweist über `tournament_matches.scoring_match_id`.
- `packages/tournament-engine` kennt `PAIR` und `TEAM` nur in der
  Turnierplanung; Scoring und Persistenz kennen sie nicht.
- `teams`, `team_players` und `competitions` sind in `DATABASE_SCHEMA.md`
  beschrieben, existieren im Schema aber nicht.

## Gewählte Architektur

Die Begegnung ist ein **eigenes Aggregat** neben dem Turnier und keine
Turnierform. Sie ist eine Klammer um gewöhnliche Matches: jeder Slot wird zu
einer regulären Scoring-Session, wodurch Scoring, Legs, Visits, Undo,
Offline-Queue, Board-Controller-Lease und Live-Ansicht unverändert
weiterfunktionieren.

Verworfen wurde, die Begegnung als Turnierformat abzubilden: eine Saison
erzeugt hunderte Pseudo-Turniere, die Turnierstatus `GROUP_STAGE` und
`KNOCKOUT` passen nicht, und der Umbau am Seitenmodell wäre trotzdem nötig.

Ebenfalls verworfen wurde, sofort das vollständige Ligamodell aus
`DATABASE_SCHEMA.md` zu bauen. Saison, Divisionen und Tabelle hätten vorerst
keine Nutzer und keine Tests aus echter Nutzung.

### Seitenmodell im Match

Damit ein Doppel überhaupt gespeichert werden kann, wird `match_participants`
von „Spieler" zu „Seite" umgebaut. Ein Einzelmatch ist danach eine Seite mit
genau einer Person und damit kein Sonderfall.

`matches` und `legs` verweisen künftig auf den **Sitz** statt auf den Spieler.
Ein Verweis auf `match_participants` würde einen Fremdschlüsselzyklus
(`matches` → `match_participants` → `matches`) erzeugen und die Spalten
nullable machen. Der Sitz ist bereits eindeutig und vermeidet beides.

| Tabelle | vorher | nachher |
| --- | --- | --- |
| `matches` | `starting_player_id`, `current_player_id`, `winner_player_id` | `starting_seat`, `current_seat`, `winner_seat` |
| `legs` | `starting_player_id`, `winner_player_id` | `starting_seat`, `winner_seat` |
| `visits` | `player_id` | `thrower_player_id` (umbenannt), zusätzlich `seat` |
| `match_participants` | `player_id` | entfällt, ersetzt durch `match_participant_players` |

`visits.player_id` wird lediglich **umbenannt**. Es findet keine
Datenbewegung statt, und jede bestehende Statistikabfrage bleibt inhaltlich
korrekt.

## Datenmodell

Alle neuen Tabellen tragen `organization_id` und sind ausschliesslich über
tenant-gebundene Repository-Funktionen erreichbar. Jede Repository-Funktion
nimmt `organizationId` explizit entgegen.

### match_participant_players

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
match_id uuid FK matches ON DELETE CASCADE NOT NULL
participant_id uuid FK match_participants ON DELETE CASCADE NOT NULL
player_id uuid FK players ON DELETE RESTRICT NOT NULL
position smallint NOT NULL

UNIQUE (participant_id, position)
UNIQUE (match_id, player_id)
INDEX (organization_id, player_id)
CHECK position in (1, 2)
```

`match_id` ist bewusst denormalisiert: nur so ersetzt ein
Datenbank-Constraint die bisherige Regel „eine Person höchstens einmal pro
Match", die zuvor `UNIQUE (match_id, player_id)` auf `match_participants`
sicherstellte.

### teams

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
name varchar(120) NOT NULL
short_name varchar(20)
status varchar(30) NOT NULL DEFAULT 'ACTIVE'
created_at, updated_at

UNIQUE (organization_id, name)
INDEX (organization_id, status)
CHECK length(trim(name)) > 0
CHECK status in ('ACTIVE', 'ARCHIVED')
```

### team_players

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
team_id uuid FK teams ON DELETE CASCADE NOT NULL
player_id uuid FK players ON DELETE RESTRICT NOT NULL
role varchar(20) NOT NULL DEFAULT 'PLAYER'
valid_from timestamptz NOT NULL DEFAULT now()
valid_to timestamptz

UNIQUE (team_id, player_id, valid_from)
UNIQUE (team_id, player_id) WHERE valid_to IS NULL
INDEX (organization_id, player_id)
CHECK role in ('PLAYER', 'CAPTAIN')
CHECK valid_to IS NULL OR valid_to > valid_from
```

Die Zeitgültigkeit ist von Anfang an vorhanden, weil eine Aufstellung gegen
den Kader **zum Ansetzungszeitpunkt der Begegnung** geprüft wird. Ohne sie
würde ein späterer Kaderwechsel vergangene Begegnungen ungültig erscheinen
lassen. Transfers als Vorgang sind nicht Teil dieser Spec.

### competitions

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
type varchar(20) NOT NULL
name varchar(120) NOT NULL
slug varchar(120) NOT NULL
status varchar(30) NOT NULL
points_per_game_win integer NOT NULL DEFAULT 1
draw_allowed boolean NOT NULL DEFAULT true
decider_rule varchar(20) NOT NULL DEFAULT 'NONE'
min_squad_size integer NOT NULL
max_squad_size integer NOT NULL
min_appearances_per_player integer NOT NULL DEFAULT 0
max_appearances_per_player integer NOT NULL
max_singles_per_player integer NOT NULL
max_doubles_per_player integer NOT NULL
version integer NOT NULL DEFAULT 0
created_at, updated_at

UNIQUE (organization_id, slug)
INDEX (organization_id, status)
CHECK type in ('LEAGUE')
CHECK status in ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')
CHECK decider_rule in ('NONE', 'EXTRA_SLOT')
CHECK points_per_game_win > 0
CHECK min_squad_size > 0 and max_squad_size >= min_squad_size
CHECK max_appearances_per_player >= min_appearances_per_player
CHECK max_singles_per_player >= 0 and max_doubles_per_player >= 0
CHECK draw_allowed or decider_rule = 'EXTRA_SLOT'
```

`type` ist heute einwertig, existiert aber als Spalte, damit Turnierserien
später denselben Träger nutzen, ohne die Tabelle zu ersetzen.

Der letzte Check schliesst einen widersprüchlichen Zustand aus: wer kein
Unentschieden zulässt, braucht einen Entscheidungsslot.

### competition_slots

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
competition_id uuid FK competitions ON DELETE CASCADE NOT NULL
sequence integer NOT NULL
role varchar(20) NOT NULL DEFAULT 'REGULAR'
discipline varchar(20) NOT NULL
label varchar(60) NOT NULL
starting_score integer NOT NULL
double_out boolean NOT NULL DEFAULT true
best_of_legs integer NOT NULL
legs_to_win_set integer NOT NULL DEFAULT 2
sets_to_win integer NOT NULL DEFAULT 1

UNIQUE (competition_id, sequence)
UNIQUE (competition_id, role) WHERE role = 'DECIDER'
CHECK role in ('REGULAR', 'DECIDER')
CHECK discipline in ('SINGLES', 'DOUBLES')
CHECK starting_score in (301, 501, 701)
CHECK best_of_legs > 0 and mod(best_of_legs, 2) = 1
CHECK legs_to_win_set > 0 and sets_to_win > 0
```

Die Vorlage ist bewusst eine Tabelle und kein JSONB-Dokument. Nur so tragen
Startscore, Disziplin und die Ungeradheit von `best_of_legs` echte
Datenbank-Constraints statt ausschliesslich serverseitiger Validierung.

### encounters

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
competition_id uuid FK competitions ON DELETE CASCADE NOT NULL
public_id uuid NOT NULL DEFAULT gen_random_uuid()
matchday integer NOT NULL
home_team_id uuid FK teams ON DELETE RESTRICT NOT NULL
away_team_id uuid FK teams ON DELETE RESTRICT NOT NULL
scheduled_at timestamptz NOT NULL
venue varchar(120)
status varchar(30) NOT NULL DEFAULT 'DRAFT'
version integer NOT NULL DEFAULT 0
home_points integer NOT NULL DEFAULT 0
away_points integer NOT NULL DEFAULT 0
home_legs integer NOT NULL DEFAULT 0
away_legs integer NOT NULL DEFAULT 0
result varchar(20)
completed_at timestamptz
created_at, updated_at

UNIQUE (public_id)
UNIQUE (competition_id, matchday, home_team_id)
UNIQUE (competition_id, matchday, away_team_id)
INDEX (organization_id, competition_id, status)
INDEX (organization_id, scheduled_at)
CHECK home_team_id <> away_team_id
CHECK matchday > 0
CHECK version >= 0
CHECK status in ('DRAFT', 'LINEUPS_OPEN', 'READY', 'RUNNING', 'COMPLETED', 'CANCELLED')
CHECK result is null or result in ('HOME_WIN', 'AWAY_WIN', 'DRAW')
CHECK (status = 'COMPLETED') = (result is not null)
```

`public_id` trennt die öffentliche Live-Ansicht von der internen id, wie es
`players.public_id` bereits vormacht.

### encounter_slots

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
encounter_id uuid FK encounters ON DELETE CASCADE NOT NULL
sequence integer NOT NULL
role varchar(20) NOT NULL
discipline varchar(20) NOT NULL
label varchar(60) NOT NULL
starting_score integer NOT NULL
double_out boolean NOT NULL
best_of_legs integer NOT NULL
legs_to_win_set integer NOT NULL
sets_to_win integer NOT NULL
status varchar(30) NOT NULL DEFAULT 'WAITING'
board_id uuid FK boards ON DELETE SET NULL
match_id uuid FK matches ON DELETE SET NULL
winner_side varchar(10)
result_type varchar(20)
home_legs integer NOT NULL DEFAULT 0
away_legs integer NOT NULL DEFAULT 0
version integer NOT NULL DEFAULT 0
completed_at timestamptz
created_at, updated_at

UNIQUE (encounter_id, sequence)
UNIQUE (match_id)
UNIQUE (board_id) WHERE status = 'IN_PROGRESS'
INDEX (organization_id, encounter_id, status)
CHECK status in ('WAITING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'WALKOVER', 'CANCELLED')
CHECK winner_side is null or winner_side in ('HOME', 'AWAY')
CHECK result_type is null or result_type in ('PLAYED', 'WALKOVER')
CHECK (status in ('COMPLETED', 'WALKOVER')) = (result_type is not null)
CHECK result_type is null or winner_side is not null
CHECK result_type <> 'WALKOVER' or match_id is null
```

Die Slots sind eine **Kopie** der Vorlage zum Zeitpunkt der Ansetzung. Ändert
jemand die Vorlage mitten in der Saison, bleiben angesetzte und gespielte
Begegnungen unverändert. Das entspricht der Regel, dass ausgelieferte Zustände
nicht rückwirkend verändert werden.

### encounter_lineup_entries

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
encounter_id uuid FK encounters ON DELETE CASCADE NOT NULL
slot_id uuid FK encounter_slots ON DELETE CASCADE NOT NULL
side varchar(10) NOT NULL
position smallint NOT NULL
player_id uuid FK players ON DELETE RESTRICT NOT NULL

UNIQUE (slot_id, side, position)
UNIQUE (slot_id, side, player_id)
INDEX (organization_id, encounter_id)
INDEX (encounter_id, player_id)
CHECK side in ('HOME', 'AWAY')
CHECK position in (1, 2)
```

Dass ein Einzelslot genau eine und ein Doppelslot genau zwei Positionen je
Seite besitzt, ist eine tabellenübergreifende Regel. Sie wird von der
League-Engine geprüft und beim Statuswechsel auf `READY` in derselben
Transaktion nachgezählt.

### encounter_commands

```text
command_id uuid PK
organization_id uuid FK organizations NOT NULL
encounter_id uuid FK encounters ON DELETE CASCADE NOT NULL
type varchar(30) NOT NULL
payload jsonb NOT NULL
resulting_version integer NOT NULL
created_at timestamptz NOT NULL DEFAULT now()

INDEX (organization_id, encounter_id)
CHECK type in ('SUBMIT_LINEUP', 'START_ENCOUNTER', 'ASSIGN_SLOT', 'RELEASE_BOARD',
               'DECLARE_WALKOVER', 'CANCEL_ENCOUNTER')
CHECK resulting_version >= 0
```

Aufbau und Zweck entsprechen `tournament_commands`: dieselbe `commandId` darf
keinen zweiten Effekt erzeugen.

## Migration

Eine einzige neue versionierte Drizzle-Migration. Bestehende Migrationen
werden nicht verändert. Der gesamte Ablauf läuft in einer Transaktion:

1. `match_participant_players` anlegen und aus `match_participants` befüllen
   (`position = 1`, `match_id` mitkopiert).
2. `matches.starting_seat`, `current_seat`, `winner_seat` sowie
   `legs.starting_seat`, `winner_seat` additiv anlegen und per Join über
   `match_participants` aus den bestehenden Spieler-Spalten füllen.
3. `visits.seat` additiv anlegen und ebenso füllen.
4. Die neuen Spalten auf `NOT NULL` setzen, soweit die alten es waren
   (`winner_seat` bleibt nullable).
5. `visits.player_id` zu `thrower_player_id` umbenennen.
6. Alte Spalten und den obsoleten Index
   `match_participants_match_player_unique` entfernen,
   `match_participants.player_id` löschen.
7. Neue Tabellen anlegen.

Der Backfill ist verlustfrei, weil jede bestehende Kombination aus Match und
Spieler dank `UNIQUE (match_id, player_id)` genau einen Sitz besitzt. Nach der
Migration existiert kein Datensatz mehr, der den alten Weg benötigt.

## Engines

### scoring-engine

Die Engine bleibt frei von Infrastruktur und deterministisch.

- `X01Match` und `createX01Match` nehmen zwei **Seiten** entgegen:
  `{ seat: 1 | 2; playerIds: readonly string[] }`.
- `SubmitVisitCommand` trägt zusätzlich `throwerPlayerId`. Die Engine lehnt
  einen Visit der falschen Person mit `INVALID_THROWER` ab.
- `X01PlayerState` wird zu einem Seitenzustand und nennt zusätzlich die
  aktuell werfende Person.
- Die Wurfreihenfolge ist eine reine Funktion ohne gespeicherten Zustand:
  die Seite wechselt nach jedem Visit; innerhalb der Seite wirft beim
  `k`-ten Visit dieser Seite in Leg `n` die Person an Position
  `(k + n - 1) mod anzahlPersonen`. Über mehrere Legs beginnt damit jede
  Person eines Doppels gleich häufig.

Einzelmatches durchlaufen exakt denselben Pfad mit einer einelementigen Seite.

### scheduling-engine

`evaluateMatchReadiness` wird verallgemeinert, damit Turnier und Begegnung
dieselbe Regel benutzen:

- `participantIds: readonly [string | null, string | null]` wird zu
  `sideMemberIds: readonly [readonly string[] | null, readonly string[] | null]`.
- `tournamentStatus` wird zu `parentStatus: "OPEN" | "CLOSED"`; die
  Übersetzung des jeweiligen Aggregatstatus übernimmt der Aufrufer.
- Neuer Code `BLOCKED_LINEUP_MISSING`, wenn eine Seite noch unbesetzt ist.
- Die übrigen Codes bleiben unverändert; „mindestens eine Person spielt
  bereits" prüft nun alle Personen beider Seiten.

### league-engine

Neues Paket `packages/league-engine`, ohne Drizzle, PostgreSQL, Redis, NestJS,
Next.js oder Socket.IO, analog zu `tournament-engine`.

```ts
validateEncounterTemplate(slots): void
validateLineup(input): void
calculateEncounterResult(input): EncounterResult
resolveDeciderRequirement(input): DeciderDecision
```

- `validateEncounterTemplate` prüft lückenlose Sequenz ab 1, höchstens einen
  Entscheidungsslot und die Konsistenz von Disziplin, Startscore und Distanz.
  Der Entscheidungsslot trägt stets die höchste Sequenz.
- `validateLineup` prüft je Seite: jeder reguläre Slot besetzt, Einzel genau
  eine Person, Doppel genau zwei, keine Person zweimal im selben Slot, alle
  Personen im gültigen Kader, Kadergrösse sowie die Einsatzgrenzen aus dem
  Wettbewerb.
- `calculateEncounterResult` ermittelt Punkte je Seite, Legdifferenz und das
  Ergebnis `HOME_WIN | AWAY_WIN | DRAW`.
- Fehler sind eine `LeagueValidationError` mit stabilem Code, analog zu
  `TournamentValidationError`.

Die Tabellenberechnung ist bewusst nicht enthalten; sie gehört in die
Folge-Spec zur Saison.

## Berechtigungen

`organizationPermissions` wird erweitert:

```text
team:read
team:manage
competition:read
competition:manage
encounter:read
encounter:manage
encounter:lineup
```

- `OWNER` und `ADMIN` erhalten alle neuen Rechte.
- `TOURNAMENT_DIRECTOR` erhält alle neuen Rechte. Der Ligabetrieb ist die
  Aufgabe dieser Rolle.
- `SCORER` erhält die drei Leserechte und `encounter:lineup`, damit eine
  Aufstellung vor Ort erfasst werden kann. Das Scoring selbst läuft
  unverändert über `match:score` und `match:undo`.
- `MEMBER` und `VIEWER` erhalten die drei Leserechte.

Der Server entscheidet in jedem Fall. Ausgeblendete Bedienelemente sind keine
Autorisierungsgrenze. Ein Self-Service für Team-Captains bräuchte eine
teambezogene Autorisierung und ist nicht Teil dieser Spec.

## API

Basis `/api/v1`, ressourcenorientiert, Fehlerformat wie in `AGENTS.md`
Abschnitt 15.

```text
GET    /organizations/:organizationId/teams
POST   /organizations/:organizationId/teams
PATCH  /organizations/:organizationId/teams/:teamId
POST   /organizations/:organizationId/teams/:teamId/members
DELETE /organizations/:organizationId/teams/:teamId/members/:playerId

GET    /organizations/:organizationId/competitions
POST   /organizations/:organizationId/competitions
GET    /organizations/:organizationId/competitions/:competitionId
PATCH  /organizations/:organizationId/competitions/:competitionId

GET    /organizations/:organizationId/competitions/:competitionId/encounters
POST   /organizations/:organizationId/competitions/:competitionId/encounters
GET    /organizations/:organizationId/encounters/:encounterId
POST   /organizations/:organizationId/encounters/:encounterId/lineup
POST   /organizations/:organizationId/encounters/:encounterId/start
POST   /organizations/:organizationId/encounters/:encounterId/slots/:slotId/assign
POST   /organizations/:organizationId/encounters/:encounterId/slots/:slotId/release
POST   /organizations/:organizationId/encounters/:encounterId/slots/:slotId/walkover
POST   /organizations/:organizationId/encounters/:encounterId/cancel

GET    /public/encounters/:publicId
```

Jede Mutation an Wettbewerb und Begegnung trägt `commandId` und
`expectedVersion`; die zugehörigen Aggregate führen dafür eine
`version`-Spalte. Teams und Kader sind gewöhnliches CRUD ohne Version, aber
ebenfalls auditiert:

```json
{
  "commandId": "…",
  "expectedVersion": 12,
  "side": "HOME",
  "entries": [{ "sequence": 1, "position": 1, "playerId": "…" }]
}
```

Alle Eingaben werden serverseitig mit Zod-Schemata aus `packages/schemas`
validiert. Interne Stacktraces erreichen keinen Client.

## Abläufe

### Begegnung ansetzen

```text
BEGIN
  encounter einfügen (Status DRAFT)
  encounter_slots aus competition_slots kopieren
  audit_event ENCOUNTER_SCHEDULED
COMMIT
```

Anschliessend `LINEUPS_OPEN`.

### Aufstellung melden

```text
BEGIN
  encounter FOR UPDATE, expectedVersion prüfen
  Kader beider Teams zum scheduled_at laden
  league-engine validiert die Aufstellung der Seite
  bestehende Einträge dieser Seite ersetzen
  version + 1, encounter_commands, audit_event
COMMIT
```

Sind beide Seiten vollständig, wechselt die Begegnung auf `READY`.

### Begegnung starten

```text
BEGIN
  expectedVersion prüfen, beide Aufstellungen nachzählen
  Status RUNNING, alle regulären Slots WAITING
  outbox_event ENCOUNTER_STARTED
  encounter_commands, audit_event
COMMIT
```

Es entstehen hier **keine** Matches. Alle achtzehn Slots stehen inklusive
Aufstellung fest, aber eine Zeile in `matches` bedeutet „läuft". Die
Scoring-Session entsteht wie im Turnier erst bei der Board-Zuweisung.

### Slot einem Board zuweisen

```text
BEGIN
  encounter und Slot FOR UPDATE
  Board FOR UPDATE, Belegung gegen tournament_matches UND encounter_slots prüfen
  evaluateMatchReadiness über beide Seiten
  matches, match_participants (Sitz 1 und 2), match_participant_players anlegen
  Slot: match_id, board_id, status IN_PROGRESS
  outbox_event ENCOUNTER_SLOT_ASSIGNED
  encounter_commands, audit_event
COMMIT
```

Die Boardprüfung muss beide Quellen betrachten, weil kein einzelner
Datenbank-Constraint über zwei Tabellen hinweg gilt. Das Sperren der
Board-Zeile innerhalb der Transaktion verhindert die Doppelvergabe.

### Spielende und Fortschreibung

Der bestehende Scoring-Pfad schliesst das Match ab. In derselben Transaktion
wie der abschliessende Visit läuft eine Fortschreibung analog zu
`update-tournament-progress.ts`:

```text
Slot auf COMPLETED, winner_side, result_type PLAYED, home_legs, away_legs
Board freigeben
Zwischenstand der Begegnung über league-engine neu berechnen
alle Slots abgeschlossen und kein Entscheidungsslot nötig
  → Ergebnis, Status COMPLETED, completed_at
  → outbox_event ENCOUNTER_COMPLETED
```

Ist `decider_rule = 'EXTRA_SLOT'` und steht es gleich, wird der
Entscheidungsslot aus der Vorlage aktiviert und wie ein regulärer Slot
besetzt und zugewiesen. Seine Aufstellung wird erst dann gemeldet und dabei
erneut gegen die Einsatzgrenzen des Wettbewerbs geprüft, nun einschliesslich
der bereits absolvierten Spiele. Wird der Entscheidungsslot nicht gebraucht,
endet er auf `CANCELLED` und zählt in keiner Wertung mit.

### Nichtantritt

`DECLARE_WALKOVER` wertet einen Slot ohne laufendes Match kampflos. Eine
Begründung ist Pflicht und wird auditiert. Der Sieger erhält die zum Sieg
nötige Anzahl Legs, der Verlierer null.

### Technischer Abbruch

Der bestehende `match:abort` bleibt zuständig. Gehört das Match zu einem
Slot, wird dieser auf `WAITING` zurückgesetzt und das Board freigegeben —
dieselbe Systematik wie bei Turniermatches.

## Realtime

```text
HTTP Command → DB Commit → Outbox → Realtime Broadcast
```

Neue Outbox-Ereignisse mit `aggregate_type = 'Encounter'`:
`ENCOUNTER_STARTED`, `ENCOUNTER_SLOT_ASSIGNED`, `ENCOUNTER_SLOT_COMPLETED`,
`ENCOUNTER_COMPLETED`. Sie werden vom bestehenden Outbox-Poller verteilt und
niemals vor dem Commit gesendet. Die Scoring-Ereignisse bleiben unverändert am
Match.

## Statistik

`visits.thrower_player_id` erfasst auch im Doppel die tatsächlich werfende
Person, die Daten liegen also vollständig vor.

Die bestehenden Aggregate in `player_statistic_aggregates` zählen jedoch
weiterhin **ausschliesslich Einzelspiele** — erkennbar daran, dass die Seite
genau eine Person hat. Andernfalls verschöben sich rückwirkend alle Averages,
und ein 701-Doppel wäre mit einem 501-Einzel vermengt. Die Auswertung der
Doppeldaten ist eigene Arbeit und braucht eine Disziplin-Dimension.

## Benutzeroberfläche

Mobile First, Touch-Ziele in verlässlicher Grösse, Serverzustand über TanStack
Query, Formulare über React Hook Form und Zod. Keine Turnier- oder
Ligalogik in Komponenten.

### Turnierleitung

- Wettbewerb anlegen: Vorlageneditor mit Slotliste (Reihenfolge, Disziplin,
  Startscore, Distanz), Aufstellungs- und Wertungsregeln.
- Teams und Kader verwalten.
- Begegnung ansetzen: Spieltag, Heim, Gast, Zeit, Ort.
- Aufstellungsformular je Seite: Slotliste mit Spielerauswahl und laufender
  Validierung gegen die Wettbewerbsregeln; Fehler stehen als Text am
  betroffenen Feld.
- Begegnungsleitung: achtzehn Slots mit Status, Board zuweisen, Zwischenstand,
  Walkover, Verbindungsstatus.

### Scoring

Das bestehende Scoreboard zeigt im Doppel beide Namen je Seite und hebt die
aktuell werfende Person hervor. Die Bedienung bleibt identisch; das Gerät
sendet zusätzlich die werfende Person mit.

### Öffentliche Ansicht

`/public/encounters/:publicId` zeigt Teams, Zwischenstand, die achtzehn Slots
mit Ergebnis und die aktuell laufenden Boards, ohne manuelles Neuladen.

### Accessibility

Semantisches HTML, Tastaturbedienung der Leitungsansichten, sichtbarer Fokus,
ausreichender Kontrast, keine Information ausschliesslich über Farbe. Der
Status eines Slots wird als Text und nicht nur farblich ausgewiesen.

## Fehlerfälle

| Situation | Antwort | Code |
| --- | --- | --- |
| Aufstellung unvollständig | 422 | `LINEUP_SLOT_UNFILLED` |
| Einsatzgrenze überschritten | 422 | `LINEUP_PLAYER_LIMIT_EXCEEDED` |
| Person nicht im gültigen Kader | 422 | `LINEUP_PLAYER_NOT_IN_SQUAD` |
| Person zweimal im selben Slot | 422 | `LINEUP_DUPLICATE_IN_SLOT` |
| Vorlage lückenhaft oder widersprüchlich | 422 | `TEMPLATE_INVALID` |
| Version passt nicht | 409 mit aktuellem Zustand | `ENCOUNTER_VERSION_CONFLICT` |
| Board belegt | 409 | `BOARD_UNAVAILABLE` |
| Person spielt bereits | 409 | `PLAYER_BUSY` |
| Begegnung beendet oder abgebrochen | 409 | `ENCOUNTER_CLOSED` |
| Falsche werfende Person | 422 | `INVALID_THROWER` |
| Fremde Organisation | 404 | `NOT_FOUND` |

Eine wiederholte `commandId` liefert dieselbe Antwort und erzeugt keinen
zweiten Effekt.

## Tests und Abnahmekriterien

### Engine-Tests, ohne Infrastruktur

- `league-engine`: Vorlagenvalidierung (Lücke in der Sequenz, zwei
  Entscheidungsslots, ungerade Distanz), jede Fehlerklasse der
  Aufstellungsprüfung, Wertung mit Sieg, Niederlage, Unentschieden und
  Entscheidungsslot, Legdifferenz.
- `scoring-engine`: Doppelrotation über mehrere Legs, falsche werfende Person,
  Checkout im Doppel, Undo im Doppel, Wiederholung derselben `commandId`,
  701 mit Double Out, Bust und Rest 1 im Doppel.
- `scheduling-engine`: Seite mit zwei Personen, Person in zwei Slots
  gleichzeitig, fehlende Aufstellung, kein freies Board.

### Integrationstests mit Testcontainers

- Vollständige Begegnung über achtzehn Slots bis zum Ergebnis.
- Versionskonflikt bei gleichzeitiger Aufstellungsänderung.
- Doppelte `commandId` erzeugt keinen zweiten Effekt.
- Walkover und anschliessende Ergebnisermittlung.
- Board wird nicht doppelt vergeben, wenn ein Turnier es bereits nutzt.
- Zugriff mit fremder `organizationId` liefert 404 für Teams, Wettbewerbe,
  Begegnungen und Slots.
- Migration: bestehende Einzelmatches, Legs und Visits bleiben nach dem
  Backfill inhaltlich identisch.

### Browser-Tests

Begegnung ansetzen, beide Aufstellungen erfassen, zwei Slots parallel auf zwei
Boards spielen, ein Doppel vollständig ausspielen, Ergebnis der Begegnung
prüfen.

### Vollständige Verifikation

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## Nicht im Umfang

- Saison, Divisionen, Spielplangenerierung, Hin- und Rückrunde
- Ligatabelle, Auf- und Abstieg, Transfers als Vorgang
- Self-Service für Team-Captains
- Auswertung der Doppelstatistik
- nachträgliche Ergebniskorrektur einer abgeschlossenen Begegnung
- Turnierserien
- Teams in Turnieren; die Turnierseite bleibt in dieser Spec einzelspielerbasiert

## Annahmen zur Bestätigung durch die Turnierleitung

Diese Punkte sind im Entwurf entschieden, damit die Spec vollständig ist. Sie
sind bewusst als Wettbewerbseinstellung ausgelegt und ohne Codeänderung
korrigierbar.

1. **Distanz je Spiel:** Einzel 501 und Doppel 701 werden mit Best of 3 Legs
   angesetzt, Double Out.
2. **Kadergrenzen:** minimal 4, maximal 12 Personen; höchstens 2 Einzel und
   höchstens 1 Doppel pro Person, mindestens 1 Einsatz.
3. **Unentschieden:** bei 9:9 bleibt es beim Unentschieden, es gibt keinen
   Entscheidungsslot.
4. **Punkte:** ein Punkt je gewonnenem Spiel; die Legdifferenz wird
   mitgeführt, entscheidet aber erst in der späteren Tabelle.
5. **Walkover:** der Sieger erhält die zum Sieg nötige Legzahl, der Verlierer
   null.
6. **Kaderstichtag:** die Aufstellung wird gegen den Kader zum
   Ansetzungszeitpunkt der Begegnung geprüft, nicht gegen den heutigen.
7. **Doppelpaarungen** werden aus demselben Kader gebildet wie die Einzel; es
   gibt keinen getrennten Doppelkader.
