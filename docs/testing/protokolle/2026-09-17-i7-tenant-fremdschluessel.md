# Protokoll: Befundliste zu zusammengesetzten Tenant-Fremdschlüsseln (I-7)

## Zweck

AGENTS.md §14 verlangt, dass jede tenant-bezogene Query nach
`organization_id` eingeschränkt wird; das schützt aber nur, solange die
Anwendung diese Einschränkung auch tatsächlich setzt. Audit-Punkt I-7 (Spec
C4) fragt, ob Fremdschlüssel zwischen zwei Tabellen, die beide eine
`organization_id`-Spalte tragen, diese Spalte ebenfalls mitprüfen
(zusammengesetzter Fremdschlüssel auf `(id, organization_id)`), sodass die
Datenbank selbst verhindert, dass eine Zeile von Organisation A auf eine
Zeile von Organisation B verweist. Dieses Protokoll listet ausschliesslich
die betroffenen Beziehungen aus dem aktuellen Schema; es ändert nichts und
ist Eingabe für die spätere I-7-Spec.

## Methode

Gegen die lokale Entwicklungsdatenbank (`DATABASE_URL` aus dem
Worktree-`.env`, `postgresql://darts:***@localhost:5433/darts`) mit `psql`
ausgeführt:

```sql
SELECT tc.table_name, kcu.column_name, ccu.table_name AS referenced_table
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN (SELECT table_name FROM information_schema.columns WHERE column_name = 'organization_id')
  AND ccu.table_name IN (SELECT table_name FROM information_schema.columns WHERE column_name = 'organization_id')
  AND kcu.column_name <> 'organization_id'
ORDER BY 1, 2;
```

Die Abfrage findet jede Fremdschlüsselspalte (ausser `organization_id`
selbst), deren Tabelle **und** deren referenzierte Tabelle beide eine
`organization_id`-Spalte besitzen. Solche Beziehungen sind heute nur über
die Anwendungslogik tenant-konsistent, nicht über einen DB-Constraint.

Befund: 53 Zeilen (siehe Ergebnis unten).

## Ergebnis

| Tabelle | Spalte | Referenzierte Tabelle | Bemerkung |
|---|---|---|---|
| board_controller_leases | match_id | matches | kritisch |
| competition_slots | competition_id | competitions | Lookup |
| encounter_commands | encounter_id | encounters | kritisch |
| encounter_lineup_entries | encounter_id | encounters | kritisch |
| encounter_lineup_entries | player_id | players | kritisch |
| encounter_lineup_entries | slot_id | encounter_slots | kritisch |
| encounter_nominations | encounter_id | encounters | kritisch |
| encounter_nominations | player_id | players | kritisch |
| encounter_slots | board_id | boards | Lookup |
| encounter_slots | encounter_id | encounters | kritisch |
| encounter_slots | match_id | matches | kritisch |
| encounter_substitutions | encounter_id | encounters | kritisch |
| encounter_substitutions | in_player_id | players | kritisch |
| encounter_substitutions | out_player_id | players | kritisch |
| encounters | away_team_id | teams | kritisch |
| encounters | competition_id | competitions | kritisch |
| encounters | home_team_id | teams | kritisch |
| legs | match_id | matches | kritisch |
| match_participant_players | match_id | matches | kritisch |
| match_participant_players | participant_id | match_participants | kritisch |
| match_participant_players | player_id | players | kritisch |
| match_participants | match_id | matches | kritisch |
| matches | board_id | boards | Lookup |
| organization_invitations | player_id | players | kritisch |
| player_avatars | player_id | players | Lookup (1:1-Ergänzung) |
| player_statistic_aggregates | player_id | players | Lookup (abgeleitete Daten) |
| score_commands | match_id | matches | kritisch |
| team_players | player_id | players | kritisch |
| team_players | team_id | teams | kritisch |
| tournament_boards | board_id | boards | Lookup |
| tournament_boards | tournament_id | tournaments | Lookup |
| tournament_commands | tournament_id | tournaments | kritisch |
| tournament_display_keys | tournament_id | tournaments | kritisch (öffentlicher Secret-Lookup ohne organization_id-Filter, siehe Auswertung) |
| tournament_group_participants | group_id | tournament_groups | kritisch |
| tournament_group_participants | player_id | players | kritisch |
| tournament_group_participants | tournament_id | tournaments | kritisch |
| tournament_groups | stage_id | tournament_stages | kritisch |
| tournament_groups | tournament_id | tournaments | kritisch |
| tournament_matches | board_id | boards | Lookup |
| tournament_matches | group_id | tournament_groups | kritisch |
| tournament_matches | participant_one_id | players | kritisch |
| tournament_matches | participant_two_id | players | kritisch |
| tournament_matches | scoring_match_id | matches | kritisch |
| tournament_matches | stage_id | tournament_stages | kritisch |
| tournament_matches | tournament_id | tournaments | kritisch |
| tournament_matches | winner_player_id | players | kritisch |
| tournament_participants | player_id | players | kritisch |
| tournament_participants | tournament_id | tournaments | kritisch |
| tournament_stages | tournament_id | tournaments | Lookup |
| visit_darts | visit_id | visits | kritisch |
| visits | leg_id | legs | kritisch |
| visits | match_id | matches | kritisch |
| visits | thrower_player_id | players | kritisch |

