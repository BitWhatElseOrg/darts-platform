# Railway Infrastructure as Code

Die Datei [`railway.ts`](./railway.ts) beschreibt die produktive Phase-0-Infrastruktur:

- Web-Service
- API-Service mit Readiness-Healthcheck
- Statistik-Worker
- PostgreSQL
- Redis
- persistente Daten-Volumes
- Custom Domains, Build-/Start-Kommandos und service-spezifische Variablen

Railway Config as Code (`railway.json` / `railway.toml`) wird bewusst nicht
verwendet, da es für neue Services abgekündigt ist.

Bestehende Production-Werte werden mit `preserve()` verwaltet, damit Secrets
nicht in Source oder Plan-Ausgaben gelangen. Benötigt werden insbesondere:

```text
BETTER_AUTH_SECRET
BETTER_AUTH_URL
WEB_ORIGIN
NEXT_PUBLIC_API_URL
```

Danach:

```bash
railway login
railway link
railway config plan
# Nur bei geprüftem, bewusst freigegebenem Plan:
railway config apply
```

Der kontrollierte Production-Abgleich vom 31. August 2026 meldete
`No changes.`.

Produktionswerte und die Reihenfolge der ersten Inbetriebnahme stehen im
[Railway-Runbook](../infrastructure/railway.md).
