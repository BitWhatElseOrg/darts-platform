# Zod-`jitless` robust verankern über `instrumentation-client.ts` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den einzigen verbliebenen Restpunkt aus der CSP-Nonce-Nacharbeit (`docs/superpowers/plans/2026-09-08-csp-nonce-nacharbeit.md`, Task 4) schliessen: `z.config({ jitless: true })` steht aktuell in `apps/web/src/components/providers.tsx` und funktioniert nur, weil Webpack diese Datei zufällig in den früh geladenen Layout-Chunk inlined — keine von Next.js zugesicherte Garantie. Ein Versuch, das nach `environment.ts` zu verschieben, hatte reproduzierbar eine neue Verletzung erzeugt (siehe Tier-3-Backlog). Diese Task verankert den Aufruf stattdessen in `apps/web/src/instrumentation-client.ts` — einem dedizierten Next.js-Framework-Hook (seit v15.3), der laut Doku garantiert *nach* dem HTML-Dokument, aber *vor* jeder React-Hydration ausgeführt wird.

**Vorab-Recherche (bereits durchgeführt, Ergebnis hier nur referenziert):** Ein Controller-Spike hat empirisch bestätigt, dass Next.js den Code aus `instrumentation-client.ts` in den eigenen `main-app`-Kern-Chunk kompiliert (`grep -l jitless .next/static/chunks/*.js` zeigt `main-app-*.js`/`main-*.js`, nicht einen separat geladenen Shared-Chunk) — das ist Next.js' eigener Bootstrap-Einstiegspunkt, kein Webpack-Bundling-Zufall wie bei der bisherigen Lösung. Fünf Szenarien wurden gegen einen frischen, nicht gecachten Produktivbuild getestet (`/`, `/offline`, `/liga/begegnungen`, `/live/begegnungen`, plus eine echte clientseitige Navigation `/liga/begegnungen` → `/` mit Marker-Beweis) — durchgängig 0 CSP-Verstösse, 0 `Function()`-Aufrufe. Diese Task wiederholt und dokumentiert diese Verifikation formal (Implementer soll sie unabhängig nachvollziehen, nicht nur das Ergebnis übernehmen).

**Architektur:** Ersetzt eine implizite (bundling-abhängige) Garantie durch eine vom Next.js-Framework selbst zugesicherte. Kein neues Verhalten, reine Verschiebung des Konfigurationsaufrufs.

**Tech Stack:** Next.js `instrumentation-client.ts` (Datei-Konvention, kein Export nötig), Zod v4 `z.config`, Playwright.

**Spec:** `docs/superpowers/plans/2026-09-08-csp-nonce-nacharbeit.md` (Task 4, inkl. des dokumentierten Restrisikos), `docs/superpowers/plans/2026-09-08-tier3-backlog-und-rueckfragen.md` (Abschnitt "CSP-Nonce — Nacharbeit", `jitless`-Punkt), `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md` (insbesondere Abschnitt "Execution timing" und "Polyfills" — das dort beschriebene Polyfill-Muster ist strukturell identisch mit unserem Anwendungsfall).

## Global Constraints

- Kein `any`, `strict: true` (AGENTS.md §5).
- Kein Verhaltensunterschied ausser der Reihenfolge-Garantie selbst — keine neue Zod-Validierungslogik.
- `apps/web/src/proxy.ts`, `content-security-policy.ts`, `layout.tsx`, alle fünf `force-dynamic`-Routen bleiben unverändert — diese Task betrifft ausschliesslich die `jitless`-Platzierung.

---

## Task 1: `z.config({ jitless: true })` nach `instrumentation-client.ts` verschieben

**Files:**
- Create: `apps/web/src/instrumentation-client.ts`
- Modify: `apps/web/src/components/providers.tsx` (Aufruf und Import entfernen)
- Modify: `docs/adr/0014-csp-nonce-static-rendering.md` (Nachtrag-Abschnitt aktualisieren)
- Modify: `docs/superpowers/plans/2026-09-08-tier3-backlog-und-rueckfragen.md` (`jitless`-Punkt als erledigt markieren)

**Interfaces:**
- Consumes: `z` aus `zod`.
- Produces: keine neue exportierte API.

- [ ] **Step 1: `instrumentation-client.ts` erstellen**

```ts
// apps/web/src/instrumentation-client.ts
import { z } from "zod";

// Zod prueft beim ersten Schema-Zugriff einmalig per `Function("")`, ob JIT-
// Kompilierung moeglich ist (Performance-Optimierung). Unter der erzwungenen
// CSP (kein 'unsafe-eval' in Production) schlaegt das fehl -- Zod faengt den
// Fehler bereits ab (kein Funktionsbruch), meldet aber einen echten
// `script-src`-Verstoss an `/api/v1/csp-reports`. `jitless` ist Zods eigenes
// Flag genau fuer "environments that disallow eval".
//
// `instrumentation-client.ts` ist Next.js' dedizierter Hook fuer genau
// diesen Fall: garantiert nach dem HTML-Dokument, aber vor jeder
// React-Hydration ausgefuehrt (Next.js-Doku, "Execution timing",
// analog zum dort beschriebenen Polyfill-Muster). Next.js kompiliert
// diesen Code in seinen eigenen `main-app`-Bootstrap-Chunk -- eine vom
// Framework zugesicherte Ausfuehrungsreihenfolge, nicht ein
// Webpack-Bundling-Zufall wie die vorherige Platzierung in
// `providers.tsx` (siehe `docs/adr/0014-csp-nonce-static-rendering.md`).
z.config({ jitless: true });
```

