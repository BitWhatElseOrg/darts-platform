# Anzeige-Schlüssel für Board- und TV-Ansichten — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Turnierleitung stellt für einen Anlass Anzeige-Schlüssel aus, mit denen Board- und TV-Bildschirme ein privates Turnier sehen, ohne dass sich jemand am Gerät anmeldet.

**Architecture:** Eine Tabelle `tournament_display_keys` hält je Schlüssel nur den SHA-256-Hash; der Klartext existiert einmal, in der Antwort, die ihn erzeugt. Die öffentliche Route nimmt ihn als Query-Parameter entgegen und lässt damit auch ein privates Turnier durch. Ausstellen und Widerrufen laufen unter einer eigenen Berechtigung `tournament:share`.

**Tech Stack:** TypeScript strict, Drizzle ORM, PostgreSQL, NestJS, Zod, `node:crypto`, Next.js App Router, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-07-oeffentliche-turnier-ids-design.md`](../specs/2026-09-07-oeffentliche-turnier-ids-design.md)

**Voraussetzung:** [Plan 1](./2026-09-07-oeffentliche-turnier-ids.md) ist umgesetzt und gemerged. Dieser Plan baut auf `tournaments.public_id`, `tournaments.visibility` und `getPublicDashboardDataByPublicId` auf.

## Global Constraints

- `strict: true`; kein `any`, kein `as any`. `unknown` statt `any`, discriminated unions, exhaustive `switch`.
- Kommentare und Oberflächentexte auf Deutsch (Schweizer Rechtschreibung, kein ß), Code-Bezeichner auf Englisch.
- Jede tenant-bezogene Repository-Funktion nimmt `organizationId` explizit entgegen (AGENTS.md §14).
- Datenintegrität gehört in die Datenbank (AGENTS.md §10); kritische Benutzeraktionen werden auditiert (AGENTS.md §4).
- Vor Abschluss: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`.

## Sicherheitsgrundsätze dieses Plans

Drei Regeln, die in jedem Task gelten und deshalb hier einmal stehen:

1. **Der Klartext verlässt den Server genau einmal.** Gespeichert wird nur `sha256(secret)`. Ein Datenbankleck gibt keine Zugänge her.
2. **Ein ungültiger Schlüssel ändert die Antwort nicht.** Ein privates Turnier antwortet mit 404 — ob der Schlüssel fehlte, abgelaufen war oder nie existierte, bleibt von aussen ununterscheidbar.
3. **Der Vergleich läuft über den Hash, nicht über den Klartext**, und der Nachschlag geht über den Unique-Index auf `secret_hash` — kein Durchlaufen aller Schlüssel eines Turniers.

---

### Task 1: Tabelle und Migration

**Files:**
- Modify: `packages/database/src/schema.ts` (neue Tabelle nach `tournaments`)
- Create: `packages/database/drizzle/0027_tournament_display_keys.sql`
- Create: `packages/database/src/display-keys.integration.spec.ts`

**Interfaces:**
- Produces: Tabelle `tournament_display_keys` mit `id`, `organizationId`, `tournamentId`, `secretHash`, `label`, `expiresAt`, `revokedAt`, `createdBy` und den Zeitstempeln.

- [ ] **Step 1: Die Tabelle im Schema anlegen**

In `packages/database/src/schema.ts`, direkt nach der Tabelle `tournaments`:

```ts
/**
 * Zugang fuer Anzeigegeraete am Spielort — Board-Tablets und der Beamer im
 * Saal. Sie sind geteilte Geraete: eine Anmeldung darauf waere ein Passwort an
 * der Wand. Der Schluessel gilt fuer ein Turnier, nicht fuer ein Board; sonst
 * waeren an einem Abend acht Zugaenge zu verteilen und acht zurueckzuziehen.
 *
 * Gespeichert wird nur der Hash. Den Klartext gibt es einmal, in der Antwort,
 * die den Schluessel erzeugt.
 */
export const tournamentDisplayKeys = pgTable(
  "tournament_display_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    secretHash: char("secret_hash", { length: 64 }).notNull(),
    label: varchar("label", { length: 80 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tournament_display_keys_secret_hash_unique").on(table.secretHash),
    index("tournament_display_keys_tournament_idx").on(table.tournamentId),
  ],
);
```

