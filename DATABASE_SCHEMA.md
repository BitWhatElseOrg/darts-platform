# DATABASE_SCHEMA.md

# Dart Tournament Platform – Datenbankschema

**Datenbank:** PostgreSQL  
**ORM:** Drizzle ORM  
**ID-Strategie:** UUID / UUIDv7  
**Multi-Tenancy:** `organization_id`  
**Zeitstempel:** UTC

Dieses Dokument beschreibt die logische Zielstruktur und markiert den bis
Phase 6 implementierten Ausschnitt. Verbindliche technische Quelle sind
`packages/database/src/schema.ts` und die versionierten Migrationen unter
`packages/database/drizzle`.

## Implementierter Stand Phase 0–6

Die Migrationen `0000` bis `0009` enthalten heute Identity und Tenancy,
Scoring, den Tournament-MVP, erweiterte Matchregeln, Offline-/Controller-Daten
und Statistikaggregate. Dazu gehören insbesondere:

- `organization_invitations`: E-Mail-gebundene, befristete Voraussetzung für
  Kontoerstellung und spätere Organisationsmitgliedschaft
- `boards`, `matches`, `match_participants`, `legs`, `visits` und
  `score_commands`: versioniertes, idempotentes X01-Scoring
- `tournaments`: Format, Spielregeln, Status und optimistische Version
- `tournament_participants` und `tournament_boards`: Setzung und Board-Reihenfolge
- `tournament_stages`, `tournament_groups` und
  `tournament_group_participants`: persistierte Struktur und Qualifikation
- `tournament_matches`: Matchgraph, Teilnehmer-/Siegerreferenzen, Board- und
  Scoring-Match-Verknüpfung
- `tournament_commands`: Idempotenzprotokoll für Zuweisung, Board-Freigabe und
  Result Correction
- `matches.double_out`: Spielregel des erzeugten Scoring-Aggregats
- `outbox_events`: getrennte Publikationszeitpunkte für Realtime und Statistik
- persistente Spieleraggregate und Rankingverlauf für Phase 6

Unique-, Check- und Foreign-Key-Constraints sichern unter anderem doppelte
Teilnehmer/Boards, Setzungen, Statuswerte, aktive Board-Belegung und
Match-Abhängigkeiten. Alle Repository-Zugriffe führen `organization_id`
explizit mit.

---

# 1. Grundregeln

- Primärschlüssel: UUID
- `created_at` / `updated_at` auf zentralen Entitäten
- Foreign Keys verwenden
- wichtige Unique Constraints auf DB-Ebene
- `organization_id` bei Tenant-Daten
- Soft Delete nur dort, wo fachlich erforderlich
- historische Match-/Score-Daten nicht unkontrolliert löschen
- Indizes auf Foreign Keys und häufige Filter
- Audit separat speichern

---

# 2. Identity & Organizations

## users

```text
id uuid PK
email varchar UNIQUE NOT NULL
display_name varchar
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Authentifizierungsdetails werden soweit möglich über Better Auth verwaltet.

---

## organizations

```text
id uuid PK
name varchar NOT NULL
slug varchar UNIQUE NOT NULL
timezone varchar NOT NULL
locale varchar NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

---

## memberships

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
user_id uuid FK users NOT NULL
role varchar NOT NULL
status varchar NOT NULL
created_at timestamptz NOT NULL

UNIQUE (organization_id, user_id)
```

Index:

```text
organization_id
user_id
```

---

## organization_invitations

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
email varchar NOT NULL
role varchar NOT NULL
status varchar NOT NULL DEFAULT 'PENDING'
claim_token_hash varchar(64) NULL
invited_by_user_id uuid FK users NOT NULL
expires_at timestamptz NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Zulässige Rollen:

```text
ADMIN
TOURNAMENT_DIRECTOR
SCORER
MEMBER
VIEWER
OWNER (nur interner Production-Bootstrap)
```

Zulässige Statuswerte:

```text
PENDING
ACCEPTED
CANCELLED
EXPIRED
```

Ein Konto kann nur erstellt werden, wenn für seine normalisierte E-Mail-Adresse
ein Datensatz mit `status = PENDING`, `claim_token_hash IS NOT NULL` und
`expires_at > now()` existiert und der Einladungscode dessen Hash ergibt. Die
eigentliche Mitgliedschaft entsteht erst beim atomischen, einmaligen Annehmen
der Einladung mit demselben Code.
Ein Index auf `(email, status)` unterstützt diese Prüfung.

Migration 0013 markiert vorhandene tokenlose `PENDING`-Einladungen als
`EXPIRED`; neue Einladungen müssen einen gültigen Claim-Hash besitzen.

---

# 3. Players

## players

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
public_id uuid UNIQUE NOT NULL

first_name varchar
last_name varchar
display_name varchar NOT NULL
nickname varchar
email varchar
external_reference varchar
status varchar NOT NULL

created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Indizes:

```text
organization_id
(organization_id, display_name)
```

---

## teams

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
name varchar NOT NULL
short_name varchar
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

---

## team_players

```text
team_id uuid FK teams NOT NULL
player_id uuid FK players NOT NULL
valid_from timestamptz
valid_to timestamptz

