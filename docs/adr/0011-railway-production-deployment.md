# ADR 0011: Railway-Produktionsdeployment

- Status: Akzeptiert
- Datum: 2026-08-29

## Kontext

Die Dart-Turnierplattform geht mit fünf Railway-Ressourcen (`web`, `api`,
`worker`, PostgreSQL, Redis) im einzigen Environment `production` in Betrieb,
erreichbar über die bei cyon registrierte Domain `dartbase.ch`
(`app.dartbase.ch` für Web, `api.dartbase.ch` für die API). Better Auth aus
ADR 0002 setzt `SameSite=Lax`-Sessioncookies. Die einladungsgebundene
Registrierung aus ADR 0010 verweigert jede offene Selbstregistrierung ohne
Ausnahme — auch für den ersten Benutzer einer neuen Installation. Diese ADR
hält die für den ersten produktiven Rollout getroffenen, nicht
selbsterklärenden Entscheidungen fest.

## Entscheidung

- **Eigene Domain statt Railway-Subdomains.** `up.railway.app` steht auf der
  Public Suffix List. Zwei Railway-Subdomains gelten damit als verschiedene
  Sites, und `SameSite=Lax`-Sessioncookies würden bei API-Anfragen vom Web aus
  nicht mitgesendet — niemand könnte sich anmelden. `app.dartbase.ch` und
  `api.dartbase.ch` teilen sich die registrierbare Domain `dartbase.ch` und
  lösen das ohne Codeänderung. Verworfen: `SameSite=None`, weil Safari
  Third-Party-Cookies blockiert und im Dartraum iPhones zu erwarten sind.
- **Eine API-Replik.** `scripts/start-api.mjs` migriert vor jedem Start.
  Mehrere Repliken würden gleichzeitig migrieren. Skalierung setzt deshalb
  einen eigenständigen Migrationsjob voraus, der die Migration aus dem
  Start-Pfad herauslöst (vgl. ADR 0003).
- **Bootstrap als expliziter Befehl statt Startlogik.** Der Erstzugang
  entsteht durch einen einmalig ausgeführten CLI-Befehl mit Audit-Eintrag
  (`bootstrap-organization.js`), nicht durch Logik im Startpfad der API.
  Startlogik bliebe dauerhaft im Produktionspfad und wäre eine stehende
  Umgehung der Einladungspflicht aus ADR 0010.
- **`invited_by_user_id` nullable.** `NULL` modelliert eine vom System
  erzeugte Einladung. Verworfen: ein Pseudo-Benutzer als Einlader, weil er
  dauerhaft und ohne fachlichen Zweck in `users` stünde.

## Folgen

- Bevor Better-Auth-Sessions zwischen Web und API funktionieren, müssen bei
  cyon die DNS-Einträge für `app.dartbase.ch` und `api.dartbase.ch` auf
  Railway zeigen.
- Horizontale Skalierung der API bleibt gesperrt, bis ein eigenständiger
  Pre-Deploy-/Migrationsjob eingeführt ist.
- Der Bootstrap-Befehl darf pro Installation nur einmal erfolgreich laufen.
  Er nimmt dafür eine Postgres-Advisory-Sperre und prüft die Exklusivität
  innerhalb derselben Transaktion wie die Inserts; jeder weitere Aufruf
  schlägt kontrolliert mit Exit-Code 1 fehl, ohne die bestehende Organisation
  zu verändern.
- Auswertungen und Audit-Ansichten müssen `invited_by_user_id = NULL` als
  «Einladung durch das System» lesen, nicht als fehlenden oder fehlerhaften
  Wert.
- Bekannte Einschränkung: `.railway/railway.ts` wird von keiner automatischen
  Prüfkette erfasst. Kein CI-Lauf validiert die Datei; ein Fehler darin fällt
  erst auf, wenn jemand `railway config plan` gegen das echte Projekt ausführt.
  Diese Validierung bleibt ein manueller Schritt vor `railway config apply`.
