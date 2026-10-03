# Spec: Doppel-K.-o. und Schweizer System (inkl. Dänisches System)

Stand: 03.10.2026.

## Problem

Mitbewerber (Gap-Analyse vom 03.10.2026 gegenüber my-darts-tournament.com)
bieten Doppel-K.-o. (DKO), Schweizer und Dänisches System als spielbare
Turnierformate an. Bei uns existiert Engine-Logik dafür
(`packages/tournament-engine/src/advanced.ts`), sie wird aber nur für eine
Formatvorschau genutzt (`advanced-format-preview`, Seite `/turniere/formate`).
Gespeichert und gespielt werden nur `GROUPS_THEN_KNOCKOUT`, `ROUND_ROBIN`,
`SINGLE_ELIMINATION` und `CLUB_DUEL`.

Die vorhandene Logik reicht nicht:

- `generateDoubleElimination` kennt nur 4/8/16/32/64 Teilnehmer, keine Byes,
  kein Final-Rückspiel und wird nirgends persistiert.
- `pairSwissRound` paart greedy und kann sich in eine Sackgasse paaren
  (Wiederholung, obwohl eine wiederholungsfreie Paarung existiert).
- Die Fortschreibung im K.-o. kennt nur Sieger-Quellen (`MATCH_WINNER`).

## Ziel

Zwei neue Turnierformate, nur für Einzelspieler:

1. **`DOUBLE_ELIMINATION`**: Gewinner- und Verlierer-Tableau, jede
   Teilnehmerzahl ab 4, Byes nach Setzung, Final mit Rückspiel bei Bedarf.
2. **`SWISS`**: Qualifikation Runde für Runde nach Schweizer oder Dänischem
   System, danach K.-o. der besten N.

## Entscheide (mit dem Nutzer abgestimmt)

| Frage | Entscheid |
|---|---|
| Final im DKO | Gewinnt der Sieger des Verlierer-Tableaus das erste Final, folgt ein Rückspiel (beide haben dann je eine Niederlage). Das Rückspiel entsteht nur bei Bedarf. |
| Spielplan DKO | Beim Start werden alle Spiele beider Tableaus und das erste Final angelegt. Byes werden in der Planung aufgelöst. Nur das Rückspiel entsteht dynamisch. |
| Platz 3 im DKO | Verlierer des Verlierer-Finals. Kein eigenes Spiel um Platz 3. |
| Swiss-Ende | Immer K.-o. der besten N (`swissQualifiers`), N zwischen 2 und Teilnehmerzahl. Ist N keine Zweierpotenz, gibt es Byes für die Bestplatzierten wie im bestehenden K.-o. |
| Dänisches System | Option des Swiss-Formats (`swissPairing = 'DANISH'`): 1.–2., 3.–4. usw. nach aktueller Rangliste, Wiederholungen erlaubt. |
| Swiss-Rangliste | Siege → Buchholz → Legdifferenz → gewonnene Legs → Seed. |
| Buchholz | Summe der Siege aller bisherigen Gegner. Bye zählt nicht als Gegner. |
| Bye im Swiss | Echtes `BYE`-Match, zählt als Sieg ohne Legs. Erhält, wer am tiefsten steht und noch kein Bye hatte. Höchstens eines pro Teilnehmer. |
| Swiss-Paarung | Gewichtetes Matching nach Edmonds (Blossom), nicht greedy. Ungarischer Algorithmus (Vereinsduell) passt nicht, weil Swiss nicht bipartit ist. |
| Paare/Teams | Nicht im Umfang. Engine-Code dafür wird entfernt (YAGNI). |
| Spielmodus | Ein Modus für das ganze Turnier, wie bei allen Formaten. |

## Grundlage im Bestand

- Runde-für-Runde-Paarung in der Abschlusstransaktion: `advance-club-duel.ts`,
  ADR 0021. Swiss übernimmt dieses Muster.
- Platzhalter `GROUP_RANK`, `MATCH_WINNER`, `SIDE_RANK` in
  `KnockoutParticipantReference` (`tournament.ts`).