- [ ] **Step 2: `providers.tsx` bereinigen**

`apps/web/src/components/providers.tsx`: den `import { z } from "zod";` und den gesamten `z.config`-Block samt Kommentar entfernen (zurück auf den Stand vor Commit `257bd22`, ohne den Zod-Bezug).

- [ ] **Step 3: Bestand prüfen**

Run: `grep -rn "jitless\|z.config" apps/web/src`
Expected: genau ein Treffer, in `instrumentation-client.ts`.

- [ ] **Step 4: Verifizieren — frischer Produktivbuild, mehrere Szenarien**

Diese Verifikation **muss** unabhängig durchgeführt werden, nicht nur das Ergebnis der Vorab-Recherche übernommen — dieselbe Lektion gilt hier wie beim vorherigen `environment.ts`-Versuch (der in ersten Tests auch gut aussah).

1. Echten Neubau erzwingen: `rm -rf apps/web/.next` (nicht nur `pnpm build`, das über Turbo-Cache einen alten Build wiederverwenden könnte, ohne den Quellcode neu zu kompilieren).
2. `pnpm build` (Root-Skript, lädt `.env`).
3. `cd apps/web && npx next start --port 3100` (Port vorher freihalten; **wichtig:** nach jedem Testlauf explizit den Kindprozess beenden, nicht nur den `npx`-Elternprozess — `npx next start` startet `next-server` als Subprozess, ein `kill` auf die npx-PID allein lässt ihn manchmal weiterlaufen; mit `ss -ltnp | grep 3100` nach dem Beenden verifizieren, dass der Port wirklich frei ist).
4. Gegen mindestens diese fünf Szenarien prüfen (Playwright, `securitypolicyviolation`-Wache plus `window.Function`-Konstruktor-Instrumentierung wie in Task 1 des Nacharbeit-Plans, oder Wiederverwendung von `tests/production-csp.spec.ts`/`playwright.prod.config.ts` aus diesem Repo, falls das einfacher ist):
   - `/` (übt `ApplicationDashboard → auth-client.ts → environment.ts` aus — genau der Pfad, an dem die `environment.ts`-Platzierung scheiterte)
   - `/offline`
   - `/liga/begegnungen`
   - `/live/begegnungen`
   - Eine echte clientseitige Navigation (Klick auf einen `next/link`, nicht `page.goto`) von einer dieser Routen zurück zu `/`, mit Marker-Beweis (`window.__navMarker` überlebt den Klick), dass es sich um eine echte SPA-Transition handelt.

   Expected: **0** CSP-Verstösse in allen fünf Szenarien, `globalThis.__zod_globalConfig.jitless === true` (per `page.evaluate`).

5. **Falls auch nur ein einziger Verstoss auftritt:** nicht committen, BLOCKED melden mit vollständigen Details — nicht versuchen, die Platzierung eigenmächtig weiter anzupassen (das hat beim vorherigen Versuch schon eine Runde gekostet).

- [ ] **Step 5: `pnpm --filter @darts-platform/web test:e2e:prod` laufen lassen**

Run: `cd apps/web && pnpm test:e2e:prod`
Expected: 5/5 grün (bestehende Suite aus der Nacharbeit, deckt bereits `'strict-dynamic'` und `jitless` ab — jetzt gegen die neue Platzierung).

- [ ] **Step 6: Bestehende Tests laufen lassen**

Run: `cd apps/web && npx vitest run --dir src` und `pnpm test:e2e` (Root-Skript)
Expected: Beide unverändert grün — diese Task ändert keine Validierungslogik.

- [ ] **Step 7: ADR 0014 und Tier-3-Backlog aktualisieren**

`docs/adr/0014-csp-nonce-static-rendering.md`: den Abschnitt "Nachtrag: `'strict-dynamic'` (2026-09-08, Folgeplan)" um einen Satz ergänzen, der auf diese neue, robuste `jitless`-Platzierung verweist (kein eigenes neues ADR nötig — das ist dieselbe Entscheidungsfamilie, kein neuer Architekturkonflikt, nur eine Korrektur der Platzierung).

`docs/superpowers/plans/2026-09-08-tier3-backlog-und-rueckfragen.md`: den Punkt "`jitless`-Platzierung nur empirisch, nicht garantiert robust — bleibt offen" auf erledigt umstellen (durchstreichen, kurzer Verweis auf diesen Plan).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/instrumentation-client.ts apps/web/src/components/providers.tsx docs/adr/0014-csp-nonce-static-rendering.md docs/superpowers/plans/2026-09-08-tier3-backlog-und-rueckfragen.md
git commit -m "fix(web): Zod jitless ueber instrumentation-client.ts statt providers.tsx verankern"
```

---

## Self-Review

- **Spec-Abdeckung:** Schliesst den einzigen verbliebenen Punkt aus der CSP-Nonce-Nacharbeit.
- **Platzhalter-Scan:** keine.
- **Risiko:** Dieselbe Klasse Risiko wie die vorherigen CSP-Tasks (läuft auf jeder Anfrage, jede Seite). Die Vorab-Recherche hat das bereits einmal gründlich verifiziert (5 Szenarien, frischer Build, Marker-bewiesene clientseitige Navigation) — Step 4 verlangt trotzdem eine unabhängige Wiederholung, nicht ein Abnicken der Controller-Ergebnisse, aus genau der Lehre, die der gescheiterte `environment.ts`-Versuch hinterlassen hat (auch der sah in ersten, weniger gründlichen Tests gut aus).
