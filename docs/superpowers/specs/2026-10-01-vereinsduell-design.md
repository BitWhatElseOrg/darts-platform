# Spec: Vereinsduell (Freundschaftsturnier Verein gegen Verein)

Stand: 01.10.2026.

## Problem

Der Verein will Freundschaftsturniere gegen andere Vereine austragen. Die
Teilnehmerzahl je Verein ist verschieden (Beispiel: 13 gegen 9). Jedes Spiel
ist immer ein Spieler von Verein A gegen einen von Verein B – in jeder Phase,
bis und mit Final. Keines der bestehenden Formate (`GROUPS_THEN_KNOCKOUT`,
`ROUND_ROBIN`, `SINGLE_ELIMINATION`) kann das garantieren.

## Ziel

Neues Turnierformat `CLUB_DUEL`:

1. **Qualifikation** im Schweizer System mit Pausen-Rotation, Runde für Runde
   gepaart.
2. **Kreuz-Finalrunde**: die besten N je Verein spielen jeder gegen jeden des
   anderen Vereins.
3. **Final** A1 gegen B1, optional **Spiel um Platz 3** A2 gegen B2.
4. **Vereinswertung** über alle Spiele.

## Entscheide (mit dem Nutzer abgestimmt)

| Frage | Entscheid |
|---|---|
| «Immer A gegen B» | Gilt bis und mit Final. Ein klassisches KO kann das nicht garantieren (gewinnen alle von A, bleiben nur A übrig). Deshalb Kreuz-Finalrunde statt KO-Baum. |
| Gastverein | Gastspieler werden in der eigenen Organisation als kontolose Spieler (`kind = 'GUEST'`) erfasst. Kein organisationsübergreifendes Turnier. |
| Qualifikation | Feste Rundenzahl (1–15, Leitung wählt), Schweizer Paarung, Pausen-Rotation beim grösseren Verein. |
| Ranglisten Quali | Gesamtrangliste (Information) und je Verein (massgeblich für die Finalrunde). |
| Rangkriterien Quali | Siegquote → Legdifferenz pro Spiel → gewonnene Legs pro Spiel → Seed. Seed statt Los, weil er gespeichert und damit reproduzierbar ist. |
| Finalrunde | Grösse N einstellbar 2–6, Standard 4, höchstens Grösse des kleineren Vereins. Kriterien: Siege → Legdifferenz → Quali-Rang. |
| Spiel um Platz 3 | Option, Standard an. |
| Vereinswertung | 1 Punkt pro gewonnenem Spiel (inkl. Walkover) über alle Phasen; Gleichstand → Legdifferenz aller Spiele → unentschieden. Nicht gespeichert, sondern berechnet. |
| Rückzug | Offenes Spiel → Walkover für den Gegner; ab nächster Runde nicht mehr gepaart; nicht besetzbare Plätze der Finalrunde → Walkover für den Gegner. |
| Resultatkorrektur | Nur solange die Folgerunde nicht gepaart ist; sonst 409 `CLUB_DUEL_ROUND_ALREADY_PAIRED`. |
| Spielmodus | Ein Modus (Best of Legs / Sets) für das ganze Turnier, wie bei allen bestehenden Formaten. Ein Modus je Phase ist nicht im Umfang; er käme als eigenes Feature für alle Formate. |

### Warum ungleiche Spielzahlen unvermeidlich sind

Jedes Spiel hat genau einen Spieler von A und einen von B. Die Summe der
Spiele beider Seiten ist deshalb gleich. Bei 13 gegen 9 spielen B-Spieler im
Schnitt 13/9 ≈ 1,44-mal so oft. Die Quali-Ranglisten rechnen darum mit Quoten,
nicht mit Punkten. Die Vereinswertung ist trotzdem fair: Jeder Punkt geht an
genau einen der beiden Vereine.

## Grundlage im Bestand

