# Tier 2 – Teil E: Frontend-Konsistenz und Test-/CI-Lücken

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Oberfläche entscheidet Berechtigungen nur noch über die geteilte Domain-Funktion (und eine Lint-Regel hält das fest), die drei offenen Web-Nachläufer aus dem Tier-1-Abschluss sind behoben, und die drei blinden Flecken der Testpyramide — HTTP-/Guard-Ebene, `boards`-Modul, gestartete Deployment-Images — haben eine Absicherung.

**Architecture:** Von billig nach teuer und von innen nach aussen. Erst die reine Umbenennung (kein Verhalten), dann die Oberfläche samt Lint-Schutz, dann die drei kleinen Web-Korrekturen, dann die beiden neuen API-Testebenen, zuletzt die CI-Rauchtests der Container. Kein Task verschiebt Business-Logik in die Oberfläche: die Komponenten blenden weiter nur aus, der Server entscheidet unverändert.

**Tech Stack:** TypeScript strict, pnpm, Turborepo, Next.js/React, NestJS/Fastify, Drizzle ORM, PostgreSQL, Zod, Vitest, `@testing-library/react` + happy-dom (seit Tier 1), Playwright, Docker, GitHub Actions.

**Spec:**
- `/tmp/claude-1000/-home-sut-projects-darts-platform/70688d40-4244-406a-b67f-18e37ab90b1a/scratchpad/audit/E-frontend.md` — Important 1 (Rollen-Arrays)
- `/tmp/claude-1000/-home-sut-projects-darts-platform/70688d40-4244-406a-b67f-18e37ab90b1a/scratchpad/audit/G-tests-qs.md` — Important 1, 2, 4, 6 und die Empfehlung zur DOM-Testumgebung
- Web-Nachläufer aus dem Tier-1-Abschluss-Review (kein Auditbericht; im Auftrag als Text übergeben, hier in Task 3 bis 5 ausformuliert)
- Regelwerk: `AGENTS.md` §4, §13, §18, §20, §24; `ARCHITECTURE.md` §32; `.github/workflows/ci.yml`

## Global Constraints

- Server entscheidet. Die Oberfläche blendet nur aus; keine Berechtigungs- oder Turnierlogik in React-Komponenten (AGENTS.md §4, §13).
- `strict: true`; kein `any`, `unknown` statt `any`, exhaustive `switch`.
- Kommentare und Oberflächentexte auf Deutsch (Schweizer Rechtschreibung, kein ß), Code-Bezeichner auf Englisch — wie im Bestand.
- Conventional Commits mit deutschem Betreff, kleine Commits, jeder Task endet mit mindestens einem Commit.
- Commit-Nachrichten tragen **keinen** `Co-Authored-By`-Trailer (Repo-Regel in `CLAUDE.md`). Ältere Pläne in diesem Verzeichnis zeigen ihn noch — nicht übernehmen.
- Web-Tests: `pnpm --filter @darts-platform/web test` (läuft `vitest run --dir src`, Node-Umgebung).
- Hook-/DOM-Tests: Dateiname `*.hook.spec.ts` mit der Pragma-Zeile `// @vitest-environment happy-dom` in Zeile 1 — Konvention aus Tier 1, siehe `apps/web/src/lib/use-offline-queue.hook.spec.ts`.
- API-Tests einzeln: aus `apps/api` heraus `npx dotenv -e ../../.env -- npx vitest run <pfad>`; `pnpm --filter … test -- <pfad>` filtert **nicht**.
- Integrationstests brauchen die laufende lokale Infrastruktur: `pnpm infra:up`.
- Vor Abschluss jedes Tasks: `pnpm lint`, `pnpm typecheck`, `pnpm test`. Am Planende zusätzlich `pnpm build` und `pnpm test:e2e` (ein Worker, im Root-Skript konfiguriert; E2E-Aufruf: `npx dotenv -e .env -- pnpm test:e2e`).
- `pnpm build` braucht `NODE_ENV`; ohne die Variable bricht der Web-Prerender mit einem irreführenden React-Fehler ab (Root-Skript setzt sie bereits).
- Die CI-Änderung aus Task 8 lässt sich lokal nur per `docker build`/`docker run` prüfen. Der lokale Trockenlauf ist Teil des Tasks; läuft Docker lokal nicht, ist der Nachweis ausschliesslich der CI-Lauf auf dem PR — das gehört dann so in die PR-Beschreibung.

## Nicht mehr zutreffend

Beim Lesen des Codes auf `fix/audit-tier2` (HEAD `79095cf`) traf **kein** Befund dieses Plans weniger zu als im Bericht beschrieben. Drei Präzisierungen, damit niemand doppelt sucht:

1. **G-I2:** `apps/api/src/boards/` hat weiterhin keine einzige Spec-Datei. `board-occupancy.ts` (dort ebenfalls abgelegt) ist über `apps/api/src/tournaments/board-occupancy.integration.spec.ts` abgedeckt — der `BoardsService` selbst nicht. Es wird also ergänzt, nicht gedoppelt.
2. **E-I1:** neun Vorkommen in sechs Dateien (`roster-route.tsx` trägt drei, `match-scoreboard-route.tsx` zwei).
3. **Web-Nachläufer:** `apps/web/src/lib/health.ts` prüft `response.ok` bereits vor dem Lesen des Körpers und ist von der Korrektur in Task 3 nicht betroffen.

## File Structure

**Neu:**

| Datei | Verantwortung |
| --- | --- |
| `apps/web/src/lib/api-client.spec.ts` | Antwortbehandlung von `apiRequest`: Status vor Körper |
| `apps/web/src/lib/use-online-flush.ts` | Hook: beim `online`-Ereignis genau einen Übertragungslauf starten |
| `apps/web/src/lib/use-online-flush.hook.spec.ts` | Tests dazu (happy-dom) |
| `apps/api/src/boards/boards.integration.spec.ts` | `BoardsService`: Anlegen, Namenskonflikt, Berechtigung, Mandantengrenze |
| `apps/api/src/common/http-boundary.spec.ts` | `AuthGuard` + `ApiExceptionFilter` über echtes Nest-HTTP |

**Umbenannt:**

| Vorher | Nachher |
| --- | --- |
| `apps/api/src/development/seed-development.spec.ts` | `apps/api/src/development/seed-development.integration.spec.ts` |
| `apps/api/src/operations/demo-organization-seed.spec.ts` | `apps/api/src/operations/demo-organization-seed.integration.spec.ts` |
| `apps/api/src/operations/production-bootstrap.spec.ts` | `apps/api/src/operations/production-bootstrap.integration.spec.ts` |

**Geändert:**

| Datei | Änderung |
| --- | --- |
| `eslint.config.mjs` | `no-restricted-syntax`: Rollenlisten mit `.includes(` in `apps/web/src/**` verboten |
| `apps/web/src/components/tournament/tournament-list.tsx` | `hasOrganizationPermission(role, "tournament:create")` |
| `apps/web/src/components/tournament/tournament-setup-route.tsx` | dito |
| `apps/web/src/components/tournament/tournament-dashboard-route.tsx` | `"tournament:update"` |
| `apps/web/src/components/match/match-scoreboard-route.tsx` | `"match:score"` / `"match:abort"` |
| `apps/web/src/components/match-workspace.tsx` | `"board:manage"` / `"match:create"`, je Formular getrennt |
| `apps/web/src/components/players/roster-route.tsx` | `"organization:manage_members"` / `"player:create"` / `"player:update"` / `"player:archive"` |
| `apps/web/src/lib/api-client.ts` | Status vor Körper, toleranter Fehlerkörper |
| `apps/web/src/lib/offline-replay.ts` | `replayAnnouncement`, Kommentar zu `pendingOnline` nachgezogen |
| `apps/web/src/lib/offline-replay.spec.ts` | Tests für `replayAnnouncement`, Begründung des SyntaxError-Falls nachgezogen |
| `apps/web/src/components/tournament/command-centre.tsx` | Meldung aus `acceptedCount`, Übertragung beim `online`-Ereignis |
| `apps/worker/src/main.ts` | eine Startzeile im Log (der Worker hat keinen Health-Pfad) |
| `.github/workflows/ci.yml` | Images laden, starten und prüfen |
| `ARCHITECTURE.md` §32 | Namenskonvention der Testdateien, HTTP-Ebene, Image-Rauchtest |

**Reihenfolge:** Task 4 und Task 5 ändern beide `command-centre.tsx` an verschiedenen Stellen. Sie laufen nacheinander, nie parallel.

---

### Task 1: DB-Tests heissen wie DB-Tests (G-I6)

**Files:**
- Rename: `apps/api/src/development/seed-development.spec.ts` → `seed-development.integration.spec.ts`
- Rename: `apps/api/src/operations/demo-organization-seed.spec.ts` → `demo-organization-seed.integration.spec.ts`
- Rename: `apps/api/src/operations/production-bootstrap.spec.ts` → `production-bootstrap.integration.spec.ts`

