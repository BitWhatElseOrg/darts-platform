# Scheiben-Tablets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein fest montiertes Tablet wird einmal einer Scheibe zugeordnet und scort danach ohne Benutzer-Login jedes Match, das dieser Scheibe zugewiesen ist.

**Architecture:** Neben der Better-Auth-Session gibt es einen zweiten Principal-Typ `device`, ausgewiesen über `Authorization: Bearer bd_…`. Die Tabelle `board_devices` hält nur den Hash. Der globale `AuthGuard` lässt Geräte nur auf Handler mit `@AllowDevice()`. Die Match-Services prüfen beim Gerät den festen Katalog `devicePermissions` und, innerhalb der schreibenden Transaktion, dass `matches.board_id` die Scheibe des Geräts ist. Das Web bekommt eine Kiosk-Route `/scheibe`, die die bestehende `MatchScoreboard` wiederverwendet.

**Tech Stack:** TypeScript strict, NestJS/Fastify, Drizzle/PostgreSQL, `@fastify/rate-limit`, Next.js/React, TanStack Query, Vitest, Testcontainers-artige Integrationstests gegen die lokale DB, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-scheiben-tablet-design.md` – vor jedem Task lesen, der Plan argumentiert von dort.

## Global Constraints

- Branch `feature/scheiben-tablet` (von `develop`). Nie auf `develop` oder `main` committen. Vor dem ersten Commit `git branch --show-current` prüfen.
- Commits: Conventional Commits, Deutsch, **kein** `Co-Authored-By`-Trailer.
- Kein `any`. `unknown` statt `any`. Exhaustive `switch`.
- Jede tenant-bezogene Query ist nach `organization_id` eingeschränkt.
- Migrationen nur neu anlegen, keine bestehende Migration ändern. Neue Migration heisst `0035_board_devices.sql`.
- Geräte-Geheimnis: Präfix `bd_`, danach 32 Zufallsbytes base64url. Gespeichert nur als SHA-256-Hex (`char(64)`).
- Fehlercodes exakt: `DEVICE_REVOKED` (401), `DEVICE_NOT_ALLOWED` (403), `DEVICE_BOARD_MISMATCH` (403), `DEVICE_MATCH_NOT_ACTIVE` (409).
- Geräte-Rechte exakt: `match:read`, `match:score`, `match:undo`, `statistics:read`. Nie `match:abort`, nie `match:create`.
- Rate-Limit: `RATE_LIMIT_DEVICE_MAX_PER_MINUTE`, Vorgabe `120`, Zähler je Geräte-ID; Einordnungs-Cache 30 s.
- Kiosk: Polling `GET /board-devices/me` alle 5000 ms; Endstand bleibt 30 000 ms.
- `localStorage`-Schlüssel im Web: `dartbase.board-device`.
- UI-Texte Deutsch (Schweiz), kein ß.
- API-Tests einzeln: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/<pfad>.spec.ts`. Tests anderer Pakete aus deren Verzeichnis: `cd packages/<paket> && npx dotenv -e ../../.env -- npx vitest run src/<datei>.spec.ts`.
- API-Tests laufen gegen `packages/*/dist`. Nach Änderungen an `packages/domain`, `packages/schemas`, `packages/database` vor API-Tests `pnpm --filter @darts-platform/<paket> build`.
- Web-Build nur mit `pnpm build` (setzt `NODE_ENV=production`).
- E2E nur über `pnpm test:e2e`, läuft auf einem Worker.
- Dialoge mit Formularfeldern nur im offenen Zustand mounten (sonst brechen bestehende `getByLabel`-Locators).

## Dateiübersicht

| Datei | Verantwortung |
|---|---|
| `packages/domain/src/device-access.ts` (neu) | `devicePermissions`, `isDevicePermission`, `decideDeviceMatchAccess` |
| `packages/domain/src/board-device-secret.ts` (neu, Subpath-Export) | Geheimnis erzeugen/hashen, `node:crypto` |
| `packages/database/src/schema.ts` | `boardDevices`, Unique `(id, organization_id)` auf `boards`, `device_id` an Lease, `actor_device_id` an Audit |
| `packages/database/drizzle/0035_board_devices.sql` (generiert) | Migration |
| `packages/schemas/src/board-device.ts` (neu) | Zod-Schemas der neuen Endpunkte |
| `packages/config/src/environment.ts` | `RATE_LIMIT_DEVICE_MAX_PER_MINUTE` |
| `apps/api/src/auth/auth.types.ts` | `AuthenticatedDevice`, `DeviceAuthContext`, `Principal`, `isDevicePrincipal` |
| `apps/api/src/auth/device-bearer.ts` (neu) | Bearer-Header lesen |
| `apps/api/src/auth/board-device-authenticator.ts` (neu) | Geheimnis → Gerät (frisch), Einordnung fürs Rate-Limit (gecacht), `last_seen_at` |
| `apps/api/src/auth/allow-device.decorator.ts` (neu) | `@AllowDevice()` |
| `apps/api/src/auth/current-principal.decorator.ts` (neu) | `@CurrentPrincipal()` |
| `apps/api/src/auth/auth.guard.ts` | zweiter Principal |
| `apps/api/src/common/audit-actor.ts` (neu) | `auditActor(principal)`, `leaseActor(principal)` |
| `apps/api/src/board-devices/*` (neu) | Einrichten, Widerruf, Liste, `/board-devices/me` |
| `apps/api/src/matches/*` | Geräte-Zweig in Service und Repository |
| `apps/api/src/statistics/*` | Geräte-Zweig für `frequent-scores` |
| `apps/api/src/common/rate-limit.ts`, `configure-application.ts` | Stufe `device`, CORS `Authorization` |
| `apps/web/src/lib/device-key-storage.ts` (neu) | Schlüssel im `localStorage` |
| `apps/web/src/lib/device-credential-context.tsx` (neu) | React-Kontext für den Kiosk-Teilbaum |
| `apps/web/src/lib/api-client.ts` | Parameter `deviceSecret` |
| `apps/web/src/components/match/*` | Geräteschlüssel durchreichen, Scoreboard ohne Rückweg |
| `apps/web/src/components/organization/board-devices-section.tsx` (neu) | Einrichten/Entkoppeln |
| `apps/web/src/components/kiosk/*` (neu), `apps/web/src/app/scheibe/page.tsx` (neu) | Kiosk |
| `apps/web/tests/board-device-kiosk.spec.ts` (neu) | E2E |
| `docs/adr/0019-scheiben-geraete.md` (neu), Betriebsdoku, ADR 0018, `AGENTS.md` | Doku |

---

### Task 1: Domain – Geräte-Rechte und Geheimnis

**Files:**
- Create: `packages/domain/src/device-access.ts`
- Create: `packages/domain/src/device-access.spec.ts`
- Create: `packages/domain/src/board-device-secret.ts`
- Create: `packages/domain/src/board-device-secret.spec.ts`
- Modify: `packages/domain/src/index.ts` (Export von `device-access`, **nicht** von `board-device-secret`)
- Modify: `packages/domain/package.json` (`exports["./board-device-secret"]` wie `./display-key-secret`)

**Interfaces:**
- Produces:
  - `devicePermissions: readonly ["match:read","match:score","match:undo","statistics:read"]`
  - `type DevicePermission`
  - `isDevicePermission(permission: OrganizationPermission): permission is DevicePermission`
  - `type DeviceMatchAction = "read" | "write"`
  - `type DeviceMatchAccess = "ALLOWED" | "BOARD_MISMATCH" | "MATCH_NOT_ACTIVE"`
  - `decideDeviceMatchAccess(input: { action: DeviceMatchAction; deviceBoardId: string; matchBoardId: string | null; matchStatus: string }): DeviceMatchAccess`
  - Aus `@darts-platform/domain/board-device-secret`: `BOARD_DEVICE_SECRET_PREFIX = "bd_"`, `createBoardDeviceSecret(): string`, `hashBoardDeviceSecret(secret: string): string`

- [ ] **Step 1: Failing Tests schreiben**

`packages/domain/src/device-access.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { decideDeviceMatchAccess, devicePermissions, isDevicePermission } from "./device-access";
import { organizationPermissions } from "./permissions";

describe("devicePermissions", () => {
  it("enthält genau die vier Rechte eines Scheiben-Tablets", () => {
    expect([...devicePermissions]).toEqual(["match:read", "match:score", "match:undo", "statistics:read"]);
  });

  it("gewährt weder Abbruch noch Anlegen noch irgendein anderes Recht", () => {
    const granted = organizationPermissions.filter((permission) => isDevicePermission(permission));
    expect(granted).toEqual(["match:read", "match:score", "match:undo", "statistics:read"]);
    expect(isDevicePermission("match:abort")).toBe(false);
    expect(isDevicePermission("match:create")).toBe(false);
  });
});

describe("decideDeviceMatchAccess", () => {
  const board = "board-a";

  it("lehnt ein Match einer anderen Scheibe für jede Aktion ab", () => {
    for (const action of ["read", "write"] as const) {
      expect(decideDeviceMatchAccess({ action, deviceBoardId: board, matchBoardId: "board-b", matchStatus: "IN_PROGRESS" })).toBe("BOARD_MISMATCH");
    }
  });

  it("lehnt ein Match ohne Scheibe ab", () => {
    expect(decideDeviceMatchAccess({ action: "read", deviceBoardId: board, matchBoardId: null, matchStatus: "IN_PROGRESS" })).toBe("BOARD_MISMATCH");
  });

  it("erlaubt Lesen in jedem Status", () => {
    for (const matchStatus of ["IN_PROGRESS", "COMPLETED", "ABORTED"]) {
      expect(decideDeviceMatchAccess({ action: "read", deviceBoardId: board, matchBoardId: board, matchStatus })).toBe("ALLOWED");
    }
  });

  it("erlaubt Schreiben (Wurf, Undo, Leg-Entscheid, Lease) nur im laufenden Match", () => {
    expect(decideDeviceMatchAccess({ action: "write", deviceBoardId: board, matchBoardId: board, matchStatus: "IN_PROGRESS" })).toBe("ALLOWED");
    expect(decideDeviceMatchAccess({ action: "write", deviceBoardId: board, matchBoardId: board, matchStatus: "COMPLETED" })).toBe("MATCH_NOT_ACTIVE");
    expect(decideDeviceMatchAccess({ action: "write", deviceBoardId: board, matchBoardId: board, matchStatus: "ABORTED" })).toBe("MATCH_NOT_ACTIVE");
  });

  it("behandelt einen unbekannten Status beim Schreiben als nicht aktiv", () => {
    expect(decideDeviceMatchAccess({ action: "write", deviceBoardId: board, matchBoardId: board, matchStatus: "SOMETHING" })).toBe("MATCH_NOT_ACTIVE");
  });
});
```

`packages/domain/src/board-device-secret.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { BOARD_DEVICE_SECRET_PREFIX, createBoardDeviceSecret, hashBoardDeviceSecret } from "./board-device-secret";

describe("board device secret", () => {
  it("trägt das Präfix bd_ und 32 Zufallsbytes base64url", () => {
    const secret = createBoardDeviceSecret();
    expect(secret.startsWith(BOARD_DEVICE_SECRET_PREFIX)).toBe(true);
    expect(secret.slice(3)).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(createBoardDeviceSecret()).not.toBe(secret);
  });

  it("hasht deterministisch zu 64 Hex-Zeichen", () => {
    expect(hashBoardDeviceSecret("bd_abc")).toBe(hashBoardDeviceSecret("bd_abc"));
    expect(hashBoardDeviceSecret("bd_abc")).toMatch(/^[a-f0-9]{64}$/u);
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd packages/domain && npx vitest run src/device-access.spec.ts src/board-device-secret.spec.ts`
Expected: FAIL, Module nicht gefunden.

- [ ] **Step 3: Implementieren**

`packages/domain/src/device-access.ts`:

```ts
import type { OrganizationPermission } from "./permissions";

/**
 * Was ein Scheiben-Tablet darf (Spec 2026-09-30-scheiben-tablet, Abschnitt 3).
 * Bewusst ein fester Katalog und keine Rolle: ein Geraet ist kein Mitglied,
 * und ein neues Recht soll nicht still mitwandern, nur weil es einer Rolle
 * hinzugefuegt wird. Kein `match:abort` – wie bei der Rolle SCORER bleibt
 * der Abbruch bei der Leitung.
 */
export const devicePermissions = [
  "match:read",
  "match:score",
  "match:undo",
  "statistics:read",
] as const satisfies readonly OrganizationPermission[];

export type DevicePermission = (typeof devicePermissions)[number];

const devicePermissionSet: ReadonlySet<OrganizationPermission> = new Set(devicePermissions);

export function isDevicePermission(permission: OrganizationPermission): permission is DevicePermission {
  return devicePermissionSet.has(permission);
}

export type DeviceMatchAction = "read" | "write";
export type DeviceMatchAccess = "ALLOWED" | "BOARD_MISMATCH" | "MATCH_NOT_ACTIVE";

/**
 * Bindung eines Geraets an das Match seiner Scheibe. `write` umfasst Wurf,
 * Undo, Leg-Entscheid und Controller-Lease und gilt nur im laufenden Match:
 * ein Undo nach Match-Ende liesse einen Liga-Slot auf COMPLETED stehen und
 * waere am offenen Tablet ohne Zeitgrenze moeglich. Korrekturen nach
 * Match-Ende bleiben bei der Leitung (Spec 2026-09-30-scheiben-tablet).
 */
export function decideDeviceMatchAccess(input: {
  readonly action: DeviceMatchAction;
  readonly deviceBoardId: string;
  readonly matchBoardId: string | null;
  readonly matchStatus: string;
}): DeviceMatchAccess {
  if (input.matchBoardId === null || input.matchBoardId !== input.deviceBoardId) return "BOARD_MISMATCH";
  switch (input.action) {
    case "read":
      return "ALLOWED";
    case "write":
      return input.matchStatus === "IN_PROGRESS" ? "ALLOWED" : "MATCH_NOT_ACTIVE";
    default: {
      const exhaustive: never = input.action;
      return exhaustive;
    }
  }
}
```

