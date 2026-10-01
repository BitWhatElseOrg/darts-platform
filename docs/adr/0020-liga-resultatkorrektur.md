# ADR 0020: Korrektur von Liga-Resultaten

**Status:** Accepted
**Datum:** 1. Oktober 2026

## Kontext

Der Undo nach Match-Ende (PR #92, `reopenEncounterSlotForMatch`) nimmt die
letzte Aufnahme eines Liga-Spiels zurück und öffnet dessen Slot mit, solange
die Begegnung noch `RUNNING` ist. An der abgeschlossenen Begegnung endet
dieser Weg: Der Undo lehnt mit `ENCOUNTER_RESULT_REQUIRES_CORRECTION` ab,
sobald die Begegnung `COMPLETED` ist oder ein Entscheidungsdoppel bereits
angesetzt, gespielt oder kampflos gewertet wurde — Resultat und Punkte gelten
dort als festgeschrieben. Einen Korrekturweg dafür gab es nicht, obwohl
Turniere ihn seit je besitzen (`POST …/tournaments/:id/result-corrections`,
`MatchesRepository.correctTournamentResult`): letzte Aufnahme per
`UNDO_LAST_VISIT` zurücknehmen, Leg wieder öffnen, Projektion und Version
fortschreiben, Outbox und Audit schreiben. Spec
`docs/superpowers/specs/2026-10-01-liga-resultatkorrektur-design.md` überträgt
diesen Mechanismus auf die Begegnung.

## Entscheidung

- **Wiedereröffnen statt Eintragen.** Eine Korrektur trägt kein Resultat
  direkt ein. Sie öffnet Begegnung, Slot und Match wieder und lässt das Spiel
  neu scoren — derselbe Weg wie bei der Turnier-Korrektur. Verworfen: ein
  Formular, das Sätze oder Beine direkt überschreibt — das umginge die
  Scoring Engine und könnte ein Resultat erzeugen, das kein gültiger
  Dartverlauf je ergeben hätte.
- **Umfang: jedes gespielte Spiel einer abgeschlossenen Begegnung**, mit
  einer Ausnahme nach Reglement 2.2.2 und A1.4: Bei 9:9 entscheidet ein
  Entscheidungsdoppel (sudden death) mit Zusatzpunkt, und dieses Doppel baut
  auf dem Stand der regulären Spiele auf. Ist es angesetzt (`IN_PROGRESS`), gespielt
  (`COMPLETED`) oder kampflos gewertet (`WALKOVER`), muss zuerst das Doppel
  selbst korrigiert werden (`DECIDER_CORRECTION_REQUIRED`) — sonst stünde ein
  Entscheidungsdoppel neben regulären Spielen, deren Korrektur seinen eigenen
  Ausgangspunkt in Frage stellt. Walkover und Forfait sind ausgenommen: Sie
  sind ein Entscheid am grünen Tisch, kein Spielresultat, und haben keinen
  Match zum Wiedereröffnen.
- **Recht `encounter:manage`**, wie Start, Walkover, Forfait und Absage einer
  Begegnung. Kein `@AllowDevice()`: Ein Scheiben-Tablet (ADR 0019) darf
  scoren, aber nicht korrigieren — dieselbe Grenze wie beim Undo nach
  Match-Ende.
- **Sperrreihenfolge Encounter → EncounterSlot → Match → Board → Players**,
  wie Undo und `assignSlot`. Jede Prüfung aus der Voraussetzungstabelle der
  Spec läuft unter dieser Sperre, vor dem ersten Schreibzugriff; trifft eine
  nicht zu, wird nichts geschrieben.
- **Audit und Outbox erst nach der Transaktion sichtbar**, wie überall:
  `ENCOUNTER_RESULT_CORRECTED` im Outbox (encounterId, slotId, matchId,
  commandId, Zielversion) und im Audit (`oldValue` = altes Resultat von
  Begegnung und Slot, `newValue` = neuer Zustand mit Korrekturgrund).
  `ENCOUNTER_SLOT_REOPENED` und die Match-seitigen Einträge
  (`UNDO_LAST_VISIT`, `score_commands`) entstehen in derselben Transaktion.
- **Gemeinsame Match-Wiedereröffnung mit der Turnier-Korrektur.** Was
  `correctTournamentResult` für das Match tat, war bisher an die
  Tournament-Engine gebunden. Für die Liga-Korrektur wird dieser Teil in zwei
  private Hilfsmethoden gezogen, `MatchesRepository.planResultReopen` (liest:
  letzte Aufnahme, Leg, ob überhaupt rücknehmbar) und
  `MatchesRepository.applyResultReopen` (schreibt: `UNDO_LAST_VISIT`, Leg
  wieder `IN_PROGRESS`, `syncProjection`, `score_commands`-Eintrag,
  Match-Version) — beide Aufrufer teilen sich dieselbe Logik statt einer
  Kopie. Ebenso wird `reopenEncounterSlotForMatch` (PR #92) aufgeteilt: Die
  Prüfung «Begegnung läuft noch» bleibt beim Undo-Pfad, die eigentliche
  Slot-Wiedereröffnung steht jetzt als eigene Funktion
  `reopenPlayedEncounterSlot` bereit, die auch die Korrektur nutzt, ohne diese
  Prüfung zu wiederholen (sie hat die Begegnung ja gerade erst selbst auf
  `RUNNING` gesetzt).
- **Migration 0036 erweitert `encounter_commands_type_check`** um den Wert
  `CORRECT_ENCOUNTER_RESULT` (zusätzlich zu den sieben bestehenden
  Begegnungskommandos). Die Korrektur läuft wie jedes andere
  Begegnungskommando über `encounter_commands`: `commandId` sichert
  Idempotenz, `expectedVersion` die Zielversion der Begegnung.
- **Punkte gehen bei Wiedereröffnung auf 0.** `encounters.home_points` und
  `encounters.away_points` sind `NOT NULL` — ein Nullwert für «noch kein
  Resultat» gibt es dort nicht, anders als bei `result`/`result_type`, die
  gemeinsam leer werden dürfen (`encounters_completed_result_check`,
  `encounters_result_pair_check`). 0:0 ist unschädlich, weil Tabelle und
  Einzelrangliste (`CompetitionsService.standings`, League-Engine) nur
  `COMPLETED`-Begegnungen auswerten; eine wieder geöffnete Begegnung
  (`RUNNING`) fällt automatisch aus der Wertung, bis
  `updateEncounterProgress` sie nach dem nächsten Checkout erneut
  abschliesst und die Punkte aus dem neuen Resultat herleitet.
- **Bewusste Abweichung vom Reglement (AGENTS.md §6).** Reglement 2.4.1 sagt,
  ein von beiden Captains unterschriebener Spielrapport sei gültig und könne
  nicht mehr angefochten werden; Reglement 2.6.1 sieht dafür den Protest beim
  Sportkoordinator des VFC vor, einzureichen innert der dort gesetzten Frist.
  Diese Korrektur ist kein Protestentscheid und ersetzt keinen der beiden
  Wege: Sie ist eine auditierte Erfassungskorrektur durch den Verein (Tenant)
  selbst — der elektronische Spielbericht wird berichtigt, nicht neu
  verhandelt. Spielrapport-Unterschrift (2.4.1) und Protestfrist (2.6.1)
  bleiben Sache des VFC beziehungsweise der Captains; jede Korrektur trägt
  ihren Grund im Audit nachvollziehbar nach. Eine eigene zeitliche
  Begrenzung setzt die Plattform dafür bewusst nicht (siehe «Bekannte
  Grenzen»).

## Verworfen

- **Direktes Eintragen eines Resultats ohne Neu-Scoren.** Schneller, aber
  ausserhalb der Scoring Engine — ein Resultat liesse sich eintragen, das aus
  keiner gültigen Dart-Folge entstehen kann, und Statistik/Aufnahmen blieben
  inkonsistent zum behaupteten Ergebnis.
- **Eigener Korrekturmechanismus für Liga-Matches**, getrennt von
  `correctTournamentResult`. Verworfen zugunsten der gemeinsamen
  `planResultReopen`/`applyResultReopen`-Hilfsmethoden: beide Domänen
  korrigieren an derselben Stelle im Match (letzte Aufnahme, Leg), nur das
  Drumherum (Begegnung vs. Turniermatch/Tournament) unterscheidet sich.

## Folgen

- **Tabelle und Einzelrangliste bleiben live korrekt**, ohne eigenen
  Korrekturschritt an ihnen: Beide rechnet die League-Engine bei jeder
  Abfrage aus den Begegnungen und Matches, eine `RUNNING`-Begegnung fällt
  automatisch heraus und kommt mit dem neuen Resultat automatisch zurück.
- **Statistik bleibt idempotent.** Der Worker baut sie beim erneuten
  `MATCH_COMPLETED`-Event aus dem neuen Spielstand neu auf; kein separater
  Korrekturpfad in `packages/statistics` nötig.
- **Walkover und Forfait sind nicht korrigierbar** — sie haben kein Match und
  keine Aufnahmen zum Wiedereröffnen. Eine falsch gewertete Begegnung dieser
  Art bleibt vorerst Handarbeit (Absage und Neuansetzung oder manuelle
  Rücksprache).
- **Bekannte Grenzen:**
  - Walkover und Forfait sind nicht korrigierbar (siehe oben).
  - Ein gespielter oder per Walkover entschiedener Decider sperrt die
    Korrektur der regulären Spiele, bis der Decider selbst korrigiert ist.
    War der Decider ein Walkover, ist diese Sperre dauerhaft: Ein
    Walkover-Decider lässt sich nicht korrigieren, also lässt sich auch kein
    reguläres Spiel dieser Begegnung mehr korrigieren.
  - Keine zeitliche Begrenzung der Korrektur — eine Begegnung bleibt
    beliebig lange nach Spielende korrigierbar.
  - Ist die Scheibe des Matches nicht mehr `AVAILABLE` (zum Beispiel
    stillgelegt), ist das Spiel nicht korrigierbar — die Korrektur öffnet das
    Match auf derselben Scheibe wieder und kann es nicht auf eine andere
    verlegen.
  - Nach der Korrektur ist die Scheibe belegt (`IN_USE`), bis neu gescort
    oder das Spiel freigegeben beziehungsweise abgebrochen wird. Ein
    Scheiben-Tablet an dieser Scheibe übernimmt das wieder geöffnete Spiel
    automatisch (ADR 0019).
- **Nicht umgesetzt:** direktes Eintragen eines Resultats ohne Neu-Scoren,
  Korrektur von Walkover/Forfait, zeitliche Begrenzung der Korrektur (alle
  drei bewusst ausserhalb dieser Spec, siehe «Nicht Teil dieser Spec»).
