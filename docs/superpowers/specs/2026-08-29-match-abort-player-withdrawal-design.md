# Technischer Match-Abbruch und Spielerausfall

**Datum:** 29. August 2026
**Status:** fachlich freigegeben
**Geltungsbereich:** laufende X01-Matches, Turniersteuerung und lokale Entwicklungsdaten

## Ziel

Die Plattform unterscheidet künftig zwei Störungen ausdrücklich:

1. Ein technischer Match-Abbruch verwirft eine fehlerhafte oder irrtümlich gestartete Scoring-Session. Ein zugehöriges Turniermatch wird wieder spielbereit.
2. Ein Spielerausfall zieht einen Teilnehmer aus genau einem Turnier zurück. Bereits abgeschlossene Ergebnisse bleiben bestehen; offene Begegnungen werden als Walkover für den Gegner gewertet.

Nach der Implementierung wird die lokale Entwicklungsumgebung reproduzierbar mit 32 fiktiven Spielern, zwei abgeschlossenen Turnieren und einem laufenden Turnier befüllt. Bestehende lokale Daten werden dabei nicht gelöscht.

## Fachliche Begriffe

- `PLAYED`: regulär ausgespieltes Match mit einer Scoring-Session.
- `BYE`: planmässiges Freilos, weil im Turnierbaum kein Gegner vorhanden ist.
- `WALKOVER`: kampfloser Sieg, weil ein bereits eingeplanter Gegner aus dem Turnier ausgeschieden ist.
- `ABORTED`: technisch verworfene Scoring-Session. Sie ist kein Turnierergebnis.
- `WITHDRAWN`: ein Teilnehmer ist aus einem konkreten Turnier zurückgezogen. Der organisationsweite Spielerstatus bleibt unverändert.

`BYE`, `WALKOVER` und `CANCELLED` werden nicht synonym verwendet. Ein technischer Abbruch verändert den Teilnehmerstatus nicht. Ein Spielerausfall setzt ein Match nicht zurück auf `READY`.

## Gewählte Architektur

### Datenmodell

`tournament_participants` erhält:

- `status`: `ACTIVE | WITHDRAWN`, Standard `ACTIVE`
- `withdrawn_at`: nullable Zeitstempel
- `withdrawal_reason`: nullable Text, maximal 500 Zeichen

`tournament_matches` erhält `result_type` mit den nullable Werten `PLAYED | BYE | WALKOVER`. Der Wert ist nur für abgeschlossene beziehungsweise als Freilos aufgelöste Matches gesetzt. Bestehende regulär abgeschlossene Matches werden in der Migration als `PLAYED`, bestehende `BYE`-Matches als `BYE` markiert.

`matches.status` wird um `ABORTED` erweitert. Eine abgebrochene Scoring-Session bleibt als technischer und auditierbarer Datensatz bestehen, erscheint jedoch nicht mehr in der aktiven Matchliste und kann keine weiteren Visits annehmen.

`score_commands.type` wird um `ABORT_MATCH` erweitert. So bleibt der technische Abbruch mit `commandId` idempotent, auch nachdem Legs und Visits der Session verworfen wurden. Der Abbruch ist ein Lifecycle-Command und wird nicht als Dartwurf an die Scoring Engine übergeben.

`tournament_commands.type` wird um `WITHDRAW_PARTICIPANT` erweitert. Dadurch ist auch der Turnierrückzug idempotent.

Alle neuen Spalten erhalten Datenbank-Constraints. Bestehende Migrationen werden nicht verändert; es wird eine neue versionierte Drizzle-Migration erzeugt.

### Berechtigungen

Die Domain-Permissions werden um `match:abort` erweitert. Sie wird nur `OWNER`, `ADMIN` und `TOURNAMENT_DIRECTOR` zugewiesen. Ein `SCORER` darf weiterhin Scores und einzelne Visits korrigieren, aber keine vollständige Session verwerfen.

Der Spielerausfall verwendet `tournament:update` und ist damit ebenfalls auf Turnierleitung und administrative Rollen beschränkt. Der Server entscheidet in beiden Fällen; ausgeblendete UI-Elemente sind keine Autorisierungsgrenze.

## Technischer Match-Abbruch

### API

`POST /api/v1/organizations/:organizationId/matches/:matchId/abort`

Request:

```json
{
  "commandId": "uuid",
  "expectedVersion": 12,
  "controllerId": "uuid",
  "reason": "Technischer Neustart"
}
```

