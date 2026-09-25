# Protokoll: Probelauf 16 Spieler, Gruppen → KO, auf Staging

Datum: 25.09.2026, 13:44–13:57 (MESZ). Umgebung: `staging`
(`https://staging.dartbase.ch`, `https://api-staging.dartbase.ch`), Organisation
`dartdemo`, Konto `test-runner-2@example.test` (ADMIN). Alle Spielernamen sind
fiktiv. Vorlage: [szenario-spieltag.md](../szenario-spieltag.md), Abschnitt
«Ablauf Turniertag (16 Spieler, Gruppen → KO, 4 Boards)».

## Ziel und Aufbau

Ein ganzes Turnier so nah wie möglich am Spieltag durchspielen, damit
Fehler in Ablauf, Zustandsführung und Anzeige sichtbar werden. Statt
Menschen an Geräten lief ein Skript, das die Rollen der Vorlage nachbildet
(`apps/api/test/staging/probelauf-16.ts`):

| Rolle | Nachbildung |
| --- | --- |
| Turnierleitung | legt 16 Spieler, 4 Boards und das Turnier an, weist Boards zu (`POST …/assignments`, sequenziell wie eine Person), löst die Störungen aus |
| Scorer 1–4 | je Board ein «Gerät» mit eigener `controllerId`: Controller-Lease, Anwurf ausbullen, Aufnahmen Wurf für Wurf (`darts[]`, `checkoutAttempts`) wie die Scoringfläche; Trefferquoten je Spieler unterschiedlich |
| Zuschauer | ein Socket.IO-Client im Raum `tournament:<publicId>`, zählt Ereignisse und misst die Verzögerung zur auslösenden HTTP-Antwort |
| Anzeige | öffentliche Live-Ansicht (`GET /public/tournaments/:publicId/live`) alle ~8 s, Abgleich mit dem Dashboard |

Turnier «Herbst-Cup Probelauf 2026-09-25»: `GROUPS_THEN_KNOCKOUT`, 4 Gruppen à
4, 2 qualifizieren, KO mit 8, 501 Straight In / Double Out, Best of 3 Legs,
`SEEDED`, öffentlich freigegeben. Erwartet 24 + 7 = 31 Matches.

Eingebaute Störungen und Fehlbedienungen:

- **A** Matchabbruch: zweites Match auf Board 2 nach 5 Aufnahmen abgebrochen
  («Falsche Paarung aufgerufen»).
- **B** Rückzug: nach 6 gespielten Gruppenmatches eine Spielerin mit
  mindestens einem gespielten Match zurückgezogen («Verletzung, abgereist»).
- **C** Netz und Bedienung im Scoring: 4 % der Aufnahmen doppelt gesendet
  (gleiche `commandId`), 2 % mit veralteter `expectedVersion`, 2,5 % per Undo
  zurückgenommen und neu eingegeben.
- **D** Nach Turnierende: Ergebniskorrektur eines Gruppenmatches (muss
  abgewiesen werden) und des Finals (muss das Match wieder öffnen).
- Browser-Kontrolle (Playwright, Chromium, Desktop 1280 px und Mobil 390 px)
  in Gruppenphase, KO-Runde und nach Abschluss:
  `apps/web/scripts/probelauf-shots.mjs`.

Nicht abgedeckt (braucht echte Geräte): WLAN-Ausfall, Sperrbildschirm mitten
im Visit, Tab schliessen (Störungen 1–3 der Vorlage), Offline-Warteschlange.
Das Tempo war verdichtet: eine Aufnahme alle 0,9–1,6 s statt 20–30 s; alle
Rollen liefen von einer Client-Adresse.

## Ablauf

