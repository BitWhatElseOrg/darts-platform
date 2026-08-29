# Neon Development and Preview Runbook

## Geltungsbereich

Neon wird ausschließlich für nicht-produktive Development- und
Pull-Request-Preview-Datenbanken verwendet. `staging` und `production` nutzen
Railway PostgreSQL. Das Neon-Projekt darf weder Production-Zugangsdaten noch
unmaskierte Production-Daten enthalten.

## Voraussetzungen

- Neon CLI ist installiert und authentifiziert.
- Ein separates, nicht-produktives Neon-Projekt ist ausgewählt.
- Eine Development-Baseline mit aktuellem Migrationsstand existiert.
- `NEON_API_KEY` und `NEON_PROJECT_ID` liegen nur im Secret Store der
  Entwicklungs- oder Deployment-Umgebung.

## Branch-Konvention

```text
development
preview/pr-<pull-request-number>
```

Ein Preview-Branch wird immer von `development` abgeleitet. Ein Ablaufdatum
begrenzt liegen gebliebene Ressourcen; zusätzlich wird der Branch beim Schließen
des Pull Requests entfernt.

## Branch erstellen

```bash
neon branches create \
  --project-id <neon-project-id> \
  --parent development \
  --name preview/pr-<pull-request-number> \
  --expires-at <iso-8601-timestamp> \
  --output json
```

Die zurückgegebene Verbindungszeichenfolge wird als `DATABASE_URL` ausschließlich
in die passende Preview-Umgebung injiziert. Sie darf nicht in Logs, Artefakte,
Pull-Request-Kommentare oder das Repository geschrieben werden.

## Migration und Seed

Nach der Branch-Erstellung und vor dem Start der Anwendung:

```bash
pnpm db:migrate
```

Falls Beispieldaten benötigt werden, sind ausschließlich synthetische oder
nachweislich anonymisierte Daten zulässig. Migrationen werden nicht speziell für
Neon verändert und niemals rückwirkend umgeschrieben.

## Aufräumen

Beim Schließen oder Mergen des Pull Requests wird ausschließlich dessen exakt
ermittelter Preview-Branch gelöscht. Vor einer automatisierten Löschung müssen
Projekt-ID und Branch-ID aus vertrauenswürdigen Workflow-Daten stammen; freie
Benutzereingaben oder unaufgelöste Shell-Variablen sind nicht zulässig.

## Verifikation

- `DATABASE_URL` verweist im Preview-Deployment auf Neon, in Staging/Production
  auf Railway.
- Alle Migrationen wurden erfolgreich angewendet.
- Healthcheck und relevante Browser-Tests laufen gegen die Preview-Umgebung.
- Nach Schließen des Pull Requests existiert dessen Neon-Branch nicht mehr.