- Sieger-Weitergabe an drei Stellen: Abschluss
  (`matches.repository.ts`, Abhängige über `source_one/two_match_id`),
  Resultatkorrektur (gleiche Datei) und Rückzug
  (`resolveTournamentWithdrawals`, `apply-withdrawal-propagation.ts`).
- K.-o.-Baum mit Byes: `generateKnockoutBracket`.
- Live-Baum: `BracketTree` in `live-tournament.tsx`; Runden-Tabs im
  Vereinsduell-Panel.

## Datenmodell (Migration `0038_double_elimination_swiss`)

### `tournaments`

- `tournaments_format_check` um `DOUBLE_ELIMINATION` und `SWISS` erweitert.
- `qualifying_rounds`: gilt neu für `CLUB_DUEL` und `SWISS` (1–15). Der Check
  `tournaments_club_duel_settings_check` wird aufgeteilt: Seitennamen und
  `final_round_size` nur bei `CLUB_DUEL`, `qualifying_rounds` genau bei
  `CLUB_DUEL` oder `SWISS`.
- Neu `swiss_pairing varchar(10)`: `'SWISS' | 'DANISH'`, genau bei `SWISS`
  nicht null (Check).
- Neu `swiss_qualifiers integer`: genau bei `SWISS` nicht null, Check
  `between 2 and 64`. Dass N höchstens der Teilnehmerzahl entspricht, prüft die
  API (Teilnehmer liegen in einer anderen Tabelle).
- Status: DKO läuft vollständig im Status `KNOCKOUT`. Swiss nutzt
  `GROUP_STAGE` für die Runden, dann `KNOCKOUT`. Kein neuer Status.

### `tournament_stages`

`type`-Check erweitert um `DOUBLE_ELIMINATION_UPPER`,
`DOUBLE_ELIMINATION_LOWER`, `GRAND_FINAL`, `SWISS`. Der K.-o. nach Swiss ist
eine normale `SINGLE_ELIMINATION`-Stage.

### `tournament_matches`

- Neu `source_one_kind varchar(10)`, `source_two_kind varchar(10)`:
  `'WINNER' | 'LOSER'`. Check: `source_x_kind` ist genau dann nicht null, wenn
  `source_x_match_id` nicht null ist. Bestand wird mit `'WINNER'` befüllt
  (Datenmigration in derselben Migration).
- Keine neuen Unique-Indizes nötig: `tournament_matches_tournament_key_unique`
  `(tournament_id, key)` verhindert mit deterministischen Keys
  (`swiss:r3:m2`, `grand-final:r2:m1`) eine doppelt eingefügte Runde bzw. ein
  doppeltes Rückspiel; `tournament_matches_stage_round_participant_*_unique`
  verhindert, dass ein Spieler in einer Runde einer Stage zweimal auftritt
  (Gewinner- und Verlierer-Tableau sind getrennte Stages).

### Platzhalter (`participant_*_ref`, jsonb)

- `{ type: "MATCH_LOSER", matchKey }`: Verlierer eines Spiels.
- `{ type: "STAGE_RANK", stageKey, rank }`: Rang in der Rangliste einer Stage
  (Swiss → K.-o.). `SIDE_RANK` bleibt fürs Vereinsduell unverändert.

## Engine (`packages/tournament-engine`)

Neue Dateien `double-elimination.ts` und `swiss.ts`; `advanced.ts` wird
entfernt, Exporte in `index.ts` bereinigt.

### `planDoubleElimination(input)`

- Eingabe: Teilnehmer mit Seed, `seeding` (`SEEDED`/`RANDOM` + `randomSeed`).
- Mindestens 4 Teilnehmer, höchstens 256 (Schema-Grenze).
- Baumgrösse = nächste Zweierpotenz. Byes in Runde 1 des Gewinner-Tableaus
  nach Standard-Setzung (wie `generateKnockoutBracket`).
- Verlierer-Tableau: abwechselnd Konsolidierungsrunde (Sieger gegen Sieger) und
  Einfallrunde (Sieger gegen Verlierer aus dem Gewinner-Tableau). Einfallende
  Verlierer werden je Runde gespiegelt eingesetzt, damit frühe
  Wiederholungsduelle vermieden werden.
