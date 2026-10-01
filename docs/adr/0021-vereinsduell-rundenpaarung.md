# ADR 0021: Vereinsduell – Paarung Runde für Runde

**Status:** Accepted
**Datum:** 1. Oktober 2026

## Kontext

Alle bisherigen Turnierformate (`ROUND_ROBIN`, `GROUPS_THEN_KNOCKOUT`,
`SINGLE_ELIMINATION`) planen beim Start alle Spiele; noch nicht feststehende
Teilnehmer sind Platzhalter (`GROUP_RANK`, `MATCH_WINNER`), die
`resolve-completed-group.ts` und `update-tournament-progress.ts` auflösen. Ein
Schweizer System lässt sich so nicht abbilden: Die Paarungen einer Folgerunde
hängen von den Ergebnissen der vorherigen ab und müssen deshalb Runde für Runde
entstehen.

Für Freundschaftsturniere Verein gegen Verein gilt zudem: Jedes Spiel ist ein
Spieler von Verein A gegen einen von Verein B, in jeder Phase bis und mit
Final, bei ungleicher Spielerzahl (Beispiel 13 gegen 9). Ein K.-o.-Baum kann
das nicht garantieren: Gewinnen alle Spieler von A, bleiben am Ende nur A-Spieler
übrig. Spec: `docs/superpowers/specs/2026-10-01-vereinsduell-design.md`.

## Entscheidung

Neues Format `CLUB_DUEL` mit drei Phasen: Qualifikation im Schweizer System
(`CLUB_SWISS`), Kreuz-Finalrunde der besten N je Verein
(`CLUB_CROSS_ROUND_ROBIN`), danach Final A1 gegen B1 und optional Spiel um
Platz 3 (`SINGLE_ELIMINATION`). Engine: `packages/tournament-engine/src/club-duel.ts`.

- **Paarung in der Transaktion des letzten Rundenspiels.**
  `advance-club-duel.ts` läuft innerhalb von `updateTournamentProgress`. Die
  Turnierzeile wird `FOR UPDATE` gesperrt, bevor offene Spiele gezählt werden;
  parallel abgeschlossene letzte Spiele erzeugen so genau eine Folgerunde.
  Danach: Spiele einfügen, `tournaments.version` erhöhen, Audit und Outbox
  `TOURNAMENT_ROUND_PAIRED` in derselben Transaktion. Realtime sendet erst
  nach dem Commit.
- **Zuordnungsproblem statt Greedy.** `pairClubSwissRound` löst die Paarung mit
  dem ungarischen Algorithmus (O(n³), deterministisch). Kosten:
  Rangabstand |Rang A − Rang B| plus Strafkosten je Wiederholung. Das findet
  immer die beste wiederholungsfreie Paarung, sofern eine existiert; ein
  Greedy-Verfahren kann sich in eine Sackgasse paaren. Wiederholungen nur,
  wenn unvermeidbar, minimal und als `warnings` zurückgegeben.
  - **Strafwert n²+1 statt fester Konstante.** Das Schema erlaubt bis zu 256
    Teilnehmer, eine Seite kann also über 140 Spieler haben. Eine feste Strafe
    (10 000) würde dann von der Summe der Rangabstände überboten und
    «Wiederholungen zuerst vermeiden» verlieren. n²+1 liegt immer über jeder
    möglichen Rangabstandssumme.
- **Pausen abgeleitet, nicht gespeichert.** Es pausieren Spieler nur beim
  Verein mit mehr aktiven Spielern, Anzahl = Differenz; wer bisher am
  wenigsten pausiert hat, zuerst. Pausen sind aktive Teilnehmer ohne Match in
  der Runde, kein `BYE`-Match, der Quoten verfälschen würde.
- **`SIDE_RANK`-Platzhalter** `{ type: "SIDE_RANK", stageKey, side, rank }`,
  analog `GROUP_RANK`: Finalrunde und Final werden beim Start angelegt und
  nach Abschluss der Vorphase aufgelöst.
- **Quali-Rangliste mit Quoten.** Siegquote → Legdifferenz pro Spiel →
  gewonnene Legs pro Spiel → Seed. Jedes Spiel hat genau einen Spieler je
  Seite; bei 13 gegen 9 spielen B-Spieler im Schnitt öfter, Punkte wären
  unfair. Seed statt Los, weil er gespeichert und damit reproduzierbar ist.
- **Vereinswertung berechnet, nicht gespeichert.** 1 Punkt je gewonnenem Spiel
  (inkl. Walkover) über alle Phasen, Gleichstand → Legdifferenz →
  unentschieden. `calculateClubScore` rechnet bei jeder Abfrage; es gibt keinen
  Zähler, der von den Spielen abweichen könnte.
- **Gastspieler als `players.kind = 'GUEST'`** in der eigenen Organisation, mit
  `guest_club_name`, ohne Konto (DB-Check: `GUEST` ⇒ `user_id is null`).
  Erfassung über `POST /api/v1/players/guests` (idempotent über `commandId`).
  Die HTTP-Spielerliste zeigt standardmässig nur Mitglieder; `?kind=GUEST` oder
  `?kind=ALL` blenden Gastspieler ein. Kein organisationsübergreifendes Turnier.
