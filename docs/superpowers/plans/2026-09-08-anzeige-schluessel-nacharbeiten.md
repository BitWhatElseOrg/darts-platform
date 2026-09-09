# Anzeige-Schlüssel Release-Nacharbeiten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die vier als "bekannte Folgearbeit" dokumentierten, nicht-blockierenden Punkte aus dem Anzeige-Schlüssel-/Realtime-Release (PR #30, #31, deployt via PR #32 am 2026-09-08) abschliessen.

**Architektur:** Vier unabhängige, kleine Änderungen ohne gemeinsame Abhängigkeit — jede Task ist einzeln committ- und testbar. Keine Migration, keine neue Berechtigung, kein neuer Endpunkt.

**Tech Stack:** TypeScript, React (Client Component), Vitest, `@testing-library/react` (happy-dom), NestJS, Zod.

**Spec:** Kein eigenes Spec-Dokument — die vier Punkte stehen als "Bekannte Folgearbeiten aus Plan 2" in der Memory-Notiz `oeffentliche-turnier-ids` und sind hier erstmals in Tasks überführt. Hintergrund: `docs/adr/0013-oeffentliche-turnier-adressen.md`.

## Global Constraints

- Kein `any` ausser technisch zwingend und dokumentiert (AGENTS.md §5).
- TypeScript `strict: true`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` müssen nach jeder Task grün bleiben.
- Deutsche Kommentare/Bezeichner folgen dem bestehenden Stil des Repos (kurze Begründungssätze, kein Wiederholen von Code in Prosa).

---

## Task 1: Copy-Button im Anzeige-Schlüssel-Panel setzt "Kopiert" nach einer Weile zurück

**Files:**
- Modify: `apps/web/src/components/tournament/display-keys-panel.tsx:58, 100-107, 131-133`
- Test: `apps/web/src/components/tournament/display-keys-panel.render.spec.tsx` (neu)

**Interfaces:**
- Consumes: nichts Neues — `useState`, `navigator.clipboard.writeText` (bereits vorhanden).
- Produces: keine neue exportierte API. `copySecret` erhält einen Rückstell-Timer; Verhalten nach aussen unverändert ausser dem Reset.

**Kontext:** Aktuell setzt `copySecret` (Zeile 100-107) `copied` auf `true` und nie wieder zurück ausser bei neuer Schlüsselausstellung (Zeile 81, `onSuccess` von `issue`). Der Button bleibt nach einem Klick dauerhaft auf "Kopiert" stehen.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```tsx
// apps/web/src/components/tournament/display-keys-panel.render.spec.tsx
// @vitest-environment happy-dom
//
// Konvention aus Tier 1: Komponenten-Tests mit echtem DOM holen sich die
// Umgebung ueber die Pragma-Zeile (siehe `live-encounter.render.spec.tsx`).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ apiRequest: vi.fn(), userFacingErrorMessage: vi.fn() }));
vi.mock("@/lib/api-client", () => client);

import { DisplayKeysPanel } from "./display-keys-panel";