| Zeit | Schritt | Ergebnis |
| --- | --- | --- |
| 13:44 | Anlage 16 Spieler, 4 Boards, Turnier; Freigabe | 201/200; Strukturvorschau 24 + 7 Matches, 0 Byes; 4 Gruppen à 4, keine Doppelnennung |
| 13:44 | Erste Zuweisungen auf 4 Boards | 4 × 201, Versionen 1–4, keine Konflikte |
| 13:44–13:46 | Lauf 1 und 2 abgebrochen (Skriptfehler, siehe Befund 3) | Turnier blieb konsistent, Wiederaufnahme möglich |
| 13:46 | Lauf 3 ab Leg 1 der vier laufenden Matches | – |
| 13:48 | Störung A: Abbruch auf Board 2 | `TOURNAMENT_MATCH_REOPENED`, Board frei, Paarung wieder `READY`, später neu zugewiesen und mit neuem Scoring-Match gespielt |
| 13:48 | Störung B: Rückzug Sibylle Huber (Gruppe A, 1 Match gespielt) | zwei Walkover sofort gewertet (8/31), Tabelle markiert «Ausgefallen», Teilnehmerstatus 15/16 |
| 13:52 | Gruppenphase abgeschlossen (24/31) | Status `KNOCKOUT`, 8 Qualifizierte, Viertelfinals A1–D2, B2–C1, A2–D1, B1–C2, 2 sofort `READY` |
| 13:52 | Browser-Kontrolle KO-Runde; dabei Scoringfläche eines laufenden Matches geöffnet | Befund 5 |
| 13:55 | Final beendet | Status `COMPLETED`, 31/31, alle Boards frei, Warteschlange leer, Turnierliste «beendet» |
| 13:56 | Störung D: Korrektur Gruppenmatch | 409 `TOURNAMENT_DEPENDENT_MATCH_STARTED` mit aktuellem Zustand – korrekt |
| 13:56 | Störung D: Korrektur Final | 201; Turnier zurück auf `KNOCKOUT` (30/31), Final `IN_PROGRESS` auf Board 1 mit zurückgenommener Entscheidungsaufnahme (Leg 3), öffentliche Sicht folgt |
| 13:57 | Final nachgespielt | `COMPLETED`, 31/31, anderer Sieger – Tableau und Liste stimmig |

## Zahlen (Lauf 3, 486 s)

| Grösse | Wert |
| --- | --- |
| HTTP-Anfragen | 1563; 0 × 5xx, 0 × 429, 31 × 409 (17 erwartete Versionskonflikte, 14 Controller-Konflikte aus Befund 5), 0 × sonstige 4xx |
| Aufnahmen | 1031, davon 17 Busts, 73 Checkouts; 26 Anwurf-Entscheide; 22 Undos |
| Engine-Abgleich | 0 Abweichungen zwischen `previewVisitOutcome` (Client) und Serverantwort (Ergebnis, Reststand) |
| Doppelt gesendete `commandId` | 35, alle idempotent (gleiche Version, kein zweiter Visit) |
| Veraltete `expectedVersion` | 17, alle 409 `MATCH_VERSION_CONFLICT` mit aktuellem Zustand |
| Undo | 22, Reststand und Wurfrecht jedes Mal korrekt wiederhergestellt |
| Antwortzeiten (p50 / p95 / max, ms) | Visit 75 / 109 / 628; Dashboard 99 / 169 / 221; Zuweisung 120 / 219 / 259; öffentliche Ansicht 109 / 220 / 283 |
| Realtime | 1123 Ereignisse empfangen; Verzögerung HTTP-Antwort → Ereignis p50 219 ms, p95 481 ms, max 1264 ms |
| Öffentliche Sicht | nie hinter dem Dashboard; keine `organizationId`, keine interne Turnier-ID, kein `blockedReason` |
| Ratenbudget | kleinster `X-RateLimit-Remaining` 45 von 300 pro Minute (eine Client-Adresse für alle Rollen) |
| API-/Worker-Logs | keine Einträge mit `level` warn/error während des Laufs |
| Browser | keine Konsolenfehler, keine fehlgeschlagenen Antworten (ausser der eigenen 404-Probe aus Befund 3) |

