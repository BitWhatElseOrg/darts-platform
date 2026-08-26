# Infrastructure

Der Statistik-Worker besitzt mit `Dockerfile.worker` ein eigenes produktives
Image. Er verwendet dieselben `DATABASE_URL`-, `REDIS_URL`- und
Auth-Konfigurationswerte wie die API. In der aktuellen Railway-IaC ist der
Worker noch nicht als Ressource deklariert; Web, API, PostgreSQL und Redis sind
dort der verbindliche Stand.

Die lokale Infrastruktur wird über die Datei [`compose.yaml`](../compose.yaml) im Repository-Root verwaltet.

In der lokalen Entwicklung laufen PostgreSQL und Redis in Docker. Web, API und
bei Bedarf der Statistik-Worker werden für schnelle Reload-Zyklen direkt unter
Node.js in WSL2 ausgeführt.

Das produktive Railway-Zielbild wird als Infrastructure as Code in
[`../.railway/railway.ts`](../.railway/railway.ts) verwaltet. Einrichtung,
Variablen, Smoke-Tests, Logging und Rollback sind im
[Railway-Runbook](./railway.md) dokumentiert.