**Interfaces:** keine. Reine Umbenennung, kein Inhalt ändert sich.

Die drei Dateien instanziieren `Pool`/`drizzle(...)` und brauchen `DATABASE_URL`, heissen aber wie die reinen Unit-Tests des Repos. Die übrigen dreizehn DB-Tests tragen `*.integration.spec.ts`. Wer die Suite ohne Datenbank startet, soll am Namen sehen, warum sie bricht.

- [ ] **Step 1: Belegen, dass die Dateien wirklich eine Datenbank brauchen**

```bash
grep -n "DATABASE_URL\|drizzle(\|new Pool" apps/api/src/development/seed-development.spec.ts apps/api/src/operations/demo-organization-seed.spec.ts apps/api/src/operations/production-bootstrap.spec.ts
```

Erwartung: Treffer in allen drei Dateien. Ohne Treffer wäre die Umbenennung falsch — dann diesen Task abbrechen und den Befund als „nicht mehr zutreffend" vermerken.

- [ ] **Step 2: Prüfen, dass kein Skript nach dem Dateinamen filtert**

```bash
grep -rn "seed-development.spec\|demo-organization-seed.spec\|production-bootstrap.spec" \
  --include='*.json' --include='*.yml' --include='*.mjs' --include='*.mts' --include='*.ts' \
  . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next
```

Erwartung: nur Treffer in `docs/superpowers/plans/**` (alte Pläne, historisch — bleiben unverändert). `apps/api/vitest.config.mts` setzt kein `include`, greift also das Vitest-Standardmuster `**/*.spec.ts`; die Root-Skripte rufen `turbo run test` ohne Dateifilter. Findet sich ein echter Filter, wird er im selben Task mitgezogen.

- [ ] **Step 3: Umbenennen**

```bash
git mv apps/api/src/development/seed-development.spec.ts apps/api/src/development/seed-development.integration.spec.ts
git mv apps/api/src/operations/demo-organization-seed.spec.ts apps/api/src/operations/demo-organization-seed.integration.spec.ts
git mv apps/api/src/operations/production-bootstrap.spec.ts apps/api/src/operations/production-bootstrap.integration.spec.ts
```

- [ ] **Step 4: Nachweis, dass Vitest sie weiterhin findet**

```bash
pnpm infra:up
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/development/seed-development.integration.spec.ts src/operations/demo-organization-seed.integration.spec.ts src/operations/production-bootstrap.integration.spec.ts
```

Erwartung: PASS, dieselbe Anzahl Tests wie vor der Umbenennung (vorher notieren).

- [ ] **Step 5: Volle API-Suite**

Run: aus `apps/api`: `npx dotenv -e ../../.env -- npx vitest run`
Expected: PASS, Dateizahl um 0 verändert (nur Namen).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(api): DB-gebundene Specs auf die Integrationskonvention umbenennen"
```

---

### Task 2: Rollenprüfung über die Domain-Funktion, abgesichert durch Lint (E-I1)

**Files:**
- Modify: `eslint.config.mjs`
- Modify: `apps/web/src/components/tournament/tournament-list.tsx`
- Modify: `apps/web/src/components/tournament/tournament-setup-route.tsx`
- Modify: `apps/web/src/components/tournament/tournament-dashboard-route.tsx`
- Modify: `apps/web/src/components/match/match-scoreboard-route.tsx`
- Modify: `apps/web/src/components/match-workspace.tsx`
- Modify: `apps/web/src/components/players/roster-route.tsx`

**Interfaces:**
- Verbraucht: `hasOrganizationPermission(role: OrganizationRole, permission: OrganizationPermission): boolean` aus `@darts-platform/domain`.
- `organization.role` ist über `organizationSummarySchema` bereits als `OrganizationRole` typisiert (`packages/schemas/src/organization.ts:38`) — keine Zusicherung nötig.

Die neun Stellen prüfen heute eine hartkodierte Rollenliste. Sie stimmen aktuell mit `packages/domain/src/permissions.ts` überein; jede künftige Änderung an `rolePermissions` müsste an neun Stellen von Hand nachgezogen werden. Die Zuordnung Stelle → Permission ist am Server abgeglichen:

| Stelle | heute | Permission | Server |
| --- | --- | --- | --- |
| `tournament-list.tsx:29` `canCreate` | OWNER/ADMIN/TD | `tournament:create` | `tournaments.service.ts:133` |
| `tournament-setup-route.tsx:27` | OWNER/ADMIN/TD | `tournament:create` | `tournaments.service.ts:133` |
| `tournament-dashboard-route.tsx:15` `canCorrect`/`canWithdraw` | OWNER/ADMIN/TD | `tournament:update` | `tournaments.service.ts:204,215` |
| `match-scoreboard-route.tsx:60` `canScore` | OWNER/ADMIN/TD/SCORER | `match:score` | `matches.service.ts:106` |
| `match-scoreboard-route.tsx:61` `canAbort` | OWNER/ADMIN/TD | `match:abort` | `matches.service.ts:106` |
| `match-workspace.tsx:42` `canCreate` (Board-Formular) | OWNER/ADMIN/TD | `board:manage` | `boards.service.ts:23` |
| `match-workspace.tsx:42` `canCreate` (Match-Formular) | OWNER/ADMIN/TD | `match:create` | `matches.service.ts:106` |
| `roster-route.tsx:99` `canManageMembers` | OWNER/ADMIN | `organization:manage_members` | `organizations.service.ts:80` |
| `roster-route.tsx:100` `canCreatePlayers` (Formular) | OWNER/ADMIN/TD | `player:create` | `players.service.ts:65` |
| `roster-route.tsx:100` `canEdit` der Zeile | OWNER/ADMIN/TD | `player:update` | `players.service.ts:87` |
| `roster-route.tsx:101` `canArchivePlayers` | OWNER/ADMIN | `player:archive` | `players.service.ts:111` |

Alle Zuordnungen ergeben mit der heutigen Matrix dieselbe Menge an Rollen wie die Liste, die sie ersetzen — die Umstellung ist verhaltensneutral und E2E bleibt grün. Die Board-Zuweisung in der Kommandozentrale (`board:assign`) bekommt **keine** neue Sperre: sie ist heute nicht rollengesteuert, der Server entscheidet, und eine neue Ausblendung wäre eine Verhaltensänderung ausserhalb dieses Befunds.

- [ ] **Step 1: Lint-Regel schreiben (das ist der rote Test)**

In `eslint.config.mjs` als **letzten** Konfigurationsblock anhängen — nach den `nextVitals`/`nextTypeScript`-Blöcken, damit ihn nichts überschreibt:

```js
  {
    // Rollenlisten gehoeren nicht in die Oberflaeche. Vor dieser Regel
    // pruefte die Oberflaeche an neun Stellen ["OWNER", "ADMIN", ...]
    // .includes(role) -- eine Kopie des Berechtigungsmodells, die bei jeder
    // Aenderung an `rolePermissions` von Hand nachzuziehen waere
    // (AGENTS.md §4, §25). Der Selektor trifft nur Array-Literale, die einen
    // Rollennamen enthalten; ein gewoehnliches `[a, b].includes(c)` bleibt
    // erlaubt.
    files: ["apps/web/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'MemberExpression[property.name="includes"] > ArrayExpression > Literal[value=/^(OWNER|ADMIN|TOURNAMENT_DIRECTOR|SCORER|MEMBER|VIEWER)$/]',
          message:
            "Rollenliste in der Oberflaeche: hasOrganizationPermission(organization.role, \"<permission>\") aus @darts-platform/domain verwenden statt eine Rollenliste zu kopieren.",
        },
      ],
    },
  },
```

- [ ] **Step 2: Regel läuft rot — und trifft nur das Richtige**

Run: `pnpm lint`
Expected: FAIL mit genau neun `no-restricted-syntax`-Fehlern, an den in der Tabelle genannten Stellen. Insbesondere **kein** Fehler in `match-workspace.tsx` an den Zeilen mit `[resolvedPlayerOneId, resolvedPlayerTwoId].includes(...)` — träfe die Regel auch die, ist der Selektor zu breit und muss vor der Weiterarbeit geschärft werden.

- [ ] **Step 3: Die neun Stellen umstellen**

`tournament-list.tsx` — Import ergänzen und Zeile 29 ersetzen:

```tsx
import { hasOrganizationPermission } from "@darts-platform/domain";
```

```tsx
  const canCreate =
    organization !== null && hasOrganizationPermission(organization.role, "tournament:create");