`packages/domain/src/board-device-secret.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

/** Macht den Schluessel in Logs und fuer Secret-Scanner erkennbar. */
export const BOARD_DEVICE_SECRET_PREFIX = "bd_";

/** 32 Zufallsbytes, base64url – wie der Anzeige-Schluessel (display-key-secret.ts). */
export function createBoardDeviceSecret(): string {
  return `${BOARD_DEVICE_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Kein Salt, keine Streckung: der Klartext ist bereits 256 Bit Zufall. */
export function hashBoardDeviceSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
```

In `packages/domain/src/index.ts` ergänzen (Stil der bestehenden Export-Blöcke):

```ts
export {
  decideDeviceMatchAccess,
  devicePermissions,
  isDevicePermission,
  type DeviceMatchAccess,
  type DeviceMatchAction,
  type DevicePermission,
} from "./device-access";
```

In `packages/domain/package.json` unter `exports` ergänzen:

```json
"./board-device-secret": {
  "types": "./dist/board-device-secret.d.ts",
  "default": "./dist/board-device-secret.js"
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cd packages/domain && npx vitest run && cd ../.. && pnpm --filter @darts-platform/domain build && pnpm --filter @darts-platform/domain typecheck`
Expected: PASS, `dist/board-device-secret.js` existiert.

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): Rechte und Geheimnis fuer Scheiben-Tablets"
```

---

### Task 2: Datenbank – `board_devices`, Akteur-Spalten, Migration

**Files:**
- Modify: `packages/database/src/schema.ts` (`boards` ~Z. 348, `boardControllerLeases` ~Z. 437, `auditEvents` ~Z. 316, neue Tabelle nach `boards`, Typ-Export am Dateiende bei `export type Board`)
- Create: `packages/database/drizzle/0035_board_devices.sql` (generiert) und Meta-Dateien
- Create: `packages/database/src/board-devices.integration.spec.ts` (Muster: `packages/database/src/display-keys.integration.spec.ts`)

**Interfaces:**
- Produces: `boardDevices` (Drizzle-Tabelle), `type BoardDevice = typeof boardDevices.$inferSelect`; `boardControllerLeases.deviceId`, `boardControllerLeases.userId` nullable; `auditEvents.actorDeviceId`.

- [ ] **Step 1: Failing Test schreiben**

`packages/database/src/board-devices.integration.spec.ts` – Aufbau wie `display-keys.integration.spec.ts` (eigene Organisation, eigener Benutzer, `afterAll` löscht beides). Fälle:

```ts
it("erlaubt nur ein aktives Gerät je Scheibe", async () => {
  await database.insert(boardDevices).values({ organizationId, boardId, secretHash: "a".repeat(64), label: "iPad 1", createdBy: userId });
  await expect(
    database.insert(boardDevices).values({ organizationId, boardId, secretHash: "b".repeat(64), label: "iPad 2", createdBy: userId }),
  ).rejects.toThrow(/board_devices_board_active_unique/u);
});

it("erlaubt ein neues Gerät, sobald das alte widerrufen ist", async () => {
  await database.update(boardDevices).set({ revokedAt: new Date() }).where(eq(boardDevices.boardId, boardId));
  await expect(
    database.insert(boardDevices).values({ organizationId, boardId, secretHash: "c".repeat(64), label: "iPad 3", createdBy: userId }),
  ).resolves.toBeDefined();
});

it("lehnt ein Gerät ab, dessen Organisation nicht die der Scheibe ist", async () => {
  await expect(
    database.insert(boardDevices).values({ organizationId: foreignOrganizationId, boardId: secondBoardId, secretHash: "d".repeat(64), label: "Fremd", createdBy: userId }),
  ).rejects.toThrow(/board_devices_board_organization_fk/u);
});

it("lehnt einen Hash im falschen Format ab", async () => {
  await expect(
    database.insert(boardDevices).values({ organizationId, boardId: secondBoardId, secretHash: "Z".repeat(64), label: "Kaputt", createdBy: userId }),
  ).rejects.toThrow(/board_devices_secret_hash_format_check/u);
});

it("verlangt bei der Lease genau einen Akteur", async () => {
  // matchId: ein Match in `organizationId` ohne Scheibe, im beforeAll angelegt
  await expect(
    database.insert(boardControllerLeases).values({ matchId, organizationId, controllerId: randomUUID(), expiresAt: new Date() }),
  ).rejects.toThrow(/board_controller_leases_actor_check/u);
  await expect(
    database.insert(boardControllerLeases).values({ matchId, organizationId, controllerId: randomUUID(), userId, deviceId: activeDeviceId, expiresAt: new Date() }),
  ).rejects.toThrow(/board_controller_leases_actor_check/u);
});

it("erlaubt im Audit höchstens einen Akteur", async () => {
  await expect(
    database.insert(auditEvents).values({ organizationId, actorUserId: userId, actorDeviceId: activeDeviceId, action: "TEST", entityType: "Test", correlationId: randomUUID() }),
  ).rejects.toThrow(/audit_events_single_actor_check/u);
});

it("löscht Geräte mit der Scheibe", async () => {
  await database.delete(boards).where(eq(boards.id, boardId));
  expect(await database.select().from(boardDevices).where(eq(boardDevices.boardId, boardId))).toHaveLength(0);
});
```

Die Fixture legt in `beforeAll` an: Organisation `organizationId` und `foreignOrganizationId`, Benutzer `userId`, Scheiben `boardId` und `secondBoardId` in `organizationId`, zwei Spieler und ein Match `matchId` (Muster aus `apps/api/src/matches/matches.integration.spec.ts`, `boardId: null`, Pflichtfelder laut Schema: `bestOfLegs: 1`, `startingSeat: 1`, dazu `matchParticipants`, falls ein Check sie verlangt – nur was das Schema erzwingt). `activeDeviceId` ist die ID des Geräts aus dem zweiten Test.

Die Fälle hängen voneinander ab und laufen in Dateireihenfolge. Das ist beabsichtigt, damit die Fixture klein bleibt.

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `cd packages/database && npx dotenv -e ../../.env -- npx vitest run src/board-devices.integration.spec.ts`
Expected: FAIL, `boardDevices` ist kein Export.

- [ ] **Step 3: Schema ändern**

In `boards` einen Index ergänzen (Array der Tabellen-Constraints):

```ts
// Ziel des zusammengesetzten Fremdschluessels aus `board_devices`: ein Geraet
// gehoert zur Organisation seiner Scheibe, erzwungen von der Datenbank.
uniqueIndex("boards_id_organization_unique").on(table.id, table.organizationId),
```

Neue Tabelle direkt nach `boards` (Import `foreignKey` aus `drizzle-orm/pg-core` ergänzen):

```ts
/**
 * Ein fest montiertes Tablet, das die Matches seiner Scheibe ohne
 * Benutzer-Login scort (Spec 2026-09-30-scheiben-tablet, ADR 0019).
 * Gespeichert wird nur der Hash; den Klartext gibt es einmal, in der Antwort,
 * die das Geraet einrichtet. Kein Ablaufdatum: geschuetzt wird ueber Widerruf
 * und die Sichtbarkeit von `last_seen_at`.
 */
export const boardDevices = pgTable(
  "board_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    boardId: uuid("board_id").notNull(),
    secretHash: char("secret_hash", { length: 64 }).notNull(),
    label: varchar("label", { length: 80 }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: "board_devices_board_organization_fk",
      columns: [table.boardId, table.organizationId],
      foreignColumns: [boards.id, boards.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("board_devices_secret_hash_unique").on(table.secretHash),
    uniqueIndex("board_devices_board_active_unique").on(table.boardId).where(sql`${table.revokedAt} is null`),
    index("board_devices_organization_idx").on(table.organizationId),
    check("board_devices_secret_hash_format_check", sql`${table.secretHash} ~ '^[a-f0-9]{64}$'`),
    check("board_devices_label_not_empty", sql`length(trim(${table.label})) > 0`),
  ],
);
```

`boardControllerLeases`: `userId` ohne `.notNull()`, neue Spalte und Check:

```ts
userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
deviceId: uuid("device_id").references(() => boardDevices.id, { onDelete: "cascade" }),
```

```ts
(table) => [
  index("board_controller_leases_organization_expiry_idx").on(table.organizationId, table.expiresAt),
  // Eine Lease haelt entweder eine Person oder ein Scheiben-Tablet.
  check("board_controller_leases_actor_check", sql`num_nonnulls(${table.userId}, ${table.deviceId}) = 1`),
],
```

`auditEvents`: nach `actorUserId`:

```ts
actorDeviceId: uuid("actor_device_id").references(() => boardDevices.id, { onDelete: "set null" }),
```

und im Constraint-Array:

```ts
// Beide leer bleibt zulaessig (System-Ereignisse, geloeschte Akteure).
check("audit_events_single_actor_check", sql`num_nonnulls(${table.actorUserId}, ${table.actorDeviceId}) <= 1`),
```

`auditEvents` steht in der Datei vor `boards`. Drizzle löst `() => boardDevices.id` erst beim Zugriff auf. Meldet `tsc` trotzdem einen Fehler wegen Verwendung vor der Deklaration, bekommt die Referenz `(): AnyPgColumn => boardDevices.id` (Import `AnyPgColumn` aus `drizzle-orm/pg-core`).

Typ-Export bei den übrigen Typen:

```ts
export type BoardDevice = typeof boardDevices.$inferSelect;
```

- [ ] **Step 4: Migration generieren und prüfen**

Run: `pnpm --filter @darts-platform/database exec drizzle-kit generate --config=drizzle.config.ts --name board_devices`
Expected: `packages/database/drizzle/0035_board_devices.sql` entsteht.

Die SQL-Datei lesen. Sie muss enthalten:
- `CREATE TABLE "board_devices"` mit allen Checks und Indexen
- `CREATE UNIQUE INDEX "boards_id_organization_unique"` **vor** dem Fremdschlüssel `board_devices_board_organization_fk`
- `ALTER TABLE "board_controller_leases" ALTER COLUMN "user_id" DROP NOT NULL`, `ADD COLUMN "device_id"`, Check
- `ALTER TABLE "audit_events" ADD COLUMN "actor_device_id"`, Check

drizzle-kit erzeugt die Reihenfolge CREATE TABLE → ADD CONSTRAINT (FK) → CREATE INDEX. Der Unique-Index steht damit nach dem Fremdschlüssel, und die Migration scheitert. Deshalb die Anweisung `CREATE UNIQUE INDEX "boards_id_organization_unique" …` von Hand vor das `ALTER TABLE "board_devices" ADD CONSTRAINT "board_devices_board_organization_fk" …` verschieben. Die Datei ist noch nicht deployt, Umsortieren ist zulässig; die Meta-Snapshots bleiben unverändert.

Run: `pnpm --filter @darts-platform/database db:migrate` (mit `.env`: `npx dotenv -e .env -- pnpm --filter @darts-platform/database db:migrate`)
Expected: Migration läuft durch.

- [ ] **Step 5: Test laufen lassen**

Run: `cd packages/database && npx dotenv -e ../../.env -- npx vitest run src/board-devices.integration.spec.ts && cd ../.. && pnpm --filter @darts-platform/database build && pnpm --filter @darts-platform/database typecheck`
Expected: PASS.

Danach die bestehenden Lease- und Audit-Nutzer typprüfen: `pnpm --filter @darts-platform/api typecheck`. Erwartet: grün. `userId` ist jetzt `string | null` beim Lesen; brechen Stellen, die `lease.userId` lesen, diese in diesem Task anpassen und im Commit nennen.

- [ ] **Step 6: Commit**

```bash
git add packages/database
git commit -m "feat(database): Tabelle board_devices und Geraete-Akteur in Lease und Audit"
```

---

### Task 3: API – Geräte-Principal, Guard und `GET /board-devices/me`

**Files:**
- Modify: `apps/api/src/auth/auth.types.ts`
- Create: `apps/api/src/auth/device-bearer.ts`, `apps/api/src/auth/device-bearer.spec.ts`
- Create: `apps/api/src/auth/board-device-authenticator.ts`
- Create: `apps/api/src/auth/allow-device.decorator.ts`
- Create: `apps/api/src/auth/current-principal.decorator.ts`
- Modify: `apps/api/src/auth/auth.guard.ts`, `apps/api/src/auth/auth.module.ts` (Provider + Export `BoardDeviceAuthenticator`)
- Modify: `apps/api/src/common/configure-application.ts` (CORS `Authorization`)
- Create: `packages/schemas/src/board-device.ts`, Export in `packages/schemas/src/index.ts`
- Create: `apps/api/src/board-devices/board-devices.module.ts`, `board-devices.repository.ts`, `board-device-self.controller.ts`
- Modify: `apps/api/src/app.module.ts` (Import `BoardDevicesModule`)
- Create: `apps/api/src/board-devices/device-auth.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`hashBoardDeviceSecret` aus `@darts-platform/domain/board-device-secret`), Task 2 (`boardDevices`).
- Produces:
  - `auth.types.ts`: `interface AuthenticatedDevice { id: string; organizationId: string; boardId: string }`, `interface DeviceAuthContext { device: AuthenticatedDevice }`, `type Principal = AuthContext | DeviceAuthContext`, `isDevicePrincipal(p: Principal): p is DeviceAuthContext`; `FastifyRequest.deviceContext?: DeviceAuthContext`
  - `readDeviceBearer(headers: IncomingHttpHeaders): string | null`
  - `BoardDeviceAuthenticator.authenticate(secret: string): Promise<AuthenticatedDevice | null>` (frisch, aktualisiert `last_seen_at`)
  - `BoardDeviceAuthenticator.classify(secret: string): Promise<string | null>` (Geräte-ID oder `null`, 30 s gecacht)
  - `AllowDevice()`, `ALLOW_DEVICE_ENDPOINT`
  - `CurrentPrincipal()` → `Principal`
  - Schemas: `boardDeviceSelfSchema`, `type BoardDeviceSelf`
  - `BoardDevicesRepository.getSelf(device: AuthenticatedDevice): Promise<BoardDeviceSelf | null>`

- [ ] **Step 1: Failing Tests schreiben**

`apps/api/src/auth/device-bearer.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { readDeviceBearer } from "./device-bearer.js";

describe("readDeviceBearer", () => {
  it("liest einen bd_-Schlüssel", () => {
    expect(readDeviceBearer({ authorization: "Bearer bd_abc" })).toBe("bd_abc");
  });

  it("ignoriert Gross-/Kleinschreibung des Schemas", () => {
    expect(readDeviceBearer({ authorization: "bearer bd_abc" })).toBe("bd_abc");
  });

  it("ignoriert fehlende und fremde Header", () => {
    expect(readDeviceBearer({})).toBeNull();
    expect(readDeviceBearer({ authorization: "Bearer xyz" })).toBeNull();
    expect(readDeviceBearer({ authorization: "Basic bd_abc" })).toBeNull();
  });
});
```

`apps/api/src/board-devices/device-auth.integration.spec.ts` – über `createApiTestApplication()` (`apps/api/src/testing/api-harness.ts`) und `app.inject`. `beforeAll`: Organisation, Owner-Benutzer, Scheibe `boardId`, zweite Scheibe `otherBoardId`, zwei Spieler. Ein Gerät direkt per Insert anlegen:

```ts
const secret = createBoardDeviceSecret();
const [device] = await database.insert(boardDevices).values({
  organizationId, boardId, secretHash: hashBoardDeviceSecret(secret), label: "iPad Test", createdBy: ownerId,
}).returning();
const bearer = { authorization: `Bearer ${secret}` };
```

Fälle:

```ts
it("liefert Gerät, Scheibe und Organisation ohne laufendes Match", async () => {
  const response = await app.inject({ method: "GET", url: "/api/v1/board-devices/me", headers: bearer });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    device: { id: device.id, label: "iPad Test" },
    board: { id: boardId, name: "Scheibe 1" },
    organization: { id: organizationId, name: expect.any(String) },
    currentMatchId: null,
  });
});