`char` ist dem Import aus `drizzle-orm/pg-core` hinzuzufügen, falls es dort noch fehlt.

- [ ] **Step 2: Migration erzeugen**

Run: `pnpm --filter @darts-platform/database db:generate`

Erwartet: `packages/database/drizzle/0027_*.sql` mit `CREATE TABLE`, dem Unique-Index und dem Index auf `tournament_id`. In `0027_tournament_display_keys.sql` umbenennen und `meta/_journal.json` angleichen.

- [ ] **Step 3: Den fehlschlagenden Test schreiben**

Create `packages/database/src/display-keys.integration.spec.ts` mit drei Fällen: eine Zeile lässt sich anlegen; derselbe `secret_hash` ein zweites Mal wird abgewiesen (`tournament_display_keys_secret_hash_unique`); das Löschen des Turniers räumt die Schlüssel mit (`ON DELETE CASCADE`). Aufbau wie `tournament-visibility.integration.spec.ts` aus Plan 1 — Organisation und Turnier in `beforeAll`, Aufräumen in `afterAll`.

- [ ] **Step 4: Test laufen lassen und scheitern sehen**

Run: `cd apps/api && npx dotenv -e .env.test -- npx vitest run ../../packages/database/src/display-keys.integration.spec.ts`
Erwartet: FAIL — Tabelle existiert nicht.

- [ ] **Step 5: Migration einspielen und bestätigen**

Run: `cd packages/database && npx dotenv -e ../../apps/api/.env.test -- pnpm db:migrate`
Dann den Test erneut. Erwartet: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/database
git commit -m "feat(database): Tabelle fuer Anzeige-Schluessel"
```

---

### Task 2: Berechtigung `tournament:share`

**Files:**
- Modify: `packages/domain/src/permissions.ts`
- Modify: `packages/domain/src/permissions.spec.ts`

**Interfaces:**
- Produces: `"tournament:share"` in `organizationPermissions`, vergeben an `OWNER`, `ADMIN` und `TOURNAMENT_DIRECTOR`.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

In `packages/domain/src/permissions.spec.ts`:

```ts
describe("tournament:share", () => {
  it("liegt bei Leitung und Verwaltung", () => {
    expect(hasOrganizationPermission("OWNER", "tournament:share")).toBe(true);
    expect(hasOrganizationPermission("ADMIN", "tournament:share")).toBe(true);
    expect(hasOrganizationPermission("TOURNAMENT_DIRECTOR", "tournament:share")).toBe(true);
  });

  it("liegt nicht bei den lesenden Rollen", () => {
    expect(hasOrganizationPermission("VIEWER", "tournament:share")).toBe(false);
  });

  it("ist nicht dasselbe wie tournament:update", () => {
    // Wer Spielplaene pflegt, muss nicht zwingend Zugaenge verteilen duerfen.
    // Die Trennung ist der Zweck dieser Berechtigung; faellt sie zusammen,
    // war die Berechtigung ueberfluessig.
    expect(organizationPermissions).toContain("tournament:update");
    expect(organizationPermissions).toContain("tournament:share");
  });
});
```

Die Rollennamen aus `organizationRoles` in `membership.ts` gegenprüfen; `VIEWER` durch die dort tatsächlich vorhandene lesende Rolle ersetzen, falls sie anders heisst.

- [ ] **Step 2: Test laufen lassen und scheitern sehen**

Run: `cd packages/domain && npx vitest run src/permissions.spec.ts`
Erwartet: FAIL — `tournament:share` ist kein gültiger Wert.

- [ ] **Step 3: Die Berechtigung ergänzen**

In `packages/domain/src/permissions.ts` in `organizationPermissions` nach `"tournament:update"` einfügen:

```ts
  "tournament:share",
```

Und im Block `TOURNAMENT_DIRECTOR` nach `"tournament:update"` dieselbe Zeile. `OWNER` und `ADMIN` bekommen sie über `organizationPermissions` automatisch.

- [ ] **Step 4: Test laufen lassen und bestätigen**

Run: `cd packages/domain && npx vitest run src/permissions.spec.ts`
Erwartet: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src
git commit -m "feat(domain): Berechtigung tournament:share"
```

