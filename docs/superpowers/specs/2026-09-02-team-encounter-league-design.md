# Team-Begegnung als Ligamodus

**Datum:** 2. September 2026
**Status:** Entwurf, zur fachlichen Freigabe durch die Turnierleitung
**Geltungsbereich:** Teams, Ligawettbewerbe, Team-Begegnungen, Doppelspiele,
Seitenmodell im Match, Scoring- und Scheduling-Engine
**Grundlagen:** VFC-Ligareglement im Electronic Dart, Ausgabe 2026 / S2,
inklusive Anhang 1 bis 6; abgeglichen mit der laufenden Saison der Gruppe
STSO S 2 (<https://www.vfc.ch/ligarang.php?gruppe=STSO%20S%202>)

## Ziel

Die Plattform unterstützt den wöchentlichen Ligabetrieb: zwei Teams treffen an
einem Spieltag aufeinander und tragen eine **Begegnung** aus, die aus mehreren
Einzel- und Doppelspielen besteht. Fachliche Grundlage ist das
**VFC-Ligareglement, Ausgabe 2026 / S2**. Der real gespielte Modus ist
(Reglement 2.2.8)

```text
Runde 1   4x Einzel 501
Runde 2   4x Einzel 501
          2x Doppel 701
Runde 3   4x Einzel 501
Runde 4   4x Einzel 501
          bei Gleichstand 1x Entscheidungsdoppel 701 (sudden death)
```

also sechzehn Einzel und zwei Doppel in fester Reihenfolge, dazu bei
Gleichstand ein neunzehntes Spiel.

Die sechzehn Einzel sind kein freies Ansetzen, sondern ein vollständiges
Rundenturnier zwischen den vier aufgestellten Personen beider Teams
(„jeder gegen jeden", Reglement 2.2.1). Jede aufgestellte Person bestreitet
damit genau vier Einzel. Die Ligarangliste der laufenden Saison bestätigt
das: Personen aus Teams mit zwei absolvierten Begegnungen führen dort acht
Einzelspiele.

Nach der Umsetzung kann eine Organisation einen Ligawettbewerb mit einer
Begegnungsvorlage anlegen, Teams mit Kader führen, eine Begegnung ansetzen,
beide Aufstellungen erfassen, die achtzehn Spiele — bei Gleichstand neunzehn —
auf mehreren Boards ausspielen und das Ergebnis der Begegnung automatisch
ermitteln lassen.

Saison, Spielplangenerierung und Ligatabelle sind **nicht** Teil dieser Spec.
Sie bauen auf dem hier entworfenen Fundament auf und erhalten eine eigene Spec.

## Fachliche Begriffe

- **Wettbewerb** (`competition`): Klammer über mehrere Begegnungen, hier vom
  Typ `LEAGUE`. Trägt die Begegnungsvorlage, die Aufstellungsregeln und die
  Wertungsregeln.
- **Begegnungsvorlage**: die nummerierten Slots eines Wettbewerbs. Für den
  Auslöser dieser Spec: Slot 1 bis 8 Einzel 501, Slot 9 und 10 Doppel 701,
  Slot 11 bis 18 Einzel 501, Slot 19 Entscheidungsdoppel 701. Jeder Einzelslot
  trägt zusätzlich die beiden Aufstellungspositionen, die gegeneinander
  antreten; erst dadurch ist das Rundenturnier in der Vorlage abgebildet.
- **Begegnung** (`encounter`): ein Aufeinandertreffen zweier Teams an einem
  Spieltag. Besteht aus einer eingefrorenen Kopie der Vorlage.
- **Slot**: eine Position innerhalb einer Begegnung. Ein Slot wird zu genau
  einer Scoring-Session (`matches`) oder als Walkover gewertet.
- **Seite** (`match_participants`): eine Hälfte eines Matches. Sie besteht aus
  einer Person im Einzel und aus zwei Personen im Doppel. Der bestehende
  `seat`-Wert 1 oder 2 identifiziert sie innerhalb des Matches.
- **Aufstellung**: die Besetzung einer Seite. Sie besteht aus der Meldung mit
  Aufstellungspositionen für die Einzel und aus den erst am Spielabend
  festgelegten Doppelpaarungen.
- **Kader** (`team_players`): die zu einem Zeitpunkt gültigen Mitglieder eines
  Teams.
- **Aufstellungsposition**: die Nummer 1 bis 4, unter der eine Person auf dem
  Spielrapport einer Seite geführt wird. Die Einzelpaarungen folgen aus den
  Positionen und nicht aus einer freien Auswahl je Slot.
- **Meldung** (`encounter_nominations`): alle für diesen Abend eingetragenen
  Personen einer Seite, inklusive Ersatzspielerinnen und Ersatzspielern.

Ein Slot ist kein Match, solange er kein Board hat. Eine Seite ist kein
Spieler. Ein Werfer ist eine Person, eine Seite kann zwei davon haben.

Das Reglement benennt dieselben Dinge anders. Die Zuordnung ist eindeutig, und
die Oberfläche zeigt die Reglementssprache:

| Reglement | Plattform |
| --- | --- |
| Begegnung | `encounters` |
| Spiel (max. 18, mit sudden death 19) | Slot, gespielt als ein Match |
| Satz (max. 36 je Team) | Leg |
| Pluspunkte | Begegnungspunkte der eigenen Seite |
| Minuspunkte | Begegnungspunkte der Gegenseite |

Ein „Satz" im Reglement ist damit ein **Leg** der Plattform. Ein Spiel geht
auf zwei Gewinnsätze, in der Sprache der Plattform also über drei Legs mit
zwei Leggewinnen zum Sieg (Reglement A1.2).

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
points_win integer NOT NULL DEFAULT 3
points_draw integer NOT NULL DEFAULT 1
points_loss integer NOT NULL DEFAULT 0
points_decider_bonus integer NOT NULL DEFAULT 1
decider_rule varchar(20) NOT NULL DEFAULT 'NONE'
lineup_positions smallint NOT NULL DEFAULT 4
min_nominations integer NOT NULL DEFAULT 4
min_nominations_shorthanded integer NOT NULL DEFAULT 3
max_substitutions_per_encounter integer NOT NULL DEFAULT 4
max_doubles_per_player integer NOT NULL DEFAULT 1
version integer NOT NULL DEFAULT 0
created_at, updated_at

UNIQUE (organization_id, slug)
INDEX (organization_id, status)
CHECK type in ('LEAGUE')
CHECK status in ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')
CHECK decider_rule in ('NONE', 'EXTRA_SLOT')
CHECK points_win >= points_draw and points_draw >= points_loss
CHECK points_loss >= 0
CHECK points_decider_bonus >= 0
CHECK points_decider_bonus = 0 or decider_rule = 'EXTRA_SLOT'
CHECK lineup_positions > 0
CHECK min_nominations >= lineup_positions
CHECK min_nominations_shorthanded > 0
CHECK min_nominations_shorthanded <= min_nominations
CHECK max_substitutions_per_encounter >= 0
CHECK max_doubles_per_player >= 0
```

`type` ist heute einwertig, existiert aber als Spalte, damit Turnierserien
später denselben Träger nutzen, ohne die Tabelle zu ersetzen.

Die Punktevergabe folgt Reglement 2.2.2 und A1.4 und ist **nicht** „ein Punkt
je gewonnenem Spiel": die siegreiche Mannschaft erhält 3 Pluspunkte, die
unterlegene 0. Bei 9:9 Spielen erhalten beide 1 Pluspunkt, danach entscheidet
zwingend ein Entscheidungsdoppel, dessen Sieger einen Zusatzpunkt bekommt
(2:1). Minuspunkte werden nicht getrennt gespeichert; sie sind stets die
Pluspunkte der Gegenseite. Die laufende Saison bestätigt beide Fälle: eine
Begegnung endete 2:1 Punkte bei 10:9 Spielen, alle übrigen 3:0 bei 18
Spielen.

Die frühere Grenze „höchstens zwei Einzel je Person" entfällt ersatzlos. Wie
viele Einzel eine Person bestreitet, ergibt sich aus der Vorlage: jede der
vier Aufstellungspositionen tritt gegen jede gegnerische Position genau einmal
an, also vier Einzel je Person. Eine gesonderte Obergrenze wäre eine zweite,
widersprechbare Quelle derselben Regel.

`min_nominations_shorthanded` bildet Reglement 2.2.5 ab: eine Mannschaft darf
ausnahmsweise mit drei Personen antreten; die Spiele der vierten Position und
eines der beiden Doppel gelten dann als kampflos verloren. Mit weniger als
drei Personen ist die ganze Begegnung verloren (2.5.1).

### competition_slots

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
competition_id uuid FK competitions ON DELETE CASCADE NOT NULL
sequence integer NOT NULL
role varchar(20) NOT NULL DEFAULT 'REGULAR'
discipline varchar(20) NOT NULL
label varchar(60) NOT NULL
home_position smallint
away_position smallint
starting_score integer NOT NULL
in_rule varchar(10) NOT NULL DEFAULT 'STRAIGHT'
out_rule varchar(10) NOT NULL DEFAULT 'DOUBLE'
max_rounds integer
best_of_legs integer NOT NULL
legs_to_win_set integer NOT NULL DEFAULT 2
sets_to_win integer NOT NULL DEFAULT 1

UNIQUE (competition_id, sequence)
UNIQUE (competition_id, role) WHERE role = 'DECIDER'
UNIQUE (competition_id, home_position, away_position)
  WHERE discipline = 'SINGLES'
CHECK role in ('REGULAR', 'DECIDER')
CHECK discipline in ('SINGLES', 'DOUBLES')
CHECK starting_score in (301, 501, 701)
CHECK in_rule in ('STRAIGHT', 'DOUBLE')
CHECK out_rule in ('SINGLE', 'DOUBLE', 'MASTER')
CHECK max_rounds is null or max_rounds > 0
CHECK best_of_legs > 0 and mod(best_of_legs, 2) = 1
CHECK legs_to_win_set > 0 and sets_to_win > 0
CHECK (discipline = 'SINGLES') = (home_position is not null)
CHECK (home_position is null) = (away_position is null)
CHECK home_position is null or home_position > 0
CHECK away_position is null or away_position > 0
```

Die Vorlage ist bewusst eine Tabelle und kein JSONB-Dokument. Nur so tragen
Startscore, Disziplin und die Ungeradheit von `best_of_legs` echte
Datenbank-Constraints statt ausschliesslich serverseitiger Validierung.

`home_position` und `away_position` tragen das Rundenturnier der Einzel. Erst
damit ist in Daten festgehalten, wer gegen wen antritt; der zusammengesetzte
Unique-Index stellt sicher, dass keine Paarung doppelt vorkommt. Doppelslots
tragen keine Positionen, weil ihre Paarungen erst am Spielabend gebildet
werden (Reglement 2.2.1).

`in_rule` und `out_rule` ersetzen das bisher angedachte `double_out boolean`.
Das Reglement kennt vier Varianten (1.1): Nationalliga 501 DI/DO, Klasse A
501 DO, Klasse B 501 MO, Klasse C 501 SO, Doppel jeweils in derselben
Variante auf 701. Ein Boolean kann Master Out und Double In nicht ausdrücken.
`matches.double_out` wird deshalb in derselben Migration zu `matches.in_rule`
und `matches.out_rule` überführt.

`max_rounds` bildet die Rundenbegrenzung aus Anhang 2 ab: 301 fünfzehn, 501
zwanzig, 701 fünfundzwanzig Runden. Wird sie erreicht, entscheidet unabhängig
vom Punktestand ein Wurf auf Bull. `NULL` bedeutet „keine Begrenzung"; für
Steeldart-Ligen ohne Automatenlimit bleibt die Spalte leer.

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
home_games integer NOT NULL DEFAULT 0
away_games integer NOT NULL DEFAULT 0
home_legs integer NOT NULL DEFAULT 0
away_legs integer NOT NULL DEFAULT 0
result varchar(20)
result_type varchar(20)
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
CHECK result_type is null or result_type in ('PLAYED', 'DECIDER', 'FORFEIT')
CHECK (status = 'COMPLETED') = (result is not null)
CHECK (result is null) = (result_type is null)
CHECK result <> 'DRAW' or result_type = 'PLAYED'
```

`public_id` trennt die öffentliche Live-Ansicht von der internen id, wie es
`players.public_id` bereits vormacht.

Punkte und **Spiele** sind getrennte Grössen und werden beide fortgeschrieben.
Die Ligarangliste des Verbands führt genau diese drei Paare: Pluspunkte,
gewonnene und verlorene Spiele, gewonnene und verlorene Sätze. `home_games`
zählt gewonnene Slots, `home_legs` gewonnene Legs. Ohne `home_games` liesse
sich die Tabelle später nicht bilden, weil die Punkte 3:0 oder 2:1 lauten und
den Spielstand 18:0 bis 9:9 nicht mehr enthalten.

`result_type` unterscheidet den regulär entschiedenen Ausgang, den Ausgang
nach Entscheidungsdoppel und den Nichtantritt. Ein Nichtantritt (Reglement
2.1.1 und 2.5.1) wird als ganze Begegnung gewertet: 0:3 Punkte, 0:18 Spiele,
0:36 Legs.

### encounter_slots

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
encounter_id uuid FK encounters ON DELETE CASCADE NOT NULL
sequence integer NOT NULL
role varchar(20) NOT NULL
discipline varchar(20) NOT NULL
label varchar(60) NOT NULL
home_position smallint
away_position smallint
starting_score integer NOT NULL
in_rule varchar(10) NOT NULL
out_rule varchar(10) NOT NULL
max_rounds integer
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
CHECK (discipline = 'SINGLES') = (home_position is not null)
CHECK (home_position is null) = (away_position is null)
```

Die Slots sind eine **Kopie** der Vorlage zum Zeitpunkt der Ansetzung. Ändert
jemand die Vorlage mitten in der Saison, bleiben angesetzte und gespielte
Begegnungen unverändert. Das entspricht der Regel, dass ausgelieferte Zustände
nicht rückwirkend verändert werden.

### encounter_nominations

Der Spielrapport einer Seite: alle für diesen Abend eingetragenen Personen.
Personen mit einer Aufstellungsposition bestreiten die Einzel, Personen ohne
Position sind Ersatz und für die Doppel dennoch spielberechtigt (Reglement
2.2.1).

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
encounter_id uuid FK encounters ON DELETE CASCADE NOT NULL
side varchar(10) NOT NULL
player_id uuid FK players ON DELETE RESTRICT NOT NULL
position smallint
origin varchar(20) NOT NULL DEFAULT 'SQUAD'

UNIQUE (encounter_id, side, player_id)
UNIQUE (encounter_id, side, position)
INDEX (organization_id, encounter_id)
INDEX (encounter_id, player_id)
CHECK side in ('HOME', 'AWAY')
CHECK position is null or position > 0
CHECK origin in ('SQUAD', 'GUEST')
```

`origin = 'GUEST'` hält fest, dass eine Person nach Reglement 1.2.3 und 1.2.4
aus einer anderen Mannschaft desselben Lokals aushilft. Die Saisonkontingente
dafür — höchstens eine Aushilfe je Abend, höchstens vier je Saison, nur in
gleicher oder höherer Klasse — sind Saisonwissen und gehören in die
Folge-Spec; ohne das Merkmal liesse sich dieser reguläre Fall aber gar nicht
erfassen, ohne den Kader zu verfälschen.

### encounter_lineup_entries

Nur für Doppelslots und den Entscheidungsslot. Die Besetzung der Einzelslots
ist **abgeleitet** und wird nicht doppelt gespeichert: sie ergibt sich aus
`encounter_slots.home_position` beziehungsweise `away_position` und der
Meldung an dieser Position.

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

Dass ein Doppelslot genau zwei Positionen je Seite besitzt und dass jede
Person höchstens an einem der beiden regulären Doppel teilnimmt, ist eine
tabellenübergreifende Regel. Sie wird von der League-Engine geprüft und beim
Freigeben des Doppelslots in derselben Transaktion nachgezählt.

### encounter_substitutions

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
encounter_id uuid FK encounters ON DELETE CASCADE NOT NULL
side varchar(10) NOT NULL
position smallint NOT NULL
out_player_id uuid FK players ON DELETE RESTRICT NOT NULL
in_player_id uuid FK players ON DELETE RESTRICT NOT NULL
effective_from_sequence integer NOT NULL
reason varchar(200)
created_at timestamptz NOT NULL DEFAULT now()

UNIQUE (encounter_id, side, position, effective_from_sequence)
INDEX (organization_id, encounter_id)
CHECK side in ('HOME', 'AWAY')
CHECK position > 0
CHECK effective_from_sequence > 0
CHECK out_player_id <> in_player_id
```

Auswechslungen sind kein Randfall, sondern Teil des Ablaufs (Reglement 2.2.4
und 2.2.10) und in der laufenden Saison sichtbar: die Einzelrangliste führt
Personen mit drei statt vier Einzeln je Begegnung. Die Regeln:

- höchstens `max_substitutions_per_encounter` je Begegnung, vier nach
  Reglement,
- nie während einer laufenden Paarung, also nur mit
  `effective_from_sequence` grösser als die höchste bereits gestartete
  Sequenz,
- eine ausgewechselte Person ist für die Einzel dieses Abends gesperrt,
  bleibt für die Doppel aber spielberechtigt,
- die einwechselnde Person muss gemeldet sein.

Die Besetzung eines Einzelslots ist damit: die Meldung an der Position des
Slots, überschrieben durch die jüngste Auswechslung dieser Position mit
`effective_from_sequence <= sequence`. Die Historie bleibt erhalten, und
bereits gespielte Slots behalten ihre Besetzung.

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
CHECK type in ('SUBMIT_NOMINATIONS', 'SUBMIT_DOUBLES', 'SUBSTITUTE_PLAYER',
               'START_ENCOUNTER', 'ASSIGN_SLOT', 'RELEASE_BOARD',
               'DECLARE_WALKOVER', 'DECLARE_ENCOUNTER_FORFEIT',
               'CANCEL_ENCOUNTER')
CHECK resulting_version >= 0
```

Aufbau und Zweck entsprechen `tournament_commands`: dieselbe `commandId` darf
keinen zweiten Effekt erzeugen.

## Migration

Zwei neue versionierte Drizzle-Migrationen, beide vorwärts gerichtet.
Bestehende Migrationen werden nicht verändert.

Der Umbau wird bewusst auf zwei Migrationen aufgeteilt statt auf eine. Mit
einer einzigen Migration müsste der gesamte Code-Umbau in einem einzigen
Commit landen, weil `pnpm typecheck` zwischen Migration und Codeanpassung
sonst rot ist. Zwei Vorwärtsmigrationen halten jeden Commit grün und erlauben
zusätzlich ein Deployment ohne Schreibsperre: zwischen beiden Schritten
schreibt die Anwendung Sitze und Altspalten parallel.

**Migration A — additiv und Backfill.** Läuft in einer Transaktion:

1. `match_participant_players` anlegen und aus `match_participants` befüllen
   (`position = 1`, `match_id` mitkopiert).
2. `matches.starting_seat`, `current_seat`, `winner_seat` sowie
   `legs.starting_seat`, `winner_seat` additiv und zunächst nullable anlegen
   und per Join über `match_participants` aus den bestehenden Spieler-Spalten
   füllen.
3. `visits.seat` additiv anlegen und ebenso füllen.
4. Die neuen Spalten auf `NOT NULL` setzen, soweit die alten es waren
   (`current_seat` und `winner_seat` bleiben nullable), und die
   Check-Constraints auf `in (1, 2)` ergänzen.

Nach Migration A schreibt die Anwendung Sitze und Altspalten gleichzeitig; die
Leser gehen bereits über den Sitz.

**Migration B — Umbenennung und Bereinigung.**

5. `visits.player_id` zu `thrower_player_id` umbenennen. Zwingend als
   `ALTER TABLE ... RENAME COLUMN`, nicht als Drop-and-Add, sonst gehen die
   Werfer verloren.
6. `matches.in_rule` und `matches.out_rule` anlegen, `out_rule` aus
   `double_out` füllen (`true` → `DOUBLE`, `false` → `SINGLE`), `in_rule` auf
   `STRAIGHT` setzen, `matches.max_rounds` nullable ergänzen und
   `matches.double_out` entfernen. `tournaments` erhält dieselbe Behandlung,
   damit Turnier-Defaults und Ligavorlage dieselbe Sprache sprechen.
7. Alte Spalten und den obsoleten Index
   `match_participants_match_player_unique` entfernen,
   `match_participants.player_id` löschen.
8. Neue Tabellen anlegen.

Der Backfill ist verlustfrei, weil jede bestehende Kombination aus Match und
Spieler dank `UNIQUE (match_id, player_id)` genau einen Sitz besitzt. Nach
Migration B existiert kein Datensatz mehr, der den alten Weg benötigt.

## Engines

### scoring-engine

Die Engine bleibt frei von Infrastruktur und deterministisch.

- `X01Match` und `createX01Match` nehmen zwei **Seiten** entgegen:
  `{ seat: 1 | 2; playerIds: readonly string[] }`.
- `X01Rules.doubleOut: boolean` wird zu `inRule: "STRAIGHT" | "DOUBLE"` und
  `outRule: "SINGLE" | "DOUBLE" | "MASTER"`. Das Reglement kennt in 1.1 vier
  Ligavarianten; Master Out und Double In sind heute nicht darstellbar. Der
  Bust bei Rest 1 gilt für `DOUBLE` und `MASTER`, nicht für `SINGLE`.
- `X01Rules.maxRounds: number | null` bildet Anhang 2 ab. Ist die Grenze
  erreicht, endet das Leg nicht durch Checkout, sondern durch ein Ausbullen:
  ein `DecideLegByBullCommand` mit `commandId` und Siegerseite schliesst es
  ab. Die Engine lehnt weitere Visits danach ab und lehnt das Kommando ab,
  solange die Grenze nicht erreicht ist.
- Der Legbeginn folgt Reglement 2.2.9: Leg 1 beginnt die Heimseite, Leg 2 die
  Gastseite, ab Leg 3 entscheidet ein Wurf auf Bull. Die Engine leitet den
  Beginner deshalb nicht durchgängig ab, sondern nimmt ihn für das
  Entscheidungsleg als Eingabe entgegen; das Entscheidungsdoppel beginnt immer
  mit Ausbullen.
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
validateNominations(input): void
validateDoublesPairings(input): void
validateSubstitution(input): void
resolveSlotOccupancy(input): SlotOccupancy
calculateEncounterResult(input): EncounterResult
resolveDeciderRequirement(input): DeciderDecision
```

- `validateEncounterTemplate` prüft lückenlose Sequenz ab 1, höchstens einen
  Entscheidungsslot und die Konsistenz von Disziplin, Startscore und Distanz.
  Der Entscheidungsslot trägt stets die höchste Sequenz und ist ein Doppel.
  Zusätzlich prüft sie das Rundenturnier: über alle Einzelslots tritt jede
  Heimposition gegen jede Gastposition genau einmal an, es gibt also
  `lineup_positions²` Einzelslots.
- `validateNominations` prüft je Seite: Positionen 1 bis `lineup_positions`
  lückenlos besetzt oder — im Ausnahmefall nach 2.2.5 — mindestens
  `min_nominations_shorthanded` davon, keine Person zweimal gemeldet, jede
  Person entweder im gültigen Kader oder ausdrücklich als `GUEST` gemeldet.
- `validateDoublesPairings` prüft: genau zwei Personen je Seite und Doppel,
  beide gemeldet, keine Person in beiden regulären Doppeln derselben Seite.
  Für den Entscheidungsslot entfällt diese Grenze, weil dort nach Reglement
  2.2.1 sämtliche gemeldeten Personen erneut spielberechtigt sind.
- `validateSubstitution` prüft Kontingent, laufende Paarung, Sperre der
  ausgewechselten Person für weitere Einzel und Meldung der einwechselnden
  Person.
- `resolveSlotOccupancy` liefert für einen Slot die beiden Seiten: bei Einzeln
  aus Position und Auswechslungshistorie, bei Doppeln aus den Paarungen.
- `calculateEncounterResult` ermittelt je Seite gewonnene Spiele, gewonnene
  Legs und Punkte. Punkte sind `points_win` bei mehr gewonnenen Spielen,
  sonst `points_draw` für beide, wobei der Sieger des Entscheidungsdoppels
  zusätzlich `points_decider_bonus` erhält. Das Entscheidungsdoppel zählt für
  Spiele und Legs mit (Reglement A1.4), ein nicht benötigter
  Entscheidungsslot zählt nirgends mit. Beim Nichtantritt liefert sie das
  Reglementsergebnis 0:3 Punkte, 0:18 Spiele, 0:36 Legs.
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
- `SCORER` erhält die drei Leserechte und `encounter:lineup`, damit Meldung,
  Doppelpaarungen und Auswechslungen vor Ort erfasst werden können. Das
  Scoring selbst läuft unverändert über `match:score` und `match:undo`.
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
POST   /organizations/:organizationId/encounters/:encounterId/nominations
POST   /organizations/:organizationId/encounters/:encounterId/doubles
POST   /organizations/:organizationId/encounters/:encounterId/substitutions
POST   /organizations/:organizationId/encounters/:encounterId/start
POST   /organizations/:organizationId/encounters/:encounterId/slots/:slotId/assign
POST   /organizations/:organizationId/encounters/:encounterId/slots/:slotId/release
POST   /organizations/:organizationId/encounters/:encounterId/slots/:slotId/walkover
POST   /organizations/:organizationId/encounters/:encounterId/forfeit
POST   /organizations/:organizationId/encounters/:encounterId/cancel

GET    /public/encounters/:publicId
```

Jede Mutation an Wettbewerb und Begegnung trägt `commandId` und
`expectedVersion`; die zugehörigen Aggregate führen dafür eine
`version`-Spalte. Teams und Kader sind gewöhnliches CRUD ohne Version, aber
ebenfalls auditiert:

Die Meldung trägt Positionen, nicht Slots:

```json
{
  "commandId": "…",
  "expectedVersion": 12,
  "side": "HOME",
  "nominations": [
    { "position": 1, "playerId": "…", "origin": "SQUAD" },
    { "position": 2, "playerId": "…", "origin": "SQUAD" },
    { "position": 3, "playerId": "…", "origin": "SQUAD" },
    { "position": 4, "playerId": "…", "origin": "GUEST" },
    { "position": null, "playerId": "…", "origin": "SQUAD" }
  ]
}
```

Die Doppelpaarungen kommen später und getrennt:

```json
{
  "commandId": "…",
  "expectedVersion": 14,
  "side": "HOME",
  "pairings": [{ "sequence": 9, "playerIds": ["…", "…"] }]
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

### Meldung erfassen

Die Aufstellung wird in zwei Schritten erfasst, weil das Reglement es so
verlangt: der Spielrapport wird vor Spielbeginn ausgefüllt, **ausgenommen die
Doppelpaarungen** (2.1.1). Diese werden unmittelbar vor der Begegnung
festgelegt (2.2.1). Eine Begegnung, die erst mit vollständigen Doppeln starten
dürfte, wäre am Spielabend nicht bedienbar.

```text
BEGIN
  encounter FOR UPDATE, expectedVersion prüfen
  Kader beider Teams zum scheduled_at laden
  league-engine validiert die Meldung der Seite
  bestehende Meldungen dieser Seite ersetzen
  version + 1, encounter_commands, audit_event
COMMIT
```

Sind beide Seiten gemeldet, wechselt die Begegnung auf `READY`. Der Captain
der Heimmannschaft meldet zuerst; dass er seine Aufstellung verdeckt schreiben
darf (2.1.1), heisst für die Oberfläche: die gegnerische Meldung ist erst
sichtbar, wenn beide Seiten gemeldet haben.

### Doppelpaarungen melden

```text
BEGIN
  encounter und betroffene Slots FOR UPDATE, expectedVersion prüfen
  Slot muss WAITING sein
  league-engine validiert die Paarungen gegen die Meldungen der Seite
  Einträge der Seite für diesen Slot ersetzen
  version + 1, encounter_commands, audit_event
COMMIT
```

Ein Doppelslot ist erst zuweisbar, wenn beide Seiten ihre Paarung gemeldet
haben. Für den Entscheidungsslot läuft derselbe Weg, sobald er benötigt wird.

### Begegnung starten

```text
BEGIN
  expectedVersion prüfen, beide Meldungen nachzählen
  Status RUNNING, alle regulären Slots WAITING
  outbox_event ENCOUNTER_STARTED
  encounter_commands, audit_event
COMMIT
```

Es entstehen hier **keine** Matches. Die sechzehn Einzelslots stehen inklusive
Besetzung fest, die Doppel folgen später, aber eine Zeile in `matches` bedeutet
„läuft". Die Scoring-Session entsteht wie im Turnier erst bei der
Board-Zuweisung.

Meldet eine Seite nur drei Positionen (2.2.5), werden beim Start die Einzel
der fehlenden Position und eines der beiden Doppel unmittelbar als Walkover
gegen diese Seite gewertet. Meldet eine Seite weniger als drei Positionen oder
tritt sie nicht an, ist der Weg nicht `START_ENCOUNTER`, sondern
`DECLARE_ENCOUNTER_FORFEIT`.

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
  → home_games, away_games, home_legs, away_legs
alle regulären Slots abgeschlossen und kein Entscheidungsslot nötig
  → Punkte, Ergebnis, result_type, Status COMPLETED, completed_at
  → outbox_event ENCOUNTER_COMPLETED
```

Ist `decider_rule = 'EXTRA_SLOT'` und steht es nach den achtzehn regulären
Spielen gleich, wird der Entscheidungsslot aktiviert. Beide Seiten melden dafür
eine Doppelpaarung. Für sie gilt die Grenze „höchstens ein Doppel je Person"
ausdrücklich **nicht**: nach Reglement 2.2.1 sind sämtliche für den Abend
gemeldeten Personen erneut spielberechtigt. Das Ergebnis zählt für Spiele und
Legs mit, und der Sieger erhält den Zusatzpunkt. Wird der Entscheidungsslot
nicht gebraucht, endet er auf `CANCELLED` und zählt in keiner Wertung mit.

### Nichtantritt

Zwei verschiedene Fälle, die das Reglement unterschiedlich wertet.

`DECLARE_WALKOVER` wertet einen einzelnen Slot ohne laufendes Match kampflos —
etwa die Spiele einer fehlenden vierten Person (2.2.5) oder eine nicht
rechtzeitig an der Abwurflinie erschienene Person (2.2.6). Eine Begründung ist
Pflicht und wird auditiert. Der Sieger erhält die zum Sieg nötige Anzahl Legs,
der Verlierer null; das entspricht der Wertung 0:1 Spiele und 0:2 Sätzen.

`DECLARE_ENCOUNTER_FORFEIT` wertet die **ganze** Begegnung, wenn eine
Mannschaft nicht oder mit weniger als drei Personen antritt (2.1.1, 2.5.1).
Das Ergebnis ist festgeschrieben: 0:3 Punkte, 0:18 Spiele, 0:36 Legs. Alle
Slots enden auf `CANCELLED`, die Begegnung auf `COMPLETED` mit
`result_type = 'FORFEIT'`. Rechnerisch ergäben achtzehn Einzelwalkovers
dieselbe Wertung; als Vorgang taugen sie nicht, weil die nicht angetretene
Seite überhaupt keine Meldung hat, kein Board belegt wird, kein
Entscheidungsdoppel ansteht und statt einer auditierten Entscheidung achtzehn
entstünden. Bussen, Sperren und die Sonderwertung der gemeldeten Personen nach
2.5.7 sind Verbandsvorgänge und nicht Teil dieser Spec.

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
genau eine Person hat. Das deckt sich mit dem Reglement: die Einzelrangliste
nach Anhang 1 wertet nur die sechzehn Einzel. Die laufende Saison bestätigt
es — ein Team mit zwei Begegnungen verteilt in der Einzelrangliste genau
zweiunddreissig Spiele, also 2 × 16, und keine Doppel. Andernfalls verschöben
sich rückwirkend alle Averages, und ein 701-Doppel wäre mit einem 501-Einzel
vermengt. Die Auswertung der
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
- Meldeformular je Seite: die vier Aufstellungspositionen plus Ersatz, mit
  laufender Validierung gegen die Wettbewerbsregeln; Fehler stehen als Text am
  betroffenen Feld. Die gegnerische Meldung bleibt verdeckt, bis beide Seiten
  gemeldet haben.
- Doppelformular: kurz vor Slot 9 aufrufbar, wählt aus den gemeldeten Personen
  beider Doppel je Seite zwei aus.
- Begegnungsleitung: achtzehn Slots mit Status und der abgeleiteten Paarung,
  Board zuweisen, Zwischenstand in Punkten, Spielen und Legs, Walkover,
  Auswechslung, Verbindungsstatus.

### Scoring

Das bestehende Scoreboard zeigt im Doppel beide Namen je Seite und hebt die
aktuell werfende Person hervor. Die Bedienung bleibt identisch; das Gerät
sendet zusätzlich die werfende Person mit.

### Öffentliche Ansicht

`/public/encounters/:publicId` zeigt Teams, Zwischenstand in Punkten, Spielen
und Legs, die achtzehn Slots samt Entscheidungsdoppel mit Ergebnis und die
aktuell laufenden Boards, ohne manuelles Neuladen.

### Accessibility

Semantisches HTML, Tastaturbedienung der Leitungsansichten, sichtbarer Fokus,
ausreichender Kontrast, keine Information ausschliesslich über Farbe. Der
Status eines Slots wird als Text und nicht nur farblich ausgewiesen.

## Fehlerfälle

| Situation | Antwort | Code |
| --- | --- | --- |
| Meldung unvollständig | 422 | `NOMINATION_INCOMPLETE` |
| Person zweimal gemeldet | 422 | `NOMINATION_DUPLICATE_PLAYER` |
| Person nicht spielberechtigt | 422 | `NOMINATION_PLAYER_NOT_IN_SQUAD` |
| Doppelpaarung unvollständig | 422 | `DOUBLES_PAIRING_INCOMPLETE` |
| Person in beiden Doppeln | 422 | `DOUBLES_PLAYER_LIMIT_EXCEEDED` |
| Auswechselkontingent erschöpft | 422 | `SUBSTITUTION_LIMIT_EXCEEDED` |
| Ausgewechselte Person im Einzel | 422 | `SUBSTITUTION_PLAYER_BLOCKED` |
| Auswechslung bei laufender Paarung | 409 | `SUBSTITUTION_SLOT_RUNNING` |
| Vorlage lückenhaft oder widersprüchlich | 422 | `TEMPLATE_INVALID` |
| Rundenturnier unvollständig | 422 | `TEMPLATE_ROUND_ROBIN_INCOMPLETE` |
| Version passt nicht | 409 mit aktuellem Zustand | `ENCOUNTER_VERSION_CONFLICT` |
| Board belegt | 409 | `BOARD_UNAVAILABLE` |
| Person spielt bereits | 409 | `PLAYER_BUSY` |
| Begegnung beendet oder abgebrochen | 409 | `ENCOUNTER_CLOSED` |
| Falsche werfende Person | 422 | `INVALID_THROWER` |
| Ausbullen vor der Rundengrenze | 409 | `ROUND_LIMIT_NOT_REACHED` |
| Fremde Organisation | 404 | `NOT_FOUND` |

Eine wiederholte `commandId` liefert dieselbe Antwort und erzeugt keinen
zweiten Effekt.

## Tests und Abnahmekriterien

### Engine-Tests, ohne Infrastruktur

- `league-engine`: Vorlagenvalidierung (Lücke in der Sequenz, zwei
  Entscheidungsslots, ungerade Distanz, unvollständiges Rundenturnier), jede
  Fehlerklasse der Melde-, Doppel- und Auswechselprüfung, Wertung 18:0 bis
  9:9, Zusatzpunkt nach Entscheidungsdoppel, Wertung mit drei Personen,
  Nichtantritt mit 0:3 / 0:18 / 0:36, abgeleitete Slotbesetzung nach
  Auswechslung.
- `scoring-engine`: Doppelrotation über mehrere Legs, falsche werfende Person,
  Checkout im Doppel, Undo im Doppel, Wiederholung derselben `commandId`,
  701 mit Double In und Double Out, Master Out, Single Out, Bust und Rest 1 je
  Ausgangsregel, Rundenbegrenzung erreicht und Leg durch Ausbullen entschieden,
  Ausbullen vor Erreichen der Grenze abgelehnt.
- `scheduling-engine`: Seite mit zwei Personen, Person in zwei Slots
  gleichzeitig, fehlende Meldung, kein freies Board.

### Integrationstests mit Testcontainers

- Vollständige Begegnung über achtzehn Slots bis zum Ergebnis, inklusive der
  erst am Abend gemeldeten Doppelpaarungen.
- Begegnung, die 9:9 endet, mit Entscheidungsdoppel zu 2:1 Punkten und 10:9
  Spielen.
- Versionskonflikt bei gleichzeitiger Änderung der Meldung.
- Doppelte `commandId` erzeugt keinen zweiten Effekt.
- Walkover eines Slots und Nichtantritt einer ganzen Mannschaft.
- Auswechslung zwischen zwei Runden; die Besetzung bereits gespielter Slots
  bleibt unverändert.
- Board wird nicht doppelt vergeben, wenn ein Turnier es bereits nutzt.
- Zugriff mit fremder `organizationId` liefert 404 für Teams, Wettbewerbe,
  Begegnungen und Slots.
- Migration: bestehende Einzelmatches, Legs und Visits bleiben nach dem
  Backfill inhaltlich identisch.

### Browser-Tests

Begegnung ansetzen, beide Meldungen erfassen, zwei Slots parallel auf zwei
Boards spielen, Doppelpaarungen vor Slot 9 melden, ein Doppel vollständig
ausspielen, Ergebnis der Begegnung prüfen.

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
- Ligatabelle mit den Kriterien nach Anhang A1.5 und die Einzelrangliste nach
  A1.7 bis A1.9; die dafür nötigen Rohdaten — Punkte, Spiele, Legs je
  Begegnung — entstehen aber bereits hier
- Auf- und Abstieg, Ligaklassenstatus einer Person, Lizenzen, Transfers als
  Vorgang
- Saisonkontingente für Aushilfen nach 1.2.3 und 1.2.4
- Spielverschiebung als Vorgang mit Fristen nach 1.4.2
- Bussen, Sperren, Protestverfahren, Schiedsrichteranforderung
- Liga-Finale, Mannschaftsmeisterschaft, Teamcup
- Self-Service für Team-Captains
- Auswertung der Doppelstatistik
- nachträgliche Ergebniskorrektur einer abgeschlossenen Begegnung
- Turnierserien
- Teams in Turnieren; die Turnierseite bleibt in dieser Spec einzelspielerbasiert

## Aus dem Reglement übernommene Regeln

Diese Punkte waren im ersten Entwurf offene Annahmen. Sie sind durch das
Reglement entschieden und werden nicht mehr zur Bestätigung gestellt. Als
Wettbewerbseinstellung bleiben sie ohne Codeänderung anpassbar, damit andere
Verbände denselben Träger nutzen können.

1. **Distanz je Spiel:** jedes Spiel geht auf zwei Gewinnsätze, in der Sprache
   der Plattform Best of 3 Legs (A1.2).
2. **Aufstellung:** vier Positionen je Seite, sechzehn Einzel als
   Rundenturnier, also vier Einzel je Person; höchstens ein reguläres Doppel
   je Person, im Entscheidungsdoppel keine Grenze (2.2.1).
3. **Unentschieden:** bei 9:9 Spielen wird zwingend ein Entscheidungsdoppel
   ausgetragen; es zählt für Spiele und Legs mit (2.2.2, A1.4).
4. **Punkte:** 3:0 für den Sieg, bei 9:9 je 1 Punkt und 1 Zusatzpunkt für den
   Sieger des Entscheidungsdoppels, also 2:1. Minuspunkte sind stets die
   Pluspunkte der Gegenseite (2.2.2, A1.4, A1.5).
5. **Walkover:** der Sieger erhält die zum Sieg nötige Legzahl, der Verlierer
   null, entsprechend 0:1 Spielen und 0:2 Sätzen (2.2.6, A4.4).
6. **Nichtantritt:** 0:3 Punkte, 0:18 Spiele, 0:36 Legs für die nicht
   angetretene Mannschaft (2.1.1, 2.5.1).
7. **Ausnahme mit drei Personen:** zulässig; die Einzel der fehlenden Position
   und eines der beiden Doppel gelten als verloren (2.2.5).
8. **Auswechslungen:** höchstens vier je Begegnung, nie während einer
   laufenden Paarung, ausgewechselte Personen bleiben für die Doppel
   spielberechtigt (2.2.4, 2.2.10).
9. **Doppelpaarungen** werden erst unmittelbar vor der Begegnung gemeldet und
   dürfen jede für den Abend gemeldete Person einsetzen, auch eine, die kein
   Einzel bestreitet (2.1.1, 2.2.1).
10. **Legbeginn:** Leg 1 die Heimseite, Leg 2 die Gastseite, Leg 3 nach
    Ausbullen; das Entscheidungsdoppel immer nach Ausbullen (2.2.9).

## Offene Punkte für die Turnierleitung

1. **Spielvariante:** die Vorlage ist auf 501 DI/DO für die Einzel und 701
   DI/DO für die Doppel eingestellt, also Nationalliga (1.1). Für Klasse A, B
   oder C ist `out_rule` auf `DOUBLE`, `MASTER` beziehungsweise `SINGLE` zu
   setzen und `in_rule` auf `STRAIGHT`. Welche Klasse gilt, ist zu bestätigen.
2. **Rundenbegrenzung:** Anhang 2 beschreibt eine Begrenzung der Automaten
   (501 zwanzig Runden) mit anschliessendem Ausbullen. Ob sie in der
   tatsächlich gespielten Gruppe greift — die verlinkte Saison ist eine
   Steeldart-Gruppe ohne Automatenlimit — ist zu bestätigen. `max_rounds`
   bleibt sonst leer.
3. **Kaderstichtag:** die Meldung wird gegen den Kader zum
   Ansetzungszeitpunkt der Begegnung geprüft, nicht gegen den heutigen. Das
   Reglement legt keinen Stichtag fest; 1.2.2 knüpft die Spielberechtigung an
   die laufende Saison der Mannschaft.
4. **Aushilfen:** eine Person aus einer anderen Mannschaft desselben Lokals
   wird als `GUEST` gemeldet und erfasst. Die Kontingente nach 1.2.3, 1.2.4
   und 1.2.9 werden in dieser Stufe **nicht** geprüft; die Turnierleitung
   verantwortet sie weiterhin selbst.
5. **Spieltag und Datum:** die verlinkte Saison spielt eine Runde über mehrere
   Kalendertage, bei neun Teams mit einem spielfreien Team je Runde. Diese
   Spec trennt deshalb `matchday` von `scheduled_at`. Die Erzeugung des
   Spielplans folgt in der Saison-Spec.
