# Dokumentation auf den Stand vom 22.09.2026 bringen

Stand: 22.09.2026

## Problem

Die Bedienungsanleitung (`apps/web/public/bedienungsanleitung.html`) stammt vom
15.09.2026. Seither sind Funktionen dazugekommen, die sie nicht kennt, und der
gesamte Liga-Bereich fehlt ihr von Anfang an. Die Wurzel-Dokumente README,
PRODUCT, ROADMAP und DESIGN stehen auf dem Stand vom 04./05.09.2026 und
beschreiben ein Monorepo, das es so nicht mehr gibt.

Nachgewiesene Lücken:

| Dokument | Befund |
| --- | --- |
| Bedienungsanleitung | kein Treffer für Begegnung, Mannschaft, Profilbild, Zustellung, Anzeige-Schlüssel; «Liga» genau einmal |
| README.md | `packages/notifications` fehlt im Monorepo-Baum; Worker nur als Statistikverarbeitung beschrieben |
| AGENTS.md | listet `apps/realtime`, `packages/integrations`, `packages/ranking-engine`, die nicht existieren; kennt `packages/notifications` nicht |
| DATABASE_SCHEMA.md | acht Tabellen fehlen: `accounts`, `sessions`, `verifications`, `competition_slots`, `encounter_lineup_entries`, `encounter_substitutions`, `match_participant_players`, `tournament_display_keys`; Migration 0034 nicht erwähnt |
| PRODUCT.md, ROADMAP.md, DESIGN.md | kennen weder E-Mail-Versand noch Profilbilder, Einzelrangliste oder das Staging-Environment |
| infrastructure/README.md, neon-preview.md, .railway/README.md | Stand 29.08.–01.09.2026, vor dem Staging-Environment |

## Umfang

Angefasst werden ausschliesslich lebende Dokumente:

```text
apps/web/public/bedienungsanleitung.html
README.md
ARCHITECTURE.md
PRODUCT.md
ROADMAP.md
DESIGN.md
DATABASE_SCHEMA.md
AGENTS.md
infrastructure/README.md
infrastructure/neon-preview.md
.railway/README.md
```

Bewusst **nicht** angefasst:

- `docs/superpowers/plans/`, `docs/superpowers/specs/`, `docs/testing/protokolle/`,
  `docs/adr/`, `.impeccable/` — historische Artefakte. Sie halten einen Zeitpunkt
  fest; ein nachträglich umgeschriebener Plan verliert seinen Beweiswert. Neue
  Entscheidungen bekommen eigene ADRs, bestehende werden höchstens als abgelöst
  markiert.
- `LIGA-REGLEMENT.md`, `DRA-REGELWERK.md` — externe Regelwerke, nicht unsere
  Dokumentation.
- `infrastructure/railway.md` — mit PR #66 bereits auf dem Stand vom 21.09.2026.
- `.claude/`, `.agents/` — Werkzeugkonfiguration Dritter.

## Bedienungsanleitung

Gliederung und Ton bleiben. Neue Kapitel an den logisch passenden Stellen:

1. Organisation selbst erstellen, inklusive des Hinweises, dass die Schaltfläche
   nur bei offener Selbstbedienung erscheint.
2. Einladung per E-Mail: Zustellstatus in der Mitgliederliste, «Erneut senden»
   mit der Sperre von 60 Sekunden, Einladungslink als Rückfallweg,
   Einladungsseite mit Vorschau.
3. Passwort vergessen und neues Passwort setzen.
4. Spielerprofilbild hochladen, ersetzen, entfernen.
5. Spieler mit einem Konto verknüpfen.
6. Liga und Begegnungen: Liga anlegen, Spieltag, Aufstellung und Nominierung,
   Wertung nach Reglement. Der grösste fehlende Block.
7. Einzelrangliste.
8. Anzeige-Schlüssel für die Board-Ansicht privater Turniere.

Korrekturen in bestehenden Kapiteln, jeweils gegen die heutige Oberfläche
geprüft: «Spieler anlegen» (der Spitzname ist wirklich optional), Turnierstart
meldet fehlende Angaben am Knopf, Live-Link erscheint erst bei Freigabe,
Verbindungspunkt der Live-Ansichten.

## Arbeitsweise

Jede Aussage wird vor dem Schreiben gegen Code, Schema oder Oberfläche geprüft,
nicht aus den Planungsdokumenten übernommen. Die Pläne beschreiben Absichten;
was davon wie umgesetzt wurde, steht im Code.

## Verifikation

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- `pnpm test:e2e` — ein Playwright-Fall ruft die Anleitung auf
- Ankerlinks und Inhaltsverzeichnis der HTML-Datei auf Konsistenz prüfen
- Dokumentierte Paket-, Tabellen- und Migrationslisten maschinell gegen den
  Bestand abgleichen

## Lieferung

Ein Zweig `docs/dokumentation-aktualisieren` mit thematisch getrennten Commits
(Anleitung, Wurzel-Dokumente, Infrastruktur), ein Pull Request nach `develop`.