- `createTournamentPlan` erzeugt heute alle Spiele beim Start. Noch nicht
  feststehende Teilnehmer sind Platzhalter (`GROUP_RANK`, `MATCH_WINNER`), die
  `resolve-completed-group.ts` und `update-tournament-progress.ts` auflösen.
- Das Schweizer System ist damit nicht abbildbar: Paarungen einer Folgerunde
  hängen von Ergebnissen ab. Neu ist deshalb die **Paarung Runde für Runde**
  (ADR 0021).
- `tournament_participants.player_id` verweist auf `players` derselben
  Organisation. Das bleibt so; Gastspieler sind gewöhnliche `players`-Zeilen.
- Scoring, Scheiben, Tablets, Live-Ansicht, Beamer, Rückzug, Walkover und
  Resultatkorrektur (`POST …/tournaments/:id/result-corrections`) bestehen und
  werden weiterverwendet.

## Datenmodell (Migration `0037_club_duel`)

### `players`

- `kind varchar(10) not null default 'MEMBER'`, Check `in ('MEMBER', 'GUEST')`
- `guest_club_name varchar(120)`, Check: `kind = 'GUEST'` ⇔
  `guest_club_name` gesetzt und nicht leer
- Check: `kind = 'GUEST'` ⇒ `user_id is null`
- Spielerliste zeigt standardmässig nur `MEMBER`; Filter «Gastspieler
  anzeigen».

### `tournaments`

- `format`-Check um `CLUB_DUEL` erweitert
- `status`-Check um `FINAL_ROUND` erweitert; Quali läuft unter
  `GROUP_STAGE`, Final unter `KNOCKOUT`
- `side_a_name varchar(120)`, `side_b_name varchar(120)`
- `qualifying_rounds integer`, Check 1–15
- `final_round_size integer`, Check 2–6
- `third_place_match boolean not null default true`
- Check: `format = 'CLUB_DUEL'` ⇔ `side_a_name`, `side_b_name`,
  `qualifying_rounds`, `final_round_size` alle gesetzt
- `group_count`, `qualify_per_group`, `knockout_size` erhalten bei
  `CLUB_DUEL` die neutralen Werte 1 / 1 / 2. Die bestehenden Constraints
  bleiben unverändert.

### `tournament_participants`

- `side char(1)`, Check `side is null or side in ('A', 'B')`
- Service erzwingt: bei `CLUB_DUEL` Pflicht, sonst null.

### `tournament_stages`

- `type`-Check um `CLUB_SWISS` und `CLUB_CROSS_ROUND_ROBIN` erweitert

### `tournament_matches`

- Neuer Platzhaltertyp in `participant_one_ref` / `participant_two_ref`:
  `{ "type": "SIDE_RANK", "stageKey": string, "side": "A" | "B", "rank": number }`
- Unique-Index `(stage_id, round, participant_one_id)` und
  `(stage_id, round, participant_two_id)` (partiell: Teilnehmer nicht null).
  Sie fangen nur Doppel in derselben Spalte ab; dass niemand in einer Runde
  einmal als Teilnehmer eins und einmal als Teilnehmer zwei steht, prüft der
  Service innerhalb der `FOR UPDATE`-Transaktion vor dem Einfügen
  (`CLUB_DUEL_DUPLICATE_IN_ROUND`), und die Engine garantiert es per Test.
- Pausen werden nicht als Matches gespeichert, sondern abgeleitet
  (aktive Teilnehmer ohne Match in der Runde). Kein `BYE`, das Quoten
  verfälscht.
- «A gegen B» prüft der Service (Seite liegt in `tournament_participants`)
  und meldet sonst `CLUB_DUEL_SAME_SIDE_PAIRING`; zusätzlich
  Integrationstest.

## Engine (`packages/tournament-engine/src/club-duel.ts`)

Reine, deterministische Funktionen, keine Infrastruktur.

### `planClubDuel(input)`