PRIMARY KEY (team_id, player_id)
```

Kader und Spielberechtigung folgen dem
[VFC-Liga-Reglement](./LIGA-REGLEMENT.md); dort steht auch, welche Rolle eine
Mannschaft je Begegnung genau einmal besetzt.

---

# 4. Competitions

## competitions

Abstraktion für Turnier, Liga oder Serie.

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
type varchar NOT NULL
name varchar NOT NULL
slug varchar NOT NULL
status varchar NOT NULL
starts_at timestamptz
ends_at timestamptz
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

UNIQUE (organization_id, slug)
```

`type`:

```text
TOURNAMENT
LEAGUE
SERIES
```

---

# 5. Tournaments

## tournaments

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
competition_id uuid FK competitions
name varchar NOT NULL
slug varchar NOT NULL
status varchar NOT NULL
game_type varchar NOT NULL
starting_score integer
in_rule varchar NOT NULL
out_rule varchar NOT NULL
default_best_of_legs integer
default_best_of_sets integer
starts_at timestamptz
finished_at timestamptz
settings jsonb NOT NULL DEFAULT '{}'
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

UNIQUE (organization_id, slug)
```

Status:

```text
DRAFT
REGISTRATION
READY
RUNNING
PAUSED
FINISHED
CANCELLED
```

---

## tournament_participants

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
tournament_id uuid FK tournaments NOT NULL
player_id uuid FK players
team_id uuid FK teams
seed integer
status varchar NOT NULL
registered_at timestamptz NOT NULL
metadata jsonb NOT NULL DEFAULT '{}'
```

Constraint:

Mindestens `player_id` oder `team_id` gesetzt.

---

# 6. Tournament Stages

## tournament_stages

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
tournament_id uuid FK tournaments NOT NULL
sequence integer NOT NULL
name varchar NOT NULL
type varchar NOT NULL
status varchar NOT NULL
settings jsonb NOT NULL DEFAULT '{}'
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL

UNIQUE (tournament_id, sequence)
```

Typen:

```text
ROUND_ROBIN
GROUP
SINGLE_ELIMINATION
DOUBLE_ELIMINATION
SWISS
```

---

## groups

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
stage_id uuid FK tournament_stages NOT NULL
name varchar NOT NULL
sequence integer NOT NULL

UNIQUE (stage_id, sequence)
```

---

## group_participants

```text
group_id uuid FK groups NOT NULL
tournament_participant_id uuid FK tournament_participants NOT NULL
position integer
seed integer

PRIMARY KEY (group_id, tournament_participant_id)
```

---

# 7. Boards

## boards

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
name varchar NOT NULL
number integer
public_code varchar UNIQUE NOT NULL
status varchar NOT NULL
location varchar
settings jsonb NOT NULL DEFAULT '{}'
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Status:

```text
AVAILABLE
IN_USE
DISABLED
MAINTENANCE
```

---

## tournament_boards

```text
tournament_id uuid FK tournaments NOT NULL
board_id uuid FK boards NOT NULL
enabled boolean NOT NULL DEFAULT true
priority integer NOT NULL DEFAULT 0

PRIMARY KEY (tournament_id, board_id)
```

---

# 8. Matches

## matches

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
tournament_id uuid FK tournaments
stage_id uuid FK tournament_stages
group_id uuid FK groups
round_number integer
match_number integer
status varchar NOT NULL

game_type varchar NOT NULL
starting_score integer
in_rule varchar NOT NULL
out_rule varchar NOT NULL
best_of_legs integer
best_of_sets integer