53 Zeilen, keine davon von Hand ergänzt oder entfernt. Davon 44 als
„kritisch" und 9 als „Lookup" markiert (ausgezählt anhand der
`Bemerkung`-Spalte der Tabelle oben, nicht geschätzt: 44 + 9 = 53).

## Auswertung

### Kritisch (verbinden schreibbare Tenant-Daten über Tabellen hinweg)

Das sind Beziehungen, bei denen ein falsch zugeordneter Fremdschlüssel eine
fremde Organisation tatsächlich beeinflussen könnte — Scoring-Daten,
Spielteilnahme, Kaderzugehörigkeit, Turnier-/Encounter-Struktur, oder ein
Lesezugriff, der ohne `organization_id`-Filter erfolgt:

- **Scoring-Kette**: `visits` → `matches`/`legs`/`players`, `visit_darts` →
  `visits`, `score_commands` → `matches`, `board_controller_leases` →
  `matches`.
- **Match-/Encounter-Teilnahme**: `match_participants` → `matches`,
  `match_participant_players` → `matches`/`match_participants`/`players`,
  `encounter_slots` → `encounters`/`matches`, `encounter_lineup_entries` →
  `encounters`/`players`/`encounter_slots`, `encounter_nominations` →
  `encounters`/`players`, `encounter_substitutions` →
  `encounters`/`players` (beide Rollen), `encounter_commands` →
  `encounters`.
- **Team-/Liga-Struktur**: `encounters` → `teams` (Heim/Auswärts) und →
  `competitions`, `team_players` → `teams`/`players`,
  `organization_invitations` → `players`.
- **Turnier-Struktur**: `tournament_matches` → `tournaments`/
  `tournament_groups`/`tournament_stages`/`players` (drei Rollen:
  Teilnehmer 1/2, Sieger) und → `matches` (Scoring-Verknüpfung),
  `tournament_groups` → `tournaments`/`tournament_stages`,
  `tournament_group_participants` → `tournaments`/`tournament_groups`/
  `players`, `tournament_participants` → `tournaments`/`players`,
  `tournament_commands` → `tournaments`.
- **Öffentlicher Secret-Lookup**: `tournament_display_keys` → `tournaments`.
  `DisplayKeysRepository.findBySecretHash`
  (`apps/api/src/tournaments/display-keys.repository.ts:151-163`) sucht die
  Zeile ausschliesslich über `secret_hash` — ohne `organization_id`- oder
  auch nur `tournament_id`-Filter in der Query selbst — und liefert die
  `tournament_id` an den Aufrufer zurück. Diese Route
  (`DisplayKeysService.stateOf`/`resolve`, aufgerufen aus der
  unauthentifizierten `GET /public/tournaments/:publicId/live`) ist der
  einzige Lesepfad im Schema, der eine tenant-tragende Zeile allein über ein
  Geheimnis auflöst, das ein anonymer Besucher besitzt. Heute vergleicht der
  Aufrufer die zurückgegebene `tournament_id` gegen die über `publicId`
  erwartete ID, bevor er den Schlüssel als gültig behandelt — ohne
  zusammengesetzten Fremdschlüssel hängt die Tenant-Bindung aber allein von
  dieser Anwendungsprüfung ab, nicht von einem DB-Constraint. Ein
  Dateninkonsistenz-Fehler (z. B. eine `tournament_display_keys`-Zeile,
  deren `organization_id` nicht mehr zur tatsächlichen Organisation ihres
  Turniers passt) könnte hier tatsächlich zur Auflösung eines fremden
  Turniers führen. Deshalb: kritisch nach dem eigenen Kriterium dieses
  Dokuments, nicht nur Lookup.

In jeder dieser Zeilen könnte eine Anwendungslücke (fehlender
`organization_id`-Filter bei einem Insert/Update) heute unbemerkt eine Zeile
erzeugen, die auf eine fremde Organisation zeigt — die Datenbank würde das
nicht verhindern.

### Lookup-artig (geringeres Schadenspotenzial)

Referenzen auf im Wesentlichen statische oder rein deskriptive
Zuordnungsdaten, bei denen eine Fehlzuordnung eher zu einer sichtbaren
Inkonsistenz als zu einer stillen Dateneigentums-Verletzung führen würde:

- `competition_slots` → `competitions`
- `encounter_slots` → `boards`, `matches` → `boards` (Board-Zuweisung)
- `player_avatars` → `players` (1:1-Ergänzungstabelle)
- `player_statistic_aggregates` → `players` (abgeleitete/aggregierte Daten,
  neu berechenbar)