- **Byes in der Planung auflösen:** Ein Platz, dessen Quelle ein Bye-Match
  ist (`MATCH_LOSER` eines Byes), ist leer. Spiele mit einem leeren Platz
  werden `BYE` mit bekanntem oder später bekanntem Sieger, Spiele mit zwei
  leeren Plätzen entfallen und ihr Abnehmer erhält einen leeren Platz. Die
  Engine rechnet das bis zum Fixpunkt aus. Ergebnis: kein Laufzeitfall
  «leerer Verlierer».
- Ausgabe: `PlannedMatch[]` mit `stageType` `DOUBLE_ELIMINATION_UPPER` /
  `DOUBLE_ELIMINATION_LOWER` / `GRAND_FINAL`, Final-Key `grand-final:r1:m1`.
- Invarianten (Tests): keine Zyklen, jede Quelle existiert und liegt früher,
  jeder Teilnehmer scheidet erst nach zwei Niederlagen aus (ausser dem
  Turniersieger), genau ein Final.

### `planGrandFinalReset(final)` und `doubleEliminationPlacements(matches)`

- Reset nötig, wenn der Sieger des ersten Finals aus dem Verlierer-Tableau
  kommt. Liefert das Rückspiel `grand-final:r2:m1` mit beiden Spielern.
- Platzierungen: 1 und 2 aus dem Final (bzw. Rückspiel), 3 Verlierer des
  Verlierer-Finals, danach geteilte Ränge nach Ausscheiderunde im
  Verlierer-Tableau (z. B. 5–6, 7–8).

### `planSwiss(input)`

Legt Stage `SWISS` mit Runde 1 und die K.-o.-Stage mit `STAGE_RANK`-
Platzhaltern an (`generateKnockoutBracket` mit N Plätzen).
Runde 1: `SEEDED` → obere Hälfte gegen untere Hälfte (1 gegen n/2+1 usw.),
`RANDOM` → nach `randomSeed` gemischt. Bei ungerader Zahl Bye an den tiefsten
Seed.

### `calculateSwissStandings(input)`

Eingabe: Teilnehmer (inkl. zurückgezogener), abgeschlossene Spiele
(Sieger, Legs, Resultattyp). Sortierung: Siege → Buchholz → Legdifferenz →
gewonnene Legs → Seed. Walkover zählt als Sieg ohne Legs. Zurückgezogene
bleiben mit ihren Resultaten in der Liste (Buchholz der Gegner) und werden
markiert.

### `pairSwissRound(input)`

- Eingabe: Rangliste der aktiven Teilnehmer, bisherige Paarungen, bisherige
  Byes.
- Bye bei ungerader Zahl: tiefster Rang ohne bisheriges Bye. Gibt es keinen,
  Fehler `NO_SWISS_BYE_AVAILABLE` (bei höchstens n−1 Runden nicht erreichbar).
- Paarung als gewichtetes perfektes Matching mit minimalen Kosten
  (Edmonds/Blossom, deterministisch, O(n³)). Kosten je Paar:
  `(Rang A − Rang B)² + Wiederholungen × (n⁴ + 1)`. Die Strafe liegt über jeder
  möglichen Summe der Rangabstandsquadrate; Wiederholungen werden nur
  akzeptiert, wenn unvermeidbar, und als `warnings` zurückgegeben.
- Tischreihenfolge nach bestem Rang im Paar.

### `pairDanishRound(input)`

1.–2., 3.–4. usw. nach aktueller Rangliste, Wiederholungen erlaubt. Bye wie
oben.

### `calculateTournamentLifecycle`

Kennt die neuen Stage-Typen: DKO → `KNOCKOUT` bis Final bzw. Rückspiel
abgeschlossen; Swiss → `GROUP_STAGE` bis letzte Runde abgeschlossen, dann
`KNOCKOUT`.

## API und Ablauf

### Erstellen und Vorschau

Bestehende Routen `POST /api/v1/organizations/:organizationId/tournaments`
(`tournament:create`) und die Strukturvorschau. Schema-Erweiterung:

- `format: "DOUBLE_ELIMINATION"`: mindestens 4 Teilnehmer.
- `format: "SWISS"`: `qualifyingRounds` (1–15, Standard ⌈log₂ n⌉),
  `swissPairing` (`SWISS`/`DANISH`), `swissQualifiers` (2 bis n). Bei
  `SWISS`-Paarung höchstens n−1 Runden, bei `DANISH` frei.