board_id uuid FK boards
scheduled_at timestamptz
started_at timestamptz
finished_at timestamptz

winner_participant_id uuid
version integer NOT NULL DEFAULT 0

metadata jsonb NOT NULL DEFAULT '{}'

created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Status:

```text
PENDING
BLOCKED
READY
CALLED
RUNNING
PAUSED
FINISHED
CANCELLED
```

Indizes:

```text
organization_id
tournament_id
stage_id
board_id
(tournament_id, status)
unique (board_id) where status = 'IN_PROGRESS'   -- matches_board_in_progress_unique
```

`matches_board_in_progress_unique` (Migration `0022_board_in_progress_unique`)
ist die strukturelle Klammer gegen die Doppelbelegung einer physischen Scheibe.
Turnier (`tournament_matches`) und Liga (`encounter_slots`) tragen je einen
eigenen partiellen Unique auf `board_id`, doch kein Constraint greift über zwei
Tabellen. `matches` ist die gemeinsame Wurzel beider Wege und der freien
Paarung; der partielle Unique lässt dort nur ein laufendes Match je Scheibe zu.
Ein Verstoss wird in den Zuweisungs-, Erstellungs- und Undo-Pfaden als
`BOARD_NOT_AVAILABLE` (HTTP 409) beantwortet, nicht als Postgres-Meldung.

Vor dem Ausrollen den Bestand prüfen — die Migration schlägt fehl, wenn heute
schon zwei laufende Matches auf einer Scheibe stehen:

```sql
select board_id, count(*) from matches
where status = 'IN_PROGRESS' and board_id is not null
group by board_id having count(*) > 1;
```

Sperrdauer: `CREATE UNIQUE INDEX` ohne `CONCURRENTLY` nimmt für die Dauer des
Aufbaus ein `SHARE`-Lock auf `matches` — der heissesten Tabelle — und blockiert
solange jedes Schreiben darauf. Bei der heutigen Grösse sind das
Sekundenbruchteile; das Deployment gehört trotzdem ausserhalb des
Spielbetriebs. Wächst `matches` deutlich, ist die Migration auf
`CREATE UNIQUE INDEX CONCURRENTLY` umzustellen (dann ausserhalb einer
Transaktion, mit anschliessender Prüfung auf `INVALID`).

---

## match_participants

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
match_id uuid FK matches NOT NULL
slot integer NOT NULL
tournament_participant_id uuid FK tournament_participants
source_match_id uuid FK matches
source_rule varchar
is_winner boolean
final_position integer

UNIQUE (match_id, slot)
```

`source_rule` Beispiele:

```text
WINNER
LOSER
GROUP_1ST
GROUP_2ND
```

---

# 9. Sets & Legs

## sets

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
match_id uuid FK matches NOT NULL
sequence integer NOT NULL
winner_participant_id uuid
started_at timestamptz
finished_at timestamptz

UNIQUE (match_id, sequence)
```

---

## legs

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
match_id uuid FK matches NOT NULL
set_id uuid FK sets
sequence integer NOT NULL
status varchar NOT NULL
starting_participant_id uuid
winner_participant_id uuid
version integer NOT NULL DEFAULT 0
started_at timestamptz
finished_at timestamptz

UNIQUE (match_id, sequence)
```

Status:

```text
PENDING
RUNNING
FINISHED
REVERTED
```

---

# 10. Visits

## visits

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
match_id uuid FK matches NOT NULL
leg_id uuid FK legs NOT NULL
participant_id uuid NOT NULL
player_id uuid FK players

sequence integer NOT NULL
command_id uuid NOT NULL

score integer NOT NULL
dart_count integer NOT NULL
remaining_before integer NOT NULL
remaining_after integer NOT NULL

bust boolean NOT NULL DEFAULT false
checkout boolean NOT NULL DEFAULT false
reverted boolean NOT NULL DEFAULT false

created_by_user_id uuid FK users
created_at timestamptz NOT NULL

UNIQUE (leg_id, command_id)
UNIQUE (leg_id, sequence)
```

Checks:

```text
score >= 0
dart_count BETWEEN 1 AND 3
remaining_before >= 0
remaining_after >= 0
```

### Visit-Kommando: `checkoutMissed`