---

### Task 3: Schlüssel erzeugen und bewerten

**Files:**
- Create: `packages/domain/src/display-key.ts`
- Create: `packages/domain/src/display-key.spec.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces: `createDisplayKeySecret(): string`, `hashDisplayKeySecret(secret: string): string`, `type DisplayKeyState = "valid" | "expired" | "revoked"`, `decideDisplayKeyState(input: { readonly expiresAt: Date; readonly revokedAt: Date | null; readonly now: Date }): DisplayKeyState`.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Create `packages/domain/src/display-key.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  createDisplayKeySecret,
  decideDisplayKeyState,
  hashDisplayKeySecret,
} from "./display-key";

describe("createDisplayKeySecret", () => {
  it("liefert jedes Mal einen anderen Wert", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => createDisplayKeySecret()));

    expect(secrets.size).toBe(50);
  });

  it("ist lang genug, dass Raten aussichtslos ist", () => {
    // 32 Bytes base64url — dieselbe Groessenordnung wie ein Sitzungstoken.
    expect(createDisplayKeySecret()).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });
});

describe("hashDisplayKeySecret", () => {
  it("bildet denselben Klartext auf denselben Hash ab", () => {
    expect(hashDisplayKeySecret("abc")).toBe(hashDisplayKeySecret("abc"));
  });

  it("liefert 64 Hex-Zeichen", () => {
    expect(hashDisplayKeySecret("abc")).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("gibt den Klartext nicht preis", () => {
    expect(hashDisplayKeySecret("abc")).not.toContain("abc");
  });
});

describe("decideDisplayKeyState", () => {
  const now = new Date("2026-09-07T20:00:00.000Z");

  it("gilt vor dem Ablauf", () => {
    expect(
      decideDisplayKeyState({
        expiresAt: new Date("2026-09-07T21:00:00.000Z"),
        revokedAt: null,
        now,
      }),
    ).toBe("valid");
  });

  it("ist nach dem Ablauf abgelaufen", () => {
    expect(
      decideDisplayKeyState({
        expiresAt: new Date("2026-09-07T19:59:59.000Z"),
        revokedAt: null,
        now,
      }),
    ).toBe("expired");
  });

  it("ist im Ablaufmoment selbst abgelaufen", () => {
    expect(decideDisplayKeyState({ expiresAt: now, revokedAt: null, now })).toBe("expired");
  });

  it("bleibt widerrufen, auch wenn der Ablauf noch nicht erreicht ist", () => {
    expect(
      decideDisplayKeyState({
        expiresAt: new Date("2026-09-07T23:00:00.000Z"),
        revokedAt: new Date("2026-09-07T19:00:00.000Z"),
        now,
      }),
    ).toBe("revoked");
  });
});
```

- [ ] **Step 2: Test laufen lassen und scheitern sehen**

Run: `cd packages/domain && npx vitest run src/display-key.spec.ts`
Erwartet: FAIL — Modul nicht gefunden.

- [ ] **Step 3: Das Modul schreiben**

Create `packages/domain/src/display-key.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

/**
 * Klartext eines Anzeige-Schluessels: 32 zufaellige Bytes, base64url — also
 * dieselbe Groessenordnung wie ein Sitzungstoken. Er steht in einer Adresse,
 * die auf einem Bildschirm im Vereinslokal geoeffnet wird; kurz und merkbar
 * waere hier das falsche Ziel.
 */
export function createDisplayKeySecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Gespeichert wird nur dieser Hash. Kein Salt und keine Schluesselstreckung:
 * der Klartext ist bereits 256 Bit Zufall, gegen den ein Woerterbuch nichts
 * ausrichtet — anders als bei einem Passwort, das ein Mensch sich ausdenkt.
 */
export function hashDisplayKeySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export type DisplayKeyState = "valid" | "expired" | "revoked";

/**
 * Der Widerruf schlaegt den Ablauf: ein zurueckgezogener Schluessel bleibt
 * zurueckgezogen, auch wenn seine Frist noch laeuft. Der Ablaufmoment selbst
 * zaehlt als abgelaufen — bei einer Frist ist die Grenze das Ende, nicht der
 * letzte gueltige Augenblick.
 */
export function decideDisplayKeyState(input: {
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly now: Date;
}): DisplayKeyState {
  if (input.revokedAt !== null) return "revoked";
  if (input.expiresAt.getTime() <= input.now.getTime()) return "expired";
  return "valid";
}
```

In `packages/domain/src/index.ts` exportieren:

```ts
export {
  createDisplayKeySecret,
  decideDisplayKeyState,
  hashDisplayKeySecret,
  type DisplayKeyState,
} from "./display-key";
```

- [ ] **Step 4: Test laufen lassen und bestätigen**

Run: `cd packages/domain && npx vitest run src/display-key.spec.ts`
Erwartet: PASS, neun Fälle.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src
git commit -m "feat(domain): Anzeige-Schluessel erzeugen und bewerten"
```

---

### Task 4: Schlüssel verwalten (API)

**Files:**
- Modify: `packages/schemas/src/tournament.ts`, `packages/schemas/src/index.ts`
- Create: `apps/api/src/tournaments/display-keys.repository.ts`
- Create: `apps/api/src/tournaments/display-keys.service.ts`
- Create: `apps/api/src/tournaments/display-keys.controller.ts`
- Modify: `apps/api/src/tournaments/tournaments.module.ts`
- Create: `apps/api/src/tournaments/display-keys.integration.spec.ts`

**Interfaces:**
- Consumes: `createDisplayKeySecret`, `hashDisplayKeySecret`, `decideDisplayKeyState` aus Task 3; `tournamentDisplayKeys` aus Task 1; `tournament:share` aus Task 2.
- Produces:
  - `POST /api/v1/organizations/:organizationId/tournaments/:tournamentId/display-keys` → `{ id, label, expiresAt, secret }`
  - `GET …/display-keys` → `{ keys: Array<{ id, label, expiresAt, revokedAt, state }> }`
  - `DELETE …/display-keys/:keyId` → 204
  - `DisplayKeysService.resolve(publicId: string, secret: string): Promise<"valid" | "invalid">`
  - `DisplayKeysService.stateOf(tournamentId: string, secret: string): Promise<DisplayKeyState | "absent">` — von Plan 3 verwendet
  - `TournamentsRepository.getAccessFactsByPublicId(publicId)` — von Plan 3 verwendet

- [ ] **Step 1: Die Schemas anlegen**

In `packages/schemas/src/tournament.ts`:

```ts
export const createDisplayKeySchema = z.object({
  label: z.string().trim().min(1).max(80),
  /** Ohne Angabe: 48 Stunden nach dem Turnierbeginn (der Service setzt sie). */
  expiresAt: z.coerce.date().optional(),
});

export const displayKeySchema = z.object({
  id: z.uuid(),
  label: z.string(),
  expiresAt: z.coerce.date(),
  revokedAt: z.coerce.date().nullable(),
  state: z.enum(["valid", "expired", "revoked"]),
});

/** Der Klartext steht NUR hier — in der Antwort, die den Schluessel erzeugt. */
export const createdDisplayKeySchema = displayKeySchema.extend({
  secret: z.string(),
});

export const displayKeyListSchema = z.object({ keys: z.array(displayKeySchema) });
```

Alle vier in `packages/schemas/src/index.ts` exportieren, dazu die abgeleiteten Typen.

- [ ] **Step 2: Den fehlschlagenden Test schreiben**

Create `apps/api/src/tournaments/display-keys.integration.spec.ts` mit diesen Fällen:

```ts
  it("gibt den Klartext genau einmal heraus", async () => {
    const created = await service.create({
      organizationId, tournamentId, data: { label: "Board 3" }, auth, audit,
    });

    expect(created.secret).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const listed = await service.list({ organizationId, tournamentId, auth });
    const found = listed.keys.find((key) => key.id === created.id);

    expect(found).toBeDefined();
    expect(Object.keys(found ?? {})).not.toContain("secret");
  });

  it("setzt den Ablauf ohne Angabe auf 48 Stunden nach Turnierbeginn", async () => {
    const created = await service.create({
      organizationId, tournamentId, data: { label: "Beamer" }, auth, audit,
    });

    expect(created.expiresAt.getTime()).toBe(tournamentStartsAt.getTime() + 48 * 60 * 60 * 1000);
  });

  it("laesst einen gueltigen Schluessel das private Turnier aufloesen", async () => {
    const created = await service.create({
      organizationId, tournamentId, data: { label: "Board 1" }, auth, audit,
    });

    await expect(service.resolve(publicId, created.secret)).resolves.toBe("valid");
  });

  it("weist einen widerrufenen Schluessel ab", async () => {
    const created = await service.create({
      organizationId, tournamentId, data: { label: "Board 2" }, auth, audit,
    });
    await service.revoke({ organizationId, tournamentId, keyId: created.id, auth, audit });

    await expect(service.resolve(publicId, created.secret)).resolves.toBe("invalid");
  });

  it("weist einen abgelaufenen Schluessel ab", async () => {
    const created = await service.create({
      organizationId,
      tournamentId,
      data: { label: "Gestern", expiresAt: new Date(Date.now() - 60_000) },
      auth,
      audit,
    });

    await expect(service.resolve(publicId, created.secret)).resolves.toBe("invalid");
  });

  it("weist einen Schluessel eines anderen Turniers ab", async () => {
    const created = await service.create({
      organizationId, tournamentId, data: { label: "Fremd" }, auth, audit,
    });

    await expect(service.resolve(otherPublicId, created.secret)).resolves.toBe("invalid");
  });

  it("laesst ohne tournament:share nichts ausstellen", async () => {
    await expect(
      service.create({
        organizationId, tournamentId, data: { label: "Verboten" }, auth: viewerAuth, audit,
      }),
    ).rejects.toThrow(ForbiddenException);
  });
```

Der letzte Fall ist der wichtigste des Tasks: er ist der Unterschied zwischen einer Berechtigung und einer Behauptung.

- [ ] **Step 3: Test laufen lassen und scheitern sehen**

Run: `cd apps/api && npx dotenv -e .env.test -- npx vitest run src/tournaments/display-keys.integration.spec.ts`
Erwartet: FAIL — die Module fehlen.

- [ ] **Step 4: Repository schreiben**

`apps/api/src/tournaments/display-keys.repository.ts` mit vier Funktionen — `insert`, `listByTournament`, `markRevoked` und `findBySecretHash`. Die letzte ist der Lesepfad der öffentlichen Route:

```ts
  /**
   * Nachschlag ueber den Unique-Index auf `secret_hash` — nicht ueber alle
   * Schluessel eines Turniers, die dann einzeln verglichen wuerden. Die
   * Turnierzugehoerigkeit prueft der Aufrufer gegen den Treffer; so gibt es
   * genau eine Abfrage, egal wie viele Schluessel existieren.
   */
  public async findBySecretHash(secretHash: string): Promise<{
    readonly tournamentId: string;
    readonly expiresAt: Date;
    readonly revokedAt: Date | null;
  } | null> {
    const [row] = await this.databaseService.database
      .select({
        tournamentId: tournamentDisplayKeys.tournamentId,
        expiresAt: tournamentDisplayKeys.expiresAt,
        revokedAt: tournamentDisplayKeys.revokedAt,
      })
      .from(tournamentDisplayKeys)
      .where(eq(tournamentDisplayKeys.secretHash, secretHash))
      .limit(1);
    return row ?? null;
  }
```

- [ ] **Step 5: Service schreiben**

`apps/api/src/tournaments/display-keys.service.ts`. `create` prüft `tournament:share` über `this.access.requirePermission({ organizationId, userId: auth.user.id, permission: "tournament:share" })`, erzeugt Klartext und Hash, setzt `expiresAt` per Vorgabe auf `starts_at + 48 h` (ein Turnier laeuft ueber den Abend hinaus oder geht am Folgetag weiter; der Zugang soll nicht mitten im Betrieb sterben), schreibt die Zeile, auditiert (`tournament.display_key_issued` beziehungsweise `tournament.display_key_revoked`) und gibt den Klartext **nur** in dieser einen Antwort zurück.

`resolve` ist der Weg der öffentlichen Route:

```ts
  /**
   * Nimmt den Klartext aus der Adresse und beantwortet genau eine Frage: darf
   * dieser Schluessel dieses Turnier sehen? Alles Uebrige — abgelaufen,
   * widerrufen, fremdes Turnier, gar nicht vorhanden — faellt zu `invalid`
   * zusammen. Der Aufrufer antwortet in allen Faellen mit 404; eine feinere
   * Auskunft waere eine Auskunft ueber fremde Turniere.
   */
  public async resolve(publicId: string, secret: string): Promise<"valid" | "invalid"> {
    const row = await this.repository.findBySecretHash(hashDisplayKeySecret(secret));
    if (row === null) return "invalid";
    if (decideDisplayKeyState({ ...row, now: new Date() }) !== "valid") return "invalid";
    const tournament = await this.tournaments.getAccessFactsByPublicId(publicId);
    return tournament !== null && tournament.id === row.tournamentId ? "valid" : "invalid";
  }

  /**
   * Dieselbe Pruefung, aber mit dem Zustand statt einem Ja/Nein. Plan 3
   * braucht ihn, weil `decideSubscription` zwischen abgelaufen und widerrufen
   * unterscheidet; `resolve` faltet beides zu `invalid` zusammen und ruft
   * diese Funktion auf, statt die Pruefung ein zweites Mal zu schreiben.
   */
  public async stateOf(
    tournamentId: string,
    secret: string,
  ): Promise<DisplayKeyState | "absent"> {
    const row = await this.repository.findBySecretHash(hashDisplayKeySecret(secret));
    if (row === null || row.tournamentId !== tournamentId) return "absent";
    return decideDisplayKeyState({ ...row, now: new Date() });
  }
```

`TournamentsRepository.getAccessFactsByPublicId(publicId): Promise<{ readonly id: string; readonly organizationId: string; readonly visibility: TournamentVisibility } | null>` ist dabei zu ergänzen — eine Abfrage auf `tournaments` über `public_id`, ohne Sichtbarkeitsfilter, weil genau hier der private Fall gemeint ist. Plan 3 verwendet dieselbe Funktion für die Kanal-Autorisierung; sie deshalb gleich mit allen drei Feldern anlegen und nicht später erweitern.

- [ ] **Step 6: Controller und Modul**

`apps/api/src/tournaments/display-keys.controller.ts` unter `@Controller("organizations/:organizationId/tournaments/:tournamentId/display-keys")` mit `POST`, `GET` und `DELETE :keyId`; dem Aufbau von `tournaments.controller.ts` folgen (`@CurrentAuth`, `getAuditContext(request)`, `parseBody`). `DELETE` antwortet mit `@HttpCode(204)`.

Beide neuen Klassen in `tournaments.module.ts` unter `providers` beziehungsweise `controllers` eintragen.

- [ ] **Step 7: Tests laufen lassen und bestätigen**

Run: `cd apps/api && npx dotenv -e .env.test -- npx vitest run src/tournaments/display-keys.integration.spec.ts`
Erwartet: PASS, sieben Fälle.

- [ ] **Step 8: Commit**

```bash
git add packages/schemas/src apps/api/src/tournaments
git commit -m "feat(api): Anzeige-Schluessel ausstellen, auflisten und widerrufen"
```

---

### Task 5: Die öffentliche Route nimmt den Schlüssel an

**Files:**
- Modify: `apps/api/src/tournaments/public-tournaments.controller.ts`
- Modify: `apps/api/src/tournaments/tournaments.service.ts`
- Modify: `apps/api/src/tournaments/tournaments.repository.ts`
- Modify: `apps/api/src/tournaments/display-keys.integration.spec.ts`

**Interfaces:**
- Consumes: `DisplayKeysService.resolve` aus Task 4.
- Produces: `GET /api/v1/public/tournaments/:publicId/live?k=<secret>` liefert auch ein privates Turnier, wenn der Schlüssel gilt.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

In `apps/api/src/tournaments/display-keys.integration.spec.ts`:

```ts
  it("zeigt ein privates Turnier mit gueltigem Schluessel", async () => {
    const created = await service.create({
      organizationId, tournamentId, data: { label: "Board 1" }, auth, audit,
    });

    const dashboard = await tournamentsService.publicDashboard(publicId, created.secret);

    expect(dashboard.tournament.publicId).toBe(publicId);
  });

  it("bleibt ohne Schluessel bei 404", async () => {
    await expect(tournamentsService.publicDashboard(publicId)).rejects.toThrow(NotFoundException);
  });

  it("antwortet auf einen erfundenen Schluessel ebenfalls mit 404", async () => {
    await expect(
      tournamentsService.publicDashboard(publicId, "erfunden-und-zu-kurz"),
    ).rejects.toThrow(NotFoundException);
  });
```

- [ ] **Step 2: Test laufen lassen und scheitern sehen**

Run: `cd apps/api && npx dotenv -e .env.test -- npx vitest run src/tournaments/display-keys.integration.spec.ts`
Erwartet: FAIL — `publicDashboard` nimmt nur einen Parameter.

- [ ] **Step 3: Service und Repository erweitern**

`TournamentsService.publicDashboard` bekommt einen zweiten, optionalen Parameter:

```ts
  /**
   * Zwei Eintrittskarten: das Turnier ist oeffentlich, oder der Aufrufer
   * bringt einen gueltigen Anzeige-Schluessel mit. Beides scheitert nach
   * aussen gleich — 404 —, damit die Antwort nicht verraet, welche der beiden
   * Bedingungen gefehlt hat.
   */
  public async publicDashboard(
    publicId: string,
    displayKeySecret?: string,
  ): Promise<PublicTournamentDashboard> {
    const data = await this.repository.getPublicDashboardDataByPublicId(publicId);
    const allowed =
      data !== null ||
      (displayKeySecret !== undefined &&
        (await this.displayKeys.resolve(publicId, displayKeySecret)) === "valid");
    if (!allowed) throw new NotFoundException("Turnier nicht gefunden.");
    const dashboard = data ?? (await this.repository.getPrivateDashboardDataByPublicId(publicId));
    if (dashboard === null) throw new NotFoundException("Turnier nicht gefunden.");
    // … weiter wie bisher mit `dashboard`
```

`getPrivateDashboardDataByPublicId` ist dabei die Schwester aus Plan 1 ohne den Sichtbarkeitsfilter — beide teilen sich denselben Rumpf; ziehe die gemeinsame Abfrage in eine private Hilfsfunktion mit einem Schalter `requirePublic: boolean`, statt sie zu kopieren.

- [ ] **Step 4: Controller**

```ts
  @Get(":publicId/live")
  public live(
    @Param("publicId", ParseUUIDPipe) publicId: string,
    @Query("k") displayKeySecret?: string,
  ): Promise<PublicTournamentDashboard> {
    return this.service.publicDashboard(publicId, displayKeySecret);
  }
```

`Query` ist dem Import aus `@nestjs/common` hinzuzufügen.

- [ ] **Step 5: Tests laufen lassen und bestätigen**

Run: `cd apps/api && npx dotenv -e .env.test -- npx vitest run src/tournaments`
Erwartet: PASS über alle Turnier-Tests, auch die aus Plan 1.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/tournaments
git commit -m "feat(api): oeffentliche Route nimmt den Anzeige-Schluessel an"
```

---

### Task 6: Weboberfläche

**Files:**
- Modify: `apps/web/src/components/tournament/share-panel.tsx`
- Create: `apps/web/src/components/tournament/display-keys-panel.tsx`
- Create: `apps/web/src/lib/display-key-storage.ts`
- Create: `apps/web/src/lib/display-key-storage.spec.ts`
- Modify: `apps/web/src/app/live/[publicId]/board/[boardId]/page.tsx` und `…/tv/page.tsx`
- Modify: `apps/web/src/components/live/live-tournament.tsx`
- Modify: `apps/web/tests/foundation.spec.ts`

**Interfaces:**
- Consumes: die drei Verwaltungsrouten und `?k=` aus Task 4 und 5.
- Produces: `rememberDisplayKey(publicId, secret)`, `recallDisplayKey(publicId): string | null`.

- [ ] **Step 1: Den fehlschlagenden Test für die Ablage schreiben**

Create `apps/web/src/lib/display-key-storage.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { recallDisplayKey, rememberDisplayKey } from "./display-key-storage";

describe("Anzeige-Schluessel im Browser", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("merkt sich den Schluessel je Turnier", () => {
    rememberDisplayKey("turnier-a", "geheim-a");
    rememberDisplayKey("turnier-b", "geheim-b");

    expect(recallDisplayKey("turnier-a")).toBe("geheim-a");
    expect(recallDisplayKey("turnier-b")).toBe("geheim-b");
  });

  it("kennt zu einem fremden Turnier nichts", () => {
    expect(recallDisplayKey("turnier-c")).toBeNull();
  });

  it("bleibt ruhig, wenn der Browser die Ablage verweigert", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Zugriff verweigert");
    });

    expect(() => rememberDisplayKey("turnier-d", "geheim-d")).not.toThrow();
    expect(recallDisplayKey("turnier-d")).toBeNull();
  });
});
```

Der dritte Fall ist kein Randfall: im privaten Fenster und bei blockierten Website-Daten wirft der Zugriff, und ein Board-Bildschirm, der deswegen mit einer Ausnahme stehen bleibt, ist schlimmer als einer ohne Gedächtnis.

- [ ] **Step 2: Test laufen lassen und scheitern sehen**

Run: `cd apps/web && npx vitest run src/lib/display-key-storage.spec.ts`
Erwartet: FAIL — Modul nicht gefunden.

- [ ] **Step 3: Die Ablage schreiben**

Create `apps/web/src/lib/display-key-storage.ts` mit `try`/`catch` um jeden Zugriff, Schlüsselpräfix `dartbase.display-key.`, Rückgabe `null` im Fehlerfall.

- [ ] **Step 4: Board- und TV-Seite den Schlüssel aufnehmen lassen**

Beide Seiten lesen `?k=` aus der Adresse, legen ihn über `rememberDisplayKey` ab, entfernen den Parameter mit `router.replace` aus der Adresszeile und reichen den Wert an `LiveTournament` weiter. Fehlt `?k=`, wird `recallDisplayKey` befragt — so überlebt ein Neuladen ohne Adresse.

`LiveTournament` hängt den Schlüssel an die Abfrage: `path: \`/public/tournaments/${publicId}/live${secret === null ? "" : \`?k=${encodeURIComponent(secret)}\`}\``.

