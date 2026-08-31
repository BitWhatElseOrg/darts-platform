# Production-Bootstrap und Release-Härtung für v0.1.0

**Datum:** 31. August 2026

**Status:** fachlich freigegeben, schriftliches Review ausstehend

**Geltungsbereich:** erster Production-Owner, Turnier-/Scoring-Lock-Reihenfolge, Walkover-Outbox-Provenienz und Railway-Deployment-Gate

## Ausgangslage

Die Anwendung erlaubt Registrierung absichtlich nur für E-Mail-Adressen mit einer gültigen Einladung. Eine Einladung setzt derzeit aber bereits einen authentifizierten Benutzer mit `organization:manage_members` voraus. Eine leere Production-Datenbank besitzt daher keinen zulässigen Weg zum ersten Administrator.

Das unabhängige Release-Review hat zusätzlich zwei Integritätsfehler und eine nicht technisch erzwungene Deployment-Freigabe identifiziert:

1. Score-Mutationen sperren zuerst das Scoring-Match und aktualisieren später das Turnier. Der Teilnehmer-Rückzug sperrt zuerst das Turnier und danach aktive Scoring-Matches. Eine zeitgleiche entscheidende Aufnahme kann dadurch mit einem Rückzug deadlocken.
2. Ein innerhalb eines Rückzug-Commands verzögert entstandener Walkover verwendet im Outbox-Payload immer den aktuell zurückgezogenen Spieler. Ursächlich kann jedoch ein früher zurückgezogener Teilnehmer sein.
3. Railway verfolgt `main` mit deaktivierter Check-Suite-Prüfung. Die dokumentierte manuelle CI-Prüfung ist damit nicht an die Production-Auslieferung gekoppelt.

Die erste Production-Version wird erst freigegeben, wenn diese vier Punkte geschlossen und erneut vollständig verifiziert sind.

## Ziele

- Ein erster `OWNER` wird ohne öffentlichen Bootstrap-Endpunkt und ohne vorgegebenes Passwort über den normalen Invite-only-Registrierungsfluss aufgenommen.
- Der Bootstrap ist CLI-only, einmalig, transaktional, auditierbar, wiederholbar und gegen eine bereits initialisierte Umgebung fail-closed.
- Reguläre Administratoren können weiterhin keinen `OWNER` einladen.
- Alle Turnier-bezogenen Score-Mutationen verwenden dieselbe globale Lock-Reihenfolge.
- Jedes Walkover-Outbox-Event nennt den tatsächlich ursächlichen zurückgezogenen Teilnehmer.
- Railway startet Production-Deployments erst nach erfolgreichen GitHub Check Suites.

## Nicht-Ziele

- kein öffentlicher oder zeitweise öffentlicher Bootstrap-HTTP-Endpunkt
- kein Default-, temporäres oder in Logs ausgegebenes Passwort
- kein manueller SQL-Bootstrap
- keine allgemeine Service-Account- oder Platform-Admin-Verwaltung
- keine Owner-Übertragung durch normale Organisationsadministratoren
- keine Änderung der bestehenden Invite-only-Registrierung nach abgeschlossenem Bootstrap

## Gewählte Architektur

### 1. Einmaliger Einladungs-Bootstrap

Ein neuer CLI-Befehl `pnpm db:bootstrap:production` wird ausschließlich innerhalb des laufenden Railway-API-Containers ausgeführt. Er verwendet den bestehenden Database-Layer, aber keinen HTTP-Controller und keinen beim API-Start automatisch ausgeführten Hook.

Der Operator übergibt:

- `BOOTSTRAP_OWNER_EMAIL`
- `BOOTSTRAP_ORGANIZATION_NAME`
- `BOOTSTRAP_ORGANIZATION_SLUG`
- optional `BOOTSTRAP_TIMEZONE`, Standard `Europe/Zurich`
- optional `BOOTSTRAP_LOCALE`, Standard `de-CH`
- die bewusste Freigabe `ALLOW_PRODUCTION_BOOTSTRAP=true`