it("nennt das laufende Match der eigenen Scheibe, nicht das einer anderen", async () => {
  // Match auf otherBoardId und auf boardId anlegen (Insert wie in matches.integration.spec.ts
  // oder ueber MatchesService.create mit Owner-AuthContext)
  const response = await app.inject({ method: "GET", url: "/api/v1/board-devices/me", headers: bearer });
  expect(response.json().currentMatchId).toBe(matchOnOwnBoardId);
});

it("aktualisiert last_seen_at", async () => {
  const [row] = await database.select().from(boardDevices).where(eq(boardDevices.id, device.id));
  expect(row?.lastSeenAt).not.toBeNull();
});

it("lehnt einen unbekannten Schlüssel mit DEVICE_REVOKED ab", async () => {
  const response = await app.inject({ method: "GET", url: "/api/v1/board-devices/me", headers: { authorization: "Bearer bd_unbekannt" } });
  expect(response.statusCode).toBe(401);
  expect(response.json().error.code).toBe("DEVICE_REVOKED");
});

it("lehnt ein Gerät auf einer nicht freigegebenen Route ab", async () => {
  const response = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/players`, headers: bearer });
  expect(response.statusCode).toBe(403);
  expect(response.json().error.code).toBe("DEVICE_NOT_ALLOWED");
});

it("lehnt /board-devices/me ohne Schlüssel ab", async () => {
  const response = await app.inject({ method: "GET", url: "/api/v1/board-devices/me" });
  expect(response.statusCode).toBe(401);
});

it("lehnt einen widerrufenen Schlüssel sofort ab", async () => {
  await database.update(boardDevices).set({ revokedAt: new Date() }).where(eq(boardDevices.id, device.id));
  const response = await app.inject({ method: "GET", url: "/api/v1/board-devices/me", headers: bearer });
  expect(response.statusCode).toBe(401);
  expect(response.json().error.code).toBe("DEVICE_REVOKED");
});

it("lässt den Authorization-Header per CORS zu", async () => {
  const response = await app.inject({
    method: "OPTIONS", url: "/api/v1/board-devices/me",
    headers: { origin: environment.WEB_ORIGIN, "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
  });
  expect(String(response.headers["access-control-allow-headers"]).toLowerCase()).toContain("authorization");
});
```

`environment.WEB_ORIGIN` durch den tatsächlichen Namen der Origin-Variable in `configure-application.ts` ersetzen (dort `trustedWebOrigins` nachlesen).

Aufräumen in `afterAll`: Matches der Organisation abbrechen oder löschen, dann Organisation und Benutzer löschen, `await app.close()`.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd apps/api && npx vitest run src/auth/device-bearer.spec.ts` und `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/board-devices/device-auth.integration.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Typen, Bearer, Decorators**

`auth.types.ts` ergänzen (bestehende Typen unverändert lassen):

```ts
export interface AuthenticatedDevice {
  readonly id: string;
  readonly organizationId: string;
  readonly boardId: string;
}

/** Ein Scheiben-Tablet (Spec 2026-09-30-scheiben-tablet). */
export interface DeviceAuthContext {
  readonly device: AuthenticatedDevice;
}

/**
 * Wer eine Anfrage stellt. `AuthContext` bleibt der Benutzer-Kontext: alle
 * bestehenden Handler und Tests arbeiten weiter damit. Nur Handler mit
 * `@AllowDevice()` nehmen `Principal` entgegen.
 */
export type Principal = AuthContext | DeviceAuthContext;

export function isDevicePrincipal(principal: Principal): principal is DeviceAuthContext {
  return "device" in principal;
}
```

und in der `declare module "fastify"`-Erweiterung `deviceContext?: DeviceAuthContext;`.

`device-bearer.ts`:

```ts
import type { IncomingHttpHeaders } from "node:http";

import { BOARD_DEVICE_SECRET_PREFIX } from "@darts-platform/domain/board-device-secret";

const BEARER = /^bearer\s+(\S+)$/iu;

/**
 * Nur `Bearer bd_…` ist ein Geraeteschluessel. Jeder andere Authorization-
 * Header wird ignoriert: die Plattform kennt sonst keine Bearer-Anmeldung.
 */
export function readDeviceBearer(headers: IncomingHttpHeaders): string | null {
  const header = headers.authorization;
  if (typeof header !== "string") return null;
  const token = BEARER.exec(header.trim())?.[1];
  return token !== undefined && token.startsWith(BOARD_DEVICE_SECRET_PREFIX) ? token : null;
}
```

Importiert `device-bearer.ts` über die Subpath-Datei auch `node:crypto`, ist das im API-Paket unproblematisch.

`allow-device.decorator.ts`:

```ts
import { SetMetadata } from "@nestjs/common";

export const ALLOW_DEVICE_ENDPOINT = Symbol("ALLOW_DEVICE_ENDPOINT");

/** Gibt einen Handler fuer Scheiben-Tablets frei. Ohne diese Markierung lehnt der Guard jedes Geraet ab. */
export const AllowDevice = () => SetMetadata(ALLOW_DEVICE_ENDPOINT, true);
```

`current-principal.decorator.ts`:

```ts
import { createParamDecorator, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import type { Principal } from "./auth.types.js";

export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): Principal => {
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  const principal = request.deviceContext ?? request.authContext;
  if (principal === undefined) throw new UnauthorizedException("Authentication is required.");
  return principal;
});
```

- [ ] **Step 4: Authenticator und Guard**

`board-device-authenticator.ts`:

```ts
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { boardDevices } from "@darts-platform/database";
import { hashBoardDeviceSecret } from "@darts-platform/domain/board-device-secret";

import { DatabaseService } from "../database/database.service.js";
import type { AuthenticatedDevice } from "./auth.types.js";

const LAST_SEEN_RESOLUTION_MS = 60_000;
const CLASSIFY_CACHE_MS = 30_000;

@Injectable()
export class BoardDeviceAuthenticator {
  private readonly classified = new Map<string, { readonly deviceId: string | null; readonly until: number }>();

  public constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  /** Frisch gegen die Datenbank, damit ein Widerruf mit der naechsten Anfrage wirkt. */
  public async authenticate(secret: string): Promise<AuthenticatedDevice | null> {
    const secretHash = hashBoardDeviceSecret(secret);
    const [device] = await this.databaseService.database
      .select({ id: boardDevices.id, organizationId: boardDevices.organizationId, boardId: boardDevices.boardId })
      .from(boardDevices)
      .where(and(eq(boardDevices.secretHash, secretHash), isNull(boardDevices.revokedAt)))
      .limit(1);
    if (device === undefined) return null;
    // Hoechstens ein Schreibzugriff pro Minute, nicht einer pro Wurf.
    await this.databaseService.database
      .update(boardDevices)
      .set({ lastSeenAt: new Date() })
      .where(and(
        eq(boardDevices.id, device.id),
        or(isNull(boardDevices.lastSeenAt), lt(boardDevices.lastSeenAt, sql`now() - ${`${LAST_SEEN_RESOLUTION_MS} milliseconds`}::interval`)),
      ));
    return device;
  }

  /**
   * Nur fuer die Einordnung im Rate-Limit, das vor dem Guard laeuft. Gecacht,
   * weil sonst jede Anfrage zwei Nachschlaege kostete; ein Widerruf wird hier
   * bis zu 30 s spaeter sichtbar, wirkt im Guard aber sofort.
   */
  public async classify(secret: string): Promise<string | null> {
    const now = Date.now();
    // Schluessel ist der Hash, nie der Klartext.
    const secretHash = hashBoardDeviceSecret(secret);
    const cached = this.classified.get(secretHash);
    if (cached !== undefined && cached.until > now) return cached.deviceId;
    const [device] = await this.databaseService.database
      .select({ id: boardDevices.id })
      .from(boardDevices)
      .where(and(eq(boardDevices.secretHash, secretHash), isNull(boardDevices.revokedAt)))
      .limit(1);
    const deviceId = device?.id ?? null;
    if (this.classified.size > 10_000) this.classified.clear();
    this.classified.set(secretHash, { deviceId, until: now + CLASSIFY_CACHE_MS });
    return deviceId;
  }
}
```

Die Cache-Grenze `10_000` schützt den Speicher gegen eine Flut zufälliger Schlüssel. Jeder neue unbekannte Schlüssel kostet trotzdem einen Nachschlag über den Unique-Index, bevor gezählt wird. Das ist eine bewusste Grenze und steht so im Kommentar über `classify`. Das SQL für das Intervall darf der Implementer vereinfachen (z. B. JS-Datum `new Date(Date.now() - LAST_SEEN_RESOLUTION_MS)` mit `lt(...)`), solange das Verhalten gleich bleibt. Die JS-Variante ist vorzuziehen.

`auth.guard.ts` – neue Logik nach dem `isPublic`-Zweig:

```ts
const request = context.switchToHttp().getRequest<FastifyRequest>();
const deviceSecret = readDeviceBearer(request.headers);

if (deviceSecret !== null) {
  const device = await this.devices.authenticate(deviceSecret);
  if (device === null) {
    throw new UnauthorizedException({ code: "DEVICE_REVOKED", message: "This device is not paired anymore." });
  }
  const allowsDevice = this.reflector.getAllAndOverride<boolean>(ALLOW_DEVICE_ENDPOINT, [context.getHandler(), context.getClass()]);
  if (allowsDevice !== true) {
    throw new ForbiddenException({ code: "DEVICE_NOT_ALLOWED", message: "Devices may not use this endpoint." });
  }
  request.deviceContext = { device };
  return true;
}

const authContext = await this.authService.getSession(request.headers);
// … wie bisher
```

Konstruktor erhält `@Inject(BoardDeviceAuthenticator) private readonly devices: BoardDeviceAuthenticator`. In `auth.module.ts` `BoardDeviceAuthenticator` unter `providers` und `exports` ergänzen. `DatabaseModule` ist `@Global()`, ein Import ist nicht nötig.

Hinweis: Ist ein Bearer vorhanden, wird die Session **nicht** gelesen. Ein ungültiger Schlüssel neben einem gültigen Cookie ergibt `401`.

In `configure-application.ts` `allowedHeaders` um `"Authorization"` ergänzen und `maxAge: 600` setzen. `Authorization` erzwingt einen CORS-Preflight; ohne `maxAge` cacht Chrome ihn nur 5 s, und das Tablet schickt fast jede Anfrage doppelt. Im CORS-Test zusätzlich `expect(response.headers["access-control-max-age"]).toBe("600")`.

- [ ] **Step 5: Schema, Repository, Controller `/board-devices/me`**

`packages/schemas/src/board-device.ts`:

```ts
import { z } from "zod";

export const boardDeviceSelfSchema = z.object({
  device: z.object({ id: z.uuid(), label: z.string() }),
  board: z.object({ id: z.uuid(), name: z.string() }),
  organization: z.object({ id: z.uuid(), name: z.string() }),
  currentMatchId: z.uuid().nullable(),
});
export type BoardDeviceSelf = z.infer<typeof boardDeviceSelfSchema>;
```

Export in `packages/schemas/src/index.ts` im Stil der bestehenden Zeilen.

`board-devices.repository.ts` mit `getSelf(device)`:

```ts
public async getSelf(device: AuthenticatedDevice): Promise<BoardDeviceSelf | null> {
  const database = this.databaseService.database;
  const [row] = await database
    .select({ deviceId: boardDevices.id, label: boardDevices.label, boardId: boards.id, boardName: boards.name, organizationId: organizations.id, organizationName: organizations.name })
    .from(boardDevices)
    .innerJoin(boards, and(eq(boards.id, boardDevices.boardId), eq(boards.organizationId, boardDevices.organizationId)))
    .innerJoin(organizations, eq(organizations.id, boardDevices.organizationId))
    .where(and(eq(boardDevices.id, device.id), eq(boardDevices.organizationId, device.organizationId)))
    .limit(1);
  if (row === undefined) return null;
  const [current] = await database
    .select({ id: matches.id })
    .from(matches)
    .where(and(eq(matches.organizationId, device.organizationId), eq(matches.boardId, device.boardId), eq(matches.status, "IN_PROGRESS")))
    .limit(1);
  return {
    device: { id: row.deviceId, label: row.label },
    board: { id: row.boardId, name: row.boardName },
    organization: { id: row.organizationId, name: row.organizationName },
    currentMatchId: current?.id ?? null,
  };
}
```

`board-device-self.controller.ts`:

```ts
@Controller("board-devices")
export class BoardDeviceSelfController {
  public constructor(@Inject(BoardDevicesRepository) private readonly repository: BoardDevicesRepository) {}

  @Get("me")
  @AllowDevice()
  public async me(@CurrentPrincipal() principal: Principal): Promise<BoardDeviceSelf> {
    if (!isDevicePrincipal(principal)) {
      throw new ForbiddenException({ code: "DEVICE_REQUIRED", message: "Only a paired device can read this." });
    }
    const self = await this.repository.getSelf(principal.device);
    if (self === null) throw new UnauthorizedException({ code: "DEVICE_REVOKED", message: "This device is not paired anymore." });
    return boardDeviceSelfSchema.parse(self);
  }
}
```

`board-devices.module.ts` registriert Controller und Repository und exportiert das Repository. Import in `app.module.ts`.

- [ ] **Step 6: Tests laufen lassen**

Run: `pnpm --filter @darts-platform/schemas build` und danach die beiden Testdateien aus Step 2, dazu `apps/api/src/auth/auth.integration.spec.ts` und `apps/api/src/testing/route-inventory.integration.spec.ts`.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api packages/schemas
git commit -m "feat(api): Geraete-Principal fuer Scheiben-Tablets und GET /board-devices/me"
```

---

### Task 4: API – Gerät einrichten, entkoppeln, auflisten

**Files:**
- Modify: `packages/schemas/src/board-device.ts`
- Create: `apps/api/src/board-devices/board-devices.service.ts`, `board-devices.controller.ts`
- Modify: `apps/api/src/board-devices/board-devices.repository.ts`, `board-devices.module.ts`
- Create: `apps/api/src/board-devices/board-devices.integration.spec.ts`
- Modify: `apps/api/src/security/tenant-isolation-matrix.integration.spec.ts` (echte `deviceId` in `createResourcesInB`, Geräte im Schnappschuss)

**Interfaces:**
- Consumes: Task 1 (`createBoardDeviceSecret`, `hashBoardDeviceSecret`), Task 2, Task 3.
- Produces:
  - Routen: `POST /api/v1/organizations/:organizationId/boards/:boardId/devices` (Body `{ label }`, Antwort `CreatedBoardDevice`, 201), `DELETE …/boards/:boardId/devices/:deviceId` (204), `GET /api/v1/organizations/:organizationId/board-devices` (Antwort `BoardDeviceList`)
  - Schemas: `createBoardDeviceSchema` (`{ label: string trim 1..80 }`), `boardDeviceSchema` (`{ id, boardId, label, createdAt, lastSeenAt: Date | null }`), `boardDeviceListSchema`, `createdBoardDeviceSchema` (`{ device: boardDeviceSchema, secret: string }`) und die zugehörigen Typen
  - Audit-Aktionen: `BOARD_DEVICE_PAIRED`, `BOARD_DEVICE_REVOKED`, `entityType: "BoardDevice"`

- [ ] **Step 1: Failing Test schreiben**

`board-devices.integration.spec.ts` ruft den Service direkt auf (Muster `apps/api/src/boards/boards.integration.spec.ts`: Owner und MEMBER, `audit`-Objekt). Fälle:

```ts
it("richtet ein Gerät ein und gibt das Geheimnis genau einmal zurück", async () => {
  const created = await service.pair({ organizationId, boardId, data: { label: "iPad Scheibe 1" }, auth, audit });
  expect(created.secret).toMatch(/^bd_[A-Za-z0-9_-]{43}$/u);
  const [row] = await database.select().from(boardDevices).where(eq(boardDevices.id, created.device.id));
  expect(row?.secretHash).toBe(hashBoardDeviceSecret(created.secret));
  const listed = await service.list({ organizationId, auth });
  expect(listed).toEqual([expect.objectContaining({ id: created.device.id, boardId, label: "iPad Scheibe 1", lastSeenAt: null })]);
  expect(JSON.stringify(listed)).not.toContain(created.secret);
});

it("ersetzt beim erneuten Einrichten das bisherige Gerät in derselben Transaktion", async () => {
  const first = await service.pair({ organizationId, boardId, data: { label: "Alt" }, auth, audit });
  const second = await service.pair({ organizationId, boardId, data: { label: "Neu" }, auth, audit });
  const rows = await database.select().from(boardDevices).where(eq(boardDevices.boardId, boardId));
  expect(rows.find((row) => row.id === first.device.id)?.revokedAt).not.toBeNull();
  expect(rows.filter((row) => row.revokedAt === null).map((row) => row.id)).toEqual([second.device.id]);
  const events = await database.select().from(auditEvents).where(and(eq(auditEvents.organizationId, organizationId), eq(auditEvents.entityId, first.device.id)));
  expect(events.map((event) => event.action)).toEqual(expect.arrayContaining(["BOARD_DEVICE_PAIRED", "BOARD_DEVICE_REVOKED"]));
});

it("verlangt board:manage", async () => {
  await expect(service.pair({ organizationId, boardId, data: { label: "X" }, auth: memberAuth, audit })).rejects.toMatchObject({ status: 403 });
  await expect(service.list({ organizationId, auth: memberAuth })).rejects.toMatchObject({ status: 403 });
});

it("kennt keine Scheibe einer fremden Organisation", async () => {
  await expect(service.pair({ organizationId, boardId: foreignBoardId, data: { label: "X" }, auth, audit })).rejects.toMatchObject({ status: 404 });
});

it("widerruft idempotent und auditiert einmal", async () => {
  const created = await service.pair({ organizationId, boardId, data: { label: "Weg" }, auth, audit });
  await service.revoke({ organizationId, boardId, deviceId: created.device.id, auth, audit });
  await service.revoke({ organizationId, boardId, deviceId: created.device.id, auth, audit });
  const revoked = await database.select().from(auditEvents).where(and(eq(auditEvents.entityId, created.device.id), eq(auditEvents.action, "BOARD_DEVICE_REVOKED")));
  expect(revoked).toHaveLength(1);
  expect(await service.list({ organizationId, auth })).not.toContainEqual(expect.objectContaining({ id: created.device.id }));
});

it("meldet 404 für ein Gerät einer anderen Scheibe", async () => {
  const created = await service.pair({ organizationId, boardId, data: { label: "A" }, auth, audit });
  await expect(service.revoke({ organizationId, boardId: secondBoardId, deviceId: created.device.id, auth, audit })).rejects.toMatchObject({ status: 404 });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/board-devices/board-devices.integration.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

Schemas in `packages/schemas/src/board-device.ts` ergänzen:

```ts
export const createBoardDeviceSchema = z.object({ label: z.string().trim().min(1).max(80) });
export const boardDeviceSchema = z.object({
  id: z.uuid(), boardId: z.uuid(), label: z.string(),
  createdAt: z.coerce.date(), lastSeenAt: z.coerce.date().nullable(),
});
export const boardDeviceListSchema = z.array(boardDeviceSchema);
export const createdBoardDeviceSchema = z.object({ device: boardDeviceSchema, secret: z.string() });
export type CreateBoardDeviceInput = z.infer<typeof createBoardDeviceSchema>;
export type BoardDeviceResponse = z.infer<typeof boardDeviceSchema>;
export type BoardDeviceList = z.infer<typeof boardDeviceListSchema>;
export type CreatedBoardDevice = z.infer<typeof createdBoardDeviceSchema>;
```

Repository (`board-devices.repository.ts`), alle Methoden mit `organizationId`:

```ts
public pair(input: {
  readonly organizationId: string; readonly boardId: string; readonly label: string;
  readonly secretHash: string; readonly createdBy: string; readonly audit: AuditContext;
}): Promise<BoardDevice | "board-not-found"> {
  return this.databaseService.database.transaction(async (transaction) => {
    const [board] = await transaction.select({ id: boards.id }).from(boards)
      .where(and(eq(boards.organizationId, input.organizationId), eq(boards.id, input.boardId))).for("update").limit(1);
    if (board === undefined) return "board-not-found";
    const replaced = await transaction.update(boardDevices).set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(boardDevices.organizationId, input.organizationId), eq(boardDevices.boardId, input.boardId), isNull(boardDevices.revokedAt)))
      .returning();
    for (const old of replaced) {
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId, actorUserId: input.createdBy, action: "BOARD_DEVICE_REVOKED",
        entityType: "BoardDevice", entityId: old.id, oldValue: { label: old.label, boardId: old.boardId }, newValue: { revokedAt: old.revokedAt, reason: "REPLACED" },
        ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId,
      });
    }
    const [created] = await transaction.insert(boardDevices).values({
      organizationId: input.organizationId, boardId: input.boardId, label: input.label, secretHash: input.secretHash, createdBy: input.createdBy,
    }).returning();
    if (created === undefined) throw new Error("Board device insert did not return a row.");
    await transaction.insert(auditEvents).values({
      organizationId: input.organizationId, actorUserId: input.createdBy, action: "BOARD_DEVICE_PAIRED",
      entityType: "BoardDevice", entityId: created.id, newValue: { label: created.label, boardId: created.boardId },
      ip: input.audit.ip, userAgent: input.audit.userAgent, correlationId: input.audit.correlationId,
    });
    return created;
  });
}
```

Der Audit-Eintrag enthält nie `secretHash`.

`revoke(input: { organizationId, boardId, deviceId, actorUserId, audit }): Promise<"ok" | "not-found">`: In einer Transaktion `select … for update` auf das Gerät mit `organizationId`, `boardId` und `id`. Fehlt es: `"not-found"`. Ist `revokedAt` gesetzt: `"ok"` ohne Schreiben. Sonst `revokedAt` setzen und `BOARD_DEVICE_REVOKED` auditieren (`reason: "MANUAL"`).

`list(organizationId): Promise<BoardDevice[]>`: aktive Geräte (`revoked_at is null`) der Organisation, sortiert nach `createdAt`.

Service (`board-devices.service.ts`): `pair`, `revoke`, `list`, jeweils zuerst `this.access.requirePermission({ organizationId, userId: input.auth.user.id, permission: "board:manage" })`. `pair` erzeugt `createBoardDeviceSecret()`, übergibt den Hash, mappt `"board-not-found"` auf `NotFoundException("Board not found.")` und gibt `createdBoardDeviceSchema.parse({ device: toResponse(created), secret })` zurück. `revoke` mappt `"not-found"` auf `NotFoundException("Board device not found.")`. `OrganizationAccessService` kommt aus `OrganizationsModule`; im Modul importieren wie `BoardsModule` es tut (dort nachlesen).

Controller (`board-devices.controller.ts`), `@Controller("organizations/:organizationId")`, Muster wie `display-keys.controller.ts`:

```ts
@Post("boards/:boardId/devices")
public pair(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("boardId", ParseUUIDPipe) boardId: string, @Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() request: FastifyRequest): Promise<CreatedBoardDevice> {
  const data = parseBody(createBoardDeviceSchema, body);
  return this.service.pair({ organizationId, boardId, data, auth, audit: getAuditContext(request, this.environment.TRUST_PROXY_HOPS) });
}

@Delete("boards/:boardId/devices/:deviceId")
@HttpCode(204)
public revoke(/* organizationId, boardId, deviceId, auth, request */): Promise<void> { /* … */ }

@Get("board-devices")
public list(@Param("organizationId", ParseUUIDPipe) organizationId: string, @CurrentAuth() auth: AuthContext): Promise<BoardDeviceList> {
  return this.service.list({ organizationId, auth });
}
```

Kein `@AllowDevice()` an diesen Routen.

- [ ] **Step 4: Tenant-Isolationsmatrix nachziehen**

In `tenant-isolation-matrix.integration.spec.ts`:
- `createResourcesInB` gibt heute kein `boardId` zurück (Z. 295–307). Ergänzen: `boardId: board.id`. Das Gerät im Fixture-Stil der Datei anlegen: `createAsOwnerB("POST", `${base}/boards/${board.id}/devices`, { label: "B-Tablet" })` (Helfer Z. 215–226). `deviceId` aus der Antwort (`device.id`) ebenfalls zurückgeben.
- `bodies` erhält `"POST /api/v1/organizations/:organizationId/boards/:boardId/devices": { label: "Matrix" }`.
- `snapshotOrganizationB` erhält `boardDevices: … select({ id, revokedAt, lastSeenAt }) … where organizationId = B`.

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @darts-platform/schemas build`, danach `board-devices.integration.spec.ts`, `tenant-isolation-matrix.integration.spec.ts`, `permission-matrix.integration.spec.ts`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api packages/schemas
git commit -m "feat(api): Scheiben-Tablets einrichten, entkoppeln und auflisten"
```

---

### Task 5: API – Scoren durch das Gerät (Match-Routen)

**Files:**
- Create: `apps/api/src/common/audit-actor.ts`, `apps/api/src/common/audit-actor.spec.ts`
- Modify: `apps/api/src/matches/matches.controller.ts`
- Modify: `apps/api/src/matches/matches.service.ts`
- Modify: `apps/api/src/matches/matches.repository.ts` (`ActorInput` Z. 42; Lease Z. 376–399; `submitVisitInTransaction` ~Z. 452–565; Undo ~Z. 960–1000; Leg-Entscheide ~Z. 1040–1095)
- Create: `apps/api/src/board-devices/device-scoring.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`decideDeviceMatchAccess`, `isDevicePermission`), Task 3 (`Principal`, `isDevicePrincipal`, `AllowDevice`, `CurrentPrincipal`).
- Produces:
  - `auditActor(principal: Principal): { actorUserId: string | null; actorDeviceId: string | null }`
  - `leaseActor(principal: Principal): { userId: string | null; deviceId: string | null }`
  - `MatchesService.get|submitVisit|undo|decideLegStart|decideLegByBull|acquireControllerLease` nehmen `auth: Principal`
  - Repository-Ergebnisse erweitert um `"device-board-mismatch" | "device-match-not-active"`
  - `type UserActorInput = Omit<ActorInput, "auth"> & { readonly auth: AuthContext }` für `abort`

- [ ] **Step 1: Failing Tests schreiben**

`audit-actor.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { auditActor, leaseActor } from "./audit-actor.js";

const user = { user: { id: "u1", email: "a@example.test", name: "A" }, session: { id: "s1", expiresAt: new Date() } };
const device = { device: { id: "d1", organizationId: "o1", boardId: "b1" } };

describe("auditActor", () => {
  it("setzt beim Benutzer nur actorUserId", () => {
    expect(auditActor(user)).toEqual({ actorUserId: "u1", actorDeviceId: null });
    expect(leaseActor(user)).toEqual({ userId: "u1", deviceId: null });
  });

  it("setzt beim Gerät nur actorDeviceId", () => {
    expect(auditActor(device)).toEqual({ actorUserId: null, actorDeviceId: "d1" });
    expect(leaseActor(device)).toEqual({ userId: null, deviceId: "d1" });
  });
});
```

`device-scoring.integration.spec.ts` ruft den Service direkt auf und nutzt `deviceAuth: DeviceAuthContext = { device: { id: deviceId, organizationId, boardId } }`. Das Gerät wird in `beforeAll` per Insert angelegt (die ID muss in `board_devices` existieren, sonst scheitert der Fremdschlüssel in Lease und Audit). Fixture für freies Match: `matchesService.create({ … boardId, … }, auth: ownerAuth)`.

**Turnier- und Liga-Fall:** Die Aufbauhelfer aus `apps/api/src/tournaments/board-occupancy.integration.spec.ts` übernehmen (`startLeagueSlot` sowie Turnier anlegen und per `service.assign` einer Scheibe zuweisen). Lokal in die neue Datei kopieren, wie es die bestehenden Specs untereinander tun. Die Scheibe des Geräts ist die zugewiesene Scheibe. Die `scoringMatchId` liefert die Rückgabe von `assign` bzw. `encounterSlots.matchId`.

Fälle:

```ts
it("scort, nimmt zurück und entscheidet den Anwurf im freien Match der eigenen Scheibe", async () => {
  const match = await matchesService.create({ organizationId, data: { playerOneId, playerTwoId, boardId, bestOfLegs: 1, bestOfSets: 1 }, auth: ownerAuth, audit });
  const controllerId = randomUUID();
  await matchesService.acquireControllerLease({ organizationId, matchId: match.id, controllerId, force: false, auth: deviceAuth, audit });
  // Ein freies Match beginnt mit BULL_FIRST_LEG: der Anwurf wird zuerst entschieden
  // (Muster matches.integration.spec.ts Z. 714/749, legStartPending: true).
  const started = await matchesService.decideLegStart({ organizationId, matchId: match.id, data: { commandId: randomUUID(), expectedVersion: match.version, legNumber: 1, startingSeat: 1, controllerId }, auth: deviceAuth, audit });
  const scored = await matchesService.submitVisit({ organizationId, matchId: match.id, data: { commandId: randomUUID(), expectedVersion: started.version, playerId: playerOneId, points: 60, dartsThrown: 3, controllerId }, auth: deviceAuth, audit });
  const undone = await matchesService.undo({ organizationId, matchId: match.id, data: { commandId: randomUUID(), expectedVersion: scored.version, controllerId }, auth: deviceAuth, audit });
  expect(undone.version).toBe(scored.version + 1);
  const events = await database.select().from(auditEvents).where(and(eq(auditEvents.entityId, match.id), eq(auditEvents.action, "SCORE_VISIT_RECORDED")));
  expect(events[0]).toMatchObject({ actorUserId: null, actorDeviceId: deviceId });
  const [lease] = await database.select().from(boardControllerLeases).where(eq(boardControllerLeases.matchId, match.id));
  expect(lease).toMatchObject({ userId: null, deviceId });
});

it("erzeugt mit gleicher commandId keinen zweiten Visit", async () => { /* submitVisit zweimal mit derselben commandId und expectedVersion, visits zählen = 1 */ });

it("lehnt ein Match einer anderen Scheibe ab", async () => {
  // Match auf otherBoardId anlegen
  await expect(matchesService.get({ organizationId, matchId: foreign.id, auth: deviceAuth })).rejects.toMatchObject({ status: 403, response: { code: "DEVICE_BOARD_MISMATCH" } });
  await expect(matchesService.submitVisit({ /* … */ auth: deviceAuth, audit })).rejects.toMatchObject({ status: 403 });
  await expect(matchesService.acquireControllerLease({ /* … */ auth: deviceAuth, audit })).rejects.toMatchObject({ status: 403 });
});

it("lehnt eine fremde Organisation mit 404 ab", async () => {
  await expect(matchesService.get({ organizationId: foreignOrganizationId, matchId: match.id, auth: deviceAuth })).rejects.toMatchObject({ status: 404 });
});

it("verbietet Abbrechen und Anlegen", async () => {
  // Controller-Ebene: siehe Step 6 (HTTP), weil der Service diese Methoden nur mit AuthContext kennt.
});

it("lehnt Scoren und Undo in einem beendeten Match mit DEVICE_MATCH_NOT_ACTIVE ab", async () => {
  // Match anlegen, danach `database.update(matches).set({ startingScore: 2 })` (Check >= 2, schema.ts:406;
  // das Aggregat liest startingScore aus der Zeile). Anwurf entscheiden, Checkout D1 durch das Gerät
  // (points 2, dartsThrown 1, checkoutDouble 1) -> COMPLETED.
  // submitVisit und undo mit deviceAuth -> 409, response.code DEVICE_MATCH_NOT_ACTIVE.
});

it("gibt bei wiederholter commandId eines fremden Scheiben-Matches keinen Zustand heraus", async () => {
  // Owner scort ein Match auf otherBoardId mit commandId X; das Gerät sendet submitVisit mit derselben
  // commandId auf dieses Match -> 403 DEVICE_BOARD_MISMATCH (nicht 200 mit fremdem Zustand).
});

it("scort ein Turniermatch auf der zugewiesenen Scheibe", async () => {
  /* assign -> scoringMatchId; Turniermatches beginnen ebenfalls mit BULL_FIRST_LEG: decideLegStart
     mit deviceAuth, dann submitVisit mit deviceAuth ok */
});

it("scort einen Liga-Slot auf der zugewiesenen Scheibe", async () => {
  /* assignSlot -> matchId; Liga (LEAGUE) braucht in Leg 1 keinen Entscheid: submitVisit mit deviceAuth ok */
});
```

Die Fälle mit Kommentar im Körper vollständig ausschreiben, nach dem Muster des ersten Falls. `startingScore` ist ein Feld von `CreateMatchInput`, falls es existiert (in `packages/schemas` nachlesen). Sonst den Checkout mit 501 über mehrere Visits herbeiführen, wie `matches.integration.spec.ts` es tut.

Aufräumen: `afterEach` bricht laufende Matches der Organisation mit `ownerAuth` ab (siehe Hinweis in der Memory-Notiz: geteilte Scheiben blockieren sonst den nächsten Test).

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `cd apps/api && npx vitest run src/common/audit-actor.spec.ts` und `npx dotenv -e ../../.env -- npx vitest run src/board-devices/device-scoring.integration.spec.ts`
Expected: FAIL (Typfehler bzw. fehlende Module).

- [ ] **Step 3: `audit-actor.ts`**

```ts
import { isDevicePrincipal, type Principal } from "../auth/auth.types.js";

/** Spalten des handelnden Akteurs fuer `audit_events` (genau einer ist gesetzt). */
export function auditActor(principal: Principal): { readonly actorUserId: string | null; readonly actorDeviceId: string | null } {
  return isDevicePrincipal(principal)
    ? { actorUserId: null, actorDeviceId: principal.device.id }
    : { actorUserId: principal.user.id, actorDeviceId: null };
}

/** Spalten des Halters einer Controller-Lease. */
export function leaseActor(principal: Principal): { readonly userId: string | null; readonly deviceId: string | null } {
  return isDevicePrincipal(principal)
    ? { userId: null, deviceId: principal.device.id }
    : { userId: principal.user.id, deviceId: null };
}
```

- [ ] **Step 4: Repository**

- `type ActorInput = { …; readonly auth: Principal; … }`. Import `Principal`, `isDevicePrincipal` aus `../auth/auth.types.js`, `auditActor`, `leaseActor` aus `../common/audit-actor.js`, `decideDeviceMatchAccess`, `type DeviceMatchAction` aus `@darts-platform/domain`.
- Ergebnis-Typen `MutationResult`/`UndoMutationResult` (am Dateikopf nachlesen) um `"device-board-mismatch" | "device-match-not-active"` erweitern.
- Private Hilfsfunktion:

```ts
/**
 * Bindung eines Scheiben-Tablets an das Match seiner Scheibe. Laeuft in der
 * schreibenden Transaktion, nachdem das Match gesperrt ist: eine Freigabe der
 * Scheibe zwischen Pruefung und Schreibzugriff rutscht so nicht durch
 * (Spec 2026-09-30-scheiben-tablet, Abschnitt 3).
 */
function deviceMismatch(auth: Principal, action: DeviceMatchAction, match: { readonly boardId: string | null; readonly status: string }): "device-board-mismatch" | "device-match-not-active" | null {
  if (!isDevicePrincipal(auth)) return null;
  const decision = decideDeviceMatchAccess({ action, deviceBoardId: auth.device.boardId, matchBoardId: match.boardId, matchStatus: match.status });
  switch (decision) {
    case "ALLOWED": return null;
    case "BOARD_MISMATCH": return "device-board-mismatch";
    case "MATCH_NOT_ACTIVE": return "device-match-not-active";
    default: { const exhaustive: never = decision; return exhaustive; }
  }
}
```

- In `submitVisitInTransaction` direkt nach `if (match === undefined) return "not-found";` und **vor** der Versionsprüfung: `const denied = deviceMismatch(input.auth, "write", match); if (denied !== null) return denied;`. Gleich im Undo-Pfad und in beiden Leg-Entscheid-Pfaden, jeweils mit `"write"`. Beim Undo steht die Prüfung vor dem Zweig, der ein beendetes Match wieder öffnet (Z. ~946–981): ein Gerät erreicht ihn damit nie.
- `acquireControllerLease`: Die Auswahl muss `boardId` mitlesen (`select({ id, status, boardId })`). Nach `if (match === undefined) return null;` bei `deviceMismatch(input.auth, "write", match) !== null` den Wert zurückgeben. Der Rückgabetyp wird `… | null | "device-board-mismatch" | "device-match-not-active"`.
- Alle `actorUserId: input.auth.user.id` in den geräte-fähigen Pfaden (Lease-Audit, `SCORE_VISIT_RECORDED`, `SCORE_VISIT_REVERTED`, Leg-Entscheid `command.type`) durch `...auditActor(input.auth)` ersetzen. In der Lease `userId: input.auth.user.id` durch `...leaseActor(input.auth)` ersetzen, im `insert` wie im `onConflictDoUpdate.set`.
- `create` und `correctTournamentResult` haben eigene Eingabetypen mit `AuthContext` und bleiben unverändert. `abort`/`abortInTransaction` nutzen heute `ActorInput` und lesen `input.auth.user.id` (Z. 400–437). Für sie einen eigenen Typ einführen und die beiden Signaturen darauf umstellen:

```ts
/** Nur fuer Personen: das Geraet darf nicht abbrechen (devicePermissions). */
type UserActorInput = Omit<ActorInput, "auth"> & { readonly auth: AuthContext };
```

- `syncProjection` liest `auth` nicht (Z. 1239–1249) und bleibt unverändert.
- Das Repository ist ~1400 Zeilen lang. Nur die genannten Stellen ändern.

- [ ] **Step 5: Service**

In `matches.service.ts`:

```ts
private async require(input: { readonly organizationId: string; readonly auth: Principal }, permission: "match:read" | "match:create" | "match:score" | "match:undo" | "match:abort"): Promise<void> {
  if (isDevicePrincipal(input.auth)) {
    // Fremde Organisation wie heute als unbekannt melden, nicht als verboten.
    if (input.auth.device.organizationId !== input.organizationId) throw new NotFoundException("Match not found.");
    if (!isDevicePermission(permission)) throw new ForbiddenException({ code: "DEVICE_NOT_ALLOWED", message: "Devices may not do this." });
    return;
  }
  await this.access.requirePermission({ organizationId: input.organizationId, userId: input.auth.user.id, permission });
}
```

- `get`, `submitVisit`, `undo`, `decideLegStart`, `decideLegByBull`, `acquireControllerLease`: Typ `auth: Principal`. `list`, `create`, `abort` bleiben bei `AuthContext`.
- `get`: Beim Gerät nach dem Laden `decideDeviceMatchAccess({ action: "read", deviceBoardId, matchBoardId: state.boardId, matchStatus: state.status })` prüfen; bei `BOARD_MISMATCH` → `ForbiddenException({ code: "DEVICE_BOARD_MISMATCH", message: "This match is not on this device's board." })`. `MatchStateResponse.boardId` existiert (`packages/schemas/src/match.ts:146`). Ein abgebrochenes Match liefert `getState` als `null` (404), das bleibt so.
- `mutate` erhält `input.auth` (Signatur `{ organizationId, matchId, auth: Principal }`). Die neuen Ergebnisse vor dem Laden des Zustands zuordnen:

```ts
if (result === "device-board-mismatch") throw new ForbiddenException({ code: "DEVICE_BOARD_MISMATCH", message: "This match is not on this device's board." });
if (result === "device-match-not-active") throw new ConflictException({ code: "DEVICE_MATCH_NOT_ACTIVE", message: "This match is not active." });
```

Dasselbe in `acquireControllerLease`.

Zusätzlich in `mutate`, nachdem der Zustand geladen ist und bevor er zurückgegeben wird: Ist `input.auth` ein Gerät, `decideDeviceMatchAccess({ action: "read", deviceBoardId: input.auth.device.boardId, matchBoardId: state.boardId, matchStatus: state.status })` prüfen und bei `BOARD_MISMATCH` `ForbiddenException({ code: "DEVICE_BOARD_MISMATCH", … })` werfen. Grund: Eine wiederholte `commandId` gibt im Repository `"ok"` zurück, noch bevor das Match gelesen und die Scheibe geprüft ist (Z. 448, 458). Ohne diese Prüfung bekäme ein Gerät den Zustand eines Matches einer anderen Scheibe.

- [ ] **Step 6: Controller**

In `matches.controller.ts` an `get`, `submitVisit`, `undo`, `decideLegStart`, `decideLegByBull`, `controllerLease` jeweils `@AllowDevice()` ergänzen und `@CurrentAuth() auth: AuthContext` durch `@CurrentPrincipal() auth: Principal` ersetzen. `list`, `create`, `abort` bleiben unverändert und damit für Geräte gesperrt.

HTTP-Fälle in `device-scoring.integration.spec.ts` ergänzen (eigener `describe` mit `createApiTestApplication`):

```ts
it("verbietet dem Gerät Abbrechen und Anlegen", async () => {
  const abort = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/matches/${match.id}/abort`, headers: bearer, payload: { commandId: randomUUID(), expectedVersion: 0, controllerId: randomUUID() } });
  expect(abort.statusCode).toBe(403);
  expect(abort.json().error.code).toBe("DEVICE_NOT_ALLOWED");
  const create = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/matches`, headers: bearer, payload: { playerOneId, playerTwoId, boardId, bestOfLegs: 1, bestOfSets: 1 } });
  expect(create.statusCode).toBe(403);
});

it("liest das Match der eigenen Scheibe über HTTP", async () => {
  const response = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/matches/${match.id}`, headers: bearer });
  expect(response.statusCode).toBe(200);
});
```

`bearer` benötigt ein echtes Geheimnis. Das Gerät dieser Datei deshalb mit `createBoardDeviceSecret()` anlegen und den Hash speichern.

- [ ] **Step 7: Tests laufen lassen**

Run: die beiden neuen Dateien, dazu `src/matches/matches.integration.spec.ts`, `src/matches/tournament-scoring-lock.integration.spec.ts`, `src/matches/encounter-scoring-lock.integration.spec.ts`, `src/tournaments/board-occupancy.integration.spec.ts`, `src/security/tenant-isolation-matrix.integration.spec.ts`; `pnpm --filter @darts-platform/api typecheck`.
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): Scheiben-Tablets scoren die Matches ihrer Scheibe"
```

---

### Task 6: API – Schnellwerte für das Gerät

**Files:**
- Modify: `apps/api/src/statistics/statistics.controller.ts`, `statistics.service.ts`
- Modify: `apps/api/src/board-devices/device-scoring.integration.spec.ts` (neuer `describe`)

**Interfaces:**
- Consumes: Task 3 (`Principal`, `AllowDevice`, `CurrentPrincipal`).
- Produces: `StatisticsService.frequentScores({ organizationId, playerId, auth: Principal })`.

- [ ] **Step 1: Failing Test schreiben**

```ts
describe("Schnellwerte am Tablet", () => {
  it("liefert Schnellwerte für eine Person im laufenden Match der Scheibe", async () => {
    // laufendes Match auf boardId mit playerOneId
    const response = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/players/${playerOneId}/statistics/frequent-scores`, headers: bearer });
    expect(response.statusCode).toBe(200);
  });

  it("verweigert Schnellwerte für eine Person, die nicht an der Scheibe spielt", async () => {
    const response = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/players/${bystanderPlayerId}/statistics/frequent-scores`, headers: bearer });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DEVICE_BOARD_MISMATCH");
  });

  it("verweigert das Statistikprofil", async () => {
    const response = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/players/${playerOneId}/statistics`, headers: bearer });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DEVICE_NOT_ALLOWED");
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen** (Befehl wie Task 5). Expected: FAIL mit 403 `DEVICE_NOT_ALLOWED` im ersten Fall.

- [ ] **Step 3: Implementieren**

- `frequentScores` im Controller: `@AllowDevice()`, `@CurrentPrincipal() auth: Principal`. `profile` bleibt unverändert.
- Im Service vor dem bisherigen Ablauf:

```ts
if (isDevicePrincipal(input.auth)) {
  if (input.auth.device.organizationId !== input.organizationId) throw new NotFoundException("Player not found.");
  const playing = await this.repository.isPlayerOnActiveBoardMatch({ organizationId: input.organizationId, boardId: input.auth.device.boardId, playerId: input.playerId });
  if (!playing) throw new ForbiddenException({ code: "DEVICE_BOARD_MISMATCH", message: "This player is not playing on this device's board." });
} else {
  await this.access.requirePermission({ organizationId: input.organizationId, userId: input.auth.user.id, permission: "statistics:read" });
}
```

- Im Statistik-Repository `isPlayerOnActiveBoardMatch`: `matches` (organizationId, boardId, `status = 'IN_PROGRESS'`) join `match_participants` join `match_participant_players` (`player_id = playerId`), `limit 1`. Tabellen- und Spaltennamen in `schema.ts` (Z. 450–497) nachlesen.

- [ ] **Step 4: Tests laufen lassen** – die Datei aus Step 1 und `src/statistics/*.spec.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): Schnellwerte fuer Personen am Scheiben-Tablet"
```

---

### Task 7: API – Rate-Limit-Stufe für Geräte

**Files:**
- Modify: `packages/config/src/environment.ts` (bei den übrigen `RATE_LIMIT_*`, ~Z. 60–83), `packages/config/src/environment.spec.ts`
- Modify: `apps/api/src/common/rate-limit.ts`, `apps/api/src/common/configure-application.ts`
- Create: `apps/api/src/common/rate-limit-device.integration.spec.ts`

**Interfaces:**
- Consumes: Task 3 (`BoardDeviceAuthenticator.classify`, `readDeviceBearer`).
- Produces: `RATE_LIMIT_DEVICE_MAX_PER_MINUTE` (Default 120); `registerRateLimit(app, environment, classifyDevice: (secret: string) => Promise<string | null>)`.

- [ ] **Step 1: Failing Tests schreiben**

`environment.spec.ts`: `expect(environment.RATE_LIMIT_DEVICE_MAX_PER_MINUTE).toBe(120);` neben den bestehenden Default-Erwartungen.

`rate-limit-device.integration.spec.ts` mit `createApiTestApplication({ RATE_LIMIT_MAX_PER_MINUTE: 5, RATE_LIMIT_DEVICE_MAX_PER_MINUTE: 8, RATE_LIMIT_SENSITIVE_MAX_PER_MINUTE: 2 })` und einem echten Gerät (Insert mit Hash):

```ts
it("zählt ein gültiges Gerät pro Gerät, nicht gegen die Grenze der IP", async () => {
  const statuses: number[] = [];
  for (let index = 0; index < 8; index += 1) {
    statuses.push((await app.inject({ method: "GET", url: "/api/v1/board-devices/me", headers: bearer })).statusCode);
  }
  expect(statuses.every((status) => status === 200)).toBe(true);
  expect((await app.inject({ method: "GET", url: "/api/v1/board-devices/me", headers: bearer })).statusCode).toBe(429);
});

it("zählt einen unbekannten Schlüssel gegen die Grenze der IP", async () => {
  const statuses: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    statuses.push((await app.inject({ method: "GET", url: "/api/v1/board-devices/me", headers: { authorization: `Bearer bd_zufall${index}` }, remoteAddress: "203.0.113.9" })).statusCode);
  }
  expect(statuses.at(-1)).toBe(429);
});
```

```ts
it("lässt die enge Grenze für Passwort-Reset auch mit gültigem Geräteschlüssel stehen", async () => {
  const statuses: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    statuses.push((await app.inject({ method: "POST", url: "/api/v1/auth/request-password-reset", headers: { ...bearer, "content-type": "application/json" }, payload: { email: "niemand@example.test" }, remoteAddress: "203.0.113.20" })).statusCode);
  }
  expect(statuses.at(-1)).toBe(429);
});
```

`remoteAddress` im ersten Fall gleich lassen, im zweiten eine andere Adresse verwenden, damit sich die Fälle nicht gegenseitig zählen. Wie `resolveClientAddress` die Adresse bei `TRUST_PROXY_HOPS` bestimmt, in `client-address.ts` nachlesen und den Override danach setzen.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen.** Expected: FAIL.

- [ ] **Step 3: Implementieren**

- `environment.ts`: `RATE_LIMIT_DEVICE_MAX_PER_MINUTE: rateLimitMaxSchema.default(120),` mit Kommentar: «Je Scheiben-Tablet; ein Tablet erzeugt im Match rund 35 Anfragen pro Minute (Lease-Heartbeat 3 s, Kiosk-Polling 5 s, Würfe).»
- `rate-limit.ts`: `type RateLimitTier = "general" | "public" | "sensitive" | "device";`. `keyGenerator` wird `async`:

```ts
keyGenerator: async (request: FastifyRequest): Promise<string> => {
  const tier = resolveRateLimitTier(pathOf(request));
  // Nur die allgemeine Stufe zaehlt pro Geraet. Anmeldung, Passwort-Reset und
  // Einladungen (sensitive) behalten ihre enge Grenze pro IP, auch mit
  // gueltigem Geraeteschluessel – sonst bekaeme jede Person am Tablet 120
  // statt 10 Anmeldeversuche pro Minute.
  const secret = tier === "general" ? readDeviceBearer(request.headers) : null;
  if (secret !== null) {
    const deviceId = await classifyDevice(secret);
    if (deviceId !== null) return `device:${deviceId}`;
  }
  return `${tier}:${resolveClientAddress(request, environment.TRUST_PROXY_HOPS)}`;
},
max: (request: FastifyRequest, key: string): number =>
  key.startsWith("device:") ? environment.RATE_LIMIT_DEVICE_MAX_PER_MINUTE : maxFor(resolveRateLimitTier(pathOf(request)), environment),
```

Vorher im installierten Paket (`apps/api/node_modules/@fastify/rate-limit/index.d.ts`) prüfen, dass `keyGenerator` ein Promise zurückgeben darf und `max` den Schlüssel als zweites Argument erhält. Ist eines davon nicht der Fall, das melden (NEEDS_CONTEXT) statt einen Umweg zu bauen.

- `configure-application.ts`: `await registerRateLimit(app, environment, (secret) => app.get(BoardDeviceAuthenticator).classify(secret));`
- Doku-Kommentar über `registerRateLimit` um die Stufe `device` ergänzen.

- [ ] **Step 4: Tests laufen lassen** – `cd packages/config && npx vitest run`, `pnpm --filter @darts-platform/config build`, dann die neue Datei und `apps/api/src/common/*rate*.spec.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/config apps/api
git commit -m "feat(api): eigene Rate-Limit-Stufe fuer Scheiben-Tablets"
```

---

### Task 8: API – Geräte-Zeile in der Tenant-Isolationsmatrix

**Files:**
- Modify: `apps/api/src/security/tenant-isolation-matrix.integration.spec.ts`

**Interfaces:**
- Consumes: Task 3–6.

- [ ] **Step 1: Test ergänzen**

Neuer `describe("Tenant-Isolation: Scheiben-Tablet von A", …)`:

- Die `collectRoutes`-Overrides (Z. 199–201) um `RATE_LIMIT_DEVICE_MAX_PER_MINUTE: 100_000` ergänzen. Sonst zählen die rund 90 Anfragen derselben Geräte-Zeile gegen die Vorgabe 120, und eine Wiederholung im selben Prozess kippt die Matrix in 429.
- Organisation A erhält eine Scheibe und ein Gerät mit echtem Geheimnis (`createBoardDeviceSecret`).
- Für **jede** Route aus `routes` (nicht nur `:organizationId`), ausser `@Public`-Routen: Anfrage mit `authorization: Bearer <geheimnis>`, Parameter mit `fillRealParams(route.url, realIdsOfB)` gefüllt.
- Erwartet:
  - `GET /api/v1/board-devices/me` → 200
  - die sechs geräte-fähigen Match-Routen und `frequent-scores` gegen Ressourcen von B → 404
  - jede andere Route → 403 mit `DEVICE_NOT_ALLOWED`
- Übersprungen (nicht bewertet) werden nur die öffentlichen Routen: Präfixe `/api/v1/public/`, `/api/v1/auth/`, `/api/v1/csp-reports`, die Route `/api/v1/health` und die `@Public()`-Routen aus `organizations/invitation-preview.controller.ts`. Die übrigen `/api/v1/invitations/…`-Routen (`invitations.controller.ts`, nicht öffentlich) werden bewertet und müssen `403 DEVICE_NOT_ALLOWED` liefern. Die öffentlichen Einladungsrouten als explizite Liste `method + url` im Test führen, nicht über ein Präfix.
- Danach `snapshotOrganizationB()` unverändert.

Die Liste der erlaubten Routen steht im Test als Konstante:

```ts
const deviceRoutes = new Set([
  "GET /api/v1/board-devices/me",
  "GET /api/v1/organizations/:organizationId/matches/:matchId",
  "POST /api/v1/organizations/:organizationId/matches/:matchId/visits",
  "POST /api/v1/organizations/:organizationId/matches/:matchId/undo",
  "POST /api/v1/organizations/:organizationId/matches/:matchId/leg-start",
  "POST /api/v1/organizations/:organizationId/matches/:matchId/leg-by-bull",
  "POST /api/v1/organizations/:organizationId/matches/:matchId/controller-lease",
  "GET /api/v1/organizations/:organizationId/players/:playerId/statistics/frequent-scores",
]);
```

Ein neuer Endpunkt mit `@AllowDevice()` ohne Eintrag hier lässt den Test rot werden. Das ist beabsichtigt.

- [ ] **Step 2: Test laufen lassen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/security/tenant-isolation-matrix.integration.spec.ts`
Expected: PASS. Schlägt eine Route fehl, liegt der Fehler im Code, nicht im Test. Beheben und in diesem Task committen.

- [ ] **Step 3: Commit**

```bash
git add apps/api
git commit -m "test(api): Scheiben-Tablet in der Tenant-Isolationsmatrix"
```

---

### Task 9: Web – Geräteschlüssel, API-Client und Scoreboard ohne Rückweg

**Files:**
- Create: `apps/web/src/lib/device-key-storage.ts`, `apps/web/src/lib/device-key-storage.spec.ts`
- Create: `apps/web/src/lib/device-credential-context.tsx`
- Modify: `apps/web/src/lib/api-client.ts` (Parameter, Fehlermeldungen), `apps/web/src/lib/api-client.spec.ts`
- Modify: `apps/web/src/lib/use-board-controller-lock.ts`, `apps/web/src/components/match/use-match-scoring.ts`, `apps/web/src/components/match/use-quick-scores.ts`
- Modify: `apps/web/src/components/match/match-scoreboard.tsx`, `scoreboard-header.tsx`, `match-scoreboard.render.spec.tsx`

**Interfaces:**
- Produces:
  - `interface StoredBoardDevice { secret: string; boardName: string; organizationName: string }`
  - `rememberBoardDevice(device: StoredBoardDevice): void`, `recallBoardDevice(): StoredBoardDevice | null`, `forgetBoardDevice(): void`
  - `DeviceCredentialProvider({ secret, children })`, `useDeviceSecret(): string | undefined`
  - `apiRequest({ …, deviceSecret?: string | undefined })`
  - `MatchScoreboard`: `backHref?: string`, `backLabel?: string`, `showHeaderLinks?: boolean` (Default `true`)

- [ ] **Step 1: Failing Tests schreiben**

`device-key-storage.spec.ts` nach dem Muster von `display-key-storage.spec.ts` (gleiche `Storage.prototype`-Technik): merken/lesen/vergessen; ein kaputter JSON-Wert ergibt `null`; ein werfendes `localStorage` ergibt `null` bzw. keinen Fehler.

`api-client.spec.ts` ergänzen:

```ts
it("sendet den Geräteschlüssel als Bearer und ohne Cookies", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await apiRequest({ path: "/board-devices/me", schema: z.object({}), deviceSecret: "bd_x" });
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  expect((init.headers as Record<string, string>).Authorization).toBe("Bearer bd_x");
  expect(init.credentials).toBe("omit");
});

it("sendet ohne Geräteschlüssel keinen Authorization-Header", async () => {
  // wie oben ohne deviceSecret: kein Authorization, credentials "include"
});
```

`match-scoreboard.render.spec.tsx` ergänzen:
- Ohne `backHref` rendert die Kopfzeile keinen Zurück-Link.
- Mit `showHeaderLinks={false}` rendert die Kopfzeile weder «LIVE» noch «Bedienungsanleitung».

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @darts-platform/web exec vitest run src/lib/device-key-storage.spec.ts src/lib/api-client.spec.ts src/components/match/match-scoreboard.render.spec.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

`device-key-storage.ts`:

```ts
/**
 * Geraeteschluessel eines Scheiben-Tablets (Spec 2026-09-30-scheiben-tablet).
 * Liegt im `localStorage` der installierten Web-App; jeder Zugriff in
 * `try`/`catch` wie in `display-key-storage.ts` – ein Kiosk, der an einem
 * gesperrten Speicher mit einer Ausnahme stehen bleibt, ist schlimmer als
 * einer, der neu eingerichtet werden muss.
 */
const STORAGE_KEY = "dartbase.board-device";

export interface StoredBoardDevice {
  readonly secret: string;
  readonly boardName: string;
  readonly organizationName: string;
}

export function rememberBoardDevice(device: StoredBoardDevice): void {
  try {
    Storage.prototype.setItem.call(window.localStorage, STORAGE_KEY, JSON.stringify(device));
  } catch {
    // Kein Gedaechtnis ist kein Fehler – siehe Kommentar oben.
  }
}

export function recallBoardDevice(): StoredBoardDevice | null {
  try {
    const raw = Storage.prototype.getItem.call(window.localStorage, STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" && parsed !== null &&
      "secret" in parsed && typeof parsed.secret === "string" && parsed.secret.startsWith("bd_") &&
      "boardName" in parsed && typeof parsed.boardName === "string" &&
      "organizationName" in parsed && typeof parsed.organizationName === "string"
    ) {
      return { secret: parsed.secret, boardName: parsed.boardName, organizationName: parsed.organizationName };
    }
    return null;
  } catch {
    return null;
  }
}

export function forgetBoardDevice(): void {
  try {
    Storage.prototype.removeItem.call(window.localStorage, STORAGE_KEY);
  } catch {
    // siehe oben
  }
}
```

`device-credential-context.tsx`:

```tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Nur der Kiosk-Teilbaum (`/scheibe`) setzt diesen Kontext. Ausserhalb ist er
 * leer, und `apiRequest` sendet keinen Geraeteschluessel – eine Admin-Sitzung
 * auf demselben Tablet tritt so nie versehentlich als Geraet auf.
 */
const DeviceCredentialContext = createContext<string | undefined>(undefined);

export function DeviceCredentialProvider({ secret, children }: { readonly secret: string; readonly children: ReactNode }) {
  return <DeviceCredentialContext.Provider value={secret}>{children}</DeviceCredentialContext.Provider>;
}

export function useDeviceSecret(): string | undefined {
  return useContext(DeviceCredentialContext);
}
```

`api-client.ts`:
- Parameter `readonly deviceSecret?: string | undefined;` mit Kommentar.
- `credentials: input.deviceSecret === undefined ? "include" : "omit"`.
- Header: `...(input.deviceSecret === undefined ? {} : { Authorization: `Bearer ${input.deviceSecret}` })`.
- In `localizedMessage` ergänzen:
  - `DEVICE_REVOKED: "Dieses Tablet ist nicht mehr gekoppelt."`
  - `DEVICE_NOT_ALLOWED: "Das darf ein Scheiben-Tablet nicht."`
  - `DEVICE_BOARD_MISMATCH: "Dieses Match läuft nicht mehr auf dieser Scheibe."`
  - `DEVICE_MATCH_NOT_ACTIVE: "Dieses Match läuft nicht mehr."`

Hooks: In `useBoardControllerLock`, `useMatchScoring` (alle `apiRequest`-Aufrufe inklusive der Queue-Wiedergabe ~Z. 194 und Visits ~Z. 316) und `useQuickScores` jeweils `const deviceSecret = useDeviceSecret();` und `deviceSecret` an `apiRequest` übergeben. Wo ein Aufruf in `useCallback`/`useMutation` steckt, gehört `deviceSecret` in dessen Abhängigkeiten.

`offline-replay.ts` bleibt im Code unverändert. `401` ist dort bewusst `RETRY` (Z. 26–27, 64–72): ein widerrufenes Gerät urteilt nicht über das Kommando, und nach erneutem Einrichten darf der Eintrag noch durchgehen. Im Zustand «nicht gekoppelt» mountet der Kiosk kein Scoreboard, also läuft keine Wiedergabe. `403 DEVICE_BOARD_MISMATCH` und `409 DEVICE_MATCH_NOT_ACTIVE` sind über `retryableStatus` bereits `REJECTED`. In `offline-replay.spec.ts` drei Fälle ergänzen, die genau das festhalten: `DEVICE_REVOKED`/401 → `RETRY`, `DEVICE_BOARD_MISMATCH`/403 → `REJECTED`, `DEVICE_MATCH_NOT_ACTIVE`/409 → `REJECTED`.

`MatchScoreboard`:
- `backHref?: string`, `backLabel?: string`, `showHeaderLinks?: boolean` (Default `true`).
- Die beiden Effekte, die nach Abbruch bzw. Match-Ende `router.push(backHref)` aufrufen, laufen nur, wenn `backHref !== undefined`. Der Hinweis «… geht es gleich von selbst» erscheint nur dann.
- `ScoreboardHeader` rendert den Zurück-Link nur mit `backHref`, und die Links «LIVE» und «Bedienungsanleitung» (Z. 78–96) nur bei `showHeaderLinks`. Aus dem Kiosk führt so kein Link hinaus.
- [ ] **Step 4: Tests laufen lassen**

Run: die drei Dateien aus Step 2, dann `pnpm --filter @darts-platform/web test` und `pnpm --filter @darts-platform/web typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): Geraeteschluessel im API-Client und Scoreboard ohne Rueckweg"
```

---

### Task 10: Web – Tablets in der Organisationsverwaltung einrichten und entkoppeln

**Files:**
- Create: `apps/web/src/lib/standalone-display.ts`, `apps/web/src/lib/standalone-display.spec.ts`
- Create: `apps/web/src/components/organization/board-devices-section.tsx`, `board-devices-section.render.spec.tsx`
- Modify: `apps/web/src/components/organization/organization-settings-route.tsx` (Abschnitt vor «Organisation löschen», ~Z. 328)

**Interfaces:**
- Consumes: Task 4 (Routen, Schemas), Task 9 (`rememberBoardDevice`).
- Produces: `isStandaloneDisplay(): boolean`; `BoardDevicesSection({ organizationId, organizationName })`.

- [ ] **Step 1: Failing Tests schreiben**

`standalone-display.spec.ts`: `matchMedia("(display-mode: standalone)")` → `true`; `navigator.standalone === true` (iOS) → `true`; sonst `false`; ein werfendes `matchMedia` → `false`.

`board-devices-section.render.spec.tsx` (Muster: `organization-settings-route.render.spec.tsx`, `apiRequest` gemockt):
- Zeigt pro Scheibe «Kein Gerät» oder «Gekoppelt · zuletzt gesehen …».
- Ausserhalb der installierten App ist «Dieses Gerät einrichten» deaktiviert und der Hinweis «Öffne DartBase zuerst als App vom Home-Bildschirm» sichtbar.
- In der installierten App ruft «Dieses Gerät einrichten» `POST …/boards/:boardId/devices` auf. Danach werden `rememberBoardDevice` (mit `secret`, Board- und Organisationsname), `authClient.signOut` und `router.replace("/scheibe")` aufgerufen, in dieser Reihenfolge.
- «Entkoppeln» öffnet eine Bestätigung. Nach Bestätigen folgt `DELETE …/devices/:deviceId`.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen.** Run: `pnpm --filter @darts-platform/web exec vitest run <beide Dateien>`. Expected: FAIL.

- [ ] **Step 3: Implementieren**

`standalone-display.ts`:

```ts
/**
 * Laeuft DartBase als installierte App? iOS trennt den Speicher von Safari und
 * installierter App; ein im Browser-Tab eingerichtetes Geraet waere in der App
 * nicht gekoppelt (Spec 2026-09-30-scheiben-tablet, Abschnitt 2).
 */
export function isStandaloneDisplay(): boolean {
  try {
    const iosStandalone = "standalone" in window.navigator && (window.navigator as { readonly standalone?: boolean }).standalone === true;
    return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}
```

`board-devices-section.tsx`:
- Zwei Queries: `["boards", organizationId]` (`boardListSchema`) und `["board-devices", organizationId]` (`boardDeviceListSchema`).
- Pro Scheibe eine Zeile: Name, Status, Knöpfe.
- «Dieses Gerät einrichten» ist `disabled`, solange `!isStandaloneDisplay()`. Den Wert erst nach dem Mount lesen (`useEffect` + State), damit der Server-Render nicht abweicht.
- Einrichten: `useMutation` → `apiRequest({ path: /organizations/${id}/boards/${boardId}/devices, method: "POST", body: { label: `Tablet ${board.name}` }, schema: createdBoardDeviceSchema })`. `onSuccess`: `rememberBoardDevice({ secret, boardName: board.name, organizationName })`, `await authClient.signOut()`, `router.replace("/scheibe")`.
- Hat die Scheibe schon ein Gerät, zeigt der Knopf «Dieses Gerät als Ersatz einrichten». Vor dem Ausführen erscheint eine `ConfirmDialog`-Bestätigung: «Das bisherige Tablet dieser Scheibe wird dabei entkoppelt.»
- «Entkoppeln»: `ConfirmDialog` (bestehende Komponente, nur offen gemountet) → `DELETE`, danach `invalidateQueries(["board-devices", organizationId])`.
- «zuletzt gesehen»: relative Zeit mit `Intl.RelativeTimeFormat("de-CH")`. Minuten unter 60, sonst Stunden, sonst Datum `TT.MM.JJJJ`.
- Nur rendern, wenn die Rolle `board:manage` hat (`hasOrganizationPermission`, wie der Rest der Seite). Der Server prüft ohnehin.
- Überschrift `<h2>`: «Scheiben-Tablets». Einleitungssatz: «Ein Tablet an der Scheibe scort die dort zugewiesenen Matches ohne Anmeldung. Richte es direkt auf dem Tablet ein, in der installierten App.»
- Gestaltung wie die anderen `<section>`s der Seite (Klassen dort übernehmen).

In `organization-settings-route.tsx` den Abschnitt vor «Organisation löschen» einfügen.

- [ ] **Step 4: Tests laufen lassen** – beide Dateien, danach `pnpm --filter @darts-platform/web test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): Scheiben-Tablets in der Organisationsverwaltung einrichten und entkoppeln"
```

---

### Task 11: Web – Kiosk `/scheibe`

**Files:**
- Create: `apps/web/src/components/kiosk/kiosk-view.ts`, `kiosk-view.spec.ts`
- Create: `apps/web/src/components/kiosk/kiosk-route.tsx`, `kiosk-route.render.spec.tsx`
- Create: `apps/web/src/app/scheibe/page.tsx`
- Create: `apps/web/src/components/kiosk/kiosk-redirect.tsx`
- Modify: `apps/web/src/app/page.tsx` (`<KioskRedirect />` einbinden)

**Interfaces:**
- Consumes: Task 3 (`boardDeviceSelfSchema`), Task 9 (Storage, Context, `MatchScoreboard`-Props).
- Produces:
  - `type KioskView = { kind: "idle" } | { kind: "match"; matchId: string } | { kind: "ended"; matchId: string }`
  - `kioskView(input: { currentMatchId: string | null; lastMatchId: string | null; lastMatchCompletedAt: number | null; dismissedMatchId: string | null; now: number }): KioskView`
  - `KIOSK_POLL_MS = 5_000`, `KIOSK_END_HOLD_MS = 30_000`

- [ ] **Step 1: Failing Tests schreiben**

`kiosk-view.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { KIOSK_END_HOLD_MS, kioskView } from "./kiosk-view";

const base = { currentMatchId: null, lastMatchId: null, lastMatchCompletedAt: null, dismissedMatchId: null, now: 1_000_000 };

describe("kioskView", () => {
  it("wartet ohne Match", () => {
    expect(kioskView(base)).toEqual({ kind: "idle" });
  });

  it("zeigt das laufende Match der Scheibe", () => {
    expect(kioskView({ ...base, currentMatchId: "m1" })).toEqual({ kind: "match", matchId: "m1" });
  });

  it("hält den Endstand 30 Sekunden", () => {
    const ended = { ...base, lastMatchId: "m1", lastMatchCompletedAt: base.now - KIOSK_END_HOLD_MS + 1 };
    expect(kioskView(ended)).toEqual({ kind: "ended", matchId: "m1" });
    expect(kioskView({ ...ended, now: base.now + 1 })).toEqual({ kind: "idle" });
  });

  it("verlässt den Endstand sofort nach «Weiter»", () => {
    expect(kioskView({ ...base, lastMatchId: "m1", lastMatchCompletedAt: base.now, dismissedMatchId: "m1" })).toEqual({ kind: "idle" });
  });

  it("zeigt ein neues Match auch während des Endstands", () => {
    expect(kioskView({ ...base, currentMatchId: "m2", lastMatchId: "m1", lastMatchCompletedAt: base.now })).toEqual({ kind: "match", matchId: "m2" });
  });
});
```

`kiosk-route.render.spec.tsx` (`apiRequest` gemockt, Storage vorbelegt):
- Ohne gespeicherten Schlüssel: Text «Dieses Tablet ist nicht gekoppelt» und ein Link zur Startseite.
- Mit Schlüssel und `currentMatchId: null`: «Scheibe 1 – wartet auf nächstes Match», Organisationsname in der Kopfzeile.
- Mit `currentMatchId`: rendert `MatchScoreboard` (Mock) mit `canScore`, ohne `canAbort`, ohne `backHref`, mit `showHeaderLinks={false}`.
- `apiRequest` wirft `ApiClientError` mit Code `DEVICE_REVOKED`: `forgetBoardDevice` wird aufgerufen, Text «Dieses Tablet ist nicht mehr gekoppelt – bitte in der Organisationsverwaltung unter «Scheiben-Tablets» neu einrichten.»
- Jede `apiRequest` erhält `deviceSecret`.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen.** Expected: FAIL.

- [ ] **Step 3: Implementieren**

`kiosk-view.ts`:

```ts
export const KIOSK_POLL_MS = 5_000;
export const KIOSK_END_HOLD_MS = 30_000;

export type KioskView =
  | { readonly kind: "idle" }
  | { readonly kind: "match"; readonly matchId: string }
  | { readonly kind: "ended"; readonly matchId: string };

/**
 * Was das Tablet zeigt. Ein laufendes Match der Scheibe hat immer Vorrang;
 * ein gerade beendetes bleibt `KIOSK_END_HOLD_MS` stehen, damit die
 * Spielenden das Ergebnis sehen – oder bis jemand «Weiter» tippt.
 */
export function kioskView(input: {
  readonly currentMatchId: string | null;
  readonly lastMatchId: string | null;
  readonly lastMatchCompletedAt: number | null;
  readonly dismissedMatchId: string | null;
  readonly now: number;
}): KioskView {
  if (input.currentMatchId !== null) return { kind: "match", matchId: input.currentMatchId };
  if (
    input.lastMatchId !== null &&
    input.lastMatchCompletedAt !== null &&
    input.dismissedMatchId !== input.lastMatchId &&
    input.now - input.lastMatchCompletedAt < KIOSK_END_HOLD_MS
  ) {
    return { kind: "ended", matchId: input.lastMatchId };
  }
  return { kind: "idle" };
}
```

`kiosk-route.tsx` (Client-Komponente):
- `const [stored] = useState(() => recallBoardDevice())`. Ist er `null`, den Zustand «nicht gekoppelt» zeigen.
- Innerhalb von `DeviceCredentialProvider secret={stored.secret}`:
  - Query `["board-device-self"]` → `apiRequest({ path: "/board-devices/me", schema: boardDeviceSelfSchema, deviceSecret })`, `refetchInterval: KIOSK_POLL_MS` (TanStack pausiert im Hintergrund standardmässig; `refetchIntervalInBackground` nicht setzen), `retry` nur bei Netzfehlern.
  - Fehler mit Code `DEVICE_REVOKED` → `forgetBoardDevice()`, Zustand «nicht mehr gekoppelt». Offene Queue-Einträge des zuletzt gezeigten Matches über `listOfflineCommands(`match:${organizationId}:${lastMatchId}`)` zählen und als «N Aufnahmen konnten nicht mehr übertragen werden» nennen.
  - Lokaler State `lastMatchId`, `lastMatchCompletedAt`, `dismissedMatchId`. Ein Ticker (`setInterval` 1 s, nur im Zustand `ended`) hält `now` aktuell.
  - Match-Query `["match", organizationId, matchId]` → `apiRequest({ path: /organizations/${organizationId}/matches/${matchId}, schema: matchStateSchema, deviceSecret })`, `refetchInterval: (query) => matchRefetchInterval(query.state.error)`, `retry: shouldRetryMatchLoad` (wie `match-scoreboard-route.tsx`).
  - Wechselt der geladene Match-Status auf `COMPLETED`, `lastMatchId` und `lastMatchCompletedAt = Date.now()` setzen. Liefert `/me` ein anderes `currentMatchId`, den letzten Stand verwerfen.
  - Beim Match-Lesen 404 (abgebrochenes Match) oder `403 DEVICE_BOARD_MISMATCH`, bei einer Mutation `409 DEVICE_MATCH_NOT_ACTIVE` → `lastMatchId` auf `null`, zurück in den Leerlauf (die nächste `/me`-Antwort entscheidet). `matches.board_id` wird nie genullt; nach Walkover, Slot-Freigabe oder Abbruch kommt deshalb 404 bzw. 409, nicht 403.
- Darstellung:
  - Vollbild `main` wie `match-scoreboard-route.tsx` (`sektorenring bg-sisal-200`).
  - Kopfzeile: Scheibenname (`self.board.name`, vor der ersten Antwort `stored.boardName`), Organisationsname, Verbindungsindikator. Die bestehende Komponente für den Online-Status aus dem Scoreboard verwenden (`scoreboard-status.tsx` nachlesen).
  - `idle`: grosser Text «{Scheibe} – wartet auf nächstes Match».
  - `match` und `ended`: `<MatchScoreboard canAbort={false} canScore match={match} organizationId={self.organization.id} showHeaderLinks={false} />`. Im Zustand `ended` darunter ein Knopf «Weiter» (`min-h-12`), der `dismissedMatchId` setzt.
  - Langes Drücken (800 ms, Pointer-Events) auf den Scheibennamen öffnet `ConfirmDialog` «Gerät zurücksetzen?» mit dem Text «Löscht die Kopplung nur auf diesem Tablet. Entkoppeln kannst du es in der Organisationsverwaltung.» Nach Bestätigen: `forgetBoardDevice()`, `router.replace("/")`.
- Alle Texte Deutsch (Schweiz), Touch-Ziele mindestens 48 px.

`app/scheibe/page.tsx`:

```tsx
import type { Metadata } from "next";

import { KioskRoute } from "@/components/kiosk/kiosk-route";

export const metadata: Metadata = {
  title: "Scheibe",
  description: "Score-Erfassung eines fest montierten Tablets.",
};

export default function ScheibePage() {
  return <KioskRoute />;
}
```

`kiosk-redirect.tsx`: Client-Komponente, die im `useEffect` bei `isStandaloneDisplay() && recallBoardDevice() !== null` `router.replace("/scheibe")` aufruft und `null` rendert. Ohne die Standalone-Prüfung landete ein Admin, der auf dem Android-Tablet den normalen Browser öffnet, immer im Kiosk (Chrome teilt `localStorage` zwischen Tab und App). In `app/page.tsx` am Anfang von `<main>` einbinden.

CSP: Die Seite nutzt keine Inline-Skripte. Das Root-Layout ist seit ADR 0014 dynamisch, eine zusätzliche Einstellung ist nicht nötig.

- [ ] **Step 4: Tests laufen lassen** – beide Specs, danach `pnpm --filter @darts-platform/web test`, `pnpm --filter @darts-platform/web typecheck`, `pnpm build`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): Kiosk-Ansicht /scheibe fuer Scheiben-Tablets"
```

---

### Task 12: E2E – Tablet einrichten, Match übernehmen, entkoppeln

**Files:**
- Create: `apps/web/tests/board-device-kiosk.spec.ts`
- Modify (falls nötig): `apps/web/tests/fixtures.ts`

**Interfaces:**
- Consumes: alles Vorherige. Fixtures und Anmelde-Helfer aus `apps/web/tests/fixtures.ts` und `foundation.spec.ts` bzw. `team-encounter.spec.ts` (Aufbau von Turnier und Begegnung) nachlesen und wiederverwenden.

- [ ] **Step 1: Test schreiben**

Zwei Fälle, jeder mit eigenem `browser.newContext()` für Admin und Tablet:

1. **Turnier:**
   - Admin legt Organisation, zwei Spieler und «Scheibe 1» an.
   - Tablet-Kontext: Anmeldung als Admin. `page.addInitScript(() => { window.matchMedia = ((query: string) => ({ matches: query.includes("standalone"), media: query, addEventListener() {}, removeEventListener() {}, onchange: null, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia; })` simuliert die installierte App.
   - Organisationsverwaltung → «Dieses Gerät einrichten» für Scheibe 1. Erwartet: URL `/scheibe`, «Scheibe 1 – wartet auf nächstes Match».
   - Admin-Kontext: Turnier mit Scheibe 1 anlegen und das erste Match der Scheibe zuweisen.
   - Tablet: innerhalb von 10 s erscheint das Scoreboard. Ein Leg zu Ende scoren (Hilfen aus `scoreboard-entry.ts`). Erwartet: «Match beendet» und «Weiter»; nach «Weiter» «Scheibe 1 – wartet auf nächstes Match».
   - Admin: Organisationsverwaltung → «Entkoppeln» → bestätigen.
   - Tablet: innerhalb von 10 s «Dieses Tablet ist nicht mehr gekoppelt».
2. **Liga-Slot:** gleich, aber Zuweisung über die Begegnung (Muster `team-encounter.spec.ts`). Nur bis «Scoreboard erscheint, eine Aufnahme wird angenommen».

Feste Daten vermeiden (siehe Memory «Kader zum Spieltag»): Datumswerte relativ zu `Date.now()`.

- [ ] **Step 2: Test laufen lassen**

Run: `npx dotenv -e .env -- pnpm --filter @darts-platform/web test:e2e board-device-kiosk.spec.ts`, danach die **volle** Suite `pnpm test:e2e`.
Expected: PASS. Ist ein anderer Fall rot, zuerst allein laufen lassen (Kontention gegen `next dev`). Ist er allein auch rot, ist es ein echter Bruch durch diesen Branch: beheben.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests
git commit -m "test(web): E2E fuer Scheiben-Tablet mit Turnier und Liga-Slot"
```

---

### Task 13: Dokumentation

**Files:**
- Create: `docs/adr/0019-scheiben-geraete.md`
- Modify: `docs/adr/0018-loeschkonzept.md`
- Modify: `AGENTS.md` (Abschnitt 13)
- Create: Betriebsdoku. Vorher prüfen, wo bestehende Betriebsanleitungen liegen (`ls docs`, `grep -ril "runbook\|betrieb" docs | head`). Liegt dort ein passender Ordner, die Datei `scheiben-tablet-einrichten.md` dort ablegen, sonst in `docs/betrieb/`.

- [ ] **Step 1: ADR 0019 schreiben**

Aufbau wie ADR 0017/0018 (Status, Datum 30.09.2026, Kontext, Entscheid, Konsequenzen). Inhalt aus der Spec:
- zweiter Principal statt Scheinbenutzer, mit Begründung
- `@AllowDevice()` als geschlossene Standardeinstellung
- Katalog `devicePermissions`
- Bindung an `matches.board_id` in der Transaktion
- kein Undo nach Match-Ende durch das Gerät (Liga-Slot bliebe COMPLETED, keine Zeitgrenze am offenen Tablet)
- Rate-Limit-Stufe mit Einordnungs-Cache
- `localStorage` statt Cookie, mit der offenen iPad-Prüfung (Spec Abschnitt 7)
- Konsequenzen: Wer ein Tablet stiehlt, kann bis zum Widerruf die Matches dieser Scheibe scoren, sonst nichts.
- Nicht umgesetzt: QR-Kopplung, Realtime-Kanal, Personen-Audit.

- [ ] **Step 2: Übrige Dokumente**

- ADR 0018: `board_devices` in der Tabellenübersicht ergänzen. Löschweg: Cascade über Scheibe und Organisation. `audit_events.actor_device_id` wird beim Löschen `null`.
- `AGENTS.md` Abschnitt 13: ein Absatz: «Neben Benutzern gibt es Scheiben-Tablets als Principal (ADR 0019). Ein Gerät erreicht nur Handler mit `@AllowDevice()`, und jeder solche Handler steht in der Geräte-Zeile der Tenant-Isolationsmatrix.»
- Betriebsdoku:
  - iPad: Safari → Teilen → «Zum Home-Bildschirm», App öffnen, anmelden, Organisationsverwaltung → Scheiben-Tablets → «Dieses Gerät einrichten»; danach «Geführter Zugriff» (Einstellungen → Bedienungshilfen → Geführter Zugriff, dreimal Seitentaste).
  - Android: Chrome → «App installieren», gleicher Ablauf, «App anheften» (Einstellungen → Sicherheit).
  - Entkoppeln, Ersatzgerät, was bei «nicht mehr gekoppelt» zu tun ist.
  - Hinweis auf die Vorabprüfung aus der Spec, Abschnitt 7.

- [ ] **Step 3: Commit**

```bash
git add docs AGENTS.md
git commit -m "docs: ADR 0019 Scheiben-Geraete, Loeschkonzept und Betriebsanleitung"
```

---

### Task 14: Volle Prüfung

- [ ] **Step 1:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Expected: alles grün.
- [ ] **Step 2:** `pnpm test:e2e`. Expected: grün.
- [ ] **Step 3:** Anfragezahl eines Kiosk-Tablets messen: lokal `/scheibe` mit laufendem Match 60 s offen lassen, im API-Log (oder mit dem Netzwerk-Tab) die Anfragen zählen. Den Wert im Commit von Task 7 bzw. in der ADR notieren. Liegt er über 60 pro Minute, die Vorgabe 120 überdenken und dem Koordinator melden.
- [ ] **Step 4:** Rote Befunde beheben, jeweils als eigener `fix:`-Commit.