- **Korrektur-Sperre nach Paarung.** `club-duel-correction-lock.ts` lehnt die
  bestehende Resultatkorrektur mit 409 `CLUB_DUEL_ROUND_ALREADY_PAIRED` ab,
  sobald die Phase nach dem Spiel feststeht (Folgerunde gepaart,
  Finalrunde besetzt beziehungsweise Final aufgelöst). Die Prüfung läuft unter
  derselben Turniersperre, damit zwischen Prüfung und Korrektur keine Paarung
  entsteht. Final und Platz 3 bleiben korrigierbar.
- **Vorschau** über eigene Route `POST …/tournaments/club-duel-preview`. Die
  klassische Strukturvorschau akzeptiert `CLUB_DUEL` bewusst nicht (400).
- **Lesepfad:** `club-duel-projection.ts` liefert den Block `clubDuel`
  (Ranglisten, Pausierende, Finalrunde, Vereinswertung) im Turnier-Dashboard,
  über die öffentliche Route und den Anzeigeschlüssel.

### Präzisierungen gegenüber der Spec

- **`CLUB_DUEL_SIDE_REQUIRED` entsteht nicht als eigener Code.** Das
  Request-Schema erzwingt die Seite je Teilnehmer; fehlt sie, antwortet die
  API mit dem generischen Validierungsfehler (400). Ein Laufzeitcheck wäre
  toter Code. Zusätzliche Engine-Codes (`CLUB_DUEL_SIDE_EMPTY`,
  `INVALID_CLUB_DUEL_FINAL_ROUND_SIZE`) ergänzen die Spec-Liste.
- **Seite ohne aktive Spieler beendet die Quali vorzeitig.** Hat beim Paaren
  der nächsten Quali-Runde eine Seite keinen aktiven Spieler mehr (Verein
  komplett zurückgezogen), wird die Finalrunde besetzt, fehlende Plätze
  werden Walkover. Sonst liesse sich der letzte Rückzug nicht erfassen, weil
  die Transaktion zurückrollte.
- **Begrenzter zweiter Durchgang statt Rekursion.** `advanceClubDuel` löst
  Phasenübergänge in höchstens zwei Durchgängen; bleibt danach etwas offen,
  wirft es einen Invariantenfehler. Die Terminierung hängt so nicht an einer
  Datenannahme.
- **Bei Sätzen darf der Sieger gleich viele oder weniger Legs haben.** Die
  Ergebnisprüfung für die Ranglisten verlangt nur Legs ≥ 0 und Sieger ∈
  Spielerpaar, nicht die Legmehrheit. Eine strengere Prüfung würde bei
  Best-of-Sets den letzten Checkout zurückrollen. Der Sieger kommt weiterhin
  aus der Scoring Engine; inkonsistente Legs aus fehlerhaften Daten flössen
  ungeprüft in die Legdifferenz.
- **Lesepfad degradiert statt auszufallen.** Wirft `projectClubDuel`, wird der
  Fehler mit der Turnier-ID geloggt und `clubDuel: null` geliefert statt
  HTTP 500. Ein Datenfehler darf nicht alle Zuschauer aussperren; er bleibt im
  UI unsichtbar, ausser im Log.

## Verworfen

- **Encounter-Modell (Liga).** Es bildet Mannschaftsbegegnungen mit
  Aufstellung nach Reglement ab, nicht Einzelspiele zwischen Vereinen.
- **Vorab-Auslosung aller Runden.** Schweizer Paarungen hängen von
  Ergebnissen ab; eine feste Auslosung wäre kein Schweizer System.
- **Getrennte K.-o.-Bäume je Verein.** Das Final wäre A gegen A oder B gegen
  B, nicht Verein gegen Verein.
- **Turnier über zwei Organisationen.** Bräuchte Cross-Tenant-Zugriff und
  bricht die Tenant-Isolation; Gastspieler in der eigenen Organisation sind
  einfacher und isolationsneutral.

## Konsequenzen

- **Quali-Resultate sind nur korrigierbar, solange die Runde noch offene
  Spiele hat**, weil die Folgerunde sofort beim letzten Spiel gepaart wird.
  Ein manuelles Umpaaren einer gepaarten Runde gibt es nicht.
- **Neue Migration `0037_club_duel`** (Spalten und Checks an `players`,
  `tournaments`, `tournament_participants`, `tournament_stages`,
  `tournament_matches`, Unique-Indizes je Runde und Teilnehmerspalte). «A gegen
  B» und «niemand doppelt in einer Runde» prüft der Service in der
  `FOR UPDATE`-Transaktion.
- **Gastspieler sind Personendaten eines anderen Vereins**, gespeichert in der
  eigenen Organisation. Ob Datenschutzerklärung (Fassung 1.0) und
  Löschkonzept (ADR 0018) das abdecken, ist offen und von der zuständigen
  internen Stelle (Legal/Datenschutz) vor dem Produktiveinsatz zu prüfen. Dieses ADR
  trifft dazu keine Aussage.
- **Nicht im Umfang:** mehr als zwei Vereine, Teams als Teilnehmer, Spielmodus je
  Phase.
- **Plan 2 (Web)** folgt: Erstellen, Turnieransicht, Beamer. Bis dahin ist das
  Format nur über die API nutzbar.