```

`tournament-setup-route.tsx` — Zeile 27:

```tsx
  if (!hasOrganizationPermission(organization.role, "tournament:create")) {
    return <Notice message="Dir fehlt die Berechtigung, Turniere anzulegen." />;
  }
```

`tournament-dashboard-route.tsx` — Zeile 15. Ergebniskorrektur und Rückzug verlangen serverseitig beide `tournament:update`:

```tsx
  const canCorrect = hasOrganizationPermission(organization.role, "tournament:update");
```

`match-scoreboard-route.tsx` — Zeilen 60/61:

```tsx
  const canScore = hasOrganizationPermission(organization.role, "match:score");
  const canAbort = hasOrganizationPermission(organization.role, "match:abort");
```

`match-workspace.tsx` — Zeile 42 wird zu zwei Aussagen, weil der Block zwei verschiedene Mutationen anbietet (Board anlegen, Match anlegen):

```tsx
  const canManageBoards = hasOrganizationPermission(organization.role, "board:manage");
  const canCreateMatches = hasOrganizationPermission(organization.role, "match:create");
```

Im JSX die äussere Bedingung auf `canManageBoards || canCreateMatches` setzen und die beiden `<form>`-Elemente einzeln kapseln: das Board-Formular unter `canManageBoards`, das Match-Formular unter `canCreateMatches`. Das Grid `xl:grid-cols-[0.7fr_1.3fr]` bleibt; fehlt ein Formular, füllt das andere die Zeile.

`roster-route.tsx` — Zeilen 99–101, plus die Zeilen-Props darunter:

```tsx
  const canManageMembers = hasOrganizationPermission(organization.role, "organization:manage_members");
  const canCreatePlayers = hasOrganizationPermission(organization.role, "player:create");
  const canEditPlayers = hasOrganizationPermission(organization.role, "player:update");
  const canArchivePlayers = hasOrganizationPermission(organization.role, "player:archive");
```

und in der Liste `canEdit={canEditPlayers}` statt `canEdit={canCreatePlayers}` (Zeile 134). `canArchive={canArchivePlayers}` bleibt.

- [ ] **Step 4: Lint läuft grün, und kein Vorkommen bleibt**

```bash
pnpm lint
grep -rn "includes(" apps/web/src --include='*.ts' --include='*.tsx' | grep -E "OWNER|ADMIN|TOURNAMENT_DIRECTOR|SCORER|MEMBER|VIEWER"
```

Expected: `pnpm lint` PASS; der `grep` gibt **keine Zeile** aus (Exit 1). Zur Gegenprobe, dass die Regel weiter beisst: eine Zeile `const x = ["OWNER"].includes("ADMIN");` temporär in eine Datei unter `apps/web/src/lib/` schreiben, `pnpm lint` (FAIL erwartet), Zeile wieder entfernen, `pnpm lint` (PASS).

- [ ] **Step 5: Typen und Tests**

```bash
pnpm typecheck
pnpm test
```

Expected: PASS. `hasOrganizationPermission` verlangt `OrganizationRole`; schlägt `typecheck` an einer der Stellen fehl, ist dort ein anderer Typ im Spiel — dann den Typ an der Quelle richten, nicht mit `as` überdecken.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(web): Rollenpruefungen der Oberflaeche auf hasOrganizationPermission ziehen"
```

---

### Task 3: `apiRequest` liest den Status vor dem Körper

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/lib/offline-replay.spec.ts` (nur eine Begründung im Kommentar)
- Test: `apps/web/src/lib/api-client.spec.ts` (neu)

**Interfaces:**
- Unverändert: `apiRequest<T>(input): Promise<T>`, `ApiClientError` mit `status`.
- Neu, dateilokal: `function parseJson(raw: string): unknown` — `undefined`, wenn der Körper kein JSON ist.

Heute steht `const payload: unknown = await response.json();` (Zeile 95) **vor** der `ok`-Prüfung. Antwortet ein Proxy, ein WAF oder ein Nest-Fehlerpfad mit 4xx und einem Körper, der kein JSON ist (HTML-Fehlerseite, leerer Körper), wirft `response.json()` einen `SyntaxError` — und der Status wird nie gelesen. Folge in der Offline-Wiedergabe: `replayFailure` sieht keinen `ApiClientError` und stuft `RETRY` ein; das Kommando läuft endlos gegen dieselbe Ablehnung, statt sichtbar als abgelehnt in der Warteschlange zu stehen.

- [ ] **Step 1: Write the failing test**

Neue Datei `apps/web/src/lib/api-client.spec.ts`:

```ts
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, apiRequest } from "./api-client";

// `api-client.ts` liest beim Import die oeffentliche Client-Umgebung. Der Mock
// haelt den Test unabhaengig davon, ob NEXT_PUBLIC_API_URL gesetzt ist.
vi.mock("./environment", () => ({
  publicEnvironment: { NEXT_PUBLIC_API_URL: "http://api.test/api/v1" },
}));

