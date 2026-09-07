# Öffentliche Turnier-IDs und Sichtbarkeit — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Turnier ist nur noch über eine eigene, unerratbare `public_id` öffentlich abrufbar, und nur wenn es bewusst freigegeben wurde.

**Architecture:** `tournaments` bekommt `public_id` (zweite Zufalls-UUID, wie `encounters.public_id` es vormacht) und `visibility` mit Check-Constraint. Die öffentliche Route löst über die `public_id` auf und antwortet für ein privates Turnier mit 404. Die interne ID verschwindet aus der öffentlichen Nutzlast und aus der Adresszeile der Weboberfläche; das alte Adress-Segment leitet befristet um.

**Tech Stack:** TypeScript strict, Drizzle ORM, PostgreSQL, NestJS, Zod, Next.js App Router, TanStack Query, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-07-oeffentliche-turnier-ids-design.md`](../specs/2026-09-07-oeffentliche-turnier-ids-design.md)

## Global Constraints

- `strict: true`; kein `any`, kein `as any`. `unknown` statt `any`, discriminated unions, exhaustive `switch`.
- Kommentare und Oberflächentexte auf Deutsch (Schweizer Rechtschreibung, kein ß), Code-Bezeichner auf Englisch.
- Jede tenant-bezogene Repository-Funktion nimmt `organizationId` explizit entgegen (AGENTS.md §14). Die eine Ausnahme dieses Plans ist benannt und kommentiert.
- Datenintegrität gehört in die Datenbank, nicht nur in Zod (AGENTS.md §10).
- Migrationen sind versioniert und werden nach dem Deployment nicht mehr verändert (AGENTS.md §21).
- Vor Abschluss: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, bei UI zusätzlich `pnpm test:e2e`.

## Umfang dieses Plans

Dies ist **Plan 1 von 3** zum Programm B1b + B2.

| Plan | Inhalt |
| --- | --- |
| **1 (dieser)** | `public_id`, Sichtbarkeit, öffentliche Route, Adressen und Umleitung, Freigabe-Schalter |
| 2 | Anzeige-Schlüssel für Board- und TV-Ansichten (`tournament_display_keys`, `tournament:share`) |
| 3 | Realtime: Räume auf der `public_id`, Autorisierung beim `subscribe`, Sitzung im Handshake, Begegnungs-Polling entfällt |

## Zwei bewusste Abweichungen von der Spec

**1. Die öffentliche Route kennt in Plan 1 nur `PUBLIC`.** Die Spec nennt als Nachweis für ein privates Turnier „Sitzung mit Mitgliedschaft **oder** Anzeige-Schlüssel". Der Schlüssel kommt erst in Plan 2, und die Sitzung braucht die Route nicht: Wer angemeldet ist und das Turnier verwalten darf, benutzt das authentifizierte Dashboard (`/organizations/:organizationId/tournaments/:tournamentId`), nicht die öffentliche Ansicht. Plan 1 antwortet für `PRIVATE` deshalb immer mit 404. Plan 2 fügt den zweiten Weg hinzu.

**2. `decideSubscription` als reine Funktion kommt erst in Plan 3.** Die Spec skizziert sie mit drei Eingaben. In Plan 1 hätte sie genau eine (`visibility === "PUBLIC"`) und wäre eine Hülle um einen Vergleich. Sie entsteht dort, wo sie eine echte Matrix bekommt. In Plan 1 lebt die Entscheidung als eine Zeile im Service — mit dem Kommentar, dass sie in Plan 3 dorthin wandert.

---

### Task 1: Datenmodell und Migration

**Files:**
- Modify: `packages/database/src/schema.ts:667-693` (Tabelle `tournaments`)
- Create: `packages/database/drizzle/0026_tournament_public_id.sql`
- Create: `packages/database/src/tournament-visibility.integration.spec.ts`

**Interfaces:**
- Produces: `tournaments.publicId` (Spalte `public_id`, `uuid`, `NOT NULL`, unique) und `tournaments.visibility` (Spalte `visibility`, `varchar(20)`, `NOT NULL`, Vorgabe `'PRIVATE'`, Check auf `PRIVATE | PUBLIC`).

- [ ] **Step 1: Die Spalten im Drizzle-Schema ergänzen**

In `packages/database/src/schema.ts`, in der Tabelle `tournaments`, direkt nach `organizationId`:

```ts
    /**
     * Zweite, unerratbare Adresse des Turniers. Sie steht in oeffentlichen
     * Links und in den Realtime-Raeumen; der Primaerschluessel bleibt intern
     * (Audit B, I-1b). Gleiches Muster wie `encounters.publicId`.
     */
    publicId: uuid("public_id").defaultRandom().notNull(),
    /**
     * `PRIVATE` ist die Vorgabe: ein neues Turnier ist erst oeffentlich, wenn
     * die Leitung es freigibt. Der Bestand wurde bei der Migration einmalig
     * auf `PUBLIC` gehoben, damit sich fuer nichts Laufendes etwas aendert.
     */
    visibility: varchar("visibility", { length: 20 }).default("PRIVATE").notNull(),
