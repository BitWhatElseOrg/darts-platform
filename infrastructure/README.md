# Infrastructure

Das Projekt `dartbase` liegt im Railway-Workspace `BitWhatElse Projects`. Im
Environment `production` sind Web, API, Worker, PostgreSQL und Redis
erfolgreich deployt. `dartbase.ch` und `api.dartbase.ch` sind öffentlich
erreichbar; DNS-Verifikation, Zertifikate und die Web-/API-Smoke-Tests sind
erfolgreich.

Daneben besteht das Environment `staging`, das dem Branch `develop` folgt und
eigene, von Production getrennte Datenservices und Zugangsdaten hat. Beide
Environments beschreibt das [Railway-Runbook](./railway.md).

Der Worker besitzt mit `Dockerfile.worker` ein eigenes produktives Image. Er
verwendet dieselben `DATABASE_URL`-, `REDIS_URL`- und
Auth-Konfigurationswerte wie die API und arbeitet zwei Warteschlangen ab:
Statistikaggregate aus `outbox_events` und ausgehende Mails aus
`email_deliveries`.

Die Railway-IaC bildet das angelegte Projekt einschliesslich Worker, Domains,
Volumes, Build-/Start-Kommandos und bestehender Variablen vollständig ab. Sie
beschreibt ausschliesslich `production`; ein `railway config plan` gegen
`staging` würde Branch und Domains überschreiben.

Die lokale Infrastruktur wird über die Datei [`compose.yaml`](../compose.yaml) im Repository-Root verwaltet.

In der lokalen Entwicklung laufen PostgreSQL und Redis in Docker. Web, API und
bei Bedarf der Worker werden für schnelle Reload-Zyklen direkt unter
Node.js in WSL2 ausgeführt.

Das produktive Railway-Zielbild wird als Infrastructure as Code in
[`../.railway/railway.ts`](../.railway/railway.ts) verwaltet. Einrichtung,
Provider-Zuständigkeiten, Domains, Variablen, Smoke-Tests, Logging und Rollback
sind im [Railway-Runbook](./railway.md) dokumentiert.

Für die öffentliche Domain gilt:

| Aufgabe | Anbieter |
| --- | --- |
| Registrierung von `dartbase.ch` | Cyon |
| Autoritative Nameserver und DNS-Zone | Cloudflare Free |
| App-Hosting, Domain-Verifikation und TLS | Railway Hobby |

Cloudflare führt die Railway-relevanten Einträge zunächst ausschließlich als
`DNS only` und meldet die Zone als aktiv. Die Zertifikate für Apex und Wildcard
sind gültig. Ein expliziter CNAME für `api.dartbase.ch` übersteuert die
Web-Wildcard und führt zusammen mit dem separaten Railway-Verifikations-TXT zum
API-Service. Auch das API-Zertifikat ist gültig.

Für isolierte Development- und Pull-Request-Preview-Datenbanken wird Neon
verwendet. Branch-Lebenszyklus, Migrationen und Datenregeln beschreibt das
[Neon-Preview-Runbook](./neon-preview.md). Production und Staging bleiben auf
Railway PostgreSQL.