Vorschau liefert Spielzahl, Byes und Baum (DKO) bzw. Runde 1, Gesamtzahl
Spiele und K.-o.-Baum (Swiss).

Entfällt: `advanced-format-preview` (Route, Service-Methode, Schemas
`advanced-tournament.ts`) und die Seite `/turniere/formate`.

### Abschluss eines Spiels (Transaktion des Abschlusses)

1. Weitergabe an Abhängige: je Platz nach `source_x_kind` den Sieger oder den
   Verlierer einsetzen. Betrifft den bestehenden Codepfad in
   `matches.repository.ts`.
2. `advanceDoubleElimination` (neu, `advance-double-elimination.ts`):
   No-op ausser bei abgeschlossenem ersten Final eines DKO. Sperrt die
   Turnierzeile `FOR UPDATE`, legt bei Bedarf das Rückspiel an (sofern nicht
   vorhanden), Audit `TOURNAMENT_GRAND_FINAL_RESET`, Outbox
   `TOURNAMENT_GRAND_FINAL_RESET`.
3. `advanceSwiss` (neu, `advance-swiss.ts`), Muster `advanceClubDuel`:
   sperren, offene Spiele der Runde zählen, bei 0 Rangliste berechnen und
   nächste Runde paaren (Spiele + Bye-Match einfügen, Audit, Outbox
   `TOURNAMENT_ROUND_PAIRED`) bzw. nach der letzten Runde die `STAGE_RANK`-
   Plätze des K.-o. auflösen. Zurückgezogene werden nicht gepaart.
4. `updateTournamentProgress` wie bisher. `tournaments.version` erhöht der
   Aufrufer. Realtime nach Commit.

Parallel abgeschlossene letzte Spiele erzeugen genau eine Folgerunde bzw. ein
Rückspiel (Sperre vor dem Zählen, Unique-Index auf `(tournament_id, key)` als
zweite Linie).

### Resultatkorrektur

- Bestehende Regel bleibt: gesperrt, sobald ein abhängiges Spiel läuft oder
  abgeschlossen ist (`downstream-started`). Gilt für Sieger- und
  Verlierer-Quellen; beim Zurücksetzen werden beide Arten Plätze geleert.
- Korrektur des ersten DKO-Finals: Ein nicht gestartetes Rückspiel wird
  gelöscht (Audit), ein gestartetes führt zu `downstream-started`.
- Swiss: gesperrt, sobald die Folgerunde gepaart bzw. der K.-o. besetzt ist,
  409 `SWISS_ROUND_ALREADY_PAIRED`. `isClubDuelResultLocked` wird zu einem
  Prädikat je Format verallgemeinert (`tournament-result-lock.ts`), geprüft
  unter der Turniersperre.

### Rückzug

`resolveTournamentWithdrawals` erhält die Quellen-Art. Offene Spiele des
Zurückgezogenen werden Walkover. Fällt ein Zurückgezogener als Verlierer ins
Verlierer-Tableau, wird sein dortiges Spiel Walkover für den Gegner. Swiss:
offene Spiele Walkover, ab der nächsten Runde nicht mehr gepaart.

### Lesen

Turnier-Dashboard, öffentliche Route und Anzeigeschlüssel erhalten optionale
Blöcke (analog `clubDuel`):

- `doubleElimination`: `upper[]` und `lower[]` (Runden mit Spielen),
  `grandFinal`, `grandFinalReset` (`null`, solange nicht angelegt),
  `resetPossible` (Boolean), `placements`.
- `swiss`: `currentRound`, `totalRounds`, `pairing`, `standings`
  (Siege, Buchholz, Legdifferenz, gewonnene Legs, zurückgezogen), `rounds[]`
  mit Spielen und Bye, `knockout` (Baum).

`tournamentStageLabel`: «Gewinnerrunde», «Verliererrunde», «Final»,
«Final-Rückspiel», «Swiss · Runde 3/5», «Dänisch · Runde 3/5», «K.-o.-Runde».

### Fehlercodes

