# Go-Live-Testprogramm – Design

Stand: 17.09.2026, Branch `develop`

## Ausgangslage

Die automatisierte Basis ist vorhanden: rund 130 Testdateien, Scoring-Engine
mit 99 Fällen, Tournament- und League-Engine decken die Mindestfälle aus
`AGENTS.md` ab, zehn API-Integrationstests laufen gegen echte Postgres, sieben
Playwright-Specs laufen in der CI, dazu Docker-Smoke-Tests aller drei Images.

Was fehlt, ist die Antwort auf die Frage, ob das System einen echten Spieltag
überlebt: Nebenläufigkeit unter Druck, Ausfälle einzelner Bausteine,
Wiederherstellung, gezielte Angriffe auf die Tenant-Grenze, und die Sicht
mehrerer Personen mit echten Geräten.

Seit dem 17.09.2026 existiert dafür das Railway-Environment `staging`
(Branch `develop`, eigene Postgres- und Redis-Instanzen, siehe
[Runbook](../../../infrastructure/railway.md#staging-environment)). Alles, was
kaputtgehen darf, läuft dort. Production wird in diesem Programm nur gelesen.

## Ziel

Am Ende liegt ein Abnahmeprotokoll vor, das je Block Testfälle, Ergebnis und
offene Befunde festhält. Der Szenario-Test unter Realbedingungen (Block E)
wird erst freigegeben, wenn Block A bis D grün sind oder ihre roten Punkte
bewusst als bekannt akzeptiert wurden.

## Umgebungen und Zugriff

| Zweck | Umgebung |
| --- | --- |
| Unit-, Engine- und Integrationstests | lokal, CI |
| Nebenläufigkeit, Last, Ausfall, Restore | `staging` |
| Security-Matrix | lokal (Integrationstest) und `staging` (Rate-Limits, Header) |
| Realbedingungen | `staging` mit Custom Domains |

Staging erlaubt `ALLOW_SELF_SERVICE_ORGANIZATIONS=true`. Testläufe legen ihre
Organisationen und Konten selbst an; alle Namen und Adressen sind fiktiv
(`test-*@example.test`). Ein Lauf hinterlässt seine Daten mit einem Präfix,
das ein Aufräumskript wiederfindet.

Bis die Custom Domains `staging.dartbase.ch` und `api-staging.dartbase.ch`
per DNS aufgelöst sind, laufen alle API-Tests über
`https://darts-platformapi-staging.up.railway.app`. Browser-Login ist erst mit
den Custom Domains möglich (Better-Auth-Cookies mit `SameSite=Lax`).

## Block A – Nebenläufigkeit und Last

Ort: `apps/api/test/staging/` als eigenes Vitest-Projekt, Basis-URL aus
`STAGING_API_URL`, nicht Teil von `pnpm test`, eigener Befehl
`pnpm test:staging`. Kein neues Framework; HTTP über `fetch`, Realtime über
`socket.io-client` (in `apps/web` bereits vorhanden).

Testfälle:

1. **Zwei Scorer, ein Match.** Zwei Sessions senden abwechselnd und
   gleichzeitig Visits mit derselben `expectedVersion`. Genau einer gewinnt,
   der andere erhält 409 mit aktuellem Zustand, kein Visit geht verloren, kein
   Visit doppelt.
2. **Gleicher Command doppelt.** Dieselbe `commandId` zehnmal parallel. Ein
   Visit, zehn identische Antworten.
3. **20 Boards gleichzeitig.** 20 Matches in einer Organisation, je ein
   Scorer, 3 Visits pro Sekunde je Match für 2 Minuten. Fehlerquote 0,
   p95 unter 500 ms, Leg-Ergebnisse stimmen mit der lokalen Nachrechnung über
   die Scoring-Engine überein.
4. **Realtime-Fan-out.** 50 Zuschauer-Sockets auf ein öffentliches Turnier,
   ein Scorer wirft. Jedes Event kommt bei allen an, Reihenfolge stimmt,
   Verzögerung p95 unter 2 s.
5. **Public-Polling unter NAT.** 600 Anfragen pro Minute von einer Adresse
   auf `/api/v1/public/**` bleiben unter dem Rate-Limit; 700 erzeugen 429
   ohne die übrigen Routen zu blockieren.
6. **Undo unter Last.** Während Fall 3 läuft, sendet ein Match Undo-Commands.
   Version und Zustand bleiben konsistent.

Messgrössen werden je Lauf als JSON unter `docs/testing/protokolle/` abgelegt.

## Block B – Betrieb und Wiederherstellung

Ort: Runbook-Kapitel und ein Protokoll je Probe. Weitgehend manuell, mit
CLI-Belegen.

1. **Backup-Stand Production.** `railway postgres pitr status` auf der
   Production-Datenbank. Ist PITR aus, wird das Einschalten als eigener
   Entscheid an den Betreiber übergeben (Mutation an Production).
2. **Restore-Probe auf Staging.** Staging-Datenbank mit Seed füllen, Backup
   erzeugen, weitere Daten schreiben, Restore in einen neuen Service,
   Zeilenzahlen und Stichproben vergleichen. Danach Service entfernen.
3. **Migrationsprobe.** Ein Deploy auf Staging mit einer Migration in
   `develop` läuft über `start-api.mjs`. Belegt wird: Migration läuft genau
   einmal, API startet erst danach, Worker wartet nicht auf ein Schema, das
   noch nicht da ist.
4. **Redis-Ausfall.** Redis in Staging neu starten, während Fall A3 läuft.
   Erwartung: Scoring über HTTP läuft weiter (kein kritischer Zustand nur in
   Redis), Realtime verbindet neu, Rate-Limit-Zähler starten bei null, keine
   verlorenen Visits.
5. **Worker-Neustart.** Worker während Statistik-Jobs neu starten. Outbox
   verarbeitet alle Events genau einmal, `deadLettered` bleibt 0.
6. **API-Neustart mit offenen Sockets.** Clients verbinden innert 10 s neu und
   holen verpasste Events per Snapshot nach.

## Block C – Technische Lücken

Alle Punkte sind Codeänderungen auf `develop` mit Tests, nach den Regeln aus
`AGENTS.md`.

1. **Coverage-Messung.** `@vitest/coverage-v8` in `packages/*` und
   `apps/api`, Bericht in CI als Artefakt. Keine Schwellen als Gate, aber ein
   Bericht je Paket im Abnahmeprotokoll.
2. **Scheduling-Engine.** Je eine Regel aus `AGENTS.md` Abschnitt 9 ein
   eigener Test: beide Teilnehmer bestimmt, beide verfügbar, keiner spielt
   gleichzeitig, Match nicht beendet, Board verfügbar, Turnierstatus erlaubt
   Start. Dazu die Begründung jeder Ablehnung als lesbarer Grund.
3. **E2E gegen Produktivbuild.** Playwright-Projekt, das gegen `next start`
   mit `NODE_ENV=production` läuft, damit CSP-Nonce und statisches Rendering
   im echten Modus geprüft werden. Läuft in CI zusätzlich zur bestehenden
   Suite.
4. **Tenant-Fremdschlüssel (I-7).** Bleibt Backlog. Braucht zuerst eine
   eigene Spec, weil die Änderung Migrationen an bestehenden Tabellen
   verlangt. In diesem Programm nur: Befundliste, welche Tabellen betroffen
   wären.

## Block D – Security mit Angreiferblick

1. **Tenant-Isolationsmatrix.** Ein Integrationstest iteriert über alle
   Routen der Controller (Boards, Competitions, Encounters, Invitations,
   Matches, Organizations, Players, Statistics, Teams, Tournaments,
   Display-Keys). Für jede Route mit `organizationId` im Pfad oder Body:
   Anfrage mit gültiger Session der Organisation A auf Ressourcen der
   Organisation B. Erwartung: 403 oder 404, niemals Daten von B, niemals
   Schreibzugriff. Die Routenliste wird aus dem NestJS-Router gelesen, nicht
   von Hand gepflegt, damit neue Routen automatisch geprüft werden.
2. **Permission-Matrix.** Für jede Permission (`match:score`, `match:undo`,
   `board:assign`, `tournament:update` und die übrigen) je eine Rolle, die
   sie hat, und eine, die sie nicht hat. Ausgelesen aus dem Permission-System,
   nicht aus einer Kopie.
3. **Rate-Limits auf Staging.** Sensitive Routen (Login, Registrierung,
   Einladung annehmen) bei 11 Versuchen pro Minute gesperrt; allgemeine
   Routen bei 301; Socket-Handshakes bei 61. Nach Ablauf des Fensters wieder
   frei.
4. **Auth-Flows.** Session-Cookie-Attribute (`HttpOnly`, `Secure`,
   `SameSite`), Logout invalidiert serverseitig, abgelaufene Session liefert
   401, Einladungstoken ist einmalig und läuft ab.
5. **Öffentliche Routen.** `/api/v1/public/**` und Display-Keys geben keine
   internen IDs, E-Mail-Adressen oder Versionsnummern fremder Entitäten
   heraus. Stichproben gegen Staging.
6. **Fehlerformat.** Jeder Fehler folgt dem Format aus `AGENTS.md`
   Abschnitt 15, ohne Stacktrace, mit `correlationId`. Erzwungene Fehler
   (ungültiges JSON, zu grosse Payload, unbekannte Route) prüfen.

## Block E – Szenario-Test unter Realbedingungen

Wird vom Betreiber mit mehreren Personen und Geräten durchgeführt. Das
Programm liefert dafür eine Vorlage unter `docs/testing/szenario-spieltag.md`
mit Ablauf, Rollen, Beobachtungspunkten und Protokollfeldern:

- Turniertag: 16 Spieler, Gruppen und KO, 4 Boards, 3 Scorer-Handys, 1
  Anzeige-Bildschirm, 5 Zuschauer-Handys.
- Liga-Spieltag: ein Encounter nach Reglement mit Aufstellung, Doppel,
  Rundenfolge, Sanktion.
- Störungen: WLAN aus für 2 Minuten während des Scorings, Handy-Sperre
  mitten im Visit, Browser-Tab schliessen und neu öffnen.

## Reihenfolge

1. Block C1 (Coverage) und D1/D2 (Matrizen) zuerst, weil sie blinde Flecken
   sichtbar machen, die die weiteren Blöcke beeinflussen.
2. Block A gegen Staging über die Railway-Domain.
3. Block C2, C3 parallel zu A.
4. Block B, sobald A stabil läuft (Ausfälle während der Last messen).
5. Block D3 bis D6 gegen Staging.
6. Abnahmeprotokoll, Freigabe für Block E.

## Nicht im Umfang

- Import maskierter Production-Daten nach Staging.
- Änderungen an Production ausser Lesezugriffen; das Einschalten von PITR
  ist ein separater Betreiberentscheid.
- I-7 (zusammengesetzte Tenant-Fremdschlüssel) als Umsetzung.
- Penetrationstest durch Dritte.

## Erfolgskriterium

Alle Fälle in Block A bis D haben ein protokolliertes Ergebnis. Rote Fälle
sind entweder behoben oder mit Begründung und Risiko im Protokoll als
akzeptiert markiert. Erst dann startet Block E.