function renderPanel(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(DisplayKeysPanel, {
        canManageDisplayKeys: true,
        organizationId: "org-1",
        tournamentId: "tour-1",
      }),
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  client.apiRequest.mockImplementation(({ method }: { method?: string }) => {
    if (method === "POST") {
      return Promise.resolve({
        id: "key-1",
        label: "Eingang Halle",
        secret: "geheim-123",
        expiresAt: new Date("2026-09-10T00:00:00.000Z"),
        revokedAt: null,
        state: "valid",
      });
    }
    return Promise.resolve({ keys: [] });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DisplayKeysPanel Copy-Button", () => {
  it("setzt 'Kopiert' nach der Anzeigedauer wieder auf 'Kopieren' zurueck", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("navigator", { clipboard });

    renderPanel();
    screen.getByLabelText("Bezeichnung").focus();
    await vi.waitFor(() => screen.getByRole("button", { name: "Schlüssel ausstellen" }));
    screen.getByPlaceholderText("z. B. Eingang Halle").dispatchEvent(new Event("input", { bubbles: true }));

    // Schluessel ausstellen, dann kopieren.
    const form = screen.getByRole("button", { name: "Schlüssel ausstellen" }).closest("form");
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => screen.getByText("geheim-123"));

    screen.getByRole("button", { name: "Kopieren" }).click();
    await waitFor(() => screen.getByRole("button", { name: "Kopiert" }));

    vi.advanceTimersByTime(2_000);

    await waitFor(() => screen.getByRole("button", { name: "Kopieren" }));
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `cd apps/web && npx vitest run src/components/tournament/display-keys-panel.render.spec.tsx`
Expected: FAIL — der Button bleibt nach 2000ms auf "Kopiert" stehen (kein Timeout implementiert).

- [ ] **Step 3: Minimale Implementierung**

`apps/web/src/components/tournament/display-keys-panel.tsx`:

```tsx
// Zeile 58 ergänzen:
const [copied, setCopied] = useState(false);
const copyResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
```

```tsx
// Zeilen 100-107 ersetzen:
async function copySecret(secret: string) {
  try {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    if (copyResetTimeout.current !== null) clearTimeout(copyResetTimeout.current);
    copyResetTimeout.current = setTimeout(() => setCopied(false), 2_000);
  } catch {
    setCopied(false);
  }
}
```

Import `useRef` zusätzlich zu `useState` aus `"react"` (Zeile 12).

Zusätzlich beim Unmount aufräumen (nach der Definition der Mutations, vor `if (!canManageDisplayKeys) return null;`):

```tsx
useEffect(() => () => {
  if (copyResetTimeout.current !== null) clearTimeout(copyResetTimeout.current);
}, []);
```

(`useEffect` zusätzlich aus `"react"` importieren.)

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `cd apps/web && npx vitest run src/components/tournament/display-keys-panel.render.spec.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/tournament/display-keys-panel.tsx apps/web/src/components/tournament/display-keys-panel.render.spec.tsx
git commit -m "fix(web): Kopiert-Status im Anzeige-Schluessel-Panel nach Timeout zuruecksetzen"
```

---

## Task 2: `publicIdOf` — AGENTS.md-§14-Ausnahme dokumentieren

**Files:**
- Modify: `apps/api/src/realtime/publish-outbox.ts:41-77`

**Interfaces:**
- Consumes: nichts.
- Produces: keine Verhaltensänderung — reiner Kommentar.

**Kontext:** `publicIdOf` (Zeilen 52-77) nimmt `internalId` ohne `organizationId` entgegen und filtert nur nach `tournaments.id`/`encounters.id`. Das widerspricht wörtlich AGENTS.md §14 ("Jede tenant-bezogene Repository-Funktion erhält explizit: `organizationId`"). Die Abweichung ist inhaltlich unproblematisch (die IDs sind global eindeutige UUIDs, kein Cross-Tenant-Leak möglich, und der Aufrufer im Outbox-Relay kennt die `organizationId` an dieser Stelle noch nicht zwangsläufig), aber unbegründet im Code — das holt dieser Task nach.

- [ ] **Step 1: Kommentar ergänzen**

`apps/api/src/realtime/publish-outbox.ts`, direkt vor der Funktion `publicIdOf` (nach Zeile 50, vor Zeile 52):

```ts
/**
 * Bewusste Abweichung von AGENTS.md §14 (explizite `organizationId` an jeder
 * tenant-bezogenen Repository-Funktion): `internalId` ist eine global
 * eindeutige UUID aus `tournaments.id`/`encounters.id`, die Abfrage kann also
 * nicht versehentlich eine Zeile einer fremden Organisation treffen, selbst
 * ohne den Filter. Der Aufrufer (`resolveScope` im Outbox-Relay) verarbeitet
 * Ereignisse mehrerer Organisationen im selben Tick und müsste die
 * `organizationId` sonst nur durchreichen, um sie hier ungenutzt zu prüfen.
 */
```

- [ ] **Step 2: Typecheck/Lint ausführen**

Run: `cd apps/api && npx tsc --noEmit && cd .. && pnpm --filter api lint`
Expected: PASS (keine Verhaltensänderung, reiner Kommentar)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/realtime/publish-outbox.ts
git commit -m "docs(api): AGENTS.md-Paragraph-14-Abweichung bei publicIdOf begruenden"
```

---

## Task 3: Expliziter Subpath-Export für `display-key-secret` statt impliziter Deep-Import

**Files:**
- Modify: `packages/domain/package.json`
- Modify: `packages/domain/tsconfig.build.json` (falls der Build den Subpath nicht automatisch mit mitbaut — siehe Step 1)
- Modify: `apps/api/src/tournaments/display-keys.service.ts:7`
- Modify: `packages/domain/src/index.ts:37-46` (Kommentar anpassen, Verweis auf jetzt explizites `exports`-Feld statt "funktioniert mangels exports-Feld")

**Interfaces:**
- Consumes: nichts Neues.
- Produces: `@darts-platform/domain/display-key-secret` als offizieller, deklarierter Importpfad (statt `@darts-platform/domain/dist/display-key-secret.js`).

**Kontext:** `packages/domain/package.json` hat kein `"exports"`-Feld. Der Deep-Import in `display-keys.service.ts:7` funktioniert deshalb nur, weil Node/TypeScript ohne `"exports"` jeden Pfad unter dem Paket erlauben — das ist implizit und bricht stillschweigend, sobald jemand ein `"exports"`-Feld ergänzt (üblich, wenn ein Paket wächst). Ein explizites Subpath-Export macht die Absicht (serverseitiger Import, getrennt vom `node:crypto`-freien Barrel) zum deklarierten Vertrag.

- [ ] **Step 1: Aktuellen Build-Output prüfen**

Run: `ls packages/domain/dist/display-key-secret.*`
Expected: `dist/display-key-secret.js` und `dist/display-key-secret.d.ts` existieren bereits (aus `tsc -p tsconfig.build.json`, kompiliert jede Datei unter `src/` einzeln nach `dist/`) — kein Anpassungsbedarf am Build selbst, nur am `package.json`.

- [ ] **Step 2: `exports`-Feld ergänzen**

`packages/domain/package.json`:

```json
{
  "name": "@darts-platform/domain",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./display-key-secret": {
      "types": "./dist/display-key-secret.d.ts",
      "default": "./dist/display-key-secret.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 3: Importpfad in `display-keys.service.ts` umstellen**

`apps/api/src/tournaments/display-keys.service.ts:7`:

```ts
// vorher:
import { createDisplayKeySecret, hashDisplayKeySecret } from "@darts-platform/domain/dist/display-key-secret.js";
// nachher:
import { createDisplayKeySecret, hashDisplayKeySecret } from "@darts-platform/domain/display-key-secret";
```

- [ ] **Step 4: Barrel-Kommentar anpassen**

`packages/domain/src/index.ts:37-46`, letzten Satz ersetzen — statt "Server-seitige Aufrufer … importieren deshalb direkt aus `@darts-platform/domain/dist/display-key-secret.js`" neu:

```ts
// Server-seitige Aufrufer (bisher nur `display-keys.service.ts`) importieren
// deshalb ueber den expliziten Subpath-Export `@darts-platform/domain/display-key-secret`
// (siehe `package.json` -> `exports`), nicht ueber diesen Barrel.
```

- [ ] **Step 5: Build und Typecheck über beide Pakete ausführen**

Run: `pnpm --filter @darts-platform/domain build && pnpm --filter api typecheck && pnpm --filter web build`
Expected: PASS. Der Web-Build ist der eigentliche Testfall dieser Task: Er muss weiterhin erfolgreich bauen, weil `display-key-secret` **nicht** im neuen `"."`-Export auftaucht und damit nicht ins Client-Bundle gezogen werden kann. Ein Fehlschlag mit "Reading from 'node:crypto' is not handled by plugins" würde bedeuten, dass der Subpath versehentlich doch im Hauptexport gelandet ist.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/package.json packages/domain/src/index.ts apps/api/src/tournaments/display-keys.service.ts
git commit -m "refactor(domain): expliziten Subpath-Export fuer display-key-secret statt impliziten Deep-Import"
```

---

## Task 4: Regressionstest für `apiRequest` bei leerem 2xx-Body

**Files:**
- Modify: `apps/web/src/lib/api-client.spec.ts`

**Interfaces:**
- Consumes: `apiRequest` (unverändert, `apps/web/src/lib/api-client.ts:143`).
- Produces: keine neue API — reiner Testzuwachs für bestehendes, aktuell korrektes Verhalten.

**Kontext:** `apiRequest` behandelt einen leeren Erfolgs-Body bereits richtig (`raw.trim() === "" ? undefined : JSON.parse(raw)`, Zeile 143) — z. B. bei `HttpCode(204)` beim Widerruf eines Anzeige-Schlüssels. Abgesichert ist das bisher nur durch einen E2E-Schritt, nicht durch einen Unit-Test in `api-client.spec.ts`. Diese Task fügt den fehlenden Unit-Test hinzu; **kein** Produktivcode ändert sich.

- [ ] **Step 1: Test schreiben**

`apps/web/src/lib/api-client.spec.ts`, neuer `it`-Block innerhalb `describe("apiRequest", ...)`, nach dem bestehenden letzten Test:

```ts
  it("akzeptiert einen leeren Koerper auf dem Erfolgspfad (z. B. HTTP 204)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 204 }));

    await expect(apiRequest({ path: "/probe", schema: z.void() })).resolves.toBeUndefined();
  });
```

- [ ] **Step 2: Test ausführen, Erfolg bestätigen**

Run: `cd apps/web && npx vitest run src/lib/api-client.spec.ts`
Expected: PASS — bestätigt bestehendes Verhalten. Sollte der Test unerwartet fehlschlagen, ist das ein echter Regressionsfund und keine Aufgabe dieser Task mehr (siehe `systematic-debugging`, nicht blind anpassen).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api-client.spec.ts
git commit -m "test(web): Regressionstest fuer apiRequest bei leerem 2xx-Koerper ergaenzen"
```

---

## Self-Review

- **Spec-Abdeckung:** Alle vier in der Memory-Notiz `oeffentliche-turnier-ids` genannten "Bekannten Folgearbeiten aus Plan 2" sind abgedeckt. Der fünfte, dort separat gelistete Punkt ("Widerruf trennt kein verbundenes Gerät") ist bewusst **nicht** Teil dieses Plans — laut ADR 0013 braucht er ein eigenes Design wegen der zirkulären `RealtimeModule`/`TournamentsModule`-Abhängigkeit, siehe Backlog-Notiz.
- **Platzhalter-Scan:** Keine TBD/TODO-Marker, jeder Code-Block ist vollständig.
- **Typkonsistenz:** `copySecret`, `copyResetTimeout`, `publicIdOf`-Signatur bleiben über alle Tasks hinweg unverändert benannt.