- 400 `INVALID_TOURNAMENT_CONFIGURATION` (Teilnehmerzahl, Runden, N).
- 409 `SWISS_ROUND_ALREADY_PAIRED`.
- Bestehend: 409 `downstream-started`, Versionskonflikte.

Keine neuen Permissions; es gelten die bestehenden `tournament:*`.

## UI (`apps/web`)

### Erstellen (`setup-sheet`)

Formatwahl um «Doppel-K.-o.» und «Schweizer System» erweitert. Swiss zeigt:
Runden (Standardwert vorbelegt), Paarung «Schweizer» / «Dänisch» mit je einem
Satz Erklärung, «Danach K.-o. der besten …». Vorschau wird live vom Server
berechnet. Fehlermeldungen am Feld.

### Turnieransicht (Leitung und öffentlich)

- DKO: Gewinner- und Verlierer-Baum (Desktop nebeneinander bzw. untereinander,
  Telefon als Tabs), Final hervorgehoben, Rückspiel als Platzhalter mit Text
  «Nur falls der Sieger der Verliererrunde gewinnt», bis entschieden.
  Platzierungsliste nach Abschluss.
- Swiss: Tabs Rangliste / Runden / K.-o. nach Muster des Vereinsduell-Panels.
  Buchholz-Spalte mit Legende «Summe der Siege der Gegner».

### Beamer (TV-Modus)

Laufende und nächste Spiele wie bisher; Swiss zusätzlich Top 8 der Rangliste.

### Scoring, Warteschlange, Scheiben-Tablet

Unverändert; sie verarbeiten `READY`-Spiele formatunabhängig.

### Barrierefreiheit

Tableau-Zugehörigkeit und Status als Text, nicht nur über Farbe. Bäume als
Listen mit Überschriften je Runde für Screenreader. Tabs per Tastatur
bedienbar.

## Tests

### Engine (Vitest)

- DKO für n = 4, 5, 7, 8, 13, 16, 33, 64: Byes korrekt aufgelöst, keine
  Zyklen, Quellen existieren, simulierte Turniere mit zufälligen Resultaten
  (fast-check): jeder ausser dem Sieger scheidet nach genau zwei Niederlagen
  aus, Rückspiel genau dann, wenn der Sieger des Verlierer-Tableaus das erste
  Final gewinnt, Platzierungen vollständig und eindeutig.
- Blossom-Matching: Vergleich mit Brute Force bis n = 12 (gleiche minimale
  Kosten), keine Wiederholung, wenn vermeidbar; Determinismus.
- Swiss: Bye höchstens einmal, an den tiefsten Rang; ganze Turniere mit
  zufälligen Resultaten simuliert, n−1 Runden ohne Wiederholung möglich.
- Dänisch: 1–2, 3–4, Wiederholungen erlaubt.
- Rangliste: Siege → Buchholz → Legdifferenz → gewonnene Legs → Seed;
  Bye und Walkover ohne Legs; Zurückgezogene bleiben.
- Lifecycle für die neuen Stage-Typen.

### API (Integration, Testcontainers)

- DKO mit 13 Teilnehmern durchgespielt, einmal mit, einmal ohne Rückspiel.
- Swiss mit 9 Teilnehmern, 4 Runden, Top 4 in den K.-o., durchgespielt; dito
  Dänisch.
- Zwei letzte Rundenspiele parallel abgeschlossen → genau eine Folgerunde;
  dito erstes Final parallel → höchstens ein Rückspiel.
- Korrektur: Swiss nach Paarung 409; DKO nach gestartetem Abhängigen 409;
  Korrektur des ersten Finals löscht ungestartetes Rückspiel.
- Rückzug mitten im Verlierer-Tableau und mitten im Swiss.
- Migration: Bestandsdaten erhalten `source_x_kind = 'WINNER'`; Checks greifen.
- Tenant-Isolation: fremde Organisation → 404.
- Outbox und Audit je Paarung bzw. Rückspiel.

### E2E (Playwright, ein Worker)

- Swiss-Turnier anlegen, Runde 1 sichtbar.
- DKO mit 4 Teilnehmern bis zum Rückspiel durchklicken.
- Render-Tests für Rangliste und beide Bäume.

## Dokumentation