const schema = z.object({ id: z.string() });
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("apiRequest", () => {
  it("gibt eine geparste Antwort zurueck", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "abc" }, 200));

    await expect(apiRequest({ path: "/probe", schema })).resolves.toEqual({ id: "abc" });
  });

  it("uebersetzt das einheitliche Fehlerformat samt Status", async () => {
    const correlationId = "11111111-1111-4111-8111-111111111111";
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "BOARD_NOT_AVAILABLE", message: "no", correlationId } }, 409),
    );

    const error = await apiRequest({ path: "/probe", schema }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: "BOARD_NOT_AVAILABLE",
      status: 409,
      correlationId,
      message: "Das gewählte Board ist nicht verfügbar.",
    });
  });

  /**
   * Der eigentliche Befund: eine Fehlerseite eines Proxys ist kein JSON. Vorher
   * warf `response.json()` einen `SyntaxError`, bevor irgendjemand den Status
   * gelesen hatte -- die Wiedergabe der Warteschlange hielt das fuer einen
   * Netzwerkfehler und wiederholte ewig.
   */
  it("meldet eine 4xx-Antwort ohne JSON-Koerper mit ihrem Status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html><body>Forbidden</body></html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      }),
    );

    const error = await apiRequest({ path: "/probe", schema }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ code: "REQUEST_FAILED", status: 403 });
  });

  it("meldet eine 5xx-Antwort mit leerem Koerper mit ihrem Status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));

    const error = await apiRequest({ path: "/probe", schema }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ code: "REQUEST_FAILED", status: 503 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @darts-platform/web test -- --dir src`
Expected: FAIL — die beiden Fälle ohne JSON-Körper scheitern mit `SyntaxError`/`Unexpected token`, die ersten beiden bestehen bereits.

- [ ] **Step 3: Implementieren**

In `apps/web/src/lib/api-client.ts` den Block ab Zeile 95 ersetzen:

```ts
  // Erst der Status, dann der Koerper. Vorher lief `await response.json()` VOR
  // der `ok`-Pruefung: eine 4xx-Antwort mit einem Koerper, der kein JSON ist --
  // eine Fehlerseite des Proxys, ein leerer 403 --, warf einen `SyntaxError`,
  // und der Status wurde nie gelesen. Die Wiedergabe der Offline-Warteschlange
  // sah darin einen Netzwerkfehler (`replayFailure` -> RETRY) und wiederholte
  // ein Kommando endlos, das der Server bereits abgelehnt hatte.
  const raw = await response.text();

  if (!response.ok) {
    const payload = parseJson(raw);
    const parsed = payload === undefined ? null : apiErrorSchema.safeParse(payload);
    if (parsed !== null && parsed.success) {
      throw new ApiClientError(
        localizedMessage(parsed.data.error.code),
        parsed.data.error.code,
        parsed.data.error.correlationId,
        parsed.data.error.details,
        response.status,
      );
    }
    throw new ApiClientError(
      `Die API hat mit HTTP ${response.status} geantwortet.`,
      "REQUEST_FAILED",
      null,
      undefined,
      response.status,
    );
  }

  return input.schema.parse(JSON.parse(raw));
```

und darunter (oder neben `localizedMessage`) die Hilfsfunktion:

```ts
/**
 * Liest einen Antwortkoerper als JSON. `undefined`, wenn er keins ist -- leer,
 * HTML, Klartext. Nur der FEHLERPFAD ist tolerant: auf dem Erfolgspfad bleibt
 * ein unlesbarer Koerper ein `SyntaxError` wie bisher, denn dort ist er ein
 * echter Vertragsbruch und darf nicht als Serverurteil (`ApiClientError` mit
 * 2xx) durch die Wiedergabe laufen.
 */
function parseJson(raw: string): unknown {
  if (raw.trim() === "") return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @darts-platform/web test`
Expected: PASS, alle vier Fälle.

- [ ] **Step 5: Begründung in `offline-replay.spec.ts` nachziehen**

Der Kommentar über dem Test „laesst eine nicht lesbare Antwort in der Warteschlange" (Zeile ~45) begründet den `SyntaxError` bisher damit, dass `response.json()` scheitere, „bevor irgendein Status gelesen wird". Das stimmt nach Step 3 nicht mehr. Der Test selbst bleibt richtig und bleibt stehen; nur die Begründung wird ehrlich:

```ts
  /**
   * Ein `SyntaxError` erreicht `replayFailure` heute nur noch vom
   * ERFOLGSPFAD (2xx mit unlesbarem Koerper) oder von einem abgebrochenen
   * Transport -- der Fehlerpfad von `apiRequest` liest seit der Korrektur
   * zuerst den Status und wirft einen `ApiClientError` mit Status. Kein
   * Urteil des Servers ist beides nicht.
   */
```

Zusätzlich in der Wiedergabe festhalten, was sich fachlich ändert: eine **4xx**-Antwort ohne JSON gilt nun als `REJECTED` statt als `RETRY` (sie steht sichtbar als abgelehnt in der Warteschlange, statt endlos zu laufen), eine **5xx**-Antwort ohne JSON bleibt `RETRY` (`retryableStatus`). Das ist die beabsichtigte Wirkung des Befunds; kein zusätzlicher Code nötig, aber ein Satz im Commit-Text.

- [ ] **Step 6: Volle Prüfung und Commit**

```bash
pnpm lint
pnpm typecheck
pnpm test
git add -A
git commit -m "$(cat <<'EOF'
fix(web): Antwortstatus vor dem Koerper lesen

Eine 4xx-Antwort mit einem Koerper, der kein JSON ist, warf bisher einen
SyntaxError, bevor der Status gelesen war: der Fehler kam ohne Status und ohne
Code an, und die Wiedergabe der Offline-Warteschlange stufte ihn als
Netzwerkfehler ein und wiederholte endlos. `apiRequest` liest jetzt zuerst den
Status, parst den Fehlerkoerper tolerant und wirft immer einen ApiClientError
mit Status. Eine 4xx ohne JSON gilt damit als abgelehnt und steht sichtbar in
der Warteschlange; eine 5xx bleibt wiederholbar.
EOF
)"
```

---

### Task 4: Die Erfolgsmeldung der Kommandozentrale zählt die Serverannahme

**Files:**
- Modify: `apps/web/src/lib/offline-replay.ts`
- Modify: `apps/web/src/components/tournament/command-centre.tsx`
- Test: `apps/web/src/lib/offline-replay.spec.ts`

**Interfaces:**
- Produziert: `replayAnnouncement(result: ReplayResult): string` in `offline-replay.ts`.

`flushPending` meldet heute `${sentCount} Befehl(e) übertragen.` (Zeile 474). `sentCount` zählt nur, was der Server angenommen **und** was lokal aufgeräumt wurde. Nimmt der Server die Zuweisung an und scheitert danach das Entfernen aus IndexedDB, sagt die Ansage „0 Befehle übertragen." — für einen Vorgang, den der Server ausgeführt hat. `acceptedCount` ist der richtige Zähler; er existiert seit `6d3f099` und wird von der Scoringfläche bereits benutzt. Die Meldung wandert als reine Funktion nach `offline-replay.ts`, damit sie ohne Komponente testbar ist (AGENTS.md §4).

- [ ] **Step 1: Write the failing test**

In `apps/web/src/lib/offline-replay.spec.ts` anhängen und den Import um `replayAnnouncement` erweitern:

```ts
describe("replayAnnouncement", () => {
  it("meldet nichts Uebertragenes im Plural", () => {
    expect(replayAnnouncement({ sentCount: 0, acceptedCount: 0 })).toBe("0 Befehle übertragen.");
  });

  it("meldet einen einzelnen Befehl im Singular", () => {
    expect(replayAnnouncement({ sentCount: 1, acceptedCount: 1 })).toBe("1 Befehl übertragen.");
  });

  /**
   * Der Befund: der Server hat angenommen, nur das lokale Aufraeumen
   * scheiterte. `sentCount` bleibt dann auf 0 und die Meldung behauptete, es
   * sei nichts uebertragen worden -- waehrend die Zuweisung laengst gebucht
   * war. Gezaehlt wird, was der Server angenommen hat.
   */
  it("zaehlt eine angenommene Zuweisung auch ohne lokales Aufraeumen", () => {
    expect(replayAnnouncement({ sentCount: 0, acceptedCount: 1 })).toBe("1 Befehl übertragen.");
  });

  it("meldet mehrere Befehle im Plural", () => {
    expect(replayAnnouncement({ sentCount: 2, acceptedCount: 3 })).toBe("3 Befehle übertragen.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @darts-platform/web test`
Expected: FAIL — `replayAnnouncement` existiert nicht.

- [ ] **Step 3: Implementieren**

In `apps/web/src/lib/offline-replay.ts` unter `ReplayResult` ergänzen:

```ts
/**
 * Die Ansage nach einem Wiedergabelauf. Sie zaehlt `acceptedCount`, nicht
 * `sentCount`: gemeldet wird, was der SERVER angenommen hat. Nahm er eine
 * Zuweisung an und scheiterte danach nur das lokale Aufraeumen, sagte die
 * Zentrale vorher "0 Befehle übertragen." fuer einen Vorgang, der gebucht war
 * -- die Meldung zum haengenden Eintrag steht separat in `writeError`
 * (`localCleanupFailureMessage`).
 */
export function replayAnnouncement(result: ReplayResult): string {
  const count = result.acceptedCount;
  return `${count} Befehl${count === 1 ? "" : "e"} übertragen.`;
}
```

In `command-centre.tsx` innerhalb `flushPending`:

```ts
      const result = await replayChained<AssignmentQueueEntry>(
        replayable,
        async (entry, chainedVersion): Promise<ReplayOutcome> =>
          await sendAssignment(pendingCommandOf(entry), chainedVersion ?? entry.expectedVersion, entry.command),
      );
      setAnnouncement(replayAnnouncement(result));
```

Der Import aus `@/lib/offline-replay` wird um `replayAnnouncement` erweitert. Die Kommentare über dem Aufruf bleiben unverändert.

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @darts-platform/web test`
Expected: PASS.

- [ ] **Step 5: Volle Prüfung und Commit**

```bash
pnpm lint
pnpm typecheck
pnpm test
git add -A
git commit -m "$(cat <<'EOF'
fix(web): Erfolgsmeldung der Zentrale zaehlt die Serverannahme

Scheiterte nach der Annahme durch den Server nur das lokale Aufraeumen, blieb
sentCount auf 0 und die Zentrale meldete "0 Befehle übertragen." fuer eine
gebuchte Zuweisung. Die Meldung entsteht jetzt in replayAnnouncement aus
acceptedCount und ist als reine Funktion getestet.
EOF
)"
```

---

### Task 5: Die Kommandozentrale überträgt beim `online`-Ereignis

**Files:**
- Create: `apps/web/src/lib/use-online-flush.ts`
- Test: `apps/web/src/lib/use-online-flush.hook.spec.ts`
- Modify: `apps/web/src/components/tournament/command-centre.tsx`
- Modify: `apps/web/src/lib/offline-replay.ts` (ein Kommentar)

**Interfaces:**
- Produziert: `useOnlineFlush(flush: () => Promise<void>): void`.

Die Scoringfläche wiederholt wartende Aufnahmen beim `online`-Ereignis von selbst (`use-match-scoring.ts:235`, geschützt durch `replayingRef`). Die Kommandozentrale überträgt nur auf Knopfdruck: kommt das Tablet an der Bande wieder ins Netz und niemand tippt, bleiben die Zuweisungen liegen. Dasselbe Muster, aber als geteilter Hook, damit es testbar ist und nicht ein drittes Mal abgeschrieben wird.

- [ ] **Step 1: Write the failing test**

Neue Datei `apps/web/src/lib/use-online-flush.hook.spec.ts`:

```ts
// @vitest-environment happy-dom
//
// Konvention aus Tier 1: Hook-Tests heissen `*.hook.spec.ts` und holen sich das
// DOM ueber die Pragma-Zeile, damit die uebrige Suite in der schnellen
// Node-Umgebung bleibt (siehe `use-offline-queue.hook.spec.ts`).
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useOnlineFlush } from "./use-online-flush";

/** Ein Versprechen, das der Test selbst aufloest. */
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = () => { done(); };
  });
  return { promise, resolve };
}

async function goOnline(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useOnlineFlush", () => {
  it("uebertraegt beim Online-Ereignis", async () => {
    const flush = vi.fn(async () => undefined);
    renderHook(() => { useOnlineFlush(flush); });

    await goOnline();

    expect(flush).toHaveBeenCalledOnce();
  });

  /**
   * Zwei Ereignisse kurz hintereinander -- ein flackernder Uplink -- duerfen
   * keinen zweiten Durchgang auf derselben Warteschlange starten: die
   * Reihenfolge der Kette waere dahin. Dasselbe Motiv wie `replayingRef` in
   * `use-match-scoring.ts`.
   */
  it("startet keinen zweiten Durchgang, solange der erste laeuft", async () => {
    const gate = deferred();
    const flush = vi.fn(async () => await gate.promise);
    renderHook(() => { useOnlineFlush(flush); });

    await goOnline();
    await goOnline();
    expect(flush).toHaveBeenCalledOnce();

    await act(async () => { gate.resolve(); await gate.promise; });
    await goOnline();
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("startet nach einem gescheiterten Durchgang wieder", async () => {
    const flush = vi.fn(async () => { throw new Error("Netz weg"); });
    renderHook(() => { useOnlineFlush(flush); });

    await goOnline();
    await goOnline();

    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("ruft die jeweils aktuelle Fassung", async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const view = renderHook(({ flush }: { flush: () => Promise<void> }) => { useOnlineFlush(flush); }, {
      initialProps: { flush: first },
    });

    view.rerender({ flush: second });
    await goOnline();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("hoert beim Abmelden auf", async () => {
    const flush = vi.fn(async () => undefined);
    const view = renderHook(() => { useOnlineFlush(flush); });

    view.unmount();
    await goOnline();

    expect(flush).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @darts-platform/web test`
Expected: FAIL — Modul `./use-online-flush` fehlt.

- [ ] **Step 3: Hook implementieren**

Neue Datei `apps/web/src/lib/use-online-flush.ts`:

```ts
"use client";

import { useEffect, useRef } from "react";

/**
 * Startet beim `online`-Ereignis genau EINEN Uebertragungslauf.
 *
 * Zwei Wachen stecken darin, beide aus dem Bestand der Scoringflaeche
 * (`use-match-scoring.ts`):
 *
 * - `running` verhindert einen zweiten, verschachtelten Durchgang bei einem
 *   flackernden Uplink. Die Reihenfolge der Warteschlange ist verbindlich; zwei
 *   gleichzeitige Laeufe wuerden dieselben Kommandos doppelt absetzen. Ein
 *   gescheiterter Lauf gibt die Wache wieder frei -- das naechste Ereignis darf
 *   es erneut versuchen.
 * - `latest` haelt die aktuelle Fassung von `flush`. Der Listener wird einmal
 *   angemeldet; haenge er stattdessen an `flush` in den Abhaengigkeiten, meldete
 *   ihn jede Neuberechnung des Callbacks ab und wieder an -- und ein Ereignis
 *   genau dazwischen ginge verloren.
 */
export function useOnlineFlush(flush: () => Promise<void>): void {
  const latest = useRef(flush);
  const running = useRef(false);

  useEffect(() => {
    latest.current = flush;
  });

  useEffect(() => {
    const becameOnline = (): void => {
      if (running.current) return;
      running.current = true;
      void latest.current().finally(() => {
        running.current = false;
      });
    };
    window.addEventListener("online", becameOnline);
    return () => {
      window.removeEventListener("online", becameOnline);
    };
  }, []);
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @darts-platform/web test`
Expected: PASS, fünf Fälle.

- [ ] **Step 5: In der Kommandozentrale verdrahten**

In `command-centre.tsx` nach der Definition von `flushPending`:

```ts
  // Wartendes geht auch ohne Knopfdruck raus, sobald das Geraet wieder im Netz
  // ist -- wie die Scoringflaeche. Vorher blieben Zuweisungen liegen, bis
  // jemand "Jetzt übertragen" traf.
  useOnlineFlush(flushPending);
```

Import ergänzen: `import { useOnlineFlush } from "@/lib/use-online-flush";`.

Dazu die Eingangswache von `flushPending` anpassen:

```ts
    // Der Verbindungszustand wird ebenfalls aus dem `online`-Ereignis gesetzt.
    // Zum Zeitpunkt des Ereignisses traegt `connection` deshalb noch "offline",
    // und eine Pruefung auf den Zustand haette die automatische Uebertragung
    // im selben Tick abgewiesen. `navigator.onLine` ist an dieser Stelle die
    // frische Auskunft; der Knopf bleibt weiterhin ueber `connection`
    // deaktiviert.
    if (commandBusy || (typeof navigator !== "undefined" && !navigator.onLine)) return;
```

`flushPending`s Abhängigkeitsliste verliert dadurch `connection`; `commandBusy` bleibt. Der `disabled`-Ausdruck des Knopfs „Jetzt übertragen" bleibt unverändert.

- [ ] **Step 6: Kommentar in `offline-replay.ts` nachziehen**

`QueuedCommandView.pendingOnline` (Zeile ~349) behauptet: „die Scoringflaeche wiederholt von selbst, die Kommandozentrale wartet auf den Knopf." Das gilt nicht mehr:

```ts
  /**
   * Was mit einem wartenden Kommando bei bestehender Verbindung geschieht.
   * Beide Flaechen wiederholen seit `useOnlineFlush` beim `online`-Ereignis von
   * selbst; die Kommandozentrale bietet zusaetzlich den Knopf "Jetzt
   * übertragen".
   */
```

Der sichtbare Text „wartet auf Übertragung" in `command-centre.tsx:658` bleibt richtig und unverändert.

- [ ] **Step 7: Volle Prüfung und Commit**

```bash
pnpm lint
pnpm typecheck
pnpm test
git add -A
git commit -m "$(cat <<'EOF'
feat(web): Zentrale uebertraegt Wartendes beim Online-Ereignis

Die Scoringflaeche wiederholt wartende Aufnahmen seit jeher selbst, sobald das
Geraet wieder im Netz ist; die Kommandozentrale wartete auf den Knopf und liess
Zuweisungen liegen, wenn niemand hinsah. useOnlineFlush buendelt das Muster samt
Schutz gegen einen zweiten, verschachtelten Durchgang und ist als Hook getestet.
EOF
)"
```

---

### Task 6: `boards`-Modul bekommt einen Integrationstest (G-I2)

**Files:**
- Create: `apps/api/src/boards/boards.integration.spec.ts`

**Interfaces:** keine Produktionsänderung. Getestet wird `BoardsService.list`/`create` gegen echtes Postgres, nach dem Muster von `apps/api/src/teams/teams.integration.spec.ts`.

`boards.service.ts:9-37` prüft `board:read`/`board:manage`, schreibt einen `BOARD_CREATED`-Audit-Datensatz in derselben Transaktion und übersetzt den Unique-Index `boards_organization_name_unique` in 409 — eine autorisierte, auditierte Mutation ohne einen einzigen Test. `matches.integration.spec.ts` schreibt an der Tabelle vorbei direkt per Drizzle, berührt den Service also nicht.

- [ ] **Step 1: Write the failing test**

Neue Datei `apps/api/src/boards/boards.integration.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { auditEvents, boards, memberships, organizations, users } from "@darts-platform/database";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { BoardsService } from "./boards.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const service = new BoardsService(
  databaseService,
  new OrganizationAccessService(new OrganizationsRepository(databaseService)),
);

const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const userId = randomUUID();
const memberUserId = randomUUID();

const auth: AuthContext = {
  user: { id: userId, email: `boards-${userId}@example.test`, name: "Board Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
// MEMBER traegt `board:read`, aber nicht `board:manage` -- genau die Grenze,
// die der Service durchsetzen muss.
const memberAuth: AuthContext = {
  user: { id: memberUserId, email: `member-${memberUserId}@example.test`, name: "Board Member" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

beforeAll(async () => {
  await databaseService.database.insert(users).values([
    { id: userId, email: auth.user.email, displayName: auth.user.name },
    { id: memberUserId, email: memberAuth.user.email, displayName: memberAuth.user.name },
  ]);
  await databaseService.database.insert(organizations).values([
    { id: organizationId, name: "Board Club", slug: `boards-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
    { id: foreignOrganizationId, name: "Foreign Board Club", slug: `foreign-boards-${foreignOrganizationId}`, timezone: "Europe/Zurich", locale: "de-CH" },
  ]);
  await databaseService.database.insert(memberships).values([
    { organizationId, userId, role: "OWNER", status: "ACTIVE" },
    { organizationId, userId: memberUserId, role: "MEMBER", status: "ACTIVE" },
  ]);
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(organizations).where(eq(organizations.id, foreignOrganizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.database.delete(users).where(eq(users.id, memberUserId));
  await databaseService.onApplicationShutdown();
});

describe("boards", () => {
  it("legt ein Board an und schreibt den Audit-Datensatz", async () => {
    const name = `Board ${randomUUID().slice(0, 8)}`;
    const board = await service.create({ organizationId, auth, audit, data: { name } });

    expect(board).toMatchObject({ name, status: "AVAILABLE" });

    const [event] = await databaseService.database
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.entityId, board.id)));
    expect(event).toMatchObject({
      action: "BOARD_CREATED",
      actorUserId: userId,
      entityType: "Board",
      correlationId: audit.correlationId,
    });

    const listed = await service.list({ organizationId, auth });
    expect(listed.map((entry) => entry.id)).toContain(board.id);
  });

  /**
   * Der Unique-Index `boards_organization_name_unique` ist die eigentliche
   * Schranke; der Service uebersetzt ihn in 409, damit die Flaeche eine
   * verstaendliche Meldung zeigt statt einer Datenbankfehlermeldung.
   */
  it("lehnt einen doppelten Namen mit 409 ab", async () => {
    const name = `Doppel ${randomUUID().slice(0, 8)}`;
    await service.create({ organizationId, auth, audit, data: { name } });

    await expect(
      service.create({ organizationId, auth, audit, data: { name } }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("laesst ein MEMBER lesen, aber nicht anlegen", async () => {
    await expect(service.list({ organizationId, auth: memberAuth })).resolves.toBeInstanceOf(Array);

    await expect(
      service.create({ organizationId, auth: memberAuth, audit, data: { name: `Verboten ${randomUUID().slice(0, 8)}` } }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("zeigt keine Boards einer fremden Organisation", async () => {
    const [foreign] = await databaseService.database
      .insert(boards)
      .values({ organizationId: foreignOrganizationId, name: "Fremdes Board" })
      .returning();
    expect(foreign).toBeDefined();

    const listed = await service.list({ organizationId, auth });
    expect(listed.map((entry) => entry.id)).not.toContain(foreign?.id);

    // Ohne Mitgliedschaft in der fremden Organisation gibt es dort gar keine
    // Sicht -- die Mandantengrenze haengt nicht an einem Filter allein.
    await expect(
      service.list({ organizationId: foreignOrganizationId, auth }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Vor der Ausführung: `pnpm infra:up`.

Run: aus `apps/api`: `npx dotenv -e ../../.env -- npx vitest run src/boards/boards.integration.spec.ts`
Expected: Die Datei läuft und die Fälle bestehen — sie beschreiben vorhandenes, korrektes Verhalten (Regressionsschutz, kein Bugfix). **Wenn ein Fall fehlschlägt, ist das ein echter Befund:** dann diesen Test stehen lassen, den Fehler in `boards.service.ts` beheben und beides gemeinsam committen. Der einzige zu erwartende Stolperstein ist die 409-Erkennung, die auf den Text `boards_organization_name_unique` in der Fehlermeldung baut; bricht sie, ist die Ursache im Test zu dokumentieren und der Vergleich auf den Constraint-Namen des Treibers umzustellen.

- [ ] **Step 3: Volle API-Suite**

Run: aus `apps/api`: `npx dotenv -e ../../.env -- npx vitest run`
Expected: PASS, eine Datei mehr als vorher.

- [ ] **Step 4: Volle Prüfung und Commit**

```bash
pnpm lint
pnpm typecheck
pnpm test
git add -A
git commit -m "$(cat <<'EOF'
test(api): Integrationstest fuer das boards-Modul

BoardsService prueft board:read/board:manage, schreibt einen Audit-Datensatz und
uebersetzt den Unique-Index in 409 -- bisher ohne jeden Test. Der Test deckt
Anlegen samt Audit, Namenskonflikt, die Rollengrenze eines MEMBER und die
Mandantengrenze ab.
EOF
)"
```

---

### Task 7: HTTP-Ebene testen — Guard und Fehlerfilter (G-I1)

**Files:**
- Create: `apps/api/src/common/http-boundary.spec.ts`

**Interfaces:** keine Produktionsänderung. **Kein Test-Seam im Produktionscode nötig:** `AuthGuard` bezieht die Session über den injizierten `AuthService`, der im Testmodul per `useValue` durch ein Doppel mit `getSession` ersetzt wird. Better Auth, Cookies und Datenbank bleiben aussen vor. Ebenso wird `OrganizationsRepository` durch ein Doppel ersetzt, während `OrganizationAccessService` **echt** läuft — die Berechtigungsentscheidung im Test ist damit die echte.

Der Test heisst bewusst `*.spec.ts` und nicht `*.integration.spec.ts`: er braucht keine Datenbank (siehe Task 1). Er liegt in `common/`, weil er die Verdrahtung zweier Bausteine prüft — Guard aus `auth/`, Filter aus `common/`.

- [ ] **Step 1: Write the failing test**

Neue Datei `apps/api/src/common/http-boundary.spec.ts`:

```ts
import {
  ConflictException,
  Controller,
  Get,
  Inject,
  Logger,
  Param,
} from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthGuard } from "../auth/auth.guard.js";
import { AuthService } from "../auth/auth.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import { CurrentAuth } from "../auth/current-auth.decorator.js";
import { Public } from "../auth/public.decorator.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { ApiExceptionFilter } from "./api-exception.filter.js";

/**
 * Ein Controller allein fuer diesen Test: die dreizehn Integrationstests des
 * Repos rufen ihre Services direkt auf, sodass Guard, `@Public()`-Dekorator und
 * Fehlerfilter nie einen echten Request sehen. Hier laeuft ein echter
 * Fastify-Zyklus dagegen -- ohne einen einzigen Handgriff im Produktionscode.
 */
@Controller("organizations/:organizationId/probe")
class ProbeController {
  public constructor(
    @Inject(OrganizationAccessService) private readonly access: OrganizationAccessService,
  ) {}

  @Get()
  public async guarded(
    @Param("organizationId") organizationId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ readonly organizationId: string; readonly userId: string }> {
    await this.access.requirePermission({
      organizationId,
      userId: auth.user.id,
      permission: "board:manage",
    });
    return { organizationId, userId: auth.user.id };
  }

  @Get("open")
  @Public()
  public open(): { readonly open: true } {
    return { open: true };
  }

  @Get("domain-error")
  public domainError(): never {
    throw new ConflictException({ code: "BOARD_NAME_TAKEN", message: "A board with this name already exists." });
  }

  @Get("boom")
  public boom(): never {
    throw new Error("Interner Zustand mit Geheimnis");
  }
}

const organizationId = "0f14d0ab-9605-4a62-a9e4-5ed26688389b";
const correlationId = "11111111-1111-4111-8111-111111111111";
const session: AuthContext = {
  user: { id: "6f0f4e4e-2d2c-4b2f-9b6a-3f9a1f0f6c11", email: "guard@example.test", name: "Guard" },
  session: { id: "9f0f4e4e-2d2c-4b2f-9b6a-3f9a1f0f6c22", expiresAt: new Date(Date.now() + 60_000) },
};

describe("HTTP-Grenze: AuthGuard und ApiExceptionFilter", () => {
  let app: NestFastifyApplication;
  const getSession = vi.fn(async (): Promise<AuthContext | null> => null);
  const getActiveMembership = vi.fn(async (): Promise<{ readonly role: string } | null> => null);

  beforeEach(async () => {
    getSession.mockReset();
    getSession.mockResolvedValue(null);
    getActiveMembership.mockReset();
    getActiveMembership.mockResolvedValue(null);

    const moduleReference = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        OrganizationAccessService,
        { provide: AuthService, useValue: { getSession } },
        { provide: OrganizationsRepository, useValue: { getActiveMembership } },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();

    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  function request(path: string) {
    return app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/api/v1/organizations/${organizationId}/probe${path}`,
      headers: { "x-correlation-id": correlationId },
    });
  }

  it("weist eine Anfrage ohne Session mit 401 im einheitlichen Format ab", async () => {
    const response = await request("");

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication is required.",
        correlationId,
      },
    });
    expect(response.headers["x-correlation-id"]).toBe(correlationId);
  });

  it("weist eine Session ohne Mitgliedschaft mit 403 ab", async () => {
    getSession.mockResolvedValue(session);

    const response = await request("");

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "PERMISSION_DENIED", correlationId } });
    expect(getActiveMembership).toHaveBeenCalledWith({
      organizationId,
      userId: session.user.id,
      permission: "board:manage",
    });
  });

  it("laesst eine Mitgliedschaft mit der Berechtigung durch", async () => {
    getSession.mockResolvedValue(session);
    getActiveMembership.mockResolvedValue({ role: "OWNER" });

    const response = await request("");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ organizationId, userId: session.user.id });
  });

  it("laesst einen @Public()-Endpunkt ohne Session durch", async () => {
    const response = await request("/open");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ open: true });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("gibt den Fehlercode einer Domain-Exception unveraendert weiter", async () => {
    getSession.mockResolvedValue(session);

    const response = await request("/domain-error");

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "BOARD_NAME_TAKEN",
        message: "A board with this name already exists.",
        correlationId,
      },
    });
  });

  /**
   * AGENTS.md §15: keine internen Stacktraces an Clients. Der Filter darf aus
   * einem unerwarteten Fehler weder die Meldung noch den Stack durchreichen.
   */
  it("verschweigt Interna eines unerwarteten Fehlers", async () => {
    getSession.mockResolvedValue(session);
    const logged = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const response = await request("/boom");

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal server error occurred.",
        correlationId,
      },
    });
    expect(response.body).not.toContain("Geheimnis");
    expect(response.body).not.toContain("stack");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: aus `apps/api`: `npx dotenv -e ../../.env -- npx vitest run src/common/http-boundary.spec.ts`
Expected: Beim ersten Lauf sind Abweichungen im Detail zu erwarten (exakter Wortlaut der 401-Meldung, Signatur von `getActiveMembership`, Verhalten von `@CurrentAuth()`). Jede Abweichung wird **im Test** an die tatsächliche Antwort angepasst, nicht im Produktionscode — es sei denn, die Antwort verletzt AGENTS.md §15 (dann ist es ein Befund und der Filter wird korrigiert). Danach: PASS, sechs Fälle.

Falls `@CurrentAuth()` mehr als `request.authContext` erwartet: `apps/api/src/auth/current-auth.decorator.ts` lesen und den Testcontroller angleichen.

- [ ] **Step 3: Volle API-Suite**

Run: aus `apps/api`: `npx dotenv -e ../../.env -- npx vitest run`
Expected: PASS.

- [ ] **Step 4: Volle Prüfung und Commit**

```bash
pnpm lint
pnpm typecheck
pnpm test
git add -A
git commit -m "$(cat <<'EOF'
test(api): HTTP-Grenze aus Guard und Fehlerfilter absichern

Alle Integrationstests riefen Services direkt auf; AuthGuard, @Public() und der
Fehlerfilter sahen nie einen echten Request. Der neue Test faehrt einen
Fastify-Zyklus gegen einen testeigenen Controller: 401 ohne Session, 403 ohne
Mitgliedschaft, 200 mit Berechtigung, 200 fuer @Public(), Fehlercode einer
Domain-Exception und ein unerwarteter Fehler ohne Interna. Der echte
OrganizationAccessService entscheidet dabei; nur Sessionquelle und Repository
sind Doppel. Kein Handgriff im Produktionscode.
EOF
)"
```

---

### Task 8: Deployment-Images werden gestartet und geprüft (G-I4)

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Neu im Worker-Log: eine Startzeile `{"level":"log","service":"worker","event":"worker_started"}`.

Der Job `deployment-artifacts` baut drei Images mit `push: false` — und ohne `load: true` landen sie nicht einmal im lokalen Docker-Daemon. Ein kaputtes Entrypoint (`scripts/start-api.mjs`), eine fehlende Laufzeitabhängigkeit oder eine gescheiterte Migration fällt in CI nicht auf. Der Job bekommt Postgres und Redis als Service-Container (heute nur im Quality-Gate) und startet jedes Image einmal wirklich.

Die Container laufen mit `--network host`: die Service-Container von GitHub Actions sind auf dem Runner unter `localhost` veröffentlicht, und die API muss ihren Port ebenfalls auf dem Runner anbieten, damit `curl` sie erreicht.

- [ ] **Step 1: Startzeile im Worker**

Der Worker hat keinen Health-Pfad und loggt im Normalbetrieb nichts — von aussen ist nicht zu unterscheiden, ob er läuft oder beim Start gescheitert ist. In `apps/worker/src/main.ts` direkt nach `const connection = createDatabaseConnection(...)`:

```ts
// Startsignal. Der Worker hat keinen Health-Endpunkt; ohne diese Zeile ist von
// aussen -- im CI-Rauchtest wie im Railway-Log -- nicht zu erkennen, ob er die
// Umgebung gelesen und die Verbindung aufgebaut hat oder sofort gescheitert
// ist.
console.log(JSON.stringify({ level: "log", service: "worker", event: "worker_started" }));
```

Diese Zeile bekommt keinen Unit-Test: sie ist Beobachtbarkeit, und ihr Nachweis ist genau der Rauchtest in Step 4.

- [ ] **Step 2: Images laden statt nur bauen**

In `.github/workflows/ci.yml` im Job `deployment-artifacts`:

- `timeout-minutes: 20` auf `25` erhöhen (drei Starts plus Migration).
- Den `services:`-Block aus dem Job `quality` (Postgres 17, Redis 8, jeweils mit Health-Optionen) unverändert übernehmen.
- Jeden der drei Build-Schritte um `load: true` und ein `tags:` ergänzen:

```yaml
          load: true
          tags: darts-api:ci
```

(entsprechend `darts-web:ci`, `darts-worker:ci`).

- [ ] **Step 3: API-Image starten und `/api/v1/health` prüfen**

Nach dem API-Build einfügen:

```yaml
      - name: Smoke-test API image
        run: |
          docker run --detach --name api-smoke --network host \
            --env NODE_ENV=production \
            --env DATABASE_URL="$DATABASE_URL" \
            --env REDIS_URL="$REDIS_URL" \
            --env BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
            --env BETTER_AUTH_URL="$BETTER_AUTH_URL" \
            --env WEB_ORIGIN="$WEB_ORIGIN" \
            --env API_PORT=3001 \
            darts-api:ci
          for attempt in $(seq 1 90); do
            if curl --fail --silent --max-time 5 http://localhost:3001/api/v1/health > /dev/null; then
              echo "API antwortet nach ${attempt}s."
              exit 0
            fi
            if [ "$(docker inspect --format '{{.State.Running}}' api-smoke)" != "true" ]; then
              echo "API-Container ist beendet."
              exit 1
            fi
            sleep 1
          done
          echo "API hat in 90 s nicht geantwortet."
          exit 1

      - name: API logs
        if: always()
        run: docker logs api-smoke || true

      - name: Remove API container
        if: always()
        run: docker rm --force api-smoke || true
```

Der Container führt über `scripts/start-api.mjs` zuerst die Migration aus; der Rauchtest deckt damit auch den Migrationspfad des Deployments ab. Die 90 Sekunden sind für Migration plus Start bemessen.

- [ ] **Step 4: Web- und Worker-Image starten**

Nach dem Web-Build:

```yaml
      - name: Smoke-test web image
        run: |
          docker run --detach --name web-smoke --network host \
            --env NODE_ENV=production \
            --env WEB_PORT=3000 \
            --env NEXT_PUBLIC_API_URL=https://api.example.test/api/v1 \
            darts-web:ci
          for attempt in $(seq 1 60); do
            if curl --fail --silent --max-time 5 http://localhost:3000/ > /dev/null; then
              echo "Web antwortet nach ${attempt}s."
              exit 0
            fi
            if [ "$(docker inspect --format '{{.State.Running}}' web-smoke)" != "true" ]; then
              echo "Web-Container ist beendet."
              exit 1
            fi
            sleep 1
          done
          echo "Web hat in 60 s nicht geantwortet."
          exit 1

      - name: Web logs
        if: always()
        run: docker logs web-smoke || true

      - name: Remove web container
        if: always()
        run: docker rm --force web-smoke || true
```

Nach dem Worker-Build (die Datenbank ist zu diesem Zeitpunkt vom API-Rauchtest migriert):

```yaml
      - name: Smoke-test worker image
        run: |
          docker run --detach --name worker-smoke --network host \
            --env NODE_ENV=production \
            --env DATABASE_URL="$DATABASE_URL" \
            --env REDIS_URL="$REDIS_URL" \
            --env BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
            --env BETTER_AUTH_URL="$BETTER_AUTH_URL" \
            darts-worker:ci
          started=false
          for attempt in $(seq 1 30); do
            if docker logs worker-smoke 2>&1 | grep --quiet worker_started; then
              started=true
              echo "Worker gestartet nach ${attempt}s."
              break
            fi
            sleep 1
          done
          if [ "$started" != "true" ]; then
            echo "Worker hat sich in 30 s nicht gemeldet."
            exit 1
          fi
          # Der Poller laeuft im Sekundentakt gegen die Datenbank. Zehn ruhige
          # Sekunden ohne Fehlerzeile belegen, dass er nicht nur gestartet ist,
          # sondern auch arbeitet.
          sleep 10
          if docker logs worker-smoke 2>&1 | grep --quiet "Statistik-Aggregation fehlgeschlagen"; then
            echo "Worker meldet Fehler."
            exit 1
          fi
          if [ "$(docker inspect --format '{{.State.Running}}' worker-smoke)" != "true" ]; then
            echo "Worker-Container ist beendet."
            exit 1
          fi

      - name: Worker logs
        if: always()
        run: docker logs worker-smoke || true

      - name: Remove worker container
        if: always()
        run: docker rm --force worker-smoke || true
```

- [ ] **Step 5: Lokaler Trockenlauf**

```bash
docker --version
pnpm infra:up
docker build --file Dockerfile.api --tag darts-api:ci .
docker run --detach --name api-smoke-local --network host \
  --env NODE_ENV=production \
  --env DATABASE_URL=postgresql://darts:darts@localhost:5432/darts \
  --env REDIS_URL=redis://localhost:6379 \
  --env BETTER_AUTH_SECRET=ci-only-better-auth-secret-with-32-characters \
  --env BETTER_AUTH_URL=http://localhost:3001 \
  --env WEB_ORIGIN=http://localhost:3000 \
  --env API_PORT=3101 \
  darts-api:ci
curl --fail --silent http://localhost:3101/api/v1/health; echo
docker logs api-smoke-local | tail -20
docker rm --force api-smoke-local
```

Der abweichende Port 3101 hält den Trockenlauf von einer lokal laufenden API fern. Erwartung: `{"status":"ok",…}`.

Danach dasselbe für den Worker (`docker build --file Dockerfile.worker --tag darts-worker:ci .`, starten, `docker logs` auf `worker_started` prüfen, entfernen). Das Web-Image ist der teuerste Build; wenn die Zeit knapp ist, darf es dem CI-Lauf überlassen bleiben — das gehört dann in die PR-Beschreibung.

**Läuft Docker lokal nicht** (`docker --version` scheitert, WSL-Daemon aus), wird kein Trockenlauf erfunden: dann ist der Nachweis ausschliesslich der CI-Lauf auf dem PR, und genau dieser Satz gehört in die PR-Beschreibung. Vor dem Merge muss der Job `deployment-artifacts` grün gelaufen sein.

- [ ] **Step 6: Prüfung und Commit**

```bash
pnpm lint
pnpm typecheck
pnpm test
git add -A
git commit -m "$(cat <<'EOF'
ci: Deployment-Images starten und pruefen statt nur bauen

Der Job baute API, Web und Worker mit push: false -- die Images liefen nie. Ein
kaputtes Entrypoint oder eine gescheiterte Migration waere in CI unbemerkt
geblieben. Die Images werden jetzt geladen, gestartet und geprueft: die API
gegen /api/v1/health inklusive Migrationslauf, das Web gegen /, der Worker gegen
seine neue Startzeile im Log und zehn ruhige Sekunden ohne Fehlermeldung.
Postgres und Redis laufen dafuer auch in diesem Job.
EOF
)"
```

---

### Task 9: Abschluss — volle Suite, E2E, Dokumentation

**Files:**
- Modify: `ARCHITECTURE.md` (§32)

- [ ] **Step 1: Volle Suite**

```bash
pnpm infra:up
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: alles PASS. Fehlschläge werden behoben, nicht weggelassen.

- [ ] **Step 2: E2E**

Run: `npx dotenv -e .env -- pnpm test:e2e`
Expected: PASS. Ein Worker (im Root-Skript konfiguriert). Besonders im Blick: `foundation.spec.ts` „a viewer does not receive tournament administration access" — dieser Fall belegt, dass die Umstellung aus Task 2 die Ausblendung nicht gelockert hat. Ein sporadisch roter Lauf ist erfahrungsgemäss Kontention gegen `next dev`; einmal wiederholen, bei erneutem Rot untersuchen statt wegdrücken.

- [ ] **Step 3: Dokumentation nachziehen**

In `ARCHITECTURE.md` §32 unter „Integration" ergänzen:

```text
Namenskonvention: `*.integration.spec.ts` bezeichnet Tests, die eine laufende
Datenbank brauchen (`DATABASE_URL`); `*.spec.ts` laeuft ohne Infrastruktur.
Die HTTP-Grenze -- AuthGuard, `@Public()` und der Fehlerfilter aus §15 -- ist
ueber `apps/api/src/common/http-boundary.spec.ts` mit einem echten
Fastify-Zyklus abgedeckt; die uebrigen Integrationstests rufen ihre Services
direkt auf.

Deployment-Images: CI baut API, Web und Worker nicht nur, sondern startet jedes
Image einmal und prueft es (Health-Endpunkt, Startseite, Startzeile im
Worker-Log).
```

Ausserdem in `apps/web` nichts dokumentieren, was der Code schon sagt — die Lint-Regel trägt ihre Begründung im Kommentar.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(architecture): Testkonventionen und Image-Rauchtest festhalten"
```

- [ ] **Step 5: Pull Request**

Beschreibung nach AGENTS.md §23: Problem (fünf Important-Befunde aus dem Tier-2-Audit plus drei Web-Nachläufer), Lösung je Task, Architektur-Auswirkung (keine neue Grenze; eine Parallelstruktur weniger), DB-Migrationen (keine), Tests (drei neue Testdateien, drei umbenannte, zwei erweiterte), Security-Auswirkung (Guard und Fehlerfilter erstmals getestet; Berechtigungsentscheidungen der Oberfläche an einer Quelle — die Serverentscheidung bleibt unverändert), Screenshots (keine sichtbare UI-Änderung; Task 2 ist mit der heutigen Rollenmatrix verhaltensneutral). Ist der lokale Docker-Trockenlauf ausgefallen, steht das ausdrücklich drin.

---

## Self-Review

**Spec-Abdeckung.** E-I1 → Task 2 (neun Stellen, Permission je Stelle am Server abgeglichen, Lint-Regel als Rückfallschutz, Grep als Nachweis). G-I1 → Task 7. G-I2 → Task 6. G-I4 → Task 8. G-I6 → Task 1. Web-Nachläufer: `api-client` → Task 3, Erfolgsmeldung → Task 4, Übertragung beim `online`-Ereignis → Task 5. Die Tier-1-Grundlage (happy-dom, `@testing-library/react`, Pragma-Konvention) wird genau einmal genutzt, in Task 5, wo ein Hook ohne DOM nicht prüfbar wäre; die übrigen Web-Tests bleiben in der schnellen Node-Umgebung.

**Was ausdrücklich nicht drin ist.** E-I2/I3/I4 (zwei Button-Primitiven, React Hook Form in den League-Panels, siebenfache `inputClassName`) bleiben Tier 3 — Task 2 fasst `roster-route.tsx` und `match-workspace.tsx` an, ohne deren Feldklassen anzurühren. G-I3 (Required Status Checks) ist ein GitHub-Plan-Thema, G-I5 (CI-Ressourcen für E2E) ein Kostenentscheid, G-I7 (breiter DOM-Testausbau) bleibt offen. Die Board-Zuweisung der Kommandozentrale bekommt keine neue `board:assign`-Ausblendung: das wäre eine Verhaltensänderung ausserhalb des Befunds.

**Braucht Task 7 einen Test-Seam?** Nein. `AuthGuard` bezieht die Session ausschliesslich über den injizierten `AuthService`; im Testmodul ersetzt ein `useValue`-Doppel dessen `getSession`. Better Auth, Cookies und Datenbank bleiben aussen vor, der Produktionscode unverändert. Der echte `OrganizationAccessService` läuft mit einem Repository-Doppel — die geprüfte Berechtigungsentscheidung ist damit die echte, nicht nachgebaute.

**Verhaltensänderung, die niemand übersehen darf.** Task 3 verschiebt eine Grenze in der Offline-Wiedergabe: eine **4xx**-Antwort ohne JSON-Körper wird von `replayFailure` künftig als `REJECTED` eingestuft statt als `RETRY`. Das ist beabsichtigt — vorher wiederholte ein längst abgelehntes Kommando endlos, jetzt steht es sichtbar als abgelehnt in der Warteschlange und lässt sich verwerfen. **5xx**, 408, 429 und 401 bleiben wiederholbar. Der Kommentar in `offline-replay.spec.ts`, der die alte Begründung trug, wird in Task 3 Step 5 mitgezogen; der Kommentar zu `pendingOnline` in `offline-replay.ts` in Task 5 Step 6.

**Reihenfolge.** Task 4 und Task 5 ändern beide `command-centre.tsx` (Meldung bzw. Wache und Effekt) und laufen nacheinander. Task 8 setzt keinen anderen Task voraus, steht aber am Ende, weil sein Trockenlauf am teuersten ist. Task 1 zuerst, weil er nichts als Dateinamen ändert und die API-Suite danach stabil bleibt.

**Offene Verantwortung.** Der Rauchtest des Worker-Images prüft, dass er startet und zehn Sekunden ruhig arbeitet — nicht, dass er ein `MATCH_COMPLETED`-Ereignis korrekt verarbeitet. Das bleibt Sache der `statistics`-Tests. Und `packages/ui` bleibt weiterhin ohne Test (G-Minor 1); das ist bewusst nicht Teil dieses Plans.