```

Im Rückgabeblock der Tabelle (`(table) => [ … ]`) ergänzen:

```ts
    uniqueIndex("tournaments_public_id_unique").on(table.publicId),
    check(
      "tournaments_visibility_check",
      sql`${table.visibility} in ('PRIVATE', 'PUBLIC')`,
    ),
```

Prüfe die Importzeile am Dateikopf: `uniqueIndex`, `check` und `sql` müssen aus `drizzle-orm/pg-core` beziehungsweise `drizzle-orm` importiert sein. Beide Hilfen werden in dieser Datei bereits verwendet — dem bestehenden Import folgen, keinen zweiten anlegen.

- [ ] **Step 2: Migration erzeugen**

Run: `pnpm --filter @darts-platform/database db:generate`

Erwartet: eine neue Datei `packages/database/drizzle/0026_*.sql` mit den beiden `ALTER TABLE … ADD COLUMN`, dem Unique-Index und dem Check-Constraint. Benenne sie in `0026_tournament_public_id.sql` um, falls drizzle-kit einen Fantasienamen vergeben hat, und passe den Eintrag in `packages/database/drizzle/meta/_journal.json` entsprechend an.

- [ ] **Step 3: Den Bestand auf `PUBLIC` heben**

drizzle-kit erzeugt keine Datenwanderung. Hänge sie von Hand an das Ende von `0026_tournament_public_id.sql`:

```sql
--> statement-breakpoint
-- Der Bestand behaelt sein heutiges Verhalten: bis hierher war jedes Turnier
-- oeffentlich abrufbar, sobald jemand die interne ID kannte. Die Vorgabe
-- `PRIVATE` greift ab der naechsten Einfuegung.
UPDATE "tournaments" SET "visibility" = 'PUBLIC';
```

- [ ] **Step 4: Den fehlschlagenden Migrationstest schreiben**

Create `packages/database/src/tournament-visibility.integration.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { createDatabaseClient } from "./client";
import { organizations, tournaments } from "./schema";

const environment = parseApplicationEnvironment(process.env);
const { database, close } = createDatabaseClient(environment.DATABASE_URL);

const organizationId = randomUUID();

beforeAll(async () => {
  await database.insert(organizations).values({
    id: organizationId,
    name: "Testverein Migration",
    slug: `migration-${organizationId.slice(0, 8)}`,
  });
});

afterAll(async () => {
  await database.delete(organizations).where(sql`${organizations.id} = ${organizationId}`);
  await close();
});

function tournamentValues() {
  return {
    organizationId,
    name: "Migrationsturnier",
    format: "GROUP_KNOCKOUT",
    groupCount: 1,
    qualifyPerGroup: 2,
    knockoutSize: 2,
    seeding: "RANDOM",
    startsAt: new Date(),
  } as const;
}

describe("tournaments.public_id und visibility", () => {
  it("vergibt jeder Zeile eine eigene public_id", async () => {
    const [first] = await database.insert(tournaments).values(tournamentValues()).returning();
    const [second] = await database.insert(tournaments).values(tournamentValues()).returning();

    expect(first?.publicId).toBeDefined();
    expect(second?.publicId).toBeDefined();
    expect(first?.publicId).not.toBe(second?.publicId);
    expect(first?.publicId).not.toBe(first?.id);
  });

  it("legt ein neues Turnier privat an", async () => {
    const [created] = await database.insert(tournaments).values(tournamentValues()).returning();

    expect(created?.visibility).toBe("PRIVATE");
  });

  it("laesst keine andere Sichtbarkeit als PRIVATE oder PUBLIC zu", async () => {
    await expect(
      database.insert(tournaments).values({ ...tournamentValues(), visibility: "UNLISTED" }),
    ).rejects.toThrow(/tournaments_visibility_check/u);
  });
});
```

- [ ] **Step 5: Test laufen lassen und scheitern sehen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run ../../packages/database/src/tournament-visibility.integration.spec.ts`

Erwartet: FAIL — die Spalten existieren in der Testdatenbank noch nicht.

Hinweis zum Testaufruf: `pnpm --filter … test -- <datei>` filtert in diesem Repo nicht; der direkte `npx vitest`-Aufruf mit `dotenv` ist der Weg (siehe die übrigen Integrationstests).

- [ ] **Step 6: Migration einspielen und Test bestätigen**

Run: `cd packages/database && npx dotenv -e ../../.env -- pnpm db:migrate`
Dann: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run ../../packages/database/src/tournament-visibility.integration.spec.ts`

Erwartet: PASS, drei Fälle.

- [ ] **Step 7: Commit**

```bash
git add packages/database/src/schema.ts packages/database/drizzle packages/database/src/tournament-visibility.integration.spec.ts
git commit -m "feat(database): public_id und Sichtbarkeit am Turnier"
```

---

### Task 2: Sichtbarkeit in Domain und Schemas

**Files:**
- Create: `packages/domain/src/tournament-visibility.ts`
- Create: `packages/domain/src/tournament-visibility.spec.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/schemas/src/tournament.ts:173-187` (interne Dashboard-Form) und `:221-237` (öffentliche Projektion)

**Interfaces:**
- Consumes: nichts aus Task 1 im Code — nur dieselben zwei Werte.
- Produces: `tournamentVisibilities: readonly ["PRIVATE", "PUBLIC"]`, `type TournamentVisibility`, `isTournamentVisibility(value: unknown): value is TournamentVisibility`; `tournamentVisibilitySchema` (Zod), `tournamentDashboardSchema.shape.tournament.visibility` und `publicTournamentDashboardSchema.shape.tournament.publicId`.

- [ ] **Step 1: Den fehlschlagenden Domain-Test schreiben**

Create `packages/domain/src/tournament-visibility.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { isTournamentVisibility, tournamentVisibilities } from "./tournament-visibility";