`reason` ist optional, wird getrimmt und ist auf 500 Zeichen begrenzt. Die Mutation akzeptiert nur `IN_PROGRESS`-Matches, prüft Tenant, `match:abort`, Versionsstand und aktiven Board-Controller. Sie ist nur online verfügbar.

Die Antwort enthält `{ matchId, status: "ABORTED", tournamentMatchId }`; `tournamentMatchId` ist bei freien Matches `null`.

### Transaktion

In einer Datenbanktransaktion:

1. Idempotenz über `commandId` prüfen.
2. Match mit `organization_id` und `FOR UPDATE` laden.
3. Version und Controller-Lease prüfen.
4. Alle Visits und Legs der Scoring-Session löschen. Die historischen Score-Commands bleiben für Nachvollziehbarkeit und Idempotenz bestehen.
5. Teilnehmerprojektionen auf null Legs zurücksetzen.
6. Scoring-Match als `ABORTED` markieren, Boardbezug und aktiven Spieler entfernen sowie die Version erhöhen.
7. Controller-Lease löschen und Board auf `AVAILABLE` setzen.
8. Falls ein Turniermatch verknüpft ist: `status = READY`, `board_id = null`, `scoring_match_id = null`, `winner_player_id = null`, `result_type = null`, `completed_at = null`; Turnierversion erhöhen.
9. Audit-Eintrag mit altem Matchzustand, Anzahl verworfener Visits und Grund schreiben.
10. Outbox-Events `MATCH_ABORTED` und bei Turnierbezug `TOURNAMENT_MATCH_REOPENED` schreiben.
11. Commit; Realtime-Broadcast erfolgt erst danach.

Ein bereits abgeschlossenes Match kann über diesen Endpunkt nicht abgebrochen werden. Dafür bleibt die bestehende Ergebniskorrektur zuständig.

### Offline-Verhalten

Der Abbruch-Button ist offline deaktiviert. Lokale, noch nicht übertragene Visits werden im Bestätigungsdialog ausdrücklich genannt. Nach erfolgreichem Serverabbruch werden alle Offline-Commands des Match-Scopes aus IndexedDB entfernt. Tritt vorher ein Versionskonflikt auf, wird der aktuelle Serverzustand geladen und nichts lokal gelöscht.

## Spielerausfall

### API

`POST /api/v1/organizations/:organizationId/tournaments/:tournamentId/withdrawals`

Request:

```json
{
  "commandId": "uuid",
  "expectedVersion": 27,
  "playerId": "uuid",
  "reason": "Verletzung"
}
```

Der Grund ist verpflichtend, getrimmt und 3 bis 500 Zeichen lang. Der Teilnehmer muss zum adressierten Turnier gehören und noch `ACTIVE` sein. Abgeschlossene Turniere lehnen den Vorgang ab. Eine Wiederholung derselben `commandId` liefert ohne zweite Wirkung den aktuellen Turnierzustand.

### Transaktion und Fortschreibung

Der Repository-Workflow sperrt Turnier, Teilnehmer und betroffene Matches. Danach:

1. Turnierteilnehmer auf `WITHDRAWN` setzen.
2. Ein laufendes Scoring-Match des Spielers mit derselben technischen Abbruchprimitive verwerfen und sein Board freigeben.
3. Jedes offene Match, in dem beide Teilnehmer feststehen und genau einer zurückgezogen ist, als `COMPLETED` mit `result_type = WALKOVER` und dem aktiven Gegner als Gewinner abschliessen.
4. Sind beide feststehenden Teilnehmer zurückgezogen, wird das Match `CANCELLED`; es gibt keinen Gewinner.
5. Steht in einem KO-Match der Gegner noch nicht fest, bleibt es `WAITING`. Sobald der andere Slot aus einem Vorgängermatch aufgelöst wird, wird der Walkover automatisch abgeschlossen.
6. Walkover-Gewinner werden mit derselben zentralen Turnierfortschrittsfunktion wie reguläre Gewinner in abhängige KO-Matches propagiert. Dadurch können mehrere Freilose beziehungsweise Walkovers in einer Transaktion kaskadieren.
7. Stage- und Turnierstatus werden nach Abschluss der Kaskade neu bestimmt.
8. Audit-Eintrag `TOURNAMENT_PARTICIPANT_WITHDRAWN` und Outbox-Events für Rückzug und jeden Walkover schreiben.

Die Kaskadenlogik gehört in eine deterministische Funktion des Tournament-Engine-Pakets. Das Repository persistiert lediglich deren Entscheidungen. So können Gruppen-, Round-Robin- und KO-Fälle infrastrukturfrei getestet werden.