Der Befehl verlangt `NODE_ENV=production`. Lokale oder falsch klassifizierte Aufrufe werden abgelehnt. E-Mail, Name, Slug, Zeitzone und Locale werden mit Zod nach denselben Grenzen wie die öffentlichen Organisationsschemas validiert.

Die Production-Ausführung erfolgt über eine kurzlebige Railway-SSH-Identität. Der Schlüssel wird in einem temporären Verzeichnis erzeugt, nur für die Ausführung registriert und unmittelbar danach aus Railway und vom lokalen Dateisystem entfernt. Es werden keine Datenbank-URLs oder Anwendungsschlüssel ausgegeben.

### 2. Persistenter System-Bootstrap-Prinzipal

Die Datenbank benötigt für `organization_invitations.invited_by_user_id` einen Benutzer. Der Bootstrap legt deshalb einen dedizierten System-Prinzipal an:

- reservierte E-Mail-Adresse `production-bootstrap@system.dartbase.invalid`
- klarer Anzeigename `Dartbase Production Bootstrap`
- kein `accounts`-Datensatz
- keine Session
- keine Membership
- keine Möglichkeit zur Anmeldung

Der System-Prinzipal bleibt erhalten, weil Einladung und Audit dauerhaft auf ihn verweisen. Er ist kein Plattformadministrator und erhält keinerlei Tenant-Rechte.

Die reservierte E-Mail-Adresse ist der stabile natürliche Schlüssel; die UUID wird nur beim ersten Insert erzeugt und danach über diese Adresse gelesen. Vor Verwendung wird verifiziert, dass für den System-Prinzipal weder Credential-Account noch Session noch Membership existiert. Eine Abweichung beendet den Bootstrap ohne Mutation.

### 3. Transaktion und Idempotenz

Der Bootstrap läuft in genau einer PostgreSQL-Transaktion und nimmt zuerst einen festen `pg_advisory_xact_lock`, damit parallele Operator-Aufrufe serialisiert werden.

Danach gilt:

1. Existiert bereits eine aktive `OWNER`-Membership für die angeforderte E-Mail und den angeforderten Organisations-Slug, endet der Befehl idempotent mit `already-complete`.
2. Existiert irgendeine andere aktive Membership, endet er fail-closed mit `BOOTSTRAP_ALREADY_INITIALIZED`.
3. Als zulässiger Teilzustand gelten nur der erwartete System-Prinzipal, die exakt konfigurierte Organisation, ihre passende Bootstrap-Einladung und optional der bereits registrierte Zielbenutzer ohne Membership. Jede andere Organisation, Einladung oder Benutzeridentität beendet den Vorgang mit einem konkreten Invariantenfehler; fremde Daten werden nicht verändert.
4. Der System-Prinzipal wird angelegt oder in seinem erwarteten, nicht anmeldbaren Zustand bestätigt.
5. Die erste Organisation wird mit Name, Slug, Zeitzone und Locale angelegt oder als exakte Wiederholung bestätigt.
6. Eine noch gültige, passende ausstehende Einladung wird unverändert zurückgegeben.
7. Eine abgelaufene passende Einladung wird auf `EXPIRED` gesetzt und durch eine neue, 48 Stunden gültige Einladung ersetzt. Eine unpassende oder zusätzliche Einladung ist ein Invariantenfehler und wird nicht verändert.
8. Die Einladung erhält ausschließlich in diesem internen Workflow die Rolle `OWNER`.
9. Ein Audit-Eintrag `PRODUCTION_BOOTSTRAP_INVITATION_CREATED` enthält Organisations-ID, normalisierte E-Mail, Ablaufzeit und den System-Prinzipal als Actor. Keine Secrets werden gespeichert.
10. Erst danach wird committed.

