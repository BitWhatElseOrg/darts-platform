# Spielerprofilbild — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeder Spieler trägt ein Profilbild; wo keines hochgeladen ist, zeichnet die Fläche ein Standardbild aus den Initialen.

**Architecture:** Die Bilder liegen als `bytea` in einer eigenen Tabelle `player_avatars`, ein Datensatz je Spieler. Der Server nimmt den rohen Binärkörper entgegen, dekodiert ihn mit `sharp`, normalisiert auf 256 px WebP und speichert nur das selbst erzeugte Ergebnis. Ausgeliefert wird hinter `player:read`, adressiert mit der Prüfsumme als Cache-Schlüssel.

**Tech Stack:** NestJS auf Fastify, Drizzle ORM auf PostgreSQL, `sharp`, Next.js/React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-spielerprofilbild-design.md`

## Global Constraints

- Gespeichert wird ausschliesslich `image/webp`, 256 × 256, Qualität 80.
- `byte_size` höchstens 262144 (256 KB), Check-Constraint in der Datenbank.
- `sharp` mit `limitInputPixels: 50_000_000`; animierte Bilder auf das erste Bild reduziert.
- `GET` antwortet mit `Cache-Control: private, max-age=31536000, immutable`.
- Fehlercodes: `AVATAR_INVALID_IMAGE` (422), `AVATAR_TOO_LARGE` (413), `FORBIDDEN` (403).
- Schreiben und Löschen verlangt `player:update` **oder** `players.user_id === auth.user.id`.
- Jede Abfrage ist nach `organization_id` eingeschränkt; ein Spieler einer fremden Organisation ergibt 404, nicht 403.
- Audit-Einträge `PLAYER_AVATAR_UPDATED` / `PLAYER_AVATAR_REMOVED` tragen die Prüfsumme, niemals die Bytes.
- Die Fläche verkleinert vor dem Upload auf 512 px WebP; das Fastify-Körperlimit von 1 MB bleibt unverändert.
- Deutsche Oberflächentexte, Schweizer Rechtschreibung, kein ß.

---

### Task 1: Initialen und Farbton

Reine Regeln ohne Abhängigkeiten. Sie tragen das Standardbild und lassen sich vollständig ohne Netz, Datenbank und Browser prüfen.

**Files:**
- Create: `apps/web/src/lib/player-avatar.ts`
- Test: `apps/web/src/lib/player-avatar.spec.ts`

**Interfaces:**
- Consumes: nichts.
- Produces: `playerInitials(displayName: string): string` — ein bis zwei Grossbuchstaben. `avatarTone(playerId: string): number` — Farbwinkel 0–359, stabil je ID.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/player-avatar.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { avatarTone, playerInitials } from "./player-avatar";

describe("playerInitials", () => {
  it("nimmt die Anfangsbuchstaben der ersten beiden Wörter", () => {
    expect(playerInitials("Alex Muster")).toBe("AM");
  });

  it("nimmt bei einem einzelnen Wort nur dessen ersten Buchstaben", () => {
    expect(playerInitials("Alex")).toBe("A");
  });

  it("überspringt zusätzliche Wörter", () => {
    expect(playerInitials("Jordan van der Beispiel")).toBe("JV");
  });

  it("verträgt mehrfache Leerzeichen und Ränder", () => {
    expect(playerInitials("  Alex   Muster  ")).toBe("AM");
  });

  it("liefert für einen leeren Namen ein Fragezeichen statt einer leeren Fläche", () => {
    expect(playerInitials("   ")).toBe("?");
  });
});

describe("avatarTone", () => {
  it("liefert denselben Farbwinkel für dieselbe Kennung", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(avatarTone(id)).toBe(avatarTone(id));
  });

  it("bleibt im Bereich von 0 bis 359", () => {
    for (const id of ["a", "b", "11111111-1111-4111-8111-111111111111", ""]) {
      const tone = avatarTone(id);
      expect(Number.isInteger(tone)).toBe(true);
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(360);
    }
  });

  it("trennt verschiedene Kennungen", () => {
    expect(avatarTone("11111111-1111-4111-8111-111111111111")).not.toBe(
      avatarTone("22222222-2222-4222-8222-222222222222"),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/player-avatar.spec.ts`
Expected: FAIL — `Failed to resolve import "./player-avatar"`.

- [ ] **Step 3: Write minimal implementation**

`apps/web/src/lib/player-avatar.ts`:

```ts
/**
 * Das Standardbild eines Spielers ohne Foto: Initialen auf einer Fläche,
 * deren Farbton aus der Spieler-ID kommt. Beide Regeln sind rein, damit
 * dieselbe Person überall dieselbe Darstellung bekommt — und damit sie ohne
 * Netz und Datenbank prüfbar sind.
 */

/** Ein bis zwei Grossbuchstaben aus dem Anzeigenamen. */
export function playerInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter((word) => word.length > 0);
  const letters = words.slice(0, 2).map((word) => word.charAt(0).toUpperCase());
  return letters.length === 0 ? "?" : letters.join("");
}

/**
 * Ein Farbwinkel von 0 bis 359, stabil je Kennung. Bewusst kein Zufall und
 * kein Index in der Liste: beides änderte die Farbe einer Person, sobald
 * sich die Liste ändert.
 */
export function avatarTone(playerId: string): number {
  let hash = 0;
  for (let index = 0; index < playerId.length; index += 1) {
    hash = (hash * 31 + playerId.charCodeAt(index)) % 360;
  }
  return hash;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/player-avatar.spec.ts`
