# Spec: Karenz für die Board-Steuerung und Löschen von Turnieren

Stand: 25.09.2026. Befunde 5 und 7 aus dem
[Probelauf 16 Spieler](../../testing/protokolle/2026-09-25-probelauf-16-spieler.md).

## Befund 5: Ein zweites Gerät übernimmt die Steuerung beim blossen Öffnen

**Beobachtet:** Die Scoringfläche beansprucht beim Öffnen die Board-Steuerung
(`POST …/controller-lease`, `force: false`) und hält sie per Heartbeat alle 3 s.
Die Lease gilt 10 s. Sobald das Scorer-Gerät länger als 10 s keinen Heartbeat
schickt (Sperrbildschirm, Tab im Hintergrund), gilt die Lease als frei, und ein
Gerät, das «nur schaut», übernimmt sie stillschweigend. Der Scorer bekommt
danach bei jeder Aufnahme `BOARD_CONTROLLER_CONFLICT`.

**Entscheid:** Eine abgelaufene Lease eines *anderen* Controllers gilt fünf
Minuten lang als «kurz verlassen». Ohne `force` darf sie in dieser Karenz
niemand übernehmen; die Antwort ist `owned: false` mit dem bisherigen
Controller, die Fläche zeigt wie bisher «Ein anderes Gerät steuert dieses
Board» mit «Steuerung übernehmen». Nach der Karenz gilt das Board als
verlassen und der nächste Anspruch ohne `force` erhält es. Der bisherige
Controller erhält seine Lease jederzeit zurück (gleiche `controllerId`),
`force` übernimmt jederzeit und wird wie bisher auditiert.

- Konstante `LEASE_GRACE_MS = 5 * 60_000` in `matches.repository.ts`, Lease-
  Dauer bleibt 10 s, Heartbeat bleibt 3 s.
- Kein Client-Wechsel nötig: `use-board-controller-lock.ts` behandelt
  `owned: false` bereits als `FREMD`.
- Warum fünf Minuten: ein Scorer bedient das Gerät während eines Legs alle
  20–40 s, eine Diskussion am Board dauert selten länger; wer wirklich weg
  ist, wird nach fünf Minuten überstimmt, und «Steuerung übernehmen» steht
  jederzeit als bewusster Weg offen.

**Verworfen:** Kein Anspruch beim Öffnen, erst bei der ersten Eingabe – hätte
das Problem nur auf den ersten Tastendruck verschoben. Lease-Dauer
verlängern – hätte ein wirklich verlassenes Board länger blockiert, ohne
das Verhalten des Zuschauers zu ändern.

## Befund 7: Turniere lassen sich nicht löschen

**Entscheid:** `DELETE /organizations/:organizationId/tournaments/:tournamentId`
löscht ein Turnier, in dem **nichts gespielt wurde**: kein Turniermatch mit
Status `COMPLETED` (gespielt oder Walkover) und kein Turniermatch mit
verknüpftem Scoring-Match (`IN_PROGRESS`). Freilose (`BYE`) zählen nicht als
gespielt. Sonst antwortet der Server mit 409 `TOURNAMENT_HAS_RESULTS`.

- Permission `tournament:delete` für `OWNER`, `ADMIN` und
  `TOURNAMENT_DIRECTOR` – wer Turniere anlegen darf, darf ein versehentlich
  angelegtes wieder entfernen; gelöscht wird nur, was keine Historie hat
  (Löschkonzept ADR 0018, gleiche Linie wie `player:delete`).
- Löschen in einer Transaktion: `delete(tournaments)` – jede Turniertabelle
  trägt `onDelete: "cascade"` auf `tournaments.id`, Boards werden über
  `tournament_boards` nur entkoppelt. Audit `TOURNAMENT_DELETED` mit Name,
  Format, Teilnehmer- und Matchzahl in `oldValue`.
- Kein `expectedVersion`, kein Bestätigungsname: es geht nichts verloren, was
  nicht in Sekunden neu angelegt wäre. Die Oberfläche fragt per
  `ConfirmDialog` nach.
- Web: Abschnitt «Turnier löschen» am Ende der Kommandozentrale, nur mit
  `tournament:delete`. Sobald ein Ergebnis vorliegt oder ein Match läuft,
  ist der Knopf gesperrt und der Hinweis nennt den Grund. Nach dem Löschen
  zurück zur Turnierliste.
- Ein Turnier **mit** Ergebnissen bleibt bewusst unlöschbar: Statistik,
  Spielerhistorie und Audit hängen daran. Wer ein solches Turnier loswerden
  muss, löscht die Organisation (ADR 0018) oder lebt mit dem Eintrag. Ein
  Archiv-Status wäre die nächste Ausbaustufe, nicht Teil dieser Spec.
