# ADR 0022: Doppel-K.-o. – Verlierer-Quellen und Rückspiel

**Status:** Accepted
**Datum:** 03.10.2026

## Kontext

Alle bisherigen K.-o.-Formate kennen nur Sieger-Quellen: Ein Spiel verweist
über `source_one_match_id` und `source_two_match_id` auf Vorgängerspiele, deren
Sieger nachrückt. `generateDoubleElimination` in `advanced.ts` liefert zwar
einen Matchgraphen mit Verlierer-Abhängigkeiten, dient aber nur der
Formatvorschau und wird nirgends gespeichert oder gespielt. Ein spielbares
Doppel-K.-o. braucht Verlierer-Quellen, ein Verlierer-Tableau und ein
Final-Rückspiel. Spec:
`docs/superpowers/specs/2026-10-03-doppel-ko-und-swiss-design.md`.

## Entscheidung

Neues Format `DOUBLE_ELIMINATION` mit den Stage-Typen
`DOUBLE_ELIMINATION_UPPER`, `DOUBLE_ELIMINATION_LOWER` und `GRAND_FINAL`.
Engine: `packages/tournament-engine/src/double-elimination.ts`; Weitergabe:
`apps/api/src/tournaments/advance-double-elimination.ts`.

- **Quellen-Art je Platz.** Neue Spalten `source_one_kind` und
  `source_two_kind` (`WINNER` oder `LOSER`) bilden zusammen mit
  den Quell-Verweisen den Platzhaltertyp `MATCH_LOSER` ab. Ein DB-Check
  erzwingt, dass die Art genau dann gesetzt ist, wenn ein Quell-Verweis
  besteht, und nur `WINNER` oder `LOSER` vorkommt. Die Migration setzt für
  bestehende Zeilen `WINNER`.
- **Planung beim Start.** Beim Turnierstart entstehen alle Spiele beider
  Tableaus und das erste Final. Byes werden in der Planung weggekürzt
  (Pass-Through): Ein Spiel mit nur einem echten Teilnehmer entsteht nicht, der
  Teilnehmer wird direkt an die Folgestelle gesetzt.
- **Rückspiel dynamisch.** Gewinnt die Verliererseite das erste Final, haben
  beide Finalisten eine Niederlage, und es folgt ein Rückspiel
  (`grand-final:r2:m1`). `advanceDoubleElimination` legt es in der Transaktion
  des Abschlusses an, vor `updateTournamentProgress`, nach `FOR UPDATE` auf der
  Turnierzeile; der Unique-Index auf `(tournament_id, key)` ist die zweite
  Linie. Es entsteht nur nach gespieltem Sieg der Verliererseite, nicht bei
  einem Walkover durch Rückzug.
- **Korrektur des ersten Finals.** Das Rückspiel hat keine Quell-Verweise (die
  Teilnehmer sind direkt gesetzt). Die Korrektur des ersten Finals prüft es
  deshalb gesondert und löscht es, solange es nicht gestartet ist; ist es
  gestartet, wird die Korrektur abgelehnt.
- **Platzierung berechnet, nicht gespeichert.** 1 und 2 aus Final bzw.
  Rückspiel, 3 und folgende aus der Runde des Ausscheidens im Verlierer-Tableau.
  Das Lesemodell leitet sie bei jeder Projektion neu ab.
- **Höchstens 64 Teilnehmer.** Wie beim Einfach-K.-o. (Grenze von
  `generateKnockoutBracket` und `tournaments_knockout_size_check`).

## Folgen

- Drei Stellen geben Spielausgänge weiter und kennen die Art: Abschluss,
  Korrektur und Rückzug. Verlierer-Quellen lösen sie mit dem Verlierer auf,
  Sieger-Quellen wie bisher mit dem Sieger.
- Jede neue Schreibstelle für Quellen muss die Art setzen; der DB-Check
  erzwingt es.
- `generateDoubleElimination` in `advanced.ts` bleibt bis Plan 2 (Swiss)
  bestehen und wird dann entfernt (siehe Nachtrag in ADR 0007).
- Swiss-Spalten kommen erst mit Plan 2; Migration `0038_double_elimination`
  enthält nur Doppel-K.-o.
