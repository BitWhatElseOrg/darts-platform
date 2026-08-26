# Infrastructure

Die lokale Infrastruktur wird über die Datei [`compose.yaml`](../compose.yaml) im Repository-Root verwaltet.

In Phase 0 laufen ausschließlich PostgreSQL und Redis in Docker. Web und API werden für schnelle Reload-Zyklen direkt unter Node.js in WSL2 ausgeführt.

Das produktive Railway-Zielbild wird als Infrastructure as Code in
[`../.railway/railway.ts`](../.railway/railway.ts) verwaltet. Einrichtung,
Variablen, Smoke-Tests, Logging und Rollback sind im
[Railway-Runbook](./railway.md) dokumentiert.