- Phasen `qualifying` (CLUB_SWISS), `final-round` (CLUB_CROSS_ROUND_ROBIN),
  `final` (SINGLE_ELIMINATION)
- Quali-Runde 1 nach Seed: Beim grösseren Verein pausieren die Spieler mit
  den höchsten Seed-Nummern; die übrigen werden der Seed-Reihenfolge nach
  gegeneinander gesetzt (Seed-Rang i von A gegen Seed-Rang i von B).
- Finalrunde: N×N Spiele, `SIDE_RANK(qualifying, A, i)` gegen
  `SIDE_RANK(qualifying, B, j)`, als N Runden so angeordnet, dass jeder pro
  Runde genau einmal spielt. Runde r (1…N), Spieler A_i (i = 1…N) trifft
  B_j mit j = ((i + r − 2) mod N) + 1. Runde 1 ist damit A1–B1, A2–B2, …
- Final: `SIDE_RANK(final-round, A, 1)` gegen `SIDE_RANK(final-round, B, 1)`;
  optional Platz 3 mit Rang 2 gegen Rang 2
- Validierung: jede Seite ≥ `finalRoundSize`, Runden 1–15, keine Duplikate,
  jede Seite nicht leer → sonst `TournamentValidationError`
  (`CLUB_DUEL_SIDE_TOO_SMALL`, `INVALID_CLUB_DUEL_ROUNDS`,
  `DUPLICATE_PARTICIPANT`)

### `pairClubSwissRound(input)`

Eingabe: aktive Teilnehmer je Seite, bisherige Spiele der Quali, Pausen
bisher, Rundennummer.

1. **Pausen** nur beim Verein mit mehr aktiven Spielern, Anzahl = Differenz.
   Es pausieren die mit den wenigsten bisherigen Pausen; bei Gleichstand wer
   mehr Spiele hat, dann der höhere Seed.
2. **Paarung als Zuordnungsproblem** (ungarischer Algorithmus, O(n³)):
   Kosten = |Rang A − Rang B| (Rang = aktuelle Rangliste je Verein) plus
   hoher Strafwert je Wiederholung. Findet immer die beste wiederholungsfreie
   Paarung, sofern es eine gibt.
3. Wiederholungen nur, wenn unvermeidbar, minimal; als `warnings`
   zurückgegeben.

Ausgabe: Paarungen (Seite A, Seite B, Position), Pausierende, Warnungen.

### `calculateClubStandings(input)`

Gesamtrangliste und Rangliste je Verein. Kriterien: Siegquote → Legdifferenz
pro Spiel → gewonnene Legs pro Spiel → Seed. Walkover zählt als Sieg für den
Gegner, ohne Legs (wie Gruppen heute). Spieler ohne Spiel (möglich bei einer
einzigen Quali-Runde) stehen hinter allen mit Spiel, untereinander nach Seed.

### `calculateCrossRoundStandings(input)`

Je Verein: Siege → Legdifferenz → Quali-Rang.

### `calculateClubScore(matches)`

Punkte und Legdifferenz je Verein, Stand `A_LEADS` | `B_LEADS` | `TIED`.
Invariante: Summe Punkte = Anzahl abgeschlossener Spiele (inkl. Walkover).

### `previewClubDuel(input)`

Spiele total und je Phase, Spiele pro Spieler (min/max je Verein),
geschätzte Dauer bei gegebener Scheibenzahl (Annahme pro Spiel aus
`bestOfLegs`, wie bestehende Vorschau).

## API und Ablauf

### Erstellen – `POST /api/v1/tournaments` (`tournament:create`)

- Zod-Schema in `packages/schemas` als discriminated union nach `format`.
- Zweig `CLUB_DUEL`: `sideAName`, `sideBName`, `qualifyingRounds`,
  `finalRoundSize`, `thirdPlaceMatch`, `participants: [{ playerId, side }]`.
- Serverprüfung: alle Spieler gehören zur `organizationId` des Aufrufers,
  sind aktiv, nicht doppelt; jede Seite ≥ `finalRoundSize`.

