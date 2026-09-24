# ADR 0018: Löschkonzept für Spieler, Mitglieder und Organisationen

**Status:** Accepted
**Datum:** 24. September 2026

## Kontext

Bis hierher liess sich keine der drei Entitäten endgültig löschen. Spieler
kannten nur das Archivieren (`status=INACTIVE`), ein Mitglied liess sich
nicht aus einer Organisation entfernen, und für Organisationen gab es
ausser `PATCH /organizations/:id` (Name, Zeitzone, Sprache) überhaupt keinen
Bildschirm. Die Spec
`docs/superpowers/specs/2026-09-24-bearbeiten-loeschen-design.md` führt alle
drei Löschwege ein, umgesetzt in drei PR: Spieler → Mitglieder →
Organisation.

Spieler mit sportlicher Historie sind durch neun RESTRICT-Fremdschlüssel
geschützt: `match_participant_players`, `visits.thrower_player_id`,
`tournament_participants`, `tournament_group_participants`,
`tournament_matches` (`participant_one_id` / `participant_two_id` /
`winner_player_id`), `team_players`, `encounter_nominations`,
`encounter_lineup_entries` und `encounter_substitutions` (`out_player_id` /
`in_player_id`). Ein `DELETE`, das eine dieser Zeilen träfe, scheitert an der
Datenbank, nicht erst an einer Anwendungsprüfung — das ist beabsichtigt und
bleibt so.

## Entscheidung

- **Spieler:** Archivieren (`status=INACTIVE`, `player:archive`) bleibt der
  Normalfall und ist reversibel — ein Spieler mit Matches, Turnieren, einem
  Team oder einer Begegnung lässt sich nicht anders behandeln, ohne Historie
  zu verwaschen. Endgültiges Löschen (`player:delete`, OWNER und ADMIN) geht
  nur für einen Spieler, der in keiner der neun RESTRICT-Tabellen vorkommt;
  sonst antwortet der Server mit 409 `PLAYER_HAS_HISTORY`, statt die
  Datenbankausnahme durchzureichen.
- **Mitglied entfernen** heisst: die Mitgliedschaft in dieser einen
  Organisation wird gelöscht, eine dortige Spieler-Verknüpfung gelöst
  (ADR 0015). Das Benutzerkonto bleibt bestehen und lässt sich erneut
  einladen — es gehört der Person, nicht der Organisation, und andere
  Mitgliedschaften desselben Kontos sind davon nicht betroffen.
- **Organisation löschen** ist ausschliesslich der Inhaberschaft
  vorbehalten (`organization:delete`, nur `OWNER`; ADMIN erhält jede andere
  Permission, diese nicht) und verlangt den exakt eingetippten
  Organisationsnamen als Bestätigung (400 `ORGANIZATION_NAME_MISMATCH` bei
  Abweichung). Gelöscht wird die gesamte Organisation mit allem, was ihr
  gehört, in einer Transaktion: ein einfaches `delete(organizations)`
  reicht, weil jede tenant-bezogene Fremdschlüsselspalte `onDelete:
  "cascade"` trägt.
  **Invariante, die das trägt:** jede Tabelle, die selbst eine RESTRICT-
  oder NO-ACTION-Fremdschlüsselspalte auf eine andere Mandantentabelle hält
  (z. B. `match_participant_players.player_id`, `visits.thrower_player_id`,
  `tournament_matches.winner_player_id`, `encounters.home_team_id`), trägt
  zusätzlich selbst eine `organization_id`-Spalte mit direktem `ON DELETE
  CASCADE` auf `organizations`. Ohne diese zweite, direkte Kaskade würde
  Postgres beim Löschen der Organisation auf genau die RESTRICT-Klammer
  laufen, die einen Spieler mit Historie vor dem *einzelnen* Löschen
  schützt — die Zeile müsste dann erst über die referenzierte Tabelle
  verschwinden, was die RESTRICT-Prüfung nicht garantiert abwartet. Die
  Invariante ist keine Konvention, sondern wird durch einen Datenbanktest
  gegen `pg_constraint` erzwungen (`packages/database/src/client.integration.spec.ts`,
  „kaskadiert jede RESTRICT-geschützte Mandantentabelle direkt aus
  organizations"): jede neue Tabelle mit einer solchen RESTRICT-Spalte
  braucht ab sofort ebenfalls die direkte `organization_id`-Kaskade, sonst
  schlägt der Test fehl.
- **Audit ausserhalb des Mandanten:** Der Audit-Eintrag über die Löschung
  (`ORGANIZATION_DELETED`) trägt `organization_id = NULL` — die kaskadierte
  Löschung würde ihn sonst mit sich reissen, bevor er etwas dokumentiert. Er
  trägt die Identität stattdessen selbst in `oldValue` (Name, Slug, Anzahl
  Mitglieder/Spieler/Turniere), damit die Löschung nachvollziehbar bleibt,
  auch wenn die Organisation danach nicht mehr existiert.

## Verworfen

- **Anonymisieren statt Löschen** (für Spieler oder Organisationen): hätte
  den Wunsch nach einem endgültigen, restlosen Löschen nicht erfüllt und
  eine eigene Nachbearbeitung jeder betroffenen Tabelle verlangt — ohne
  klaren Nutzen gegenüber dem bestehenden Archivieren.
- **Löschfrist** (Organisation bleibt eine Zeit lang wiederherstellbar,
  endgültige Löschung erst danach): mehr Zustand (ein weiterer Status,
  ein Hintergrundjob, der die Frist vollzieht) für einen Fall, der sich
  bereits über die Point-in-Time-Recovery des Betriebs abdecken lässt (siehe
  Folgen). Nicht Teil dieser Spec.

## Folgen

- Das Löschen einer Organisation ist irreversibel. Es gibt keinen
  Wiederherstellungsweg im Produkt; einzige Rückholmöglichkeit ist eine
  Point-in-Time-Recovery der Datenbank durch den Betrieb (Railway
  PostgreSQL), die die gesamte Organisation samt allen seither erfolgten
  Änderungen anderer Organisationen zurückdrehen würde — ein Mittel für den
  Notfall, kein Undo-Knopf.
- **Offener Punkt (Legal/Compliance):** Audit-Einträge zu einem gelöschten
  Spieler oder einer gelöschten Organisation enthalten weiterhin
  Personendaten in `oldValue` (zum Beispiel Name, E-Mail-Adresse). Ob das so
  bleiben darf oder eine Anonymisierung dieser Einträge nötig ist, klärt
  Legal/Compliance; diese Entscheidung ändert daran nichts.
- `ARCHITECTURE.md` und die Bedienungsanleitung nennen die drei neuen Wege
  (Spieler endgültig löschen, Mitglied entfernen, Organisation löschen) und
  die jeweils nötige Permission.