describe("tournamentVisibilities", () => {
  it("kennt genau zwei Stufen", () => {
    expect([...tournamentVisibilities]).toEqual(["PRIVATE", "PUBLIC"]);
  });

  it("erkennt gueltige Werte", () => {
    expect(isTournamentVisibility("PRIVATE")).toBe(true);
    expect(isTournamentVisibility("PUBLIC")).toBe(true);
  });

  it("weist alles andere ab", () => {
    expect(isTournamentVisibility("UNLISTED")).toBe(false);
    expect(isTournamentVisibility("public")).toBe(false);
    expect(isTournamentVisibility(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Test laufen lassen und scheitern sehen**

Run: `cd packages/domain && npx vitest run src/tournament-visibility.spec.ts`
Erwartet: FAIL — Modul nicht gefunden.

- [ ] **Step 3: Die Werte anlegen**

Create `packages/domain/src/tournament-visibility.ts`:

```ts
/**
 * Zwei Stufen, mehr nicht. `PRIVATE` ist die Vorgabe; `PUBLIC` gibt die
 * Ansicht ueber die `public_id` frei — wer den Link hat, sieht zu. Eine dritte
 * Stufe („gelistet") waere ein oeffentliches Verzeichnis und damit eine
 * Produktentscheidung mit eigener Oberflaeche, nicht eine weitere Konstante.
 */
export const tournamentVisibilities = ["PRIVATE", "PUBLIC"] as const;

export type TournamentVisibility = (typeof tournamentVisibilities)[number];

export function isTournamentVisibility(value: unknown): value is TournamentVisibility {
  return (
    typeof value === "string" &&
    (tournamentVisibilities as readonly string[]).includes(value)
  );
}
```

In `packages/domain/src/index.ts` ergänzen (alphabetisch zwischen den bestehenden Blöcken):

```ts
export {
  isTournamentVisibility,
  tournamentVisibilities,
  type TournamentVisibility,
} from "./tournament-visibility";
```

- [ ] **Step 4: Test laufen lassen und bestätigen**

Run: `cd packages/domain && npx vitest run src/tournament-visibility.spec.ts`
Erwartet: PASS, drei Fälle.

- [ ] **Step 5: Die Schemas nachziehen**

In `packages/schemas/src/tournament.ts`, oberhalb von `tournamentDashboardSchema`:

```ts
export const tournamentVisibilitySchema = z.enum(tournamentVisibilities);
```

Der Import am Dateikopf: `import { tournamentVisibilities } from "@darts-platform/domain";` — dem bestehenden Importstil der Datei folgen.

In `tournamentDashboardSchema.shape.tournament` (Zeile 173–187) nach `id` ergänzen:

```ts
    publicId: z.uuid(),
    visibility: tournamentVisibilitySchema,
```

In `publicTournamentDashboardSchema` (Zeile 221) die Turnier-Form ersetzen:

```ts
  /**
   * Die oeffentliche Sicht nennt die interne ID NICHT — sie ist der
   * Pfadschluessel jeder authentifizierten Route (Audit B, I-1b). Stattdessen
   * steht hier die `publicId`: die Weboberflaeche braucht sie fuer den
   * Realtime-Raum und fuer die Umleitung von der alten Adresse.
   */
  tournament: tournamentDashboardSchema.shape.tournament.omit({
    organizationId: true,
    id: true,
    visibility: true,
  }),
```

`visibility` fällt aus der öffentlichen Form heraus: wer die Ansicht sieht, weiss, dass sie öffentlich ist; ein privates Turnier antwortet gar nicht erst.

- [ ] **Step 6: Den Schema-Test ergänzen**

In `packages/schemas/src/tournament.spec.ts` ans Ende:

```ts
describe("publicTournamentDashboardSchema", () => {
  it("nennt die publicId und nicht die interne ID", () => {
    const shape = publicTournamentDashboardSchema.shape.tournament.shape;

    expect(Object.keys(shape)).toContain("publicId");
    expect(Object.keys(shape)).not.toContain("id");
    expect(Object.keys(shape)).not.toContain("organizationId");
    expect(Object.keys(shape)).not.toContain("visibility");
  });
});
```

Der Import von `publicTournamentDashboardSchema` in dieser Datei ist zu ergänzen, falls er fehlt.

- [ ] **Step 7: Tests laufen lassen und bestätigen**

Run: `cd packages/schemas && npx vitest run src/tournament.spec.ts`
Erwartet: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src packages/schemas/src/tournament.ts packages/schemas/src/tournament.spec.ts
git commit -m "feat(domain): Sichtbarkeitsstufen und oeffentliche Turnier-Projektion"
```

---

### Task 3: Auflösung über die public_id in Repository und Service

**Files:**
- Modify: `apps/api/src/tournaments/tournaments.repository.ts:184-192`
- Modify: `apps/api/src/tournaments/tournaments.service.ts:161-191`
- Modify: `apps/api/src/tournaments/tournaments.integration.spec.ts`

**Interfaces:**
- Consumes: `tournaments.publicId`, `tournaments.visibility` aus Task 1; `publicTournamentDashboardSchema` aus Task 2.
- Produces: `TournamentsRepository.getPublicDashboardDataByPublicId(publicId: string): Promise<TournamentDashboardData | null>` und `TournamentsService.publicDashboard(publicId: string): Promise<PublicTournamentDashboard>` (Parameter ist ab jetzt die `public_id`, nicht mehr die interne ID).

- [ ] **Step 1: Den fehlschlagenden Integrationstest schreiben**

In `apps/api/src/tournaments/tournaments.integration.spec.ts` ans Ende, innerhalb des bestehenden `describe`-Blocks:

```ts
  it("liefert ein oeffentliches Turnier ueber die publicId ohne interne ID", async () => {
    const [row] = await databaseService.database
      .update(tournaments)
      .set({ visibility: "PUBLIC" })
      .where(eq(tournaments.id, tournamentId))
      .returning();
    const publicId = row?.publicId ?? "";

    const dashboard = await service.publicDashboard(publicId);

    expect(dashboard.tournament.publicId).toBe(publicId);
    expect(Object.keys(dashboard.tournament)).not.toContain("id");
    expect(Object.keys(dashboard.tournament)).not.toContain("organizationId");
  });

  it("antwortet fuer ein privates Turnier mit 404, nicht mit 403", async () => {
    const [row] = await databaseService.database
      .update(tournaments)
      .set({ visibility: "PRIVATE" })
      .where(eq(tournaments.id, tournamentId))
      .returning();

    await expect(service.publicDashboard(row?.publicId ?? "")).rejects.toThrow(NotFoundException);
  });

  it("verraet ueber die interne ID nichts mehr", async () => {
    await expect(service.publicDashboard(tournamentId)).rejects.toThrow(NotFoundException);
  });
```

Ergänze die Importe der Datei um `tournaments` aus `@darts-platform/database` und `NotFoundException` aus `@nestjs/common`, sofern sie fehlen.

- [ ] **Step 2: Test laufen lassen und scheitern sehen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/tournaments.integration.spec.ts`
Erwartet: FAIL — `publicDashboard` löst noch über die interne ID auf.

- [ ] **Step 3: Die Repository-Funktion ersetzen**

In `apps/api/src/tournaments/tournaments.repository.ts` `getPublicDashboardData` ersetzen durch:

```ts
  /**
   * Die eine Abfrage dieses Repositories ohne `organizationId` (AGENTS.md §14).
   * Das ist kein Versehen: die `public_id` IST der Schluessel einer oeffentlich
   * geteilten Adresse, und der Mandant faellt aus dem Treffer heraus. Jede
   * andere Abfrage bleibt mandantengebunden.
   */
  public async getPublicDashboardDataByPublicId(
    publicId: string,
  ): Promise<TournamentDashboardData | null> {
    const [tournament] = await this.databaseService.database
      .select({
        organizationId: tournaments.organizationId,
        id: tournaments.id,
        visibility: tournaments.visibility,
      })
      .from(tournaments)
      .where(eq(tournaments.publicId, publicId))
      .limit(1);
    if (tournament === undefined) return null;
    // Ein privates Turnier ist von aussen nicht von einem nicht existierenden
    // zu unterscheiden — der Aufrufer wirft in beiden Faellen 404.
    if (tournament.visibility !== "PUBLIC") return null;
    return this.getDashboardData(tournament.organizationId, tournament.id);
  }
```

- [ ] **Step 4: Den Service umstellen**

In `apps/api/src/tournaments/tournaments.service.ts` die ersten beiden Zeilen von `publicDashboard` ersetzen:

```ts
  /**
   * Nimmt die `public_id`, nicht die interne ID. Ein privates Turnier
   * antwortet mit 404 statt 403: ein 403 bestaetigte, dass es die Adresse gibt.
   *
   * In Plan 1 ist „oeffentlich" die einzige Eintrittskarte. Der zweite Weg
   * (Anzeige-Schluessel) kommt in Plan 2, die Sitzungspruefung am Socket in
   * Plan 3 — dann wandert die Entscheidung in eine reine Funktion.
   */
  public async publicDashboard(publicId: string): Promise<PublicTournamentDashboard> {
    const data = await this.repository.getPublicDashboardDataByPublicId(publicId);
    if (data === null) throw new NotFoundException("Turnier nicht gefunden.");
```

Im Rumpf danach die Projektion anpassen: statt `const { organizationId, ...tournament } = dashboard.tournament;` nun

```ts
    const { organizationId, id, visibility, ...tournament } = dashboard.tournament;
    void organizationId;
    void id;
    void visibility;
```

`tournament` trägt die `publicId` bereits, weil `getDashboardData` sie aus der Tabelle mitliest — prüfe, dass die Projektion in `projectDashboard` `publicId` und `visibility` in die interne Dashboard-Form übernimmt, und ergänze sie dort, falls sie fehlen.

- [ ] **Step 5: Tests laufen lassen und bestätigen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/tournaments.integration.spec.ts`
Erwartet: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/tournaments
git commit -m "feat(api): oeffentliches Dashboard ueber die public_id aufloesen"
```

---

### Task 4: Die öffentliche Route und die Übergangsauflösung

**Files:**
- Modify: `apps/api/src/tournaments/public-tournaments.controller.ts`
- Create: `apps/api/src/tournaments/public-tournaments.integration.spec.ts`

**Interfaces:**
- Consumes: `TournamentsService.publicDashboard(publicId)` aus Task 3.
- Produces: `GET /api/v1/public/tournaments/:publicId/live` und `GET /api/v1/public/tournaments/:tournamentId/address` (Übergang, liefert `{ publicId }`).

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Create `apps/api/src/tournaments/public-tournaments.integration.spec.ts` mit zwei Fällen: die Live-Route über die `public_id` antwortet, und die Übergangsroute liefert zu einer internen ID die `publicId` — aber nur für ein öffentliches Turnier.

```ts
import { describe, expect, it } from "vitest";
import { NotFoundException } from "@nestjs/common";

import { PublicTournamentsController } from "./public-tournaments.controller";
import type { TournamentsService } from "./tournaments.service";

function controllerWith(service: Partial<TournamentsService>): PublicTournamentsController {
  return new PublicTournamentsController(service as TournamentsService);
}

describe("PublicTournamentsController", () => {
  it("reicht die publicId an den Service durch", async () => {
    const publicId = "6f1f1f6a-0000-4000-8000-000000000001";
    const controller = controllerWith({
      publicDashboard: async (id: string) => {
        expect(id).toBe(publicId);
        return { tournament: { publicId } } as never;
      },
    });

    await controller.live(publicId);
  });

  it("liefert zu einer internen ID die oeffentliche Adresse", async () => {
    const controller = controllerWith({
      publicAddress: async () => ({ publicId: "6f1f1f6a-0000-4000-8000-000000000002" }),
    });

    const address = await controller.address("6f1f1f6a-0000-4000-8000-000000000003");

    expect(address.publicId).toBe("6f1f1f6a-0000-4000-8000-000000000002");
  });

  it("gibt fuer eine unbekannte interne ID nichts preis", async () => {
    const controller = controllerWith({
      publicAddress: async () => {
        throw new NotFoundException("Turnier nicht gefunden.");
      },
    });

    await expect(controller.address("6f1f1f6a-0000-4000-8000-000000000004")).rejects.toThrow(
      NotFoundException,
    );
  });
});
```

- [ ] **Step 2: Test laufen lassen und scheitern sehen**

Run: `cd apps/api && npx vitest run src/tournaments/public-tournaments.integration.spec.ts`
Erwartet: FAIL — `address` und `publicAddress` existieren nicht.

- [ ] **Step 3: Den Controller umstellen**

`apps/api/src/tournaments/public-tournaments.controller.ts` vollständig:

```ts
import { Controller, Get, Inject, Param, ParseUUIDPipe } from "@nestjs/common";
import type { PublicTournamentDashboard } from "@darts-platform/schemas";

import { Public } from "../auth/public.decorator.js";
import { TournamentsService } from "./tournaments.service.js";

@Public()
@Controller("public/tournaments")
export class PublicTournamentsController {
  public constructor(@Inject(TournamentsService) private readonly service: TournamentsService) {}

  @Get(":publicId/live")
  public live(
    @Param("publicId", ParseUUIDPipe) publicId: string,
  ): Promise<PublicTournamentDashboard> {
    return this.service.publicDashboard(publicId);
  }

  /**
   * Uebergangsweg fuer Links, die vor der Umstellung geteilt wurden: er
   * uebersetzt die interne ID in die oeffentliche Adresse, damit die
   * Weboberflaeche umleiten kann. Er gibt nichts als die `publicId` preis und
   * nur fuer ein oeffentliches Turnier.
   *
   * ENTFERNEN: eigener PR, geplant bis Ende Oktober 2026. Solange diese Route
   * steht, bleibt die interne ID ein gueltiger Adressweg.
   */
  @Get(":tournamentId/address")
  public address(
    @Param("tournamentId", ParseUUIDPipe) tournamentId: string,
  ): Promise<{ readonly publicId: string }> {
    return this.service.publicAddress(tournamentId);
  }
}
```

- [ ] **Step 4: `publicAddress` im Service ergänzen**

In `apps/api/src/tournaments/tournaments.service.ts` nach `publicDashboard`:

```ts
  /** Siehe `PublicTournamentsController.address` — Uebergangsweg mit Frist. */
  public async publicAddress(tournamentId: string): Promise<{ readonly publicId: string }> {
    const address = await this.repository.getPublicAddress(tournamentId);
    if (address === null) throw new NotFoundException("Turnier nicht gefunden.");
    return address;
  }
```

Und in `apps/api/src/tournaments/tournaments.repository.ts`:

```ts
  /** Siehe `TournamentsService.publicAddress` — Uebergangsweg mit Frist. */
  public async getPublicAddress(
    tournamentId: string,
  ): Promise<{ readonly publicId: string } | null> {
    const [row] = await this.databaseService.database
      .select({ publicId: tournaments.publicId, visibility: tournaments.visibility })
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1);
    if (row === undefined || row.visibility !== "PUBLIC") return null;
    return { publicId: row.publicId };
  }
```

- [ ] **Step 5: Tests laufen lassen und bestätigen**

Run: `cd apps/api && npx vitest run src/tournaments/public-tournaments.integration.spec.ts`
Erwartet: PASS, drei Fälle.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/tournaments
git commit -m "feat(api): oeffentliche Route auf die public_id, Uebergangsweg mit Frist"
```

---

### Task 5: Sichtbarkeit umschalten

**Files:**
- Modify: `packages/schemas/src/tournament.ts` (Eingabeschema)
- Modify: `apps/api/src/tournaments/tournaments.controller.ts`
- Modify: `apps/api/src/tournaments/tournaments.service.ts`
- Modify: `apps/api/src/tournaments/tournaments.repository.ts`
- Modify: `apps/api/src/tournaments/tournaments.integration.spec.ts`

**Interfaces:**
- Consumes: `tournamentVisibilitySchema` aus Task 2.
- Produces: `PATCH /api/v1/organizations/:organizationId/tournaments/:tournamentId/visibility` mit `{ visibility }`; `TournamentsService.setVisibility({ organizationId, tournamentId, data, auth, audit })` liefert das interne Dashboard zurück.

- [ ] **Step 1: Das Eingabeschema anlegen**

In `packages/schemas/src/tournament.ts`:

```ts
export const setTournamentVisibilitySchema = z.object({
  visibility: tournamentVisibilitySchema,
});

export type SetTournamentVisibilityInput = z.infer<typeof setTournamentVisibilitySchema>;
```

Beide in `packages/schemas/src/index.ts` exportieren, dem bestehenden Block folgend.

- [ ] **Step 2: Den fehlschlagenden Test schreiben**

In `apps/api/src/tournaments/tournaments.integration.spec.ts`:

```ts
  it("schaltet die Sichtbarkeit um und auditiert das", async () => {
    const dashboard = await service.setVisibility({
      organizationId,
      tournamentId,
      data: { visibility: "PUBLIC" },
      auth,
      audit: { ipAddress: "127.0.0.1", userAgent: "vitest" },
    });

    expect(dashboard.tournament.visibility).toBe("PUBLIC");

    const [row] = await databaseService.database
      .select({ visibility: tournaments.visibility })
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1);
    expect(row?.visibility).toBe("PUBLIC");
  });

  it("laesst eine Freigabe ohne tournament:update nicht zu", async () => {
    const viewer: AuthContext = { ...auth, role: "VIEWER" };

    await expect(
      service.setVisibility({
        organizationId,
        tournamentId,
        data: { visibility: "PUBLIC" },
        auth: viewer,
        audit: { ipAddress: "127.0.0.1", userAgent: "vitest" },
      }),
    ).rejects.toThrow();
  });
```

Die genaue Form von `auth` und `audit` aus den bereits vorhandenen Fällen derselben Datei übernehmen — dort steht, wie ein `AuthContext` im Test gebaut wird.

- [ ] **Step 3: Test laufen lassen und scheitern sehen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/tournaments.integration.spec.ts`
Erwartet: FAIL — `setVisibility` existiert nicht.

- [ ] **Step 4: Repository, Service und Controller ergänzen**

Repository:

```ts
  public async updateVisibility(
    organizationId: string,
    tournamentId: string,
    visibility: TournamentVisibility,
  ): Promise<void> {
    await this.databaseService.database
      .update(tournaments)
      .set({ visibility })
      .where(and(eq(tournaments.organizationId, organizationId), eq(tournaments.id, tournamentId)));
  }
```

Service — dem Aufbau der übrigen Mutationen dieser Datei folgen (Permission prüfen, Transaktion, Auditsatz, Dashboard zurückgeben):

```ts
  /**
   * Eine Freigabe nach aussen ist eine kritische Benutzeraktion und wird
   * auditiert (AGENTS.md §4). Die Berechtigung ist `tournament:update`: die
   * Sichtbarkeit ist eine Eigenschaft des Turniers. Das Verteilen von
   * Anzeige-Schluesseln bekommt in Plan 2 eine eigene Berechtigung, weil es
   * eine andere Handlung ist.
   */
  public async setVisibility(input: {
    readonly organizationId: string;
    readonly tournamentId: string;
    readonly data: SetTournamentVisibilityInput;
    readonly auth: AuthContext;
    readonly audit: AuditContext;
  }): Promise<TournamentDashboard> {
    await this.access.assertPermission(input.auth, input.organizationId, "tournament:update");
    await this.repository.updateVisibility(
      input.organizationId,
      input.tournamentId,
      input.data.visibility,
    );
    await this.recordAudit(input.audit, input.auth, {
      action: "tournament.visibility_changed",
      organizationId: input.organizationId,
      tournamentId: input.tournamentId,
      visibility: input.data.visibility,
    });
    const dashboard = await this.dashboard(input.organizationId, input.tournamentId, input.auth);
    return dashboard;
  }
```

Die genauen Namen von `assertPermission` und der Audit-Schreibfunktion aus den bestehenden Mutationen derselben Datei übernehmen — sie sind dort bereits verdrahtet; erfinde keine zweite Schreibweise.

Controller, nach `correctResult`:

```ts
  @Patch(":tournamentId/visibility")
  public setVisibility(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("tournamentId", ParseUUIDPipe) tournamentId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TournamentDashboard> {
    const data: SetTournamentVisibilityInput = parseBody(setTournamentVisibilitySchema, body);
    return this.service.setVisibility({
      organizationId,
      tournamentId,
      data,
      auth,
      audit: getAuditContext(request),
    });
  }
```

`Patch` ist dem Import aus `@nestjs/common` hinzuzufügen.

- [ ] **Step 5: Tests laufen lassen und bestätigen**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/tournaments/tournaments.integration.spec.ts`
Erwartet: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src apps/api/src/tournaments
git commit -m "feat(api): Sichtbarkeit eines Turniers umschalten"
```

---

### Task 6: Adressen und Freigabe in der Weboberfläche

**Files:**
- Rename: `apps/web/src/app/live/[id]/` → `apps/web/src/app/live/[publicId]/` (samt `tv/` und `board/[boardId]/`)
- Create: `apps/web/src/lib/live-address.ts` (Auflösung alter Adressen)
- Modify: `apps/web/src/components/live/live-tournament.tsx`
- Create: `apps/web/src/components/tournament/share-panel.tsx`
- Create: `apps/web/src/components/tournament/share-panel.spec.ts`
- Modify: `apps/web/src/components/tournament/command-centre.tsx`
- Modify: `apps/web/tests/foundation.spec.ts`

**Interfaces:**
- Consumes: `GET /public/tournaments/:publicId/live` und `/address` aus Task 4, `PATCH …/visibility` aus Task 5.
- Produces: die Adressen `/live/<publicId>`, `/live/<publicId>/tv`, `/live/<publicId>/board/<boardId>`.

- [ ] **Step 1: Die Routen umbenennen**

```bash
git mv apps/web/src/app/live/\[id\] apps/web/src/app/live/\[publicId\]
```

In allen drei `page.tsx` unterhalb des neuen Segments den Parameternamen von `id` auf `publicId` ziehen und an `LiveTournament` als `publicId` weiterreichen.

- [ ] **Step 2: `LiveTournament` auf die publicId umstellen**

In `apps/web/src/components/live/live-tournament.tsx` die Eigenschaft `tournamentId` in `publicId` umbenennen, den Abfragepfad auf `/public/tournaments/${publicId}/live` setzen und den Abfrageschlüssel auf `["public-live", publicId]`.

**Den Realtime-Aufruf aus dieser Komponente entfernen** (`connectTournamentRealtime` samt `useEffect` und dem `connection`-Zustand, soweit er nur daran hängt). Der Raum heisst bis Plan 3 nach der internen ID, und die liegt der Komponente nach dieser Umstellung nicht mehr vor — ein Beibehalten wäre nicht übersetzbar. `refetchInterval` wird dafür fest auf `5_000` gesetzt, mit diesem Kommentar:

```tsx
  // Befristet: der Realtime-Raum heisst bis Plan 3 nach der internen ID, die
  // diese Ansicht nicht mehr kennt. Bis dahin laedt sie im Intervall nach —
  // wie die Begegnungsansicht heute auch. Plan 3 nimmt beide zurueck in ihre
  // Raeume, und dieser Kommentar verschwindet mit ihm.
```

Das ist ein bewusster, befristeter Rückschritt für die öffentliche Turnieransicht.

- [ ] **Step 3: Alte Adressen umleiten**

Alte Links zeigen auf `/live/<interne-id>`. Dieses Muster trifft nach der Umbenennung auf `[publicId]` — ein eigenes Segment wie `/live/legacy/[id]` würde nie erreicht. Die Umleitung gehört deshalb in die Seite selbst: schlägt die öffentliche Auflösung fehl, wird derselbe Wert einmal als interne ID gedeutet.

In `apps/web/src/app/live/[publicId]/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { publicEnvironment } from "@/lib/environment";
import { LiveTournament } from "@/components/live/live-tournament";

interface LivePageProps {
  readonly params: Promise<{ readonly publicId: string }>;
}

export default async function LivePage({ params }: LivePageProps) {
  const { publicId } = await params;

  // Uebergangsweg: Adressen, die vor der Umstellung geteilt wurden, tragen die
  // interne ID. Sie treffen auf dieses Segment und wuerden ohne diesen Umweg
  // in eine 404 laufen. Nur der Fehlerpfad zahlt die zusaetzliche Abfrage.
  //
  // ENTFERNEN mit dem Uebergangsweg in der API: eigener PR, Ende Oktober 2026.
  const response = await fetch(
    `${publicEnvironment.NEXT_PUBLIC_API_URL}/public/tournaments/${publicId}/address`,
    { cache: "no-store" },
  );
  if (response.ok) {
    const address = (await response.json()) as { readonly publicId: string };
    if (address.publicId !== publicId) redirect(`/live/${address.publicId}`);
  }

  return <LiveTournament publicId={publicId} mode="publikum" />;
}
```

Die Abfrage läuft vor dem Rendern und kostet eine Rundreise auf jedem Aufruf. Das ist der Preis der Übergangsfrist und einer der Gründe, sie zu befristen. `/address` antwortet für eine `public_id` mit 404 (es sucht über die interne ID) — deshalb ist der Normalfall ein fehlgeschlagener Aufruf, und die Bedingung `address.publicId !== publicId` fängt den Sonderfall ab, dass beide Werte zusammenfallen.

Für `tv/page.tsx` und `board/[boardId]/page.tsx` gilt dasselbe; ziehe die Auflösung in eine gemeinsame Hilfsfunktion `resolvePublicId(publicId: string): Promise<string | null>` in `apps/web/src/lib/live-address.ts`, statt sie dreimal zu schreiben.

- [ ] **Step 4: Den fehlschlagenden Test für den Freigabe-Bereich schreiben**

Create `apps/web/src/components/tournament/share-panel.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { shareLink, shareState } from "./share-panel";

describe("shareState", () => {
  it("nennt ein privates Turnier nicht freigegeben", () => {
    expect(shareState("PRIVATE")).toEqual({
      label: "Nicht freigegeben",
      hint: "Nur angemeldete Mitglieder sehen dieses Turnier.",
      next: "PUBLIC",
    });
  });

  it("nennt ein oeffentliches Turnier freigegeben", () => {
    expect(shareState("PUBLIC")).toEqual({
      label: "Freigegeben",
      hint: "Wer den Link hat, sieht zu. Das Turnier steht in keinem Verzeichnis.",
      next: "PRIVATE",
    });
  });
});

describe("shareLink", () => {
  it("baut die oeffentliche Adresse aus der publicId", () => {
    expect(shareLink("https://dartbase.ch", "6f1f1f6a-0000-4000-8000-000000000001")).toBe(
      "https://dartbase.ch/live/6f1f1f6a-0000-4000-8000-000000000001",
    );
  });
});
```

- [ ] **Step 5: Test laufen lassen und scheitern sehen**

Run: `cd apps/web && npx vitest run src/components/tournament/share-panel.spec.ts`
Erwartet: FAIL — Modul nicht gefunden.

- [ ] **Step 6: Den Freigabe-Bereich bauen**

Create `apps/web/src/components/tournament/share-panel.tsx` mit den beiden reinen Funktionen `shareState` und `shareLink` (damit sie ohne DOM prüfbar sind) und der Komponente `SharePanel`, die den Schalter, den Link mit Kopieren-Knopf und den Hinweistext zeigt. Der Schalter ruft `PATCH …/visibility` über den bestehenden `apiRequest`-Weg auf und macht danach `queryClient.invalidateQueries` auf den Dashboard-Schlüssel. Bei `PRIVATE` wird kein Link angezeigt — es gibt keinen.

Die Komponente in `command-centre.tsx` unterhalb des Kopfbereichs einhängen.

- [ ] **Step 7: Tests laufen lassen und bestätigen**

Run: `cd apps/web && npx vitest run src/components/tournament/share-panel.spec.ts`
Erwartet: PASS, drei Fälle.

- [ ] **Step 8: Den E2E-Fall ergänzen**

In `apps/web/tests/foundation.spec.ts` einen Fall ergänzen, der ein Turnier anlegt, die Live-Ansicht ohne Freigabe anonym aufruft (erwartet: Hinweis „Turnier nicht gefunden"), dann freigibt und die Adresse aus dem Freigabe-Bereich anonym in einem zweiten Kontext öffnet (erwartet: die Turnieransicht). Für den anonymen Aufruf `browser.newContext()` ohne gespeicherte Anmeldung verwenden, wie es die bestehenden Fälle der Datei tun.

- [ ] **Step 9: Die volle Kette laufen lassen**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
```

Erwartet: alles grün.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat(web): oeffentliche Turnieradressen und Freigabe-Bereich"
```

---

## Nach diesem Plan

- **In die offenen Punkte eintragen:** Der Übergangsweg (`/address` und die Auflösung in `live-address.ts`) hat eine Frist bis Ende Oktober 2026. Solange er steht, bleibt die interne ID ein gültiger Adressweg.
- **In die offenen Punkte eintragen:** Die öffentliche Turnieransicht lädt bis Plan 3 im 5-Sekunden-Intervall nach, statt im Raum zu hängen.
- **ARCHITECTURE.md** um den Abschnitt zur öffentlichen Adressierung ergänzen, sobald Plan 3 den Realtime-Teil abgeschlossen hat — nicht dreimal dieselbe Stelle umschreiben.
- **Plan 2** (Anzeige-Schlüssel) und **Plan 3** (Realtime) schreiben.