### Gastspieler – `POST /api/v1/players/guests` (`player:create`)

- `{ commandId, clubName, names: string[] }`, 1–64 Namen, je 1–255 Zeichen
- Eine Transaktion, ein Audit-Eintrag; gleicher `commandId` erzeugt keine
  Duplikate.

### Folgerunde (automatisch, `update-tournament-progress.ts`)

Wird das letzte offene Spiel einer Quali-Runde abgeschlossen (gespielt,
Walkover oder Rückzug über `apply-withdrawal-propagation.ts`), in derselben
Transaktion:

```text
SELECT tournament FOR UPDATE
Rangliste berechnen → pairClubSwissRound
tournament_matches einfügen (READY)
tournaments.version + 1
Audit tournament.round_paired (Paarungen, Pausen, Warnungen)
Outbox-Event → Realtime nach Commit
```

Nach der letzten Quali-Runde: `SIDE_RANK` der Finalrunde auflösen, Status
`FINAL_ROUND`. Nach der Finalrunde: Final und Platz 3 auflösen, Status
`KNOCKOUT`. Nach dem Final: `COMPLETED`.

`calculateTournamentLifecycle` wird um `CLUB_DUEL` erweitert.

### Resultatkorrektur

Bestehender Korrekturweg. Bei `CLUB_DUEL` abgelehnt mit 409
`CLUB_DUEL_ROUND_ALREADY_PAIRED`, sobald die Phase nach dem Spiel feststeht:

- Quali-Runde 1 bis n−1: wenn die Folgerunde gepaart ist. Weil die Paarung
  beim letzten Spiel der Runde sofort erfolgt, heisst das praktisch: Ein
  Quali-Resultat ist nur korrigierbar, solange die Runde noch offene Spiele
  hat.
- Letzte Quali-Runde: wenn die `SIDE_RANK`-Platzhalter der Finalrunde
  aufgelöst sind.
- Finalrunde: wenn Final oder Platz 3 aufgelöst sind.
- Final und Platz 3: korrigierbar wie heute, solange das Turnier nicht
  gelöscht ist.

### Lesen

- `GET /api/v1/tournaments/:id` liefert zusätzlich `clubDuel`:
  Gesamtrangliste, Ranglisten je Verein, Pausierende der laufenden Runde,
  Rangliste der Finalrunde, Vereinswertung.
- Gleicher Block über die öffentliche Route (`publicId`, nur `PUBLIC`) und den
  Anzeigeschlüssel (Beamer).

### Fehlercodes

`CLUB_DUEL_SIDE_TOO_SMALL`, `CLUB_DUEL_SIDE_REQUIRED`,
`CLUB_DUEL_SAME_SIDE_PAIRING`, `CLUB_DUEL_DUPLICATE_IN_ROUND`,
`CLUB_DUEL_ROUND_ALREADY_PAIRED`, `INVALID_CLUB_DUEL_ROUNDS`.

## UI (`apps/web`)

Keine Turnierlogik im Frontend.

### Erstellen

- Formatkachel «Vereinsduell»
- Schritt «Vereine»: eigener Verein (vorbelegt mit Organisationsname),
  Gastverein
- Schritt «Spieler»: Spalten A | B (mobil untereinander mit Umschalter);
  «Gastspieler erfassen» als Textfeld (ein Name pro Zeile); frühere
  Gastspieler mit gleichem Vereinsnamen werden vorgeschlagen
- Schritt «Modus»: Runden, Grösse der Finalrunde, Platz 3, Spielmodus (ein
  Modus für das Turnier, wie heute), Live-Vorschau (Spiele, Spiele pro
  Person, Dauer)
- React Hook Form + Zod-Schema aus `packages/schemas`

### Turnieransicht (Leitung und öffentlich)