Expected: PASS, 8 Tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/player-avatar.ts apps/web/src/lib/player-avatar.spec.ts
git commit -m "feat(web): Initialen und Farbton fuer das Standardbild"
```

---

### Task 2: Bildnormalisierung auf dem Server

Der Kern des Features: aus beliebigen Bytes wird ein vom Server erzeugtes 256-px-WebP oder ein Fehler. Infrastrukturfrei und einzeln prüfbar.

**Files:**
- Create: `apps/api/src/players/avatar-image.ts`
- Test: `apps/api/src/players/avatar-image.spec.ts`
- Modify: `apps/api/package.json` (Abhängigkeit `sharp`)

**Interfaces:**
- Consumes: nichts.
- Produces: `normalizeAvatarImage(input: Buffer): Promise<NormalizedAvatar>` mit `NormalizedAvatar = { bytes: Buffer; contentType: "image/webp"; checksum: string; byteSize: number }`; `AvatarImageError` mit `code: "AVATAR_INVALID_IMAGE"`.

- [ ] **Step 1: Add the dependency**

```bash
cd apps/api && pnpm add sharp
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/players/avatar-image.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { AvatarImageError, normalizeAvatarImage } from "./avatar-image.js";

/** Ein echtes Bild, nicht gefälschte Bytes: die Normalisierung dekodiert wirklich. */
async function sourceImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .jpeg()
    .toBuffer();
}