Rohdaten: [messwerte/2026-09-25-probelauf-16.json](./messwerte/2026-09-25-probelauf-16.json).

## Befunde

Schwere wie in den übrigen Protokollen: `niedrig` / `mittel` / `hoch` /
`kritisch`; `info` für bestätigtes, erwartetes Verhalten, das für den Spieltag
wissenswert ist.

| Nr. | Schwere | Beobachtung | Ort / Ursache | Empfehlung |
| --- | --- | --- | --- | --- |
| 1 | mittel | Das Panel «Störungen» der Kommandozentrale zeigt während des normalen Spielbetriebs für jedes bespielte Board den Hinweis «Halle Board n ist nicht verfügbar» (4 Hinweise bei 4 laufenden Matches, 0 nach Turnierende). Echte Störungen gehen darin unter, die Zahl im Panelkopf ist dauernd > 0. | `apps/api/src/tournaments/tournaments.service.ts`, Konflikte aus `isBoardFree` – ein Board mit laufendem Turniermatch gilt als «blockiert». | Nur Boards melden, die nicht `AVAILABLE` sind **und** kein Match dieses Turniers tragen (Sperre, Fremdbelegung). |
| 2 | mittel | Freigabe-Panel auf 390 px: der Hinweistext bricht wortweise («Wer / den / Link / hat, / sieht / zu.»), weil der Schalter «Freigegeben Nein/Ja» die Textspalte auf wenige Zeichen zusammendrückt. | `apps/web/src/components/tournament/share-panel.tsx`: Text `min-w-0 flex-1`, Schalter `shrink-0` in einem `flex-wrap`-Container – die Zeile bricht nie um, weil die Textbasis 0 ist. | Textblock mit `basis-full` bzw. `min-w-[16rem]` versehen, damit der Schalter auf Mobil unter den Text rutscht. Gleiches Muster im Panel «Anzeige-Schlüssel» prüfen. |
| 3 | niedrig | `boards[].match.matchId` im Dashboard ist die **Turniermatch-ID**, die Match-API (`/matches/:id`, Scoringfläche) kennt nur die **Scoring-Match-ID**. Ein Gerät, das die Scoringfläche direkt aus dem Board-Feld öffnet, landet auf einer Fehlerseite («Die Anfrage konnte nicht ausgeführt werden. Prüfe die Eingaben …»), die alle 4 s neu lädt und keinen Weg zurück bietet. Die Weboberfläche selbst ist nicht betroffen (Scorer geht über die Matches-Seite). | `tournaments.service.ts` (Board-Slot `matchId: scheduled.id`), `match-scoreboard-route.tsx` (`refetchInterval: 4_000`, generische Fehlermeldung bei 404). | Feld umbenennen (`tournamentMatchId`) oder zusätzlich `scoringMatchId` liefern; auf der Matchseite bei 404 nicht weiter pollen und «Match nicht gefunden» mit Link zur Matches-Seite zeigen. |
| 4 | niedrig | `boards[].match.overrunning` ist immer `false`; das Schema verspricht «running longer than this stage's expected duration». Die Kachel zeigt zwar die Laufzeit, aber nie eine Überziehung. | `tournaments.service.ts`, Board-Slot fest `overrunning: false`. | Entweder berechnen (z. B. > 2 × mittlere Matchdauer der Phase) oder Feld und Schema-Kommentar entfernen. |
| 5 | niedrig | Öffnet ein zweites Gerät die Scoringfläche eines laufenden Matches (Turnierleitung «schaut nur»), übernimmt es die Board-Steuerung, sobald das Scorer-Gerät länger als 10 s keinen Heartbeat gesendet hat (Tab im Hintergrund, Sperrbildschirm). Der Scorer bekommt danach `BOARD_CONTROLLER_CONFLICT` (14 × beobachtet, ~20 s bis zur Rückkehr nach Schliessen des zweiten Tabs) und muss «Steuerung übernehmen». | Lease 10 s in `matches.repository.ts` (`acquireControllerLease`), automatischer Claim beim Öffnen in `use-board-controller-lock.ts`. Verhalten ist so entworfen. | Ansicht und Steuerung trennen: beim Öffnen nicht automatisch übernehmen, wenn ein fremder Lease besteht oder kürzlich bestand; Übernahme nur per Knopf. Im Bedienhandbuch festhalten: «Scoringfläche eines laufenden Boards nicht auf einem zweiten Gerät öffnen». |
| 6 | niedrig | Alle Rollen einer Halle (Leitung, 4 Boards, TV) teilen hinter einem NAT das Ratenbudget von 300 Anfragen pro Minute. Im verdichteten Lauf sank der Rest auf 45; bei realem Tempo (≈ 10 Aufnahmen/min) entscheidet das Polling der Ansichten (Scoringfläche 4 s, Zentrale/Live je nach Verbindung). Keine 429 im Lauf. | `RATE_LIMIT_MAX_PER_MINUTE`, Schlüssel = Client-Adresse (`resolveClientAddress`). | Vor dem ersten grossen Spieltag (8 Boards, mehrere Anzeigen) mit Produktionswerten nachrechnen oder Polling bei aktivem Socket drosseln. |
| 7 | niedrig | Turniere lassen sich nicht löschen (kein `DELETE`-Endpunkt, kein Knopf). Das Probelauf-Turnier und die zwei abgebrochenen Ansätze bleiben dauerhaft in der Liste von `dartdemo`. Ein versehentlich angelegtes Turnier auf Production bliebe ebenfalls stehen. | `tournaments.controller.ts` | Löschen (oder Archivieren) für Turniere ohne gespielte Matches, mindestens für `OWNER`/`ADMIN`, mit Audit. |
| 8 | niedrig | Nach Turnierende sagen die Board-Kacheln «Die Warteschlange wartet auf Ergebnisse oder eine offene Phase», und weder Zentrale noch Live-/TV-Ansicht nennen die Siegerin ausdrücklich (nur Häkchen im Tableau). | `board-wedge.tsx`, `live-tournament.tsx` | Bei `COMPLETED` eine Abschlusszeile («Turnier beendet – Siegerin: …») und neutralen Kacheltext. |
| 9 | info | Ergebniskorrektur: Gruppenmatch nach KO-Start wird mit 409 `TOURNAMENT_DEPENDENT_MATCH_STARTED` abgewiesen; Korrektur des Finals nimmt die Entscheidungsaufnahme zurück, öffnet das Match auf demselben Board in Leg 3, setzt das Turnier auf `KNOCKOUT` und die öffentliche Sicht folgt sofort. Nachspielen führt sauber zu `COMPLETED`. | – | Verhalten in die Bedienungsanleitung aufnehmen (Korrektur = Match wird wieder geöffnet, nicht Sieger umgeschrieben). |
| 10 | info | Rückzug: Walkover mit 0:0 Legs und 2 Punkten für den Gegner, sofort gewertet; die Zurückgezogene behält ihr gespieltes Resultat und steht mit Markierung in der Tabelle; sie bleibt im Tableau ausgeschlossen. | `calculateGroupStandings` | – |
| 11 | info | Abbruch eines laufenden Matches: Paarung wieder `READY`, Board sofort frei, neue Zuweisung erzeugt ein neues Scoring-Match; das abgebrochene taucht in keiner Liste mehr auf. | – | – |