- ADR 0022: `MATCH_LOSER` und Quellen-Art, `STAGE_RANK`, Blossom statt
  Greedy/Ungarisch, dynamisches Final-Rückspiel, Abbau der Formatvorschau.
- Nachtrag ADR 0007: Stage-Komposition, Paare und Teams entfernt.
- ROADMAP Phase 4 korrigieren (spielbar statt nur Vorschau).
- Nutzerdoku/Hilfe-Texte zu den Formaten.

## Lieferung

Zwei Umsetzungspläne, je ein PR nach `develop`:

1. **Doppel-K.-o.**: Migration (Format, Stage-Typen, Quellen-Art,
   Swiss-Spalten gleich mit), Engine, Weitergabe/Korrektur/Rückzug,
   Rückspiel, Projektion, UI, Tests, ADR 0022.
2. **Swiss und Dänisch**: Engine (Blossom, Rangliste), `advanceSwiss`,
   Korrektursperre, Projektion, UI, Abbau `advanced.ts` und Formatvorschau,
   Tests.

## Datenschutz

Keine neuen Personendaten. Ranglisten und Bäume zeigen dieselben Namen wie die
bestehenden Formate und folgen der Turnier-Sichtbarkeit (ADR 0013).

## Nicht im Umfang

- Paar- und Team-Turniere.
- Swiss ohne anschliessenden K.-o.
- Spielmodus je Phase.
- Weitere Formate (Leben/Kratzer, kombinierbare Stages).
- Manuelle Paarungskorrektur durch die Turnierleitung.

## Umsetzung Plan 1 (Doppel-K.-o.) – Abweichungen

Stand: 03.10.2026. Die Umsetzung von Plan 1 weicht in folgenden Punkten von
dieser Spec ab:

1. **Höchstens 64 Teilnehmer statt 256.** Grenze von `generateKnockoutBracket`
   und `tournaments_knockout_size_check`, wie beim Einfach-K.-o.
2. **Swiss-Spalten erst mit Plan 2.** `swiss_pairing`, `swiss_qualifiers` und
   der Check `qualifying_rounds` fehlen; Migration `0038_double_elimination`
   enthält nur Doppel-K.-o. (nicht `0038_double_elimination_swiss`).
3. **Lesemodell.** Statt eigener `upper[]`/`lower[]` trägt jede Zeile der
   bestehenden Liste `bracket` ein Feld `section` (`MAIN`, `UPPER`, `LOWER`,
   `GRAND_FINAL`). Der Block `doubleElimination` enthält nur `placements` und
   `resetPossible`.
4. **Setzung `RANDOM`.** Verhält sich wie beim Einfach-K.-o. (Anmeldereihenfolge
   ist die Setzliste). Das ist bestehendes Verhalten aller K.-o.-Formate und
   nicht Teil des Plans.
5. **Check `source_*_kind`.** Verlangt zusätzlich `kind is not null`, weil ein
   CHECK bei NULL besteht.
6. **Migration von Hand geschrieben.** Die drizzle-Snapshots enden bei 0029,
   wie bei 0030–0037.
7. **Live-Ansicht.** Drei Abschnitte untereinander (Gewinnerrunde,
   Verliererrunde, Final) statt Tabs auf dem Telefon; der Baum stapelt bis `lg`
   ohnehin.
8. **Rückspiel ohne Quell-Verweise.** Die Teilnehmer sind direkt gesetzt; die
   Korrektur des ersten Finals prüft das Rückspiel deshalb gesondert und löscht
   es, solange es nicht gestartet ist.
9. **Phasenbezeichnung im Kopf.** `tournamentStageLabel` bleibt beim
   Doppel-K.-o. «K.-o.-Runde»; die feineren Bezeichnungen «Gewinnerrunde ·
   Runde N», «Verliererrunde · Runde N», «Final» und «Final-Rückspiel» tragen
   die einzelnen Spiele.
10. **Kommandozentrale ohne Tableau.** Die Kommandozentrale der Leitung zeigt
    (wie beim Einfach-K.-o. heute) kein Tableau; die Bäume und die
    Schlussrangliste stehen in der Live-Ansicht, die die Leitung ebenfalls
    öffnen kann.
