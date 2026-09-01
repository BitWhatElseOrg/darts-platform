# ADR 0011: Datenbankstrategie für Development und Preview

- Status: Akzeptiert
- Datum: 2026-08-29

## Kontext

Lokale Entwicklung, Pull-Request-Previews, Staging und Production benötigen
unterschiedliche Lebenszyklen und Schutzklassen. Preview-Umgebungen sollen
isoliert, schnell erzeugbar und nach Abschluss eines Pull Requests entfernbar
sein. Production-Daten dürfen dabei weder zur Abhängigkeit einer
Preview-Umgebung werden noch unkontrolliert in einen anderen Dienst gelangen.

## Entscheidung

- Railway PostgreSQL ist die persistente Datenbank für `staging` und
  `production` und bleibt dort Source of Truth.
- Neon wird ausschließlich in einem nicht-produktiven Projekt für langlebige
  Development-Branches und kurzlebige Pull-Request-Preview-Branches verwendet.
- Jeder Preview-Branch erhält eine eigene `DATABASE_URL` als Secret der
  zugehörigen Deployment-Umgebung. Zugangsdaten werden nie committet oder in
  Browser-Bundles exponiert.
- Preview-Branches entstehen aus einer nicht-produktiven Development-Baseline,
  niemals aus einer Production-Datenbank.
- Auf jeden neuen Branch werden die unveränderten, versionierten
  Drizzle-Migrationen angewendet. Bestehende Migrationen werden auch für
  Preview-Umgebungen nicht umgeschrieben.
- Test- und Demodaten werden synthetisch erzeugt. Unmaskierte Production-Daten
  dürfen Neon nicht erreichen.
- Preview-Branches erhalten ein Ablaufdatum oder werden nach Schließen des Pull
  Requests gelöscht. Langlebige Development-Branches werden regelmäßig
  bereinigt.
- Die CI-Testdatenbank bleibt ein kurzlebiger PostgreSQL-Service-Container; CI
  benötigt keine Neon-Zugangsdaten.

## Folgen

- Fehlerhafte Migrationen und Schemaänderungen lassen sich pro Feature isoliert
  prüfen, ohne Production oder Staging zu beeinflussen.
- Preview-Deployments benötigen Automatisierung für Branch-Erstellung,
  Secret-Injektion, Migration und Aufräumen.
- Vendor-spezifische Neon-Logik bleibt außerhalb der Domain- und
  Anwendungspakete. Die Anwendung konsumiert weiterhin nur `DATABASE_URL` und
  bleibt PostgreSQL-portabel.
- Production-Wiederherstellung, Backups und Rollbacks bleiben vollständig im
  Railway-Betriebsmodell.