- Banner Vereinswertung («VFC 21 : 15 DC Musterdorf»), live
- Tab Runden: aktuelle Runde mit Paarungen und Scheiben, «Pausieren: …»;
  frühere Runden aufklappbar
- Tab Rangliste: Umschalter Gesamt | Verein A | Verein B; Rang, Name, Verein,
  Spiele, Siege, Quote, Legdifferenz pro Spiel; Finalrunden-Plätze markiert
- Tab Finalrunde: Kreuztabelle N×N (Zeilen A, Spalten B) mit Resultaten,
  Rangliste der Finalrunde, danach Final und Platz 3

### Beamer

Vereinswertung gross, darunter laufende Spiele und nächste Runde.

### Scoring-Fläche und Scheiben-Tablet

Unverändert, Vereinskürzel neben dem Spielernamen.

### Barrierefreiheit

Vereine nie nur über Farbe; immer Kürzel oder Name. Kreuztabelle als
`<table>` mit `<th scope>`.

## Tests

### Engine (Vitest, `club-duel.spec.ts`)

- Planung 13/9, 9/13, 8/8, 4/4 (N=4), 3/9 mit N=4 abgelehnt
- Jedes geplante und gepaarte Spiel ist A gegen B
- Pausen-Rotation: 13/9 über 4 Runden – jeder A-Spieler pausiert 1–2-mal,
  niemand zweimal, bevor alle einmal; 8/8 ohne Pausen
- Schweizer Paarung: wiederholungsfrei bis zur Grenze, danach minimal mit
  Warnung; deterministisch
- Property-Test: zufällige Grössen 2–32 je Seite, zufällige Ergebnisse über
  alle Runden – nie A gegen A, niemand zweimal pro Runde, Pausen gleichmässig
- Ranglisten: jedes Kriterium einzeln, Walkover, Rückzug
- Finalrunde: N×N vollständig, jeder einmal pro Runde, Gleichstände über
  Quali-Rang
- Vereinswertung: Summe = abgeschlossene Spiele, Legdifferenz, `TIED`

### API (Integration, Testcontainers)

- Ganzer Ablauf 13/9 bis `COMPLETED` mit korrekter Vereinswertung
- Parallel abgeschlossene letzte Spiele einer Runde → genau eine Folgerunde,
  ein Audit-Eintrag
- Korrektur nach Paarung → 409 `CLUB_DUEL_ROUND_ALREADY_PAIRED`
- Rückzug in der Quali und vor der Finalrunde (Seite unter N)
- Gastspieler: Idempotenz über `commandId`; DB-Check `GUEST` ⇒ kein Konto
- Mandantentrennung: Spieler fremder Organisation abgelehnt; neue Routen in
  der Isolationsmatrix
- Öffentliche Route bei `PRIVATE` → 404
- Realtime-Event nur nach Commit, nicht bei Rollback

### E2E (Playwright, ein Worker)

Vereinsduell 5/4 mit Gastspieler-Schnellerfassung anlegen, eine Runde
durchspielen, Folgerunde und Banner der Vereinswertung erscheinen.

## Dokumentation

- ADR 0021 «Vereinsduell: Paarung Runde für Runde»
- README-Abschnitt Vereinsduell
- Isolationsmatrix ergänzt

## Datenschutz

Gastspieler sind Personendaten eines anderen Vereins, die in der eigenen
Organisation gespeichert werden. Ob Datenschutzerklärung (Fassung 1.0) und
Löschkonzept (ADR 0018) das abdecken, prüft die zuständige Stelle vor dem
Produktiveinsatz. Diese Spec trifft dazu keine Aussage.

## Nicht im Umfang

- Turniere über zwei Organisationen
- Mehr als zwei Vereine
- Doppel/Teams als Teilnehmer
- Manuelles Umpaaren einer gepaarten Runde
- Spielmodus je Phase (heute gibt es einen Modus pro Turnier; eine Änderung
  beträfe alle Formate und bekäme ein eigenes ADR)