Das Score-Kommando (`submitVisitSchema` in
[`packages/schemas/src/match.ts`](packages/schemas/src/match.ts)) trägt neben
`points`, `dartsThrown`, `checkoutDouble` und `checkoutAttempts` das optionale
Feld `checkoutMissed`. Es meldet ausdrücklich „kein gültiger Finish-Wurf sass"
— ohne dieses Feld rät die Engine unter der Ausgangsregel `MASTER` anhand
einer Heuristik (`finishesOnMasterSegment` in
[`packages/scoring-engine/src/x01.ts`](packages/scoring-engine/src/x01.ts)).
`checkoutMissed` ist optional und abwärtskompatibel: gespeicherte Kommandos
ohne dieses Feld werden unverändert gewertet wie bisher. Es schliesst sich
mit `checkoutDouble` und mit explizit übergebenen Einzelwürfen (`darts`)
gegenseitig aus.

### Visit-Kommando: `checkoutSegment`

Dasselbe Kommando trägt ausserdem das optionale Feld `checkoutSegment`
(`{ segment, multiplier }` wie ein einzelner Wurf). Es benennt das
abschliessende Segment einer Aufnahme **ohne** Einzelwürfe und verallgemeinert
damit `checkoutDouble`, das über `checkoutValue` nur D1–D20 und Bull kodieren
kann: ein Triple-Finish unter der Ausgangsregel `MASTER` (Reglement 1.1,
Klasse B) liess sich vorher gar nicht belegen.

Gewertet wird es wie der letzte Wurf der Aufnahme — `closesLegWithDarts`
entscheidet über den Legabschluss —, zusätzlich muss sein Wert in der
Rundensumme enthalten und der Rest mit den übrigen Darts erreichbar sein. Ein
gemeldetes Doppel füllt weiterhin `visits.checkout_double`; ein Triple lässt
die Spalte auf `NULL`, sie kann kein Triple tragen.

`checkoutSegment` ist optional und abwärtskompatibel: gespeicherte Kommandos
ohne dieses Feld werden unverändert gewertet. Es schliesst sich mit `darts`,
`checkoutMissed` und `checkoutDouble` gegenseitig aus — zwei Belege zur
selben Aufnahme wären nicht entscheidbar.

Die Scoringfläche sendet es unter `MASTER` für Doppel wie Triple, unter
`DOUBLE` bleibt es beim bestehenden `checkoutDouble`
(`checkoutCommandFields` in
[`apps/web/src/lib/round-entry.ts`](apps/web/src/lib/round-entry.ts)).

### Visit-Kommando: `checkoutAttempts` — zwei Einheiten in einer Spalte

`checkoutAttempts` trägt seit der Einführung der Einzelwürfe **je nach
Aufnahme eine andere Einheit**, und der Bruch ist bewusst in Kauf genommen:

- **Aufnahme ohne Einzelwürfe** (Runden-Modus, alle Aufnahmen vor Migration
  `0021_steady_mauler.sql`): eine Zahl von **Aufnahmen** — 0 oder 1. Die
  Fläche meldet „auf ein Finish geworfen", nicht wie oft.
- **Aufnahme mit Einzelwürfen** (Wurf-für-Wurf-Modus): eine Zahl von
  **Darts** — 0 bis 3. Die Engine leitet sie aus den Würfen ab
  (`checkoutAttemptsFromDarts` in
  [`packages/scoring-engine/src/x01.ts`](packages/scoring-engine/src/x01.ts))
  und zählt jeden Wurf, der aus einer Finish-Position abgegeben wurde.

Die dart-genaue Zählung ist die übliche Definition der Checkout-Quote
(erfolgreiche Checkouts geteilt durch Darts auf ein Finish) und bleibt
deshalb. Eine Umrechnung der Historie scheidet aus: für Aufnahmen ohne
Einzelwürfe existieren die Wurfdaten nicht und lassen sich auch nicht
rekonstruieren.

**Folge für die Auswertung:** `checkout_percentage` (siehe
`player_statistics`) und `CareerStatistics.checkoutAttempts` in
[`packages/statistics`](packages/statistics/src/statistics.ts) summieren über
den Umstellungszeitpunkt hinweg beide Einheiten. Ein Karrierewert, der
Aufnahmen von vor und nach der Umstellung enthält, ist deshalb keine saubere
Quote. Der Zähler (erfolgreiche Checkout-Aufnahmen) ist davon nicht
betroffen. Wer die Quote je Einheit sauber ausweisen will, muss nach dem
Vorhandensein von `visit_darts`-Zeilen trennen.