**Stand der Behebung (Branch `fix/probelauf-befunde`, 25.09.2026):**
Befunde 1, 2, 3, 4 und 8 sind behoben und mit Tests belegt:

- 1: Konflikte entstehen nur noch aus gesperrten Slots
  (`tournaments.integration.spec.ts`, «meldet ein bespieltes Board nicht als
  Stoerung»).
- 2: Freigabe-Karte stapelt Text und Schalter bis `sm`
  (`share-panel.render.spec.tsx`).
- 3: Scoringfläche pollt nach 404 nicht weiter, wiederholt nicht, nennt das
  Match als unbekannt und bietet den Rückweg an (`match-load-state.spec.ts`);
  `boardSlotMatchSchema.matchId` ist als Turniermatch-ID dokumentiert.
- 4: `overrunning` wird aus Laufzeit, Legs und Sätzen abgeleitet
  (`match-overrun.spec.ts`, 7 min je Leg, Toleranz 1,5).
- 8: Kopfzeilen von Zentrale und Live-Ansicht nennen den Turniersieg, freie
  Kacheln sagen nach Turnierende «Turnier beendet.»
  (`dashboard-header.render.spec.tsx`, `board-wedge.render.spec.tsx`,
  `tournament-winner.spec.ts`).

Sichtprüfung auf Staging (Deploy 8ba3bce, 25.09.2026 15:16): Kopfzeilen
von Zentrale und Live-Ansicht nennen «Turniersieg: Adrian Oberholzer»
(Sieger nach der Finalkorrektur), die vier freien Kacheln sagen «Turnier
beendet.», das Störungen-Panel steht auf «ohne Befund», die Freigabe-Karte
bricht auf 390 px normal um, und die Scoringfläche zeigt für eine
Turniermatch-ID «Dieses Match gibt es nicht oder nicht mehr» mit Link «Zur
Übersicht» nach genau einer Anfrage statt vierzehn.

