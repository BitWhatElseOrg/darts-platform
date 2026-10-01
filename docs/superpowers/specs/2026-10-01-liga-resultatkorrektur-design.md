# Spec: Korrektur von Liga-Resultaten

Stand: 01.10.2026.

## Problem

Ein falsch eingetragener Checkout in einer Liga-Begegnung lässt sich heute nur
korrigieren, solange die Begegnung noch läuft (Undo, PR #92). Der letzte
Checkout, der eine Begegnung abschliesst, und jedes Spiel einer bereits
abgeschlossenen Begegnung sind nicht korrigierbar: Der Undo lehnt mit
`ENCOUNTER_RESULT_REQUIRES_CORRECTION` ab, und einen Korrekturweg gibt es
nicht. Turniere haben ihn seit je (`POST …/tournaments/:id/result-corrections`,
`correctTournamentResult`).

## Ziel

Die Leitung (`encounter:manage`) öffnet ein gespieltes Spiel einer
abgeschlossenen Begegnung mit Begründung wieder. Das Match öffnet sich auf seiner
Scheibe mit zurückgenommener letzter Aufnahme, es wird neu gescort, und der
nächste Checkout schliesst Slot und Begegnung wieder ab. Tabelle und Rangliste
stimmen danach ohne weiteren Schritt.

## Entscheide (mit dem Nutzer abgestimmt)

| Frage | Entscheid |
|---|---|
| Mechanik | Wieder öffnen und neu scoren, wie bei der Turnier-Korrektur. Kein direktes Eintragen von Resultaten. |
| Umfang | Jedes gespielte Spiel einer abgeschlossenen Begegnung. Ausnahme: ein reguläres Spiel, nachdem das Entscheidungsdoppel gespielt wurde oder läuft – dann zuerst das Doppel korrigieren. Walkover und Forfait sind ausgenommen. |
| Recht | `encounter:manage` (wie Start, Walkover, Forfait, Absage). |

## Grundlage im Bestand

- Die Tabelle (`CompetitionsService.standings`) und die Einzelrangliste rechnet
  die League-Engine bei jeder Abfrage aus den Begegnungen bzw. Matches. Eine
  wieder geöffnete Begegnung (`RUNNING`, Resultat leer) fällt damit automatisch
  aus der Wertung, bis sie erneut abgeschlossen ist.
- `updateEncounterProgress` schreibt Spiele/Legs fort und setzt beim Abschluss
  Resultat, Punkte, `status = COMPLETED`, `completed_at` und das Outbox-Event
  `ENCOUNTER_COMPLETED`. Bei `COMPLETED`/`CANCELLED` kehrt es sofort zurück.
- `correctTournamentResult` (`matches.repository.ts`) zeigt den Ablauf für das
  Match: letzte Aufnahme per `UNDO_LAST_VISIT` zurücknehmen, Leg wieder öffnen,
  `syncProjection`, Version, Outbox, Audit.
- `reopenEncounterSlotForMatch` (`sync-encounter-slot.ts`, PR #92) öffnet einen
  gespielten Slot, prüft Entscheidungsdoppel und auditiert – lehnt aber bei
  abgeschlossener Begegnung ab.
- Der Undo nach Match-Ende prüft Scheibe (`isBoardOccupied`) und belegte Spieler
  (`lockPlayers`, `loadActivePlayerIds`).

## 1. API

`POST /api/v1/organizations/:organizationId/encounters/:encounterId/result-corrections`

Body (`correctEncounterResultSchema` in `packages/schemas`):

```ts
{
  commandId: uuid,
  expectedVersion: number (int ≥ 0),   // Version der Begegnung
  slotId: uuid,
  reason: string (trim, 3..500)
}
```

- Recht `encounter:manage`, über den bestehenden `command(...)`-Weg des
  `EncountersService` (Idempotenz über `encounter_commands`, Versionsprüfung der
  Begegnung, Fehlerabbildung wie bei den übrigen Kommandos).
- Antwort: die aktualisierte Begegnung (wie die anderen Encounter-Kommandos) –
  der Client findet darin den wieder laufenden Slot mit seiner `matchId`.
- Kein `@AllowDevice()`: Geräte dürfen nicht korrigieren.

## 2. Voraussetzungen

Alle Prüfungen laufen in der Transaktion, nach den Sperren, vor jedem
Schreibzugriff. Trifft eine nicht zu, wird nichts geschrieben.

| Bedingung | Fehlercode | HTTP |
|---|---|---|
| Begegnung nicht `COMPLETED` | `ENCOUNTER_NOT_CORRECTABLE` | 409 |
| Begegnung durch Forfait entschieden (`resultType = FORFEIT`; korrigierbar sind `PLAYED` und `DECIDER`) | `ENCOUNTER_NOT_CORRECTABLE` | 409 |
| Slot gehört nicht zur Begegnung | 404 | 404 |
| Slot nicht `COMPLETED` mit `resultType = PLAYED` oder ohne `matchId` | `SLOT_NOT_CORRECTABLE` | 409 |
| Match nicht `COMPLETED` oder letzte Aufnahme ist kein Leg-Gewinn | `SLOT_NOT_CORRECTABLE` | 409 |
| Regulärer Slot, Entscheidungsdoppel `IN_PROGRESS`, `COMPLETED` oder `WALKOVER` | `DECIDER_CORRECTION_REQUIRED` | 409 |
| Scheibe des Matches fehlt, nicht `AVAILABLE` oder belegt | `BOARD_UNAVAILABLE` (bestehend im EncountersService) | 409 |
| Beteiligte Person spielt an einer anderen Scheibe | `PLAYER_BUSY` (bestehend) | 409 |
| Version der Begegnung passt nicht | `ENCOUNTER_VERSION_CONFLICT` (bestehend) | 409 |

`encounters.result_type` kennt `PLAYED`, `DECIDER` und `FORFEIT`
(`encounters_result_type_check`). Die Checks `encounters_completed_result_check`
und `encounters_result_pair_check` verlangen, dass `result` und `result_type`
gemeinsam leer werden, sobald die Begegnung nicht mehr `COMPLETED` ist.

## 3. Wirkung

In einer Transaktion, Sperrreihenfolge Encounter → EncounterSlot → Match →
Board → Players (wie Undo und `assignSlot`):

1. **Begegnung:** `status = RUNNING`, `result`, `resultType`, `homePoints`,
   `awayPoints`, `completedAt` = null, `version + 1`. Die DB-Checks auf
   `encounters` (Resultat nur bei `COMPLETED`) müssen erfüllt bleiben – vor der
   Umsetzung lesen.
2. **Entscheidungsdoppel:** Ein Decider-Slot mit `status = CANCELLED`, der beim
   Abschluss als «nicht gebraucht» gestrichen wurde, geht zurück auf `WAITING`.
   Ergibt die Korrektur später wieder kein Unentschieden, streicht
   `updateEncounterProgress` ihn beim erneuten Abschluss wieder. Meldungen
   (Doppel-Aufstellung) bleiben unverändert. Wurde der Decider durch Absage oder
   Forfait gestrichen, ist die Begegnung nicht korrigierbar (siehe Tabelle).
3. **Slot:** wie `reopenEncounterSlotForMatch` – `IN_PROGRESS`, `boardId` =
   Scheibe des Matches, Resultat/Legs geleert, `version + 1`, Outbox
   `ENCOUNTER_SLOT_REOPENED`, Audit `ENCOUNTER_SLOT_REOPENED`. Die Funktion wird
   so aufgeteilt, dass der Korrekturweg die Wiedereröffnung ohne die Prüfung
   «Begegnung läuft» nutzen kann; der Undo-Pfad behält seine Ablehnung.
4. **Match:** wie in `correctTournamentResult` – letzte Aufnahme per
   `UNDO_LAST_VISIT` zurücknehmen (`commandId` der Korrektur), Folgeleg löschen,
   aktuelles Leg wieder öffnen, `syncProjection` (Match `IN_PROGRESS`, Scheibe
   `IN_USE`), `score_commands`-Eintrag, `version + 1`. Gemeinsamer Code mit der
   Turnier-Korrektur wird in eine private Hilfsmethode gezogen statt kopiert.
5. **Spiele/Legs der Begegnung** über `updateEncounterProgress` neu rechnen
   (läuft, weil die Begegnung jetzt `RUNNING` ist).
6. **Outbox** `ENCOUNTER_RESULT_CORRECTED` (encounterId, slotId, matchId,
   commandId, version) und **Audit** `ENCOUNTER_RESULT_CORRECTED` mit
   `oldValue` = altes Resultat der Begegnung und des Slots, `newValue` =
   `{ status: "RUNNING", slotId, matchId, reason }`.

Danach läuft alles wie gewohnt: Scoren am Tablet oder in der Scoringfläche,
Checkout → `completeEncounterSlotForMatch` → `updateEncounterProgress` →
Begegnung `COMPLETED` mit neuem Resultat. Statistik: Der Worker baut beim
erneuten `MATCH_COMPLETED` idempotent neu auf.

## 4. Web

- `apps/web/src/components/league/`: In der Kommandozentrale einer
  abgeschlossenen Begegnung erhält jedes gespielte Spiel einen Knopf «Resultat
  korrigieren» (nur mit `encounter:manage`). Er öffnet – nur im offenen Zustand
  gemountet – ein Feld «Korrekturgrund» (3–500 Zeichen) und «Korrektur
  starten», Muster `apps/web/src/components/tournament/results-panel.tsx`.
- Nach Erfolg zeigt die Begegnung den Slot als laufend; ein Link «Zum
  Scoreboard» öffnet die Scoringfläche des Matches (bestehende Route mit
  `?begegnung=`).
- Fehlercodes erhalten deutsche Meldungen in `api-client.ts`:
  - `ENCOUNTER_NOT_CORRECTABLE`: «Diese Begegnung lässt sich nicht korrigieren.»
  - `SLOT_NOT_CORRECTABLE`: «Dieses Spiel lässt sich nicht korrigieren.»
  - `DECIDER_CORRECTION_REQUIRED`: «Das Entscheidungsdoppel ist bereits gespielt. Korrigiere zuerst das Doppel.»
- Bei abgeschlossener Begegnung zeigt die Undo-Ablehnung
  (`ENCOUNTER_RESULT_REQUIRES_CORRECTION`) den Hinweis auf den neuen Weg:
  Meldung ergänzen um «Die Leitung kann das Resultat in der Begegnung
  korrigieren.»

## 5. Tests

- **API-Integration** (`apps/api/src/encounters/encounter-correction.integration.spec.ts`,
  Aufbau über echte Services wie `encounter-undo.integration.spec.ts`):
  - letztes Spiel korrigieren → Begegnung `RUNNING`, Slot und Match laufen,
    letzte Aufnahme zurückgenommen, Tabelle zählt die Begegnung nicht mehr;
    erneuter Checkout mit anderem Sieger → Begegnung `COMPLETED` mit neuem
    Resultat, Tabelle entsprechend.
  - früheres Spiel korrigieren (nicht das letzte).
  - Entscheidungsdoppel korrigieren; reguläres Spiel nach gespieltem Doppel →
    `DECIDER_CORRECTION_REQUIRED`; gestrichener Decider wird `WAITING` und beim
    Abschluss ohne Gleichstand wieder `CANCELLED`.
  - jede Ablehnung aus Abschnitt 2 ändert nichts (Begegnung, Slots, Match,
    Visits, Outbox, Audit).
  - Idempotenz (gleiche `commandId` zweimal) und Versionskonflikt.
  - Recht: MEMBER/SCORER → 403; Gerät → 403 `DEVICE_NOT_ALLOWED`.
  - Audit- und Outbox-Einträge.
- **Matrizen:** neue Route in `tenant-isolation-matrix` (Body ergänzen) und
  Probe in `permission-matrix`, falls die Matrix je Permission eine Route
  verlangt (`encounter:manage` hat schon eine Probe – dann nur prüfen).
- **Web:** Render-Tests für Knopf, Grund-Validierung, Erfolg und Fehler.
- **E2E:** Begegnung zu Ende spielen, letztes Spiel korrigieren, neu scoren,
  Begegnung wieder abgeschlossen mit neuem Resultat.

## 6. Dokumentation

- ADR 0020 «Korrektur von Liga-Resultaten».
- Bedienungsanleitung (`apps/web/public/bedienungsanleitung.html`): Abschnitt
  zur Korrektur in der Begegnung.
- Hinweis in Spec/ADR 0019 nicht nötig.

## Nicht Teil dieser Spec

- Direktes Eintragen von Resultaten ohne Neu-Scoren.
- Korrektur von Walkover und Forfait.
- Zeitliche Begrenzung der Korrektur.