---

## visit_darts

Die bis zu drei Einzelwürfe einer Aufnahme, dart-genau gespeichert (Migration
`0021_steady_mauler.sql`). Eine zurückgenommene Aufnahme behält ihre Würfe —
`visits.reverted_at` bleibt die einzige Wahrheit über den Widerruf.

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
visit_id uuid FK visits NOT NULL
dart_index integer NOT NULL
segment integer NOT NULL
multiplier integer NOT NULL
value integer NOT NULL
created_at timestamptz NOT NULL

UNIQUE (visit_id, dart_index)
```

Checks:

```text
visit_darts_index_check      dart_index BETWEEN 1 AND 3
visit_darts_segment_check    segment BETWEEN 0 AND 20 OR segment = 25
visit_darts_multiplier_check multiplier BETWEEN 1 AND 3
visit_darts_miss_check       segment <> 0 OR multiplier = 1
visit_darts_bull_check       segment <> 25 OR multiplier <= 2
visit_darts_value_check      value = segment * multiplier
```

Indizes: `visit_darts_organization_visit_idx` auf `(organization_id, visit_id)`
für tenant-sichere Auswertungen je Aufnahme.

---

# 11. Board Assignments

## board_assignments

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
board_id uuid FK boards NOT NULL
match_id uuid FK matches NOT NULL
assigned_at timestamptz NOT NULL
released_at timestamptz
assigned_by_user_id uuid FK users
```

---

# 12. Rankings

## rankings

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
tournament_id uuid FK tournaments
stage_id uuid FK tournament_stages
type varchar NOT NULL
version integer NOT NULL DEFAULT 1
calculated_at timestamptz NOT NULL
```

---

## ranking_entries

```text
id uuid PK
ranking_id uuid FK rankings NOT NULL
participant_id uuid NOT NULL
position integer NOT NULL
played integer NOT NULL DEFAULT 0
wins integer NOT NULL DEFAULT 0
losses integer NOT NULL DEFAULT 0
draws integer NOT NULL DEFAULT 0
points numeric NOT NULL DEFAULT 0
legs_for integer NOT NULL DEFAULT 0
legs_against integer NOT NULL DEFAULT 0
leg_difference integer NOT NULL DEFAULT 0
average numeric
metadata jsonb NOT NULL DEFAULT '{}'
```

---

# 13. Statistics

## player_statistics

Aggregierte Werte.

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
player_id uuid FK players NOT NULL
scope_type varchar NOT NULL
scope_id uuid

matches integer NOT NULL DEFAULT 0
wins integer NOT NULL DEFAULT 0
losses integer NOT NULL DEFAULT 0

average numeric
first_9_average numeric
checkout_percentage numeric  -- Nenner mischt Einheiten, siehe unten

count_100_plus integer NOT NULL DEFAULT 0
count_120_plus integer NOT NULL DEFAULT 0
count_140_plus integer NOT NULL DEFAULT 0
count_160_plus integer NOT NULL DEFAULT 0
count_180 integer NOT NULL DEFAULT 0

highest_score integer
highest_checkout integer
best_leg_darts integer

updated_at timestamptz NOT NULL
```

