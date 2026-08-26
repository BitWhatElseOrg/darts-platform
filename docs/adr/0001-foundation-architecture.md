# ADR 0001: Foundation als modularer Monolith

- Status: Akzeptiert
- Datum: 2026-08-26

## Kontext

Die Plattform benötigt klare Domänengrenzen und eine zuverlässige lokale Entwicklungsumgebung, ohne den Betriebs- und Transaktionsaufwand früher Microservices einzuführen. Phase 0 umfasst ausschließlich Web, API, gemeinsame Foundation-Pakete, PostgreSQL und Redis.

## Entscheidung

- Die Codebasis wird als pnpm-/Turborepo-Monorepo organisiert.
- Next.js und NestJS sind getrennte Anwendungen, werden lokal aber als ein Produkt betrieben.
- Gemeinsame Typen, Schemas, UI, Konfiguration und Datenbankzugriffe liegen in expliziten Paketen.
- PostgreSQL ist die Source of Truth. Redis dient in Phase 0 nur als geprüfte Infrastrukturabhängigkeit.
- Das Datenbankschema enthält ausschließlich `users`, `organizations`, `memberships` und `players`.
- Domain-Pakete importieren keine Frameworks oder Infrastrukturtreiber.

## Konsequenzen

- Fachmodule können später innerhalb desselben Deployments ergänzt und transaktional umgesetzt werden.
- Package-Grenzen machen unerwünschte Infrastrukturabhängigkeiten sichtbar.
- Realtime, Worker und Engines werden erst in ihren Roadmap-Phasen angelegt.
- Eine spätere Service-Extraktion bleibt möglich, benötigt aber einen nachgewiesenen Betriebs- oder Skalierungsgrund und ein eigenes ADR.