Die Konsolenausgabe enthält nur Status, Organisations-ID/Slug, normalisierte Ziel-E-Mail und Ablaufzeit. Sie enthält weder Passwort noch Datenbankverbindung noch Auth-Secret.

### 4. OWNER-Einladung ohne öffentliche Rechteausweitung

Die bestehende Datenbank-Constraint für `organization_invitations.role` wird durch eine neue, unveränderliche Migration um `OWNER` ergänzt. Bestehende Migrationen werden nicht bearbeitet.

Die öffentliche Schreibgrenze bleibt enger:

- `createInvitationSchema` akzeptiert weiterhin nur `ADMIN`, `TOURNAMENT_DIRECTOR`, `SCORER`, `MEMBER` und `VIEWER`.
- Der normale Controller und `OrganizationsService.invite` können daher keinen Owner erzeugen.
- Das Leseschema für Einladungen akzeptiert künftig die vollständige `organizationRoleSchema`, damit der erste Benutzer seine Bootstrap-`OWNER`-Einladung sehen kann.
- `acceptInvitation` bleibt E-Mail-gebunden, ablaufgeprüft und transaktional und erzeugt die `OWNER`-Membership erst nach authentifizierter Annahme.

Nach der Annahme verweigert der CLI-Befehl alle neuen Bootstrap-Mutationen. Weitere Benutzer werden ausschließlich über den normalen, berechtigten Einladungsfluss aufgenommen.

## Einheitliche Lock-Reihenfolge

Für jede Mutation eines Turnier-gebundenen Scoring-Matches gilt künftig:

```text
Tournament
→ TournamentMatch
→ Scoring Match
→ Controller Lease / Legs / Visits
→ abhängige TournamentMatches
```

Ein gemeinsamer Repository-Helper ermittelt vor dem Scoring-Match-Lock den optionalen Turnierbezug. Wenn ein Bezug existiert, sperrt er zuerst das tenant-gefilterte Turnier und danach das verknüpfte Turniermatch. Erst anschließend darf der Caller das Scoring-Match sperren.

Der Helper wird von folgenden Pfaden verwendet:

- Aufnahme einreichen
- letzte Aufnahme zurücknehmen
- technischer Match-Abbruch

Ergebniskorrektur und Zuweisung verwenden bereits `Tournament → TournamentMatch → Scoring Match` und bleiben in dieser Reihenfolge. Der Teilnehmer-Rückzug wird von `Tournament → Participant → Scoring Match → TournamentMatches` auf `Tournament → Participant → TournamentMatches → Scoring Matches` umgestellt. Mehrere Scoring-Matches werden weiterhin stabil nach ID sortiert gesperrt.

Nachdem das Turnier gesperrt ist, wird der zuvor nur lesend ermittelte Turnierbezug erneut tenant-gefiltert mit `FOR UPDATE` gelesen. Ist er verschwunden oder verändert, wird kein veralteter Zusammenhang verwendet. Freie Scoring-Matches nehmen keinen Turnier-Lock.

Deadlock-/Serialization-Fehler werden nicht als erfolgreicher Command behandelt. Der Test erzwingt die relevante Interleaving-Situation und beweist, dass eine wartende Score-Mutation das Scoring-Match nicht vor dem Turnier hält. Fachliche Versionskonflikte bleiben HTTP 409; unerwartete DB-Fehler werden nicht verschluckt.

## Korrekte Walkover-Provenienz

Die Bestimmung des ursächlichen zurückgezogenen Spielers wird in eine gemeinsame, reine Funktion verschoben. Für einen `WALKOVER` muss unter den beiden feststehenden Teilnehmern genau ein Spieler in der aktuellen Menge aller zurückgezogenen Teilnehmer enthalten sein und dieser Spieler darf nicht der Gewinner sein.