### Gruppen und Round Robin

Bereits regulär abgeschlossene Matches bleiben unverändert. Jedes noch offene direkte Match des zurückgezogenen Spielers wird Walkover.

Ein Walkover zählt in der Tabelle als:

- ein gespieltes Match für beide Teilnehmer
- ein Sieg und zwei Punkte für den aktiven Gegner
- eine Niederlage für den zurückgezogenen Spieler
- `0:0` Legs, damit kein erfundener Leg-Score in Average oder Leg-Differenz eingeht

Die Tournament Engine akzeptiert deshalb gruppenbezogene Ergebnisse als discriminated union aus `PLAYED` und `WALKOVER`. Reguläre Ergebnisse verlangen weiterhin unterschiedliche Legstände; Walkovers verlangen `0:0` und einen eindeutigen Gewinner.

Zurückgezogene Spieler bleiben sichtbar und werden als „Zurückgezogen“ gekennzeichnet, sind aber von der Qualifikation ausgeschlossen. Bei der Gruppenauflösung werden die bestplatzierten `ACTIVE`-Teilnehmer gewählt. Gibt es weniger aktive Teilnehmer als Qualifikationsplätze, bleiben entsprechende KO-Slots leer und werden durch die vorhandene Bye-Logik weitergeführt.

### Statistiken

Nur regulär ausgespielte Scoring-Matches mit `status = COMPLETED` fliessen in Spielerstatistiken ein. Bei Turniermatches wird dafür zusätzlich die verknüpfte `tournament_matches.result_type = PLAYED` geprüft; freie Matches gelten bei regulärem Abschluss ebenfalls als ausgespielt. Abgebrochene Sessions, Byes und Walkovers erzeugen keine Dart-, Average-, Checkout- oder Legstatistik. Der Turnierstand berücksichtigt Walkovers unabhängig davon.

## Benutzeroberfläche

### Scoreboard

Im Scoreboard erscheint für Rollen mit `match:abort` ein sekundärer, rot gekennzeichneter Button „Match abbrechen“. Er steht räumlich getrennt von „Letzte Aufnahme zurücknehmen“.

Der native, tastaturbedienbare Bestätigungsdialog erklärt:

- alle erfassten Aufnahmen dieser Session werden verworfen
- das Board wird freigegeben
- ein Turniermatch wird wieder startbereit
- die Aktion kann nicht über Undo rückgängig gemacht werden
- wie viele lokale Offline-Aufnahmen zusätzlich verworfen werden

Die finale Aktion heisst „Match endgültig abbrechen“. Während der Mutation sind beide Dialogaktionen gesperrt. Nach Erfolg verschwinden Scoreboard und Match aus der aktiven Liste; Queries für Matches, Boards und Turnierdashboard werden invalidiert.

### Turnierleitung

Das Turnierdashboard erhält im Bereich „Störungen“ eine Aktion „Spieler fällt aus“. Ein Dialog zeigt alle `ACTIVE`-Teilnehmer, verlangt einen Grund und fasst vor der Bestätigung die Folgen zusammen. Die Aktion ist offline deaktiviert und wird nur mit `tournament:update` angeboten.

Tabellen markieren zurückgezogene Spieler textuell, nicht nur farblich. Ergebnislisten und Bracket zeigen `Walkover` beziehungsweise `Freilos` als Ergebnisart. Öffentliche Live-Ansichten erhalten dieselben Kennzeichnungen, jedoch keine administrativen Aktionen.

## Entwicklungsdaten

Ein neuer Befehl `pnpm db:seed:dev` erzeugt einen deterministischen Demo-Mandanten, ohne andere lokale Daten zu löschen. Der Seed verweigert die Ausführung bei `NODE_ENV=production` und bei einer nicht-lokalen `DATABASE_URL`, sofern kein ausdrücklich dokumentierter Entwicklungs-Override gesetzt ist.

Der Seed verwendet feste natürliche Schlüssel und Upserts, sodass wiederholte Ausführung keine Duplikate erzeugt. Better Auth legt das Demo-Konto über seine öffentliche Server-API an; Passworthashes werden nicht selbst erzeugt. Zugangsdaten werden nach erfolgreicher Ausführung in der Konsole ausgegeben, nicht im Produktionscode verwendet.

Demo-Inhalt:

