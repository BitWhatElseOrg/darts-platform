---
description: Commit, push and deploy the current branch (quality gates -> commit -> push -> CI -> Railway)
argument-hint: [optional commit message]
---

Du führst den `/ship`-Workflow aus: commiten, pushen und deployen. Folge den
Regeln aus `AGENTS.md` (insb. Abschnitt 20 „Tests vor Abschluss“, Abschnitt 22
„Git“ und dem Workflow-Diagramm) sowie `infrastructure/railway.md` für den
Deployment-Teil. Arbeite die Schritte der Reihe nach ab und brich bei
Fehlschlägen sofort ab, statt sie zu ignorieren.

Optionales Argument `$ARGUMENTS`: falls angegeben, als Commit-Message-Vorschlag
verwenden (muss Conventional-Commits-Format haben, sonst anpassen). Ohne
Argument die Message aus dem tatsächlichen Diff ableiten.

## 1. Zustand prüfen

- `git status` und `git diff` (bzw. `git diff --staged`) ansehen. Nur Dateien
  shippen, die zur aktuellen Änderung gehören — keine unbeabsichtigten Dateien
  (`.env`, Secrets, generierte Artefakte, `.worktrees/`) mit einchecken.
- Aktuellen Branch feststellen (`git branch --show-current`).

## 2. Quality Gate (Abschnitt 20)

Vor jedem Commit ausführen und bei jedem Fehlschlag stoppen und den Fehler
melden statt weiterzumachen:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Wenn die Änderung relevantes UI betrifft, zusätzlich:

```bash
pnpm test:e2e
```

## 3. Commit

- Änderungen gezielt stagen (`git add <files>`, kein pauschales `-A`, wenn
  ungewollte Dateien im Status stehen).
- Commit mit Conventional-Commits-Message (`feat:`, `fix:`, `refactor:`,
  `test:`, `docs:`, `chore:`), kurz und verständlich (Abschnitt 22). **Keine**
  `Co-Authored-By`-Zeile anhängen.
- Keine Migrationsdateien rückwirkend verändern (Abschnitt 21) — bei
  Schemaänderungen eine neue versionierte Migration verwenden.

## 4. Push

- `git push` auf den aktuellen Branch (bei fehlendem Upstream mit `-u origin
  <branch>`).
- **Niemals** `--force`/`--force-with-lease` ohne explizite Rückfrage an den
  Nutzer.

## 5. Deploy-Pfad je nach Branch

Das Repo hat auf GitHub Free keine Required-Checks; Railway wartet über den
gemeinsamen GitHub-Source (`checkSuites: true`) dennoch auf grüne Check Suites
des Commits, bevor Web/API/Worker deployen (siehe `infrastructure/railway.md`,
Abschnitt „GitHub-CI-Gate“).

- **Branch ist `main`:** Push löst `.github/workflows/ci.yml` aus. Sobald CI
  grün ist, deployt Railway `@darts-platform/web`, `@darts-platform/api` und
  `@darts-platform/worker` im Projekt `dartbase`, Environment `production`,
  automatisch.
- **Branch ist `feature/*`, `fix/*`, `refactor/*`, `chore/*`:** Kein direktes
  Deployment. Stattdessen den Workflow aus `AGENTS.md` einhalten: PR nach
  `main` öffnen bzw. aktualisieren (`gh pr create` oder `gh pr view --web`
  falls schon vorhanden), PR-Beschreibung gemäß Abschnitt 23 (Problem, Lösung,
  Architektur-Auswirkung, DB-Migrationen, Tests, Security-Auswirkungen).
  Nicht selbstständig nach `main` mergen — das bleibt eine bewusste
  Entscheidung des Nutzers (PR-Agent-Review abwarten).

## 6. CI überwachen (nur bei Push auf `main` bzw. nach PR)

```bash
gh run list --branch <branch> --limit 1
gh run watch <run-id>
```

Bei rotem CI-Lauf: Ursache aus den Logs melden, **nicht** versuchen, das
Deployment trotzdem zu erzwingen.

## 7. Railway-Deployment verifizieren (nur bei Deploy auf `main`)

Nach grüner CI mit den Railway-MCP-Tools (Projekt `dartbase`, Environment
`production`) den Deploy-Status der drei App-Services prüfen:

- `mcp__railway__list-deployments` je Service (`@darts-platform/web`,
  `@darts-platform/api`, `@darts-platform/worker`)
- bei Auffälligkeiten `mcp__railway__get-logs` bzw.
  `mcp__railway__get-deployment-diagnosis`

Abschließend Smoke-Test wie im Runbook:

```bash
curl --fail https://api.dartbase.ch/api/v1/health
curl --fail https://dartbase.ch/
```

## 8. Zusammenfassung

Am Ende kurz berichten:

- welcher Commit gepusht wurde (Hash + Message)
- Branch und ob PR erstellt/aktualisiert wurde
- CI-Ergebnis
- Railway-Deploy-Status je Service (oder: „kein Deploy, da Feature-Branch“)
- ggf. offene Probleme, die der Nutzer selbst entscheiden muss