- `tournament_boards` → `boards`/`tournaments`
- `tournament_matches` → `boards` (Board-Zuweisung)
- `tournament_stages` → `tournaments`

Diese Einordnung ersetzt keine Risikoanalyse der späteren Spec, sondern
sortiert nur nach Schadenspotenzial bei einer hypothetischen
Fehlzuordnung.

### Gegenprobe: gibt es bei den übrigen Lookup-Zeilen einen Lesepfad ohne `organization_id`-Filter?

Nach dem Fund bei `tournament_display_keys` wurde jede verbliebene
Lookup-Zeile im Code gegen dasselbe Kriterium geprüft (löst irgendein
Codepfad die referenzierte Zeile auf, ohne `organization_id` zu filtern —
insbesondere über einen unauthentifizierten oder secret-basierten Weg?):

- `competition_slots` → `competitions`: alle Fundstellen
  (`apps/api/src/competitions/competitions.repository.ts`,
  `apps/api/src/encounters/encounters.repository.ts`) filtern
  `competitionSlots.organizationId` explizit. Kein öffentlicher Lesepfad.
  Bleibt Lookup.
- `encounter_slots.board_id` → `boards`, `matches.board_id` → `boards`,
  `tournament_matches.board_id` → `boards`, `tournament_boards.board_id` →
  `boards`: `boards` wird nirgends direkt über eine Client-Kennung
  aufgelöst; jeder Board-Join hängt an einer bereits organisationsgebunden
  aufgelösten Zeile (Encounter/Match/Turnier). Im öffentlichen
  Turnier-Dashboard (`getPublicDashboardDataByPublicId` →
  `getDashboardData`, `apps/api/src/tournaments/tournaments.repository.ts`)
  und in der öffentlichen Begegnungsansicht (`EncountersRepository.loadData`,
  `apps/api/src/encounters/encounters.repository.ts:1555`) wird die
  `organization_id` einmal aus der über `public_id` gefundenen
  Turnier-/Begegnungszeile gelesen und danach für alle Folgeabfragen
  (Boards, Slots, Gruppen, Matches) wiederverwendet — nie unabhängig vom
  Client übernommen. Bleibt Lookup.
- `player_avatars.player_id` → `players`: jede Fundstelle in
  `apps/api/src/players/players.repository.ts` filtert
  `playerAvatars.organizationId` explizit, auch das
  `onConflictDoUpdate` (`setWhere`). Bleibt Lookup.
- `player_statistic_aggregates.player_id` → `players`: aktuell existiert nur
  ein Schreibpfad (`apps/worker/src/statistics/rebuild-player-statistics.ts`),
  kein API-Lesepfad. Kein Lesezugriff ohne Filter, weil noch kein Lesezugriff
  existiert. Bleibt Lookup, mit dem Hinweis, dies bei Einführung eines
  Lesepfads erneut zu prüfen.
- `tournament_boards.tournament_id` → `tournaments`,
  `tournament_stages.tournament_id` → `tournaments`: beide werden nur über
  `getDashboardData` gelesen, das wie oben beschrieben mit der bereits
  aufgelösten `organization_id` filtert. Bleibt Lookup.

Ergebnis der Gegenprobe: `tournament_display_keys` ist die einzige
Lookup-Zeile mit einem Lesepfad ohne `organization_id`-Filter; alle übrigen
bleiben unverändert eingestuft.

### Nicht in der Liste, mit Begründung

`memberships.user_id` referenziert `users(id)`; `users` trägt keine
`organization_id`-Spalte (ein Benutzerkonto ist bewusst
organisationsübergreifend und wird erst über `memberships` einer
Organisation zugeordnet). Diese Beziehung fällt korrekt aus der Abfrage, da
die referenzierte Tabelle keine `organization_id`-Spalte hat und ein
zusammengesetzter Tenant-Fremdschlüssel hier fachlich keinen Sinn ergäbe.

## Nicht im Umfang

Dieses Protokoll ändert kein Schema und keine Migration. Ein
zusammengesetzter Fremdschlüssel auf `(id, organization_id)` würde
voraussetzen:

1. einen `UNIQUE`-Constraint auf `(id, organization_id)` der jeweils
   referenzierten Tabelle (zusätzlich zum bestehenden Primary Key auf
   `id`), und
2. eine Migration, welche die referenzierende Tabelle um die
   `organization_id`-Spalte im Fremdschlüssel ergänzt (`FOREIGN KEY
   (spalte_id, organization_id) REFERENCES tabelle(id, organization_id)`).

Beides gehört in die spätere I-7-Spec, inklusive Priorisierung nach der
Einteilung oben (kritisch zuerst) und einer Prüfung auf bestehende
Datensätze, die eine solche Migration verletzen würden. Dieses Protokoll
liefert nur die Ausgangsliste.