Zusätzlich im selben PR: der Prune-Test der Outbox schützt seine
«bleibt»-Zeilen per `*_not_before` vor fremden Pollern, und der
Realtime-Service wartet beim Herunterfahren auf den laufenden
Outbox-Durchlauf (`outbox-publish-loop.ts`) – beides Ursachen roter
Quality-Gate-Läufe ohne Codefehler.

Offen bleiben 5 (Lease-Übernahme beim blossen Öffnen, Verhaltensänderung mit
eigener Spezifikation), 6 (Beobachtung, keine Änderung nötig) und 7
(Löschen von Turnieren, eigenes Feature mit Autorisierung und Audit).

Schwerwiegende Befunde (hoch/kritisch): **keine.** Scoring-Korrektheit,
Idempotenz, Versionsprüfung, Turnierlebenszyklus, Qualifikation, Tableau,
Tenant-Grenzen der öffentlichen Sicht und Realtime-Zustellung haben unter
Last und Störungen gehalten.

## Hinterlassenschaft auf Staging

In `dartdemo` bleiben 16 fiktive Spieler (Reto Ammann … Petra Rüegg), die
Boards «Halle Board 1–4» und das Turnier
`c48375b6-37c3-40c7-a1ae-e87428ef9624` (öffentlich, `publicId`
`b583f723-1544-4a58-a666-7f6dca57bbbc`) stehen. Löschen ist für Turniere
nicht möglich (Befund 7); Spieler und Boards wurden bewusst belassen, damit
das Turnier nachvollziehbar bleibt.

## Wiederholung

```bash
# aus apps/api, Konto und Organisation aus ../../.env.staging
SIM_OUT=/tmp/probelauf npx dotenv -e ../../.env.staging -- npx tsx test/staging/probelauf-16.ts
# Wiederaufnahme eines bereits angelegten Turniers
SIM_RESUME=/tmp/probelauf.status.json SIM_OUT=/tmp/probelauf-2 npx dotenv -e ../../.env.staging -- npx tsx test/staging/probelauf-16.ts
# Browser-Kontrolle aus apps/web
node --env-file=../../.env.staging scripts/probelauf-shots.mjs /tmp/probelauf.status.json /tmp/probelauf-shots
```

Ein Lauf braucht rund 8 Minuten und etwa 1600 Anfragen; das Sign-in-Budget
(10/min) wird einmal belastet. Vor einem Lauf gegen Production: nicht
vorgesehen – das Skript legt Spieler, Boards und ein unlöschbares Turnier an.