- Organisation „Dartclub Musterstadt“ mit einem Owner
- 32 aktive Spieler mit klar fiktiven Namen
- acht Boards
- abgeschlossenes Single-Elimination-Turnier
- abgeschlossenes Round-Robin-Turnier
- laufendes Turnier mit allen 32 Spielern, Gruppenphase und KO-Plan; einige Ergebnisse, mindestens ein aktives Boardmatch und weitere `READY`-Matches

Die Seed-Routine verwendet die vorhandenen Services beziehungsweise Repositories und normale Commands für Turnier- und Scorezustände. Nur Identitäts- und Bootstrapdaten werden über den vorgesehenen Database-Layer angelegt. Dadurch entsprechen Versionen, Audit, Outbox, Legs, Visits und Turnierfortschritt realen Anwendungsabläufen.

## Fehlerfälle

- Falscher Tenant oder unbekannte ID: `404`, ohne Informationen über fremde Ressourcen.
- Fehlende Permission: `403`.
- Veraltete Version: `409` mit aktuellem Serverzustand.
- Fremder Board-Controller beim Abbruch: `409 BOARD_CONTROLLER_CONFLICT`.
- Match bereits beendet oder abgebrochen: fachlicher Konflikt; identische `commandId` bleibt erfolgreich idempotent.
- Teilnehmer bereits zurückgezogen: fachlicher Konflikt; identische `commandId` bleibt erfolgreich idempotent.
- Turnier bereits abgeschlossen: Rückzug abgelehnt.
- Downstream-Match bei Rückzug bereits aktiv: Die Kaskade verarbeitet den Rückzug, wenn der ausgefallene Spieler dort Teilnehmer ist; bereits regulär abgeschlossene Downstream-Ergebnisse werden nicht rückwirkend verändert.
- Ein bereits abgeschlossener Walkover bleibt bei einem späteren Rückzug seines damaligen Gewinners bestehen. Eine Walkover-Korrektur oder Reaktivierung ist nicht Teil dieses Features.
- Fehler innerhalb einer Kaskade: vollständiger Rollback, kein Realtime-Event.

## Tests und Abnahmekriterien

### Domain- und Engine-Tests

- Permission-Matrix für `match:abort`
- Gruppen-Walkover ergibt 2 Punkte, 0:0 Legs und keine erfundene Leg-Differenz
- abgeschlossene Gruppenergebnisse bleiben bestehen
- `WITHDRAWN` wird bei Qualifikation übersprungen
- KO-Walkover propagiert den Gegner in die nächste Runde
- Rückzug vor bekanntem Gegner wird nach Slot-Auflösung automatisch verarbeitet
- zwei zurückgezogene Teilnehmer ergeben `CANCELLED`
- Kaskade kann ein Turnier korrekt abschliessen

### API-/Repository-Integrationstests

- technischer Abbruch verwirft Visits und Legs, gibt Board frei und setzt Turniermatch auf `READY`
- freies Match wird als `ABORTED` aus aktiven Listen entfernt
- Abbruch ist tenant-sicher, autorisiert, versionsgeprüft, controller-geschützt und idempotent
- Rückzug setzt Teilnehmerstatus, Grund und Zeitpunkt
- laufendes Match wird verworfen und als Walkover gewertet
- Gruppenmatches und KO-Abhängigkeiten werden korrekt fortgeschrieben
- Audit- und Outbox-Einträge liegen nach Commit vor
- Walkover erzeugt keine Spielerstatistik

### Browser-Tests

- Scoreboard-Abbruchdialog: Öffnen, Abbrechen, Bestätigen und Query-Aktualisierung
- Offline-Zustand und Hinweis auf wartende Visits
- Spielerausfall-Dialog mit Grundvalidierung
- Gruppenkennzeichnung und Walkover-Ergebnis
- aktive KO-Begegnung wird kampflos fortgeschrieben
- mobile Darstellung, Tastaturfokus und sichtbare Fehlerzustände

### Vollständige Verifikation

Vor Merge:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Zusätzlich erfolgen Impeccable-UI-Audit, Codex-Security-Diff-Scan und Self-Review. Nach lokalem Merge wird die Testmatrix auf `main` erneut ausgeführt. Anschliessend werden Migrationen angewendet und `pnpm db:seed:dev` gegen die lokale Entwicklungsdatenbank ausgeführt; die erzeugten Mengen und Turnierstatus werden per Readback geprüft.

## Nicht im Umfang

- Reaktivierung eines zurückgezogenen Teilnehmers
- nachträgliche Umwertung bereits regulär abgeschlossener Matches wegen eines Rückzugs
- Ersatzspieler
- Geldstrafen oder disziplinarische Regeln
- frei konfigurierbare Walkover-Punktestände
