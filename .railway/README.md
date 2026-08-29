# Railway Infrastructure as Code

Die Datei [`railway.ts`](./railway.ts) beschreibt die produktive Phase-0-Infrastruktur:

- Web-Service
- API-Service mit Readiness-Healthcheck
- Worker-Service für asynchrone Statistikaggregate
- PostgreSQL
- Redis
- service-spezifische Dockerfiles

Railway Config as Code (`railway.json` / `railway.toml`) wird bewusst nicht
verwendet, da es für neue Services abgekündigt ist.

Vor `plan` oder `apply` müssen im Ziel-Environment diese Shared Variables
existieren:

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
railway config apply
```

Produktionswerte und die Reihenfolge der ersten Inbetriebnahme stehen im
[Railway-Runbook](../infrastructure/railway.md).