Der direkte Rückzugspfad und die spätere automatische Propagation verwenden dieselbe Funktion. Ist kein eindeutiger zurückgezogener Teilnehmer ableitbar, wird die Transaktion mit einem Invariantenfehler zurückgerollt; es wird kein falsches Event publiziert.

Das Event bleibt:

```json
{
  "tournamentId": "uuid",
  "tournamentMatchId": "uuid",
  "winnerPlayerId": "uuid",
  "withdrawnPlayerId": "uuid"
}
```

`withdrawnPlayerId` wird aus der Entscheidung und der vollständigen Withdrawn-Menge abgeleitet, niemals pauschal aus dem aktuellen HTTP-Command.

## Railway-Deployment-Gate

Alle drei GitHub-gebundenen Production-Services (`web`, `api`, `worker`) werden in Railway IaC auf `checkSuites: true` gesetzt. Das ist unabhängig davon, dass GitHub Free für das private Repository keine Required-Check-Rulesets bereitstellt: Railway selbst darf den Commit erst nach erfolgreichen Check Suites deployen.

Vor dem Apply wird `railway config plan --json` ausgeführt. Da der Plan reale Production-Konfiguration ändert, wird der genaue Plan dem Benutzer separat zur Freigabe gezeigt. Ohne diese Freigabe erfolgt kein Apply und kein Push.

Nach Apply und Readback gilt der Release-Ablauf:

1. Fast-forward-Push von `main`.
2. GitHub-CI `Quality` und `Deployment artifacts` bis zum terminalen Erfolg überwachen.
3. Railway-Deployments für Web, API und Worker bis `SUCCESS` überwachen.
4. Migrationen müssen vor API-Start erfolgreich sein.
5. API-Health, Web-Root, Domains und Zertifikate prüfen.
6. Bootstrap-CLI über kurzlebige SSH-Identität ausführen.
7. Erster Owner registriert sich mit exakt der eingeladenen E-Mail-Adresse und nimmt die Einladung an.
8. Authentifizierten UI-Smoke-Test und Tenant-Isolationsprüfung durchführen.
9. Erst dann `v0.1.0` taggen und die GitHub Release erzeugen.

Wenn Check-Suite-Gating in Railway nicht unterstützt oder nicht wirksam ist, wird nicht auf einen automatischen ungeprüften Deploy zurückgefallen. Dann muss Automatic Deployment deaktiviert und ein expliziter Promotion-Schritt separat entworfen und freigegeben werden.

## Fehlerfälle

- fehlendes `ALLOW_PRODUCTION_BOOTSTRAP=true`: Abbruch vor DB-Zugriff
- `NODE_ENV` ungleich `production`: Abbruch vor DB-Zugriff
- ungültige E-Mail oder Organisationsfelder: validierter Fehler ohne Mutation
- bereits vorhandener exakt passender Owner: idempotentes `already-complete`
- andere aktive Membership vorhanden: `BOOTSTRAP_ALREADY_INITIALIZED`
- kollidierender Organisations-Slug oder System-Prinzipal: Invariantenfehler ohne Übernahme fremder Daten
- System-Prinzipal besitzt Account, Session oder Membership: Invariantenfehler
- passende Einladung noch gültig: unveränderte Wiederverwendung
- passende Einladung abgelaufen: explizite Erneuerung mit Audit
- Registrierung mit anderer E-Mail: weiterhin HTTP 403
- Einladung abgelaufen oder falscher Benutzer: Annahme weiterhin 404
- parallele Bootstrap-Aufrufe: serialisiert, höchstens eine wirksame Einladung
- Lock-Kontext verändert sich zwischen Vorab-Lookup und Sperre: erneuter Readback; keine veraltete Mutation
- Walkover-Ursache nicht eindeutig: vollständiger Rollback statt falschem Outbox-Event
- GitHub Check Suite fehlschlägt: kein Railway-Production-Deploy

## Tests und Abnahmekriterien

### Bootstrap-Unit- und Integrationstests