`checkout_percentage` teilt erfolgreiche Checkout-Aufnahmen durch die Summe
der `checkoutAttempts`. Deren Einheit hängt an der einzelnen Aufnahme —
Aufnahmen ohne Einzelwürfe tragen eine Aufnahmenzahl, Aufnahmen mit Würfen
eine Wurfzahl (siehe „Visit-Kommando: `checkoutAttempts` — zwei Einheiten in
einer Spalte" in Abschnitt 10). Über den Umstellungszeitpunkt hinweg mischt
der Nenner deshalb beide Einheiten.

---

# 14. Integrations

## integrations

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
type varchar NOT NULL
name varchar NOT NULL
status varchar NOT NULL
config jsonb NOT NULL DEFAULT '{}'
secret_reference varchar
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Typen:

```text
AUTODARTS
SCOLIA
WEBHOOK
```

Secrets nicht im `config` JSON unverschlüsselt speichern.

---

## external_board_mappings

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
integration_id uuid FK integrations NOT NULL
board_id uuid FK boards NOT NULL
external_board_id varchar NOT NULL

UNIQUE (integration_id, external_board_id)
```

---

# 15. Webhooks

## webhooks

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
url varchar NOT NULL
secret_reference varchar NOT NULL
enabled boolean NOT NULL DEFAULT true
events jsonb NOT NULL
created_at timestamptz NOT NULL
```

---

## webhook_deliveries

```text
id uuid PK
webhook_id uuid FK webhooks NOT NULL
event_id uuid NOT NULL
attempt integer NOT NULL
status varchar NOT NULL
http_status integer
requested_at timestamptz NOT NULL
completed_at timestamptz
response_excerpt varchar
```

---

# 16. Notifications

## notifications

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
user_id uuid FK users
player_id uuid FK players
type varchar NOT NULL
title varchar NOT NULL
body varchar NOT NULL
status varchar NOT NULL
created_at timestamptz NOT NULL
read_at timestamptz
```

---

# 17. Audit

## audit_events

```text
id uuid PK
organization_id uuid FK organizations
actor_user_id uuid FK users
action varchar NOT NULL
entity_type varchar NOT NULL
entity_id uuid
old_value jsonb
new_value jsonb
ip inet
user_agent varchar
correlation_id uuid
created_at timestamptz NOT NULL
```

Index:

```text
(organization_id, created_at)
(entity_type, entity_id)
correlation_id
```

---

# 18. Transactional Outbox

## outbox_events

```text
id uuid PK
organization_id uuid
event_type varchar NOT NULL
aggregate_type varchar NOT NULL
aggregate_id uuid NOT NULL
payload jsonb NOT NULL
created_at timestamptz NOT NULL
published_at timestamptz
attempts integer NOT NULL DEFAULT 0
last_error varchar
```

Index:

```text
published_at
created_at
```

---

# 19. Idempotency

Optional zentrale Tabelle zusätzlich zu `visits.command_id`.

## idempotency_keys

```text
id uuid PK
organization_id uuid FK organizations NOT NULL
key varchar NOT NULL
scope varchar NOT NULL
request_hash varchar
response_status integer
response_body jsonb
created_at timestamptz NOT NULL
expires_at timestamptz

UNIQUE (organization_id, scope, key)
```

---

# 20. Spätere Liga-Tabellen

Die Team-Begegnung selbst ist bereits umgesetzt (`competitions` vom Typ
`LEAGUE`, Begegnungsvorlage, `encounters` und `encounter_slots`) und folgt dem
[VFC-Liga-Reglement](./LIGA-REGLEMENT.md). Offen bleiben die Saison- und
Tabellenstrukturen, ab Phase 9:

```text
seasons
leagues
divisions
league_teams
fixtures
team_rosters
league_tables
transfers
```

---

# 21. Spätere Turnierserien

Ab Phase 10:

```text
series
series_events
series_participants
series_points
series_rankings
```

---

# 22. Wichtige Indizes

Mindestens prüfen:

```text
organization_id
tournament_id
stage_id
match_id
leg_id
player_id
board_id

(tournament_id, status)
(organization_id, status)
(organization_id, slug)
(leg_id, sequence)
(match_id, status)
```

---

# 23. DB-Sicherheitsregeln

- DB-Zugang nur Backend/Worker.
- PostgreSQL nicht unnötig öffentlich exponieren.
- Redis nicht öffentlich exponieren.
- Migrationen ausschliesslich kontrolliert.
- Backups aktivieren.
- Restore regelmäßig testen.
- Production und Staging trennen.
- Secrets über Railway Variables / Secret Management.
- Bei späterem SaaS Row Level Security als zusätzliche Schutzschicht evaluieren.

---

# 24. Implementierungsreihenfolge Schema

## Phase 0

```text
users
organizations
memberships
organization_invitations
players
```

## Phase 1

```text
boards
matches
match_participants
sets
legs
visits
audit_events
```

## Phase 2

```text
competitions
tournaments
tournament_participants
tournament_stages
groups
group_participants
tournament_boards
board_assignments
rankings
ranking_entries
```

## Phasen 3–6

```text
outbox_events
player_statistic_aggregates
board_controller_leases
```

## Phase 7+

```text
integrations
webhooks
notifications
```

Weitere Tabellen erst bei Bedarf entsprechend ROADMAP.