- [ ] **Step 5: Die Schlüsselverwaltung in die Oberfläche**

Create `apps/web/src/components/tournament/display-keys-panel.tsx`: Liste der Schlüssel mit Bezeichnung, Ablauf und Zustand (`gültig`, `abgelaufen`, `widerrufen`), ein Formular zum Ausstellen und je Zeile ein Widerrufen-Knopf. Der frisch ausgestellte Klartext erscheint einmal in einem hervorgehobenen Feld mit Kopieren-Knopf und dem Satz „Dieser Schlüssel wird nicht wieder angezeigt." Danach verschwindet er aus dem Zustand der Komponente.

Das Panel unterhalb des Freigabe-Bereichs aus Plan 1 in `command-centre.tsx` einhängen.

- [ ] **Step 6: Den E2E-Fall ergänzen**

In `apps/web/tests/foundation.spec.ts`: privates Turnier anlegen, Schlüssel ausstellen, Klartext aus der Oberfläche lesen, in einem anonymen Kontext `/live/<publicId>/board/<boardId>?k=<secret>` öffnen und die Board-Ansicht sehen; danach denselben Aufruf ohne `?k=` und den Hinweis „Turnier nicht gefunden" erwarten.

- [ ] **Step 7: Die volle Kette**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
```

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): Anzeige-Schluessel verwalten und am Board verwenden"
```

---

## Nach diesem Plan

- **ARCHITECTURE.md** um den Abschnitt „Anzeige-Schlüssel" ergänzen — gemeinsam mit dem Realtime-Teil aus Plan 3, nicht in zwei Anläufen.
- **Plan 3** (Realtime) ist danach die letzte offene Etappe des Programms.
- Offen bleibt bewusst: keine Rotation, keine Nutzungsstatistik je Schlüssel, keine Begrenzung der Anzahl je Turnier. Wenn sich zeigt, dass Vereine Dutzende ausstellen, ist das der Moment für eine Obergrenze — nicht vorher.