- Guard lehnt fehlende Freigabe und nicht-produktive Umgebung ab.
- Eingaben werden normalisiert und begrenzt.
- Leere Datenbank erhält exakt einen System-Prinzipal, eine Organisation, eine ausstehende Owner-Einladung und einen Audit-Eintrag.
- System-Prinzipal hat keinen Account, keine Session und keine Membership.
- Wiederholung vor Ablauf erzeugt keine zweite Einladung.
- Wiederholung nach akzeptierter Owner-Einladung ist `already-complete` und schreibt nichts.
- Fremde aktive Membership oder widersprüchliche Teilzustände werden fail-closed abgelehnt und vollständig zurückgerollt.
- Parallele Aufrufe erzeugen höchstens eine wirksame Einladung.
- Normale Einladungs-API lehnt `OWNER` weiterhin ab.
- Eingeladener Benutzer kann sich mit exakt passender E-Mail registrieren, sieht die Owner-Einladung und erhält erst nach Annahme eine aktive Owner-Membership.

### Concurrency- und Provenienztests

- Erzwungenes Interleaving beweist die Reihenfolge `Tournament → TournamentMatch → Scoring Match` für entscheidende Aufnahme und Rückzug.
- Dasselbe Lock-Protokoll wird für Undo und technischen Abbruch geprüft.
- Gleichzeitiger Rückzug und entscheidende Aufnahme enden ohne Deadlock in einem konsistenten Zustand; ein veralteter Command erhält einen Konflikt.
- Ein verzögerter Walkover nach mehreren Rückzügen nennt im Outbox-Event den tatsächlich ursächlichen früher zurückgezogenen Spieler.
- Ein nicht eindeutig ableitbarer Walkover erzeugt weder Zustandsänderung noch Outbox-Event.

### Release-Gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Zusätzlich:

- alle drei Docker-Images bauen
- Impeccable-UI-Audit ohne P0/P1
- Codex-Security-Diff-Scan ohne reportables Finding
- unabhängiger Code-Review ohne Critical/Important
- `railway config plan --json` und freigegebener Apply/Readback
- GitHub-CI und Railway-Deployments terminal grün
- Production-Health und authentifizierter Bootstrap-/Tenant-Smoke-Test grün

## Sicherheits- und Betriebsfolgen

Der Bootstrap erweitert keine öffentliche API. Sein stärkstes Recht ist das Erzeugen genau einer Owner-Einladung in einer noch nicht initialisierten Umgebung. Dieses Recht erfordert gleichzeitig Railway-Containerzugriff, Production-Umgebung, den expliziten Freigabeschalter und gültige Bootstrap-Eingaben.

Der System-Prinzipal kann sich nicht anmelden und hat keine Tenant-Berechtigung. Seine Persistenz dient ausschließlich referenzieller Integrität und Auditierbarkeit. Eine spätere allgemeine Service-Identity-Lösung kann ihn migrieren, ist aber nicht Voraussetzung für v0.1.0.

Die neue Migration lockert nur die DB-Wertemenge für Einladungen. Die öffentlich erreichbare Schreibgrenze bleibt durch das engere Zod-Eingabeschema unverändert. Diese Trennung wird durch einen Regressionstest geschützt.

## Dokumentation

Folgende Dokumente werden mit der Implementierung aktualisiert:

- `README.md`: Bootstrap-Befehl und sichere Verwendung
- `infrastructure/railway.md`: Check-Suite-Gate, SSH-Ausführung, Readback und erster Owner
- `.railway/README.md`: IaC-Gate und Apply-Ablauf
- `ARCHITECTURE.md`: System-Prinzipal und globale Lock-Reihenfolge
- neue ADR für den einmaligen Production-Bootstrap

Bestehende Migrationen bleiben unverändert. Alle neuen Datenbankänderungen werden als neue versionierte Migration hinzugefügt.