describe("normalizeAvatarImage", () => {
  it("liefert ein quadratisches WebP von 256 Pixeln", async () => {
    const result = await normalizeAvatarImage(await sourceImage(900, 600));

    expect(result.contentType).toBe("image/webp");
    const metadata = await sharp(result.bytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(256);
    expect(metadata.height).toBe(256);
  });

  it("bleibt unter der gespeicherten Groessengrenze", async () => {
    const result = await normalizeAvatarImage(await sourceImage(2000, 2000));

    expect(result.byteSize).toBe(result.bytes.byteLength);
    expect(result.byteSize).toBeLessThanOrEqual(262_144);
  });

  it("liefert fuer gleiche Eingabe dieselbe Pruefsumme", async () => {
    const source = await sourceImage(400, 400);

    const first = await normalizeAvatarImage(source);
    const second = await normalizeAvatarImage(source);

    expect(first.checksum).toBe(second.checksum);
    expect(first.checksum).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("verwirft EXIF-Daten", async () => {
    // Ein Bild mit EXIF-Block rein; nach der Neukodierung darf keiner mehr
    // dranhaengen. Handyfotos tragen dort GPS-Koordinaten.
    const withExif = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 10, g: 10, b: 10 } },
    })
      .withExif({ IFD0: { Copyright: "Testaufnahme", Software: "Kamera" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const result = await normalizeAvatarImage(withExif);

    expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
  });

  it("lehnt Bytes ab, die kein Bild sind", async () => {
    await expect(normalizeAvatarImage(Buffer.from("kein Bild, nur Text"))).rejects.toMatchObject({
      code: "AVATAR_INVALID_IMAGE",
    });
  });

  it("wirft einen AvatarImageError, nicht den rohen Bibliotheksfehler", async () => {
    // Nach aussen geht nie eine Bibliotheksmeldung; der Fehlerfilter braucht
    // den eigenen Code.
    await expect(normalizeAvatarImage(Buffer.alloc(0))).rejects.toBeInstanceOf(AvatarImageError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/players/avatar-image.spec.ts`
Expected: FAIL — `Failed to resolve import "./avatar-image.js"`.

- [ ] **Step 4: Write minimal implementation**

`apps/api/src/players/avatar-image.ts`:

```ts
import { createHash } from "node:crypto";

import sharp from "sharp";

/** Kantenlänge des gespeicherten Bildes. */
const avatarSize = 256;
/** Obergrenze gegen Dekompressionsbomben, zusätzlich zur Bytegrenze. */
const maximumInputPixels = 50_000_000;

export class AvatarImageError extends Error {
  public constructor(
    public readonly code: "AVATAR_INVALID_IMAGE",
    message: string,
  ) {
    super(message);
    this.name = "AvatarImageError";
  }
}

export interface NormalizedAvatar {
  readonly bytes: Buffer;
  readonly contentType: "image/webp";
  readonly checksum: string;
  readonly byteSize: number;
}

/**
 * Aus beliebigen Bytes wird ein vom Server erzeugtes Bild — oder ein Fehler.
 *
 * Gespeichert wird nie die gelieferte Datei, sondern immer das Ergebnis
 * dieser Funktion. Daraus folgen drei Eigenschaften, die nicht Nebeneffekt,
 * sondern Zweck sind: was sich nicht dekodieren lässt, kommt gar nicht erst
 * in die Datenbank; EXIF-Daten mit GPS-Koordinaten und Gerätekennungen
 * überleben die Neukodierung nicht; und die Grösse ist vorhersagbar.
 *
 * `rotate()` ohne Argument wendet die EXIF-Orientierung an, BEVOR sie
 * verworfen wird — sonst läge ein Hochformatfoto danach quer.
 */
export async function normalizeAvatarImage(input: Buffer): Promise<NormalizedAvatar> {
  try {
    const bytes = await sharp(input, { limitInputPixels: maximumInputPixels, animated: false })
      .rotate()
      .resize(avatarSize, avatarSize, { fit: "cover", position: "centre" })
      .webp({ quality: 80 })
      .toBuffer();
    return {
      bytes,
      contentType: "image/webp",
      checksum: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength,
    };
  } catch (error: unknown) {
    throw new AvatarImageError(
      "AVATAR_INVALID_IMAGE",
      `Die Datei liess sich nicht als Bild lesen: ${error instanceof Error ? error.message : "unbekannter Fehler"}`,
    );
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/players/avatar-image.spec.ts`
Expected: PASS, 6 Tests.

- [ ] **Step 6: Verify the Docker build still works**

`sharp` bringt vorgebaute Binärdateien für `node:24-bookworm-slim`. Bestätigen, dass das Bild weiterhin baut:

Run: `docker build -f Dockerfile.api -t darts-api:avatar-check .`
Expected: erfolgreicher Build. Danach `docker image rm darts-api:avatar-check`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json apps/api/src/players/avatar-image.ts apps/api/src/players/avatar-image.spec.ts pnpm-lock.yaml
git commit -m "feat(api): Bildnormalisierung fuer Profilbilder"
```

---

### Task 3: Tabelle, Migration und ADR

**Files:**
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/drizzle/0033_player_avatars.sql`
- Modify: `packages/database/drizzle/meta/_journal.json`
- Create: `docs/adr/0016-profilbilder-in-postgres.md`
- Modify: `DATABASE_SCHEMA.md`
- Test: `packages/database/src/schema.spec.ts` (anlegen, falls nicht vorhanden)

**Interfaces:**
- Consumes: nichts.
- Produces: `playerAvatars` (Drizzle-Tabelle) und `bytea` (Drizzle-`customType`), beide aus `@darts-platform/database` exportiert. Spalten: `id`, `organizationId`, `playerId`, `contentType`, `bytes`, `byteSize`, `checksum`, `createdAt`, `updatedAt`.

- [ ] **Step 1: Write the failing test**

`packages/database/src/schema.spec.ts` — falls die Datei existiert, den `describe`-Block anhängen:

```ts
import { describe, expect, it } from "vitest";

import { playerAvatars } from "./schema.js";

describe("player_avatars", () => {
  it("traegt einen Datensatz je Spieler und haengt an der Organisation", () => {
    const columns = Object.keys(playerAvatars);
    for (const column of ["id", "organizationId", "playerId", "contentType", "bytes", "byteSize", "checksum"]) {
      expect(columns).toContain(column);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/database && npx vitest run src/schema.spec.ts`
Expected: FAIL — `playerAvatars` ist kein Export von `./schema.js`.

- [ ] **Step 3: Add the custom type and the table**

In `packages/database/src/schema.ts` bei den übrigen Importen `customType` ergänzen und vor `players` einfügen:

```ts
/**
 * `bytea` fehlt in `pg-core`. Der Treiber (`postgres`) liefert und erwartet
 * einen Buffer; der Typ macht das an der Schemagrenze sichtbar.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
```

Nach der Tabelle `players` einfügen:

```ts
/**
 * Das Profilbild eines Spielers, als Bytes in der Datenbank (ADR 0016).
 * Eigene Tabelle statt Spalten auf `players`: `players` wird überall
 * vollständig gelesen, ein Bild in jeder Spielerliste mitzuschleppen wäre
 * teuer. Gespeichert wird ausschliesslich das vom Server erzeugte WebP.
 */
export const playerAvatars = pgTable(
  "player_avatars",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    contentType: varchar("content_type", { length: 50 }).notNull(),
    bytes: bytea("bytes").notNull(),
    byteSize: integer("byte_size").notNull(),
    checksum: varchar("checksum", { length: 64 }).notNull(),
    ...timestamps,
  },
  (table) => [
    // Ein Spieler trägt genau ein Bild.
    uniqueIndex("player_avatars_player_unique").on(table.playerId),
    index("player_avatars_organization_idx").on(table.organizationId),
    check("player_avatars_content_type_check", sql`${table.contentType} = 'image/webp'`),
    check("player_avatars_byte_size_check", sql`${table.byteSize} > 0 and ${table.byteSize} <= 262144`),
  ],
);

export type PlayerAvatar = typeof playerAvatars.$inferSelect;
export type NewPlayerAvatar = typeof playerAvatars.$inferInsert;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/database && npx vitest run src/schema.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the migration**

`packages/database/drizzle/0033_player_avatars.sql`:

```sql
-- Profilbilder liegen als Bytes in der Datenbank statt in einem Bucket
-- (ADR 0016): keine zweite Konsistenzdomäne, keine Zugangsdaten je Umgebung,
-- Löschen per Fremdschlüssel. Gespeichert wird ausschliesslich das vom Server
-- erzeugte 256-px-WebP, nie die hochgeladene Datei.
CREATE TABLE "player_avatars" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "player_id" uuid NOT NULL,
  "content_type" varchar(50) NOT NULL,
  "bytes" bytea NOT NULL,
  "byte_size" integer NOT NULL,
  "checksum" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "player_avatars" ADD CONSTRAINT "player_avatars_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_avatars" ADD CONSTRAINT "player_avatars_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_avatars_player_unique" ON "player_avatars" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "player_avatars_organization_idx" ON "player_avatars" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "player_avatars" ADD CONSTRAINT "player_avatars_content_type_check" CHECK ("player_avatars"."content_type" = 'image/webp');--> statement-breakpoint
ALTER TABLE "player_avatars" ADD CONSTRAINT "player_avatars_byte_size_check" CHECK ("player_avatars"."byte_size" > 0 and "player_avatars"."byte_size" <= 262144);
```

Im `packages/database/drizzle/meta/_journal.json` als letzten Eintrag anhängen (`when` um eins höher als der bisher letzte Eintrag, Datei ohne abschliessenden Zeilenumbruch lassen):

```json
    {
      "idx": 33,
      "version": "7",
      "tag": "0033_player_avatars",
      "breakpoints": true
    }
```

- [ ] **Step 6: Apply and verify the migration**

Run: `npx dotenv -e .env -- pnpm --filter @darts-platform/database db:migrate`
Expected: `database_migration_completed`.

Danach prüfen, dass die Constraints stehen — die Grenze von 256 KB und der Medientyp sind Datenintegrität, nicht bloss Applikationslogik:

```bash
npx dotenv -e .env -- node -e "
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);
sql\`select conname from pg_constraint where conrelid = 'player_avatars'::regclass order by conname\`
  .then(rows => { for (const r of rows) console.log(r.conname); return sql.end(); });
"
```

Expected: `player_avatars_byte_size_check`, `player_avatars_content_type_check` und die beiden Fremdschlüssel erscheinen.

- [ ] **Step 7: Write the ADR**

`docs/adr/0016-profilbilder-in-postgres.md` — dem Aufbau der bestehenden ADRs folgen (Status, Kontext, Entscheid, Begründung, Alternativen, Folgen). Inhaltlich der Abschnitt „Ablage: Postgres, nicht Bucket" aus der Spec: erwogen wurde ein S3-kompatibler Railway-Bucket; dagegen sprachen eine zweite Konsistenzdomäne, Zugangsdaten je Umgebung und der Umstand, dass der Hauptvorteil eines Buckets — öffentliche Auslieferung über ein CDN — bei bildern hinter der Berechtigungsprüfung entfällt. Die Folge festhalten: bei einer Grössenordnung mehr Daten ist der Wechsel eine eigene Entscheidung, die drei Endpunkte blieben dabei unverändert.

- [ ] **Step 8: Document the table**

In `DATABASE_SCHEMA.md` einen Abschnitt `## player_avatars` im Kapitel 3 (Players) ergänzen: Spalten, die beiden Check-Constraints mit ihrer Begründung, das Kaskadenverhalten, und der Hinweis, dass ausschliesslich servergeneriertes WebP gespeichert wird.

- [ ] **Step 9: Commit**

```bash
git add packages/database/src/schema.ts packages/database/src/schema.spec.ts packages/database/drizzle/0033_player_avatars.sql packages/database/drizzle/meta/_journal.json docs/adr/0016-profilbilder-in-postgres.md DATABASE_SCHEMA.md
git commit -m "feat(database): Tabelle player_avatars samt Migration und ADR"
```

---

### Task 4: `avatarChecksum` in der Spieler-Nutzlast

Ohne dieses Feld müsste die Fläche für jeden Spieler eine Bildanfrage stellen, nur um 404 zu bekommen.

**Files:**
- Modify: `packages/schemas/src/player.ts`
- Modify: `apps/api/src/players/players.repository.ts`
- Test: `apps/api/src/players/players-avatar.integration.spec.ts` (in Task 5 erweitert)

**Interfaces:**
- Consumes: `playerAvatars` aus Task 3.
- Produces: `playerSchema` trägt `avatarChecksum: string | null`; `PlayerResponse` entsprechend.

- [ ] **Step 1: Write the failing test**

`apps/api/src/players/players-avatar.integration.spec.ts` anlegen, nach dem Muster von `apps/api/src/players/tenant-isolation.integration.spec.ts` (Harness `createApiTestApplication`, Organisation, Mitgliedschaft und Spieler anlegen). Erster Fall:

```ts
it("meldet ohne Bild avatarChecksum als null", async () => {
  const player = await playersService.get({ organizationId, playerId, auth });

  expect(player.avatarChecksum).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/players/players-avatar.integration.spec.ts`
Expected: FAIL — `avatarChecksum` existiert nicht auf `PlayerResponse`.

- [ ] **Step 3: Extend the schema**

In `packages/schemas/src/player.ts` in `playerSchema` nach `hasAccount` ergänzen:

```ts
  /**
   * Die Prüfsumme des gespeicherten Profilbildes, oder `null`. Die Fläche
   * weiss damit ohne Zusatzabfrage, ob es ein Bild gibt, und hängt den Wert
   * als `?v=` an die Bildadresse — eine Änderung bricht den Cache von selbst.
   */
  avatarChecksum: z.string().nullable(),
```

- [ ] **Step 4: Join the avatar in the repository**

In `apps/api/src/players/players.repository.ts`: `playerAvatars` importieren, `toPlayerResponse` um den Parameter erweitern und beide Leseabfragen auf einen `leftJoin` umstellen.

```ts
function toPlayerResponse(row: PlayerRow, avatarChecksum: string | null) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    publicId: row.publicId,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: row.displayName,
    nickname: row.nickname,
    email: row.email,
    externalReference: row.externalReference,
    status: row.status,
    hasAccount: row.userId !== null,
    avatarChecksum,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
```

`list` und `get` liefern den Wert über einen `leftJoin` auf `playerAvatars` mit `eq(playerAvatars.playerId, players.id)`; die Bytes werden dabei **nicht** selektiert, nur `playerAvatars.checksum`. Jede Stelle, die heute `toPlayerResponse(row)` aufruft — auch die Schreibpfade `create` und `update` —, übergibt dort `null` beziehungsweise die vorhandene Prüfsumme.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/players/players-avatar.integration.spec.ts`
Expected: PASS.

- [ ] **Step 6: Run the neighbouring suites**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/players`
Expected: alle bestehenden Spieler-Tests weiterhin grün.

- [ ] **Step 7: Commit**

```bash
git add packages/schemas/src/player.ts apps/api/src/players/players.repository.ts apps/api/src/players/players-avatar.integration.spec.ts
git commit -m "feat(api): avatarChecksum in der Spieler-Nutzlast"
```

---

### Task 5: Die drei Endpunkte

**Files:**
- Modify: `apps/api/src/common/configure-application.ts`
- Modify: `apps/api/src/players/players.controller.ts`
- Modify: `apps/api/src/players/players.service.ts`
- Modify: `apps/api/src/players/players.repository.ts`
- Test: `apps/api/src/players/players-avatar.integration.spec.ts`

**Interfaces:**
- Consumes: `normalizeAvatarImage`, `AvatarImageError` (Task 2); `playerAvatars` (Task 3); `avatarChecksum` (Task 4).
- Produces: `PlayersService.getAvatar/setAvatar/removeAvatar`; `PlayersRepository.findAvatar/upsertAvatar/deleteAvatar`.

- [ ] **Step 1: Write the failing tests**

An `players-avatar.integration.spec.ts` anhängen. `sampleImage()` erzeugt ein echtes Bild wie in Task 2.

```ts
it("nimmt ein Bild von der Verwaltung entgegen und liefert es zurueck", async () => {
  const stored = await playersService.setAvatar({
    organizationId, playerId, body: await sampleImage(), auth, audit,
  });
  expect(stored.avatarChecksum).toMatch(/^[0-9a-f]{64}$/u);

  const avatar = await playersService.getAvatar({ organizationId, playerId, auth });
  expect(avatar.contentType).toBe("image/webp");
  expect(avatar.bytes.byteLength).toBeGreaterThan(0);
  expect(avatar.checksum).toBe(stored.avatarChecksum);
});

it("laesst die verknuepfte Person ihr eigenes Bild setzen", async () => {
  // ADR 0015: das Konto ist mit diesem Spieler verknuepft und hat kein
  // player:update.
  await expect(
    playersService.setAvatar({ organizationId, playerId: linkedPlayerId, body: await sampleImage(), auth: memberAuth, audit }),
  ).resolves.toMatchObject({ avatarChecksum: expect.any(String) });
});

it("verweigert einer fremden Person ohne player:update das Setzen", async () => {
  await expect(
    playersService.setAvatar({ organizationId, playerId, body: await sampleImage(), auth: memberAuth, audit }),
  ).rejects.toMatchObject({ status: 403 });
});

it("lehnt Bytes ab, die kein Bild sind", async () => {
  await expect(
    playersService.setAvatar({ organizationId, playerId, body: Buffer.from("kein Bild"), auth, audit }),
  ).rejects.toMatchObject({ response: { code: "AVATAR_INVALID_IMAGE" } });
});

it("findet einen Spieler einer fremden Organisation nicht", async () => {
  // 404, nicht 403: sonst verriete die Antwort die Existenz.
  await expect(
    playersService.getAvatar({ organizationId, playerId: foreignPlayerId, auth }),
  ).rejects.toMatchObject({ status: 404 });
});

it("entfernt das Bild wieder", async () => {
  await playersService.setAvatar({ organizationId, playerId, body: await sampleImage(), auth, audit });
  await playersService.removeAvatar({ organizationId, playerId, auth, audit });

  const player = await playersService.get({ organizationId, playerId, auth });
  expect(player.avatarChecksum).toBeNull();
  await expect(playersService.getAvatar({ organizationId, playerId, auth })).rejects.toMatchObject({ status: 404 });
});

it("raeumt das Bild mit dem Spieler ab", async () => {
  await playersService.setAvatar({ organizationId, playerId, body: await sampleImage(), auth, audit });
  await playersService.remove({ organizationId, playerId, auth, audit });

  const rows = await databaseService.database
    .select({ id: playerAvatars.id })
    .from(playerAvatars)
    .where(eq(playerAvatars.playerId, playerId));
  expect(rows).toHaveLength(0);
});

it("schreibt einen Audit-Eintrag ohne die Bilddaten", async () => {
  await playersService.setAvatar({ organizationId, playerId, body: await sampleImage(), auth, audit });

  const [entry] = await databaseService.database
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, "PLAYER_AVATAR_UPDATED"));
  expect(entry).toBeDefined();
  expect(JSON.stringify(entry?.newValue)).not.toContain("bytes");
  expect(entry?.newValue).toMatchObject({ checksum: expect.any(String) });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/players/players-avatar.integration.spec.ts`
Expected: FAIL — `playersService.setAvatar is not a function`.

- [ ] **Step 3: Accept the binary body**

In `apps/api/src/common/configure-application.ts` neben `registerCspReportContentTypes` ergänzen und in `configureApplication` unmittelbar danach aufrufen:

```ts
/**
 * Profilbilder kommen als roher Binärkörper (`PUT`, `Content-Type: image/*`),
 * nicht als Multipart und nicht als base64-JSON. Das spart ein Plugin, und
 * clientseitig ist es `fetch(url, { method: "PUT", body: blob })`. Die
 * Bytegrenze bleibt das Fastify-Standardlimit von 1 MB; die Fläche
 * verkleinert vorher im Browser.
 */
function registerImageUploadContentType(app: NestFastifyApplication): void {
  const instance = app.getHttpAdapter().getInstance();
  instance.addContentTypeParser(/^image\//u, { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
}
```

Im selben Aufruf `app.enableCors` die Methode `"PUT"` ergänzen — sie fehlt heute, der Upload käme sonst nicht durch die Preflight-Prüfung.

- [ ] **Step 4: Add the repository functions**

In `apps/api/src/players/players.repository.ts`:

```ts
public async findAvatar(input: {
  readonly organizationId: string;
  readonly playerId: string;
}): Promise<{ readonly bytes: Buffer; readonly contentType: string; readonly checksum: string } | null> {
  const [row] = await this.databaseService.database
    .select({ bytes: playerAvatars.bytes, contentType: playerAvatars.contentType, checksum: playerAvatars.checksum })
    .from(playerAvatars)
    .where(
      and(
        eq(playerAvatars.organizationId, input.organizationId),
        eq(playerAvatars.playerId, input.playerId),
      ),
    )
    .limit(1);
  return row ?? null;
}
```

```ts
public async upsertAvatar(input: {
  readonly organizationId: string;
  readonly playerId: string;
  readonly avatar: { readonly bytes: Buffer; readonly contentType: string; readonly checksum: string; readonly byteSize: number };
  readonly actorUserId: string;
  readonly audit: AuditContext;
}): Promise<void> {
  await this.databaseService.database.transaction(async (transaction) => {
    await transaction
      .insert(playerAvatars)
      .values({
        organizationId: input.organizationId,
        playerId: input.playerId,
        contentType: input.avatar.contentType,
        bytes: input.avatar.bytes,
        byteSize: input.avatar.byteSize,
        checksum: input.avatar.checksum,
      })
      .onConflictDoUpdate({
        target: playerAvatars.playerId,
        set: {
          contentType: input.avatar.contentType,
          bytes: input.avatar.bytes,
          byteSize: input.avatar.byteSize,
          checksum: input.avatar.checksum,
          updatedAt: new Date(),
        },
      });
    // Die Pruefsumme, nicht die Bytes: ein Audit-Log mit Bilddaten waere eine
    // zweite, unkontrollierte Kopie der Personendaten.
    await transaction.insert(auditEvents).values({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "PLAYER_AVATAR_UPDATED",
      entityType: "Player",
      entityId: input.playerId,
      newValue: { checksum: input.avatar.checksum, byteSize: input.avatar.byteSize },
      ip: input.audit.ip,
      userAgent: input.audit.userAgent,
      correlationId: input.audit.correlationId,
    });
  });
}

public async deleteAvatar(input: {
  readonly organizationId: string;
  readonly playerId: string;
  readonly actorUserId: string;
  readonly audit: AuditContext;
}): Promise<void> {
  await this.databaseService.database.transaction(async (transaction) => {
    const [removed] = await transaction
      .delete(playerAvatars)
      .where(
        and(
          eq(playerAvatars.organizationId, input.organizationId),
          eq(playerAvatars.playerId, input.playerId),
        ),
      )
      .returning({ checksum: playerAvatars.checksum });
    if (removed === undefined) return;
    await transaction.insert(auditEvents).values({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "PLAYER_AVATAR_REMOVED",
      entityType: "Player",
      entityId: input.playerId,
      oldValue: { checksum: removed.checksum },
      ip: input.audit.ip,
      userAgent: input.audit.userAgent,
      correlationId: input.audit.correlationId,
    });
  });
}

public async isLinkedToUser(input: {
  readonly organizationId: string;
  readonly playerId: string;
  readonly userId: string;
}): Promise<boolean> {
  const [row] = await this.databaseService.database
    .select({ id: players.id })
    .from(players)
    .where(
      and(
        eq(players.organizationId, input.organizationId),
        eq(players.id, input.playerId),
        eq(players.userId, input.userId),
      ),
    )
    .limit(1);
  return row !== undefined;
}
```

- [ ] **Step 5: Add the service functions**

In `apps/api/src/players/players.service.ts`. Die Berechtigungsregel steht genau einmal:

```ts
/**
 * Lesen braucht `player:read`. Schreiben braucht `player:update` — oder die
 * Person pflegt ihr eigenes Profil (ADR 0015). Die Mitgliedschaft wird in
 * beiden Fällen geprüft, deshalb steht `player:read` zuerst.
 */
private async requireAvatarWrite(input: {
  readonly organizationId: string;
  readonly playerId: string;
  readonly auth: AuthContext;
}): Promise<void> {
  await this.organizationAccessService.requirePermission({
    organizationId: input.organizationId,
    userId: input.auth.user.id,
    permission: "player:read",
  });
  const player = await this.playersRepository.get({
    organizationId: input.organizationId,
    playerId: input.playerId,
  });
  if (player === null) throw new NotFoundException("Player not found.");
  if (await this.playersRepository.isLinkedToUser({ ...input, userId: input.auth.user.id })) return;
  await this.organizationAccessService.requirePermission({
    organizationId: input.organizationId,
    userId: input.auth.user.id,
    permission: "player:update",
  });
}
```

`setAvatar` ruft `requireAvatarWrite`, dann `normalizeAvatarImage`, fängt `AvatarImageError` und wirft daraus eine `UnprocessableEntityException` mit `{ code: "AVATAR_INVALID_IMAGE", message: … }`, speichert und gibt die neue Prüfsumme zurück. `removeAvatar` ruft `requireAvatarWrite` und löscht. `getAvatar` verlangt `player:read`, prüft die Existenz des Spielers (404) und liefert `findAvatar`, ebenfalls 404 ohne Bild.

`isLinkedToUser` im Repository: `select` auf `players` mit `organizationId`, `id` und `userId`, `limit 1`.

- [ ] **Step 6: Add the controller routes**

In `apps/api/src/players/players.controller.ts`:

```ts
@Get(":playerId/avatar")
public async avatar(
  @Param("organizationId", ParseUUIDPipe) organizationId: string,
  @Param("playerId", ParseUUIDPipe) playerId: string,
  @CurrentAuth() auth: AuthContext,
  @Res({ passthrough: true }) reply: FastifyReply,
): Promise<Buffer> {
  const avatar = await this.playersService.getAvatar({ organizationId, playerId, auth });
  // Die Adresse trägt die Prüfsumme als `?v=`; eine Änderung bricht den
  // Cache dadurch von selbst, und der Browser lädt jedes Bild genau einmal.
  reply.header("Content-Type", avatar.contentType);
  reply.header("Cache-Control", "private, max-age=31536000, immutable");
  reply.header("ETag", `"${avatar.checksum}"`);
  return avatar.bytes;
}

@Put(":playerId/avatar")
public async setAvatar(
  @Param("organizationId", ParseUUIDPipe) organizationId: string,
  @Param("playerId", ParseUUIDPipe) playerId: string,
  @Body() body: Buffer,
  @CurrentAuth() auth: AuthContext,
  @Req() request: FastifyRequest,
): Promise<PlayerResponse> {
  return this.playersService.setAvatar({
    organizationId, playerId, body, auth, audit: getAuditContext(request),
  });
}

@Delete(":playerId/avatar")
public async removeAvatar(
  @Param("organizationId", ParseUUIDPipe) organizationId: string,
  @Param("playerId", ParseUUIDPipe) playerId: string,
  @CurrentAuth() auth: AuthContext,
  @Req() request: FastifyRequest,
): Promise<PlayerResponse> {
  return this.playersService.removeAvatar({
    organizationId, playerId, auth, audit: getAuditContext(request),
  });
}
```

`Put` und `Res` aus `@nestjs/common` importieren, `FastifyReply` als Typ aus `fastify`.

- [ ] **Step 7: Map the body-limit error**

Ein Körper über dem Fastify-Limit erzeugt `FST_ERR_CTP_BODY_TOO_LARGE` mit Status 413. Ob dieser Fehler die Nest-Pipeline überhaupt erreicht, entscheidet der Test — nicht eine Annahme. Erst den Fall schreiben:

```ts
it("beantwortet einen zu grossen Koerper im Fehlerformat", async () => {
  const response = await application.inject({
    method: "PUT",
    url: `/api/v1/organizations/${organizationId}/players/${playerId}/avatar`,
    headers: { "content-type": "image/webp", ...authHeaders },
    payload: Buffer.alloc(2 * 1024 * 1024),
  });

  expect(response.statusCode).toBe(413);
  expect(response.json()).toMatchObject({ error: { code: "AVATAR_TOO_LARGE" } });
});
```

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/players/players-avatar.integration.spec.ts -t "zu grossen Koerper"`
Expected: zunächst FAIL.

Dann in `apps/api/src/common/api-exception.filter.ts` die Tabelle `errorCodes` ergänzen:

```ts
  // Der Profilbild-Upload ist heute die einzige Route mit Binärkörper;
  // deshalb trägt 413 seinen Code. Kommt eine zweite dazu, wird der Code
  // generisch und die Route nennt ihren eigenen.
  [HttpStatus.PAYLOAD_TOO_LARGE]: "AVATAR_TOO_LARGE",
```

Läuft der Test danach immer noch rot, weil Fastify den Fehler vor der Nest-Pipeline beantwortet, den Fall stattdessen im Fastify-Fehlerbehandler abbilden — und das im Kommentar festhalten.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/players`
Expected: PASS, alle Fälle aus Schritt 1 und Schritt 7.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/common/configure-application.ts apps/api/src/common/api-exception.filter.ts apps/api/src/players packages/schemas/src/player.ts
git commit -m "feat(api): Endpunkte fuer das Spielerprofilbild"
```

---

### Task 6: Die Avatar-Komponente

**Files:**
- Create: `apps/web/src/components/players/player-avatar.tsx`
- Create: `apps/web/src/components/players/player-avatar.render.spec.tsx`
- Modify: `apps/web/src/components/players/player-list.tsx`
- Modify: `apps/web/src/components/player-profile.tsx`

**Interfaces:**
- Consumes: `playerInitials`, `avatarTone` (Task 1); `avatarChecksum` (Task 4).
- Produces: `<PlayerAvatar player={{ id, displayName, avatarChecksum }} organizationId size={…} decorative />`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/players/player-avatar.render.spec.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlayerAvatar } from "./player-avatar";

const organizationId = "11111111-1111-4111-8111-111111111111";
const player = { id: "22222222-2222-4222-8222-222222222222", displayName: "Alex Muster" };

afterEach(() => { cleanup(); });

describe("PlayerAvatar", () => {
  it("zeigt die Initialen, solange kein Bild hinterlegt ist", () => {
    render(<PlayerAvatar organizationId={organizationId} player={{ ...player, avatarChecksum: null }} />);

    expect(screen.getByText("AM")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("zeigt das Bild mit der Pruefsumme in der Adresse", () => {
    render(<PlayerAvatar organizationId={organizationId} player={{ ...player, avatarChecksum: "abc123" }} />);

    const image = screen.getByRole("img", { name: "Alex Muster" });
    expect(image.getAttribute("src")).toContain(`/organizations/${organizationId}/players/${player.id}/avatar?v=abc123`);
  });

  it("bleibt neben dem Namen dekorativ", () => {
    // Steht der Name daneben, liest eine Vorlesehilfe ihn sonst zweimal.
    render(<PlayerAvatar decorative organizationId={organizationId} player={{ ...player, avatarChecksum: "abc123" }} />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(document.querySelector("img")?.getAttribute("alt")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/components/players/player-avatar.render.spec.tsx`
Expected: FAIL — `Failed to resolve import "./player-avatar"`.

- [ ] **Step 3: Write the component**

`apps/web/src/components/players/player-avatar.tsx`:

```tsx
import { avatarTone, playerInitials } from "@/lib/player-avatar";
import { publicEnvironment } from "@/lib/environment";

export interface AvatarPlayer {
  readonly id: string;
  readonly displayName: string;
  readonly avatarChecksum: string | null;
}

/**
 * Das Profilbild eines Spielers, oder die Initialen.
 *
 * `decorative` ist zu setzen, wo der Name daneben steht: eine Vorlesehilfe
 * liest ihn sonst zweimal. Allein stehend trägt das Bild den Namen.
 *
 * Die Prüfsumme steht als `?v=` in der Adresse. Der Endpunkt antwortet mit
 * `immutable`, der Browser lädt jedes Bild also genau einmal — und eine
 * Änderung bricht den Cache von selbst, weil sich die Adresse ändert.
 */
export function PlayerAvatar({
  organizationId,
  player,
  size = 40,
  decorative = false,
}: {
  readonly organizationId: string;
  readonly player: AvatarPlayer;
  readonly size?: number;
  readonly decorative?: boolean;
}) {
  const dimension = { width: size, height: size };
  if (player.avatarChecksum === null) {
    return (
      <span
        aria-hidden={decorative ? true : undefined}
        className="inline-flex shrink-0 items-center justify-center rounded-full font-plate font-semibold text-chalk"
        style={{
          ...dimension,
          backgroundColor: `hsl(${avatarTone(player.id)} 55% 32%)`,
          fontSize: Math.round(size * 0.4),
        }}
        title={decorative ? undefined : player.displayName}
      >
        {playerInitials(player.displayName)}
      </span>
    );
  }
  return (
    <img
      alt={decorative ? "" : player.displayName}
      className="inline-block shrink-0 rounded-full object-cover"
      loading="lazy"
      referrerPolicy="no-referrer"
      src={`${publicEnvironment.NEXT_PUBLIC_API_URL}/organizations/${organizationId}/players/${player.id}/avatar?v=${player.avatarChecksum}`}
      style={dimension}
      {...dimension}
    />
  );
}
```

Gestaltung nach DESIGN.md; für die Feinarbeit die `impeccable`-Vorgaben heranziehen.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/components/players/player-avatar.render.spec.tsx`
Expected: PASS, 3 Tests.

- [ ] **Step 5: Show the avatar in list and profile**

In `apps/web/src/components/players/player-list.tsx` je Zeile vor dem Namen `<PlayerAvatar decorative … size={40} />`, im Kopf von `apps/web/src/components/player-profile.tsx` in grösserer Darstellung.

- [ ] **Step 6: Run the web suite**

Run: `cd apps/web && npx vitest run`
Expected: alle Tests grün.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/players apps/web/src/components/player-profile.tsx
git commit -m "feat(web): Profilbild in Spielerliste und Profil"
```

---

### Task 7: Hochladen und Entfernen

**Files:**
- Create: `apps/web/src/lib/avatar-upload.ts`
- Create: `apps/web/src/lib/avatar-upload.spec.ts`
- Create: `apps/web/src/components/players/player-avatar-control.tsx`
- Modify: `apps/web/src/components/player-profile.tsx`
- Test: `apps/web/tests/player-avatar.spec.ts`

**Interfaces:**
- Consumes: `PlayerAvatar` (Task 6); die Endpunkte aus Task 5.
- Produces: `prepareAvatarUpload(file: File): Promise<Blob>` — quadratischer Ausschnitt, 512 px, WebP.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/avatar-upload.spec.ts` prüft die reine Zuschnittrechnung, nicht den Canvas:

```ts
import { describe, expect, it } from "vitest";

import { squareCrop } from "./avatar-upload";

describe("squareCrop", () => {
  it("schneidet ein Querformat mittig zu", () => {
    expect(squareCrop(900, 600)).toEqual({ x: 150, y: 0, size: 600 });
  });

  it("schneidet ein Hochformat mittig zu", () => {
    expect(squareCrop(600, 900)).toEqual({ x: 0, y: 150, size: 600 });
  });

  it("laesst ein Quadrat unveraendert", () => {
    expect(squareCrop(400, 400)).toEqual({ x: 0, y: 0, size: 400 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/lib/avatar-upload.spec.ts`
Expected: FAIL — `squareCrop` ist kein Export.

- [ ] **Step 3: Write the module**

`apps/web/src/lib/avatar-upload.ts`:

```ts
/** Kantenlänge vor dem Upload — grösser als die gespeicherten 256 px, damit
 *  der Server aus genügend Bildinformation herunterrechnet. */
const uploadSize = 512;

export interface CropRegion {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** Der grösstmögliche mittige quadratische Ausschnitt. */
export function squareCrop(width: number, height: number): CropRegion {
  const size = Math.min(width, height);
  return { x: Math.round((width - size) / 2), y: Math.round((height - size) / 2), size };
}

/**
 * Verkleinert die gewählte Datei vor dem Upload. Ein Handyfoto von 4 MB geht
 * damit als etwa 40 KB über die Leitung und bleibt unter dem Körperlimit der
 * API — an einem Spielort mit schlechtem Empfang der Unterschied zwischen
 * „geht" und „geht nicht".
 *
 * Das ist Bequemlichkeit, KEINE Vertrauensgrenze: der Server dekodiert und
 * normalisiert unabhängig davon noch einmal selbst.
 */
export async function prepareAvatarUpload(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const crop = squareCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = uploadSize;
    canvas.height = uploadSize;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Kein 2D-Kontext verfügbar.");
    context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, uploadSize, uploadSize);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => { blob === null ? reject(new Error("Das Bild liess sich nicht umwandeln.")) : resolve(blob); },
        "image/webp",
        0.9,
      );
    });
  } finally {
    bitmap.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/lib/avatar-upload.spec.ts`
Expected: PASS, 3 Tests.

- [ ] **Step 5: Build the control**

`player-avatar-control.tsx`: Dateiauswahl (`accept="image/*"`), Vorschau, Knöpfe „Bild speichern" und „Bild entfernen", Fehlermeldungen über `userFacingErrorMessage`. Der Upload geht als `PUT` mit dem Blob als Körper; danach `queryClient.invalidateQueries` auf `["players", organizationId]` und das Profil. Das Bedienelement erscheint nur, wenn die Berechtigung reicht — die Prüfung bleibt serverseitig.

Die neuen Fehlercodes in `apps/web/src/lib/api-client.ts` ergänzen:

```ts
    AVATAR_INVALID_IMAGE: "Diese Datei liess sich nicht als Bild lesen. Wähle ein JPEG, PNG oder WebP.",
    AVATAR_TOO_LARGE: "Das Bild ist zu gross. Wähle ein kleineres Bild.",
```

- [ ] **Step 6: Write the end-to-end case**

`apps/web/tests/player-avatar.spec.ts`: anmelden, Spielerprofil öffnen, über `setInputFiles` ein Testbild aus `apps/web/tests/fixtures/` hochladen, warten bis das `img` erscheint, zur Spielerliste wechseln und prüfen, dass dort ebenfalls ein `img` statt der Initialen steht.

- [ ] **Step 7: Run the whole gate**

```bash
pnpm lint && pnpm typecheck && npx dotenv -e .env -- pnpm test && NODE_ENV=production npx dotenv -e .env -- pnpm build && NODE_ENV=test npx dotenv -e .env -- pnpm test:e2e --workers=1
```

Expected: alles grün.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/avatar-upload.ts apps/web/src/lib/avatar-upload.spec.ts apps/web/src/components/players/player-avatar-control.tsx apps/web/src/components/player-profile.tsx apps/web/src/lib/api-client.ts apps/web/tests/player-avatar.spec.ts apps/web/tests/fixtures
git commit -m "feat(web): Profilbild hochladen und entfernen"
```

---

## Abschluss

Nach Task 7 steht das Feature vollständig. Vor dem Merge nach `develop`:

- Die Migration läuft auf der Produktionsdatenbank beim nächsten API-Start mit. Sie legt eine leere Tabelle an; ein Bestandsdatenproblem gibt es nicht.
- Issue #2 mit Verweis auf den Merge schliessen.
