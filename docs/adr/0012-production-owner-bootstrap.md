# ADR 0012: Einmaliger Production-Owner-Bootstrap

**Status:** Accepted
**Datum:** 31. August 2026

## Kontext

Die Registrierung ist an eine offene, nicht abgelaufene Einladung gebunden.
Eine normale Organisationseinladung darf nur von einem bereits authentifizierten
Benutzer mit entsprechender Permission erstellt werden. Eine leere Production-
Datenbank hätte damit keinen zulässigen Weg zum ersten Organisations-Owner.

Der erste Owner muss deshalb über einen eng begrenzten Betriebsablauf in den
normalen Invite-only-Registrierungsfluss gelangen. Dieser Ablauf darf keine
öffentliche API erweitern, kein Passwort vorgeben und keine manuelle
Datenbankmutation voraussetzen.

## Entscheidung

Der erste Owner wird durch den kompilierten, nur einmalig ausgeführten CLI-Befehl
`pnpm db:bootstrap:production` eingeladen. Der Root-Befehl delegiert an den
kompilierten API-Befehl:

```text
pnpm db:bootstrap:production
→ pnpm --filter @darts-platform/api bootstrap:production
→ node dist/operations/bootstrap-production.js
```

Die Root- und API-pnpm-Wrapper sind bequeme Bedienbefehle und dürfen zusätzlich
Lifecycle- oder Bannertext ausgeben. Für maschinenlesbares Readback im API-Image
wird aus dem Image-Arbeitsverzeichnis `/app` der kompilierte Node-Entry-Point
direkt aufgerufen:

```text
node /app/apps/api/dist/operations/bootstrap-production.js
```

Nur dieser direkte Entry-Point schreibt genau eine sanitierte JSON-Zeile; der
Wrapper darf neben seinem Kindprozess unkritischen Lifecycle-Text ausgeben.

Der Befehl ist nur zulässig, wenn `NODE_ENV=production` und der rohe
Freigabewert `ALLOW_PRODUCTION_BOOTSTRAP=true` vorliegen. Diese Prüfung erfolgt
vor der vollständigen Anwendungskonfiguration und vor dem Aufbau einer
Datenbankverbindung. Es gibt keinen HTTP-Controller und keinen automatischen
Startup-Hook.

Die Bootstrap-spezifischen Variablen sind exakt:

```text
ALLOW_PRODUCTION_BOOTSTRAP=true
BOOTSTRAP_OWNER_EMAIL
BOOTSTRAP_INVITATION_CLAIM_TOKEN (43 Zeichen, mindestens 256 Bit Zufall)
BOOTSTRAP_ORGANIZATION_NAME
BOOTSTRAP_ORGANIZATION_SLUG
BOOTSTRAP_TIMEZONE (optional, Standard: Europe/Zurich)
BOOTSTRAP_LOCALE (optional, Standard: de-CH)
```

E-Mail-Adresse, Organisationsname, Slug, Zeitzone und Locale werden serverseitig
mit den bestehenden Zod-Grenzen normalisiert und validiert. Der reservierte
System-Prinzipal darf nicht als Owner-Adresse verwendet werden.

### Persistenter, nicht anmeldbarer System-Prinzipal

Für `invited_by_user_id` und den Audit-Eintrag legt der Bootstrap einen
dedizierten Benutzer an oder prüft ihn anhand seiner reservierten Adresse:

```text
E-Mail: production-bootstrap@system.dartbase.invalid
Anzeigename: Dartbase Production Bootstrap
E-Mail verifiziert: false
Bild: null
```

Dieser Prinzipal besitzt keinen Account, kein Passwort, keine Session und keine
Membership und kann sich nicht anmelden. Er erhält keine Tenant- oder
Plattformrechte. Er bleibt persistent, weil Einladung und Audit dauerhaft auf
ihn verweisen; seine Persistenz ist keine allgemeine Service-Account-Lösung.
Abweichungen von diesem nicht anmeldbaren Zustand beenden den Vorgang
fail-closed ohne Mutation.

### Transaktionale Einladung

Der Bootstrap nimmt zuerst einen festen PostgreSQL-Transaktionslock und prüft
den vollständigen relevanten Zustand. Erst danach werden System-Prinzipal,
Organisation, Einladung und Audit-Eintrag in derselben Transaktion geschrieben.
Die OWNER-Rolle wird ausschließlich an dieser internen Datenbankgrenze erzeugt.
Die Einladung läuft nach 48 Stunden ab. Ihr Klartext-Code wird nur beim
Bootstrap-Aufruf verwendet; gespeichert wird ausschließlich der SHA-256-Hash.
Eine passende noch gültige Einladung wird unverändert wiederverwendet; eine passende abgelaufene Einladung wird als
`EXPIRED` historisiert und durch eine neue 48-Stunden-Einladung ersetzt.
Bei dieser Erneuerung darf der Operator einen neuen Claim setzen; ein alter
Claim wird nicht wiederverwendet. Ein noch gültiger `PENDING`-Rerun muss dagegen
denselben Claim liefern.
Die Erzeugung wird als Audit-Aktion
`PRODUCTION_BOOTSTRAP_INVITATION_CREATED` mit dem System-Prinzipal als Actor
festgehalten.

Nur die erwarteten Zustände sind wiederaufnehmbar:

| Zustand | CLI-Ergebnis |
| --- | --- |
| Keine Bootstrap-Daten; erwartete Organisation und Einladung werden angelegt | `created` |
| Exakt passende, noch gültige `PENDING`-Einladung | `pending` ohne Schreibvorgang |
| Exakt passende Owner-Membership und genau eine akzeptierte Einladung | `already-complete` ohne Schreibvorgang |
| Passende, abgelaufene Einladung | `created` nach Erneuerung |

Fremde aktive Memberships, zusätzliche oder widersprüchliche Benutzer,
Organisationen oder Einladungen sowie ein kompromittierter System-Prinzipal
werden mit einem kontrollierten Fehler abgelehnt. Eine Wiederholung liefert
`pending` oder `already-complete` nur bei exakt dem jeweils geprüften Zustand;
fremde Daten werden nicht übernommen.

Nach der Registrierung des eingeladenen Benutzers entsteht die OWNER-Membership
erst durch die authentifizierte Annahme der Einladung. Der normale öffentliche
Einladungs-Controller und `createInvitationSchema` akzeptieren weiterhin keine
OWNER-Rolle. Reguläre Organisationsadministratoren können daher keinen Owner
einladen.

### Sichere Ausgabe und Betriebszugriff

Der kompilierte Node-Entry-Point schreibt genau eine sanitierte JSON-Zeile: bei
Erfolg nach stdout, bei Fehler nach stderr. Die Erfolgsdaten enthalten nur
Ereignis, Status,
Organisations-ID und -Slug, normalisierte Owner-E-Mail sowie `expiresAt` (bei
`already-complete` `null`). Fehlermeldungen enthalten nur einen stabilen Code
und eine kontrollierte Nachricht. Datenbank-URLs, Secrets, Passwörter,
Token, Hashes, Stacktraces und interne Treiberfehler werden weder ausgegeben
noch geloggt. Der Owner benötigt den Code sowohl für die Registrierung als auch
für die anschließende Annahme; der Acceptance-Claim ist transaktional und
einmalig.

Die Erfolgsform entspricht:

```json
{
  "event": "production_bootstrap_completed",
  "status": "created | pending | already-complete",
  "organizationId": "uuid",
  "organizationSlug": "normalized-slug",
  "ownerEmail": "normalized@example.test",
  "expiresAt": "ISO timestamp or null"
}
```

Ein Fehler enthält ausschließlich `event`, `code` und `message` mit dem Wert
`production_bootstrap_failed` für `event`; der Prozess beendet sich mit Exit-Code
1. Erfolgreiche Ausgaben gehen nach stdout, Fehlerausgaben nach stderr.

Die Production-Ausführung erfolgt einmalig über Railway SSH im kompilierten
API-Container. Dafür wird eine kurzlebige Ed25519-Identität registriert. Nach
der Ausführung wird der Schlüssel unverzüglich aus Railway und vom lokalen
Dateisystem entfernt und die Entfernung durch Readback bestätigt. Der Owner
schließt danach selbst die normale Registrierung mit einem privaten Passwort ab;
der Operator erzeugt, kennt oder verteilt kein Passwort.

## Verworfene Alternativen

- Ein öffentlicher oder zeitweise öffentlicher Bootstrap-Endpunkt würde das
  stärkste Recht der Anwendung über die öffentliche Angriffsfläche verfügbar
  machen.
- Ein Default- oder temporäres Passwort würde Zugangsdaten erzeugen, verteilen
  und möglicherweise in Logs oder Tickets hinterlassen.
- Ein manueller SQL-Bootstrap wäre nicht durch die Domain-Guards, Transaktion,
  Auditierung und Idempotenz des Application-Flows geschützt.
- Ein Startup-Hook würde bei jedem Deploy erneut privilegierte Mutationen
  versuchen und die bewusste einmalige Freigabe umgehen.

## Sicherheitsfolgen

Der Bootstrap erweitert weder die öffentliche API noch die normalen
Einladungsrechte. Sein einziges zusätzliches fachliches Recht ist das Erzeugen
genau einer OWNER-Einladung in einer noch nicht initialisierten Umgebung. Dafür
werden gleichzeitig ein Railway-Containerzugriff, die Production-Klassifikation,
die explizite Freigabe und gültige Eingaben benötigt. Nach abgeschlossener
Annahme ist der Vorgang idempotent beendet; weitere Benutzer gelangen über den
normalen Invite-only-Fluss in die Organisation.

Die Datenbank-Constraint erlaubt `OWNER` als gespeicherten Einladungswert, die
öffentliche Schreibvalidierung bleibt jedoch absichtlich enger. Dieses
Zusammenspiel und die E-Mail-Bindung der Annahme werden durch Integrationstests
geschützt.

## Betriebsfolgen

Die vollständige einmalige Prozedur einschließlich SSH-Schlüssel-Lifecycle,
Readback und authentifiziertem UI-Smoke-Test steht im
[Railway-Runbook](../../infrastructure/railway.md). Die getrennte Railway-
CI-Gate-Änderung ist ein späterer Release-Schritt: Die aktuelle IaC-Konfiguration
ist davon unabhängig und gilt erst nach einem separat geprüften und
freigegebenen Plan als produktionsbereit.
