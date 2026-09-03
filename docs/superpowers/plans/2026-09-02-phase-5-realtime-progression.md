# Phase 5: Realtime-Verteilung und Fortschreibung — Implementierungsplan

> **Für agentische Ausführung:** ERFORDERLICHES SUB-SKILL:
> `superpowers:subagent-driven-development` (empfohlen) oder
> `superpowers:executing-plans`. Die Schritte sind als Checkboxen (`- [ ]`)
> geführt. **Ausnahme, sie schlägt das Skill:** Die Roadmap verbietet
> Subagents (Sessionregel 5) — dieser Plan wird **inline** ausgeführt.

**Ziel:** Die fünf Encounter-Outbox-Ereignisse erreichen die Clients über
WebSocket, und der Statistik-Worker rechnet nach dem Seitenmodell weiter
ausschliesslich Einzelspiele.

**Architektur:** Der bestehende Outbox-Poller in `RealtimeService` kennt nur
`Tournament` und `Match` und verwirft alles andere lautlos. Phase 5 zieht die
Routing-Entscheidung in ein reines Modul (`event-routing.ts`) und die
Pollerschleife in eine Funktion mit einspeisbarem Broadcaster
(`publish-outbox.ts`); `RealtimeService` bleibt die dünne Socket.IO-Hülle.
Dadurch ist die Verteilung ohne Socket-Client und ohne Redis testbar. Im
Worker wird die Match-Auswahl in eine reine Funktion gezogen, die Doppel
verwirft.

**Tech-Stack:** TypeScript (strict), NestJS, Socket.IO, Drizzle ORM,
PostgreSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-team-encounter-league-design.md`
(Abschnitte „Realtime", „Statistik", „Spielende und Fortschreibung")

**Roadmap:** `docs/superpowers/plans/2026-09-02-team-encounter-roadmap.md`

## Globale Rahmenbedingungen

- `HTTP Command → DB Commit → Outbox → Realtime Broadcast`. Nie vor dem
  Commit senden (Spec „Realtime", AGENTS.md §16).
- Jede tenant-bezogene Query wird nach `organization_id` eingeschränkt
  (AGENTS.md §14). Die Outbox-Zeile trägt `organizationId` — sie ist bei jeder
  Auflösung mitzuführen.
- Kein `any` (AGENTS.md §5). Outbox-`payload` ist `jsonb`, also `unknown` —
  eng typisiert auslesen.
- `player_statistic_aggregates` zählt **ausschliesslich Einzelspiele**,
  erkennbar daran, dass eine Seite genau eine Person hat (Spec „Statistik").
- Während der Arbeit **kein** `pnpm test`/`pnpm build` im Root
  (Roadmap-Sessionregel 3). Einzelne API-Testdatei:
  `cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/<pfad>.spec.ts`.
  Integrationstests brauchen die lokale Datenbank (`pnpm infra:up`, Port 5433).
- Commits ohne `Co-Authored-By`. Branch `feature/phase-5-realtime-progression`
  von `develop`.

## Ausgangsbefund

Was Phase 4 hinterlassen hat und was daraus folgt:

1. `apps/api/src/realtime/realtime.service.ts:97` löst nur `Tournament` und
   `Match` auf. Alle fünf Encounter-Ereignisse
   (`ENCOUNTER_STARTED`, `ENCOUNTER_SLOT_ASSIGNED`, `ENCOUNTER_SLOT_COMPLETED`,
   `ENCOUNTER_SLOT_REOPENED`, `ENCOUNTER_COMPLETED`) laufen in `return null`
   und werden ohne einen einzigen Empfänger als `published_at` gestempelt.
2. Ein Match eines Begegnungsslots steht **nicht** in `tournament_matches`.
   Damit verteilt heute auch das laufende Scoring eines Ligaspiels
   (`VISIT_RECORDED`, `MATCH_COMPLETED`) nichts.
3. Es gibt keinen Raum für Begegnungen; `register()` kennt nur
   `tournament:subscribe`.
4. Der Worker (`apps/worker/src/main.ts`) baut je Match aus den ersten beiden
   Teilnehmerzeilen ein Statistikspiel. Nach Sitzen und Positionen sortiert
   sind das bei einem **Doppel beide Personen derselben Seite** — sie würden
   als Gegner gegeneinander gewertet. Der Kommentar „Ein Sitz traegt in dieser
   Phase genau eine Person" gilt seit Phase 1 nicht mehr.

Punkt 4 ist die eigentliche Fortschreibungsarbeit dieser Phase: die DB-seitige
Fortschreibung der Begegnung (`updateEncounterProgress`) hat Phase 4 bereits
geliefert und in derselben Transaktion wie den abschliessenden Visit gehängt.

## Dateien

- Neu: `apps/api/src/realtime/event-routing.ts` — reine Abbildung
  Ereignis + Geltungsbereich → Raum, Kanalname, Nutzlast. Kein Import aus
  Drizzle, NestJS oder Socket.IO.
- Neu: `apps/api/src/realtime/event-routing.spec.ts` — Unit, ohne Infrastruktur.
- Neu: `apps/api/src/realtime/publish-outbox.ts` — Auflösung des
  Geltungsbereichs über die Datenbank und die Pollerschleife, mit
  einspeisbarem `RealtimeBroadcaster`.
- Neu: `apps/api/src/realtime/publish-outbox.integration.spec.ts` — gegen die
  echte Datenbank, mit aufzeichnendem Broadcaster statt Socket.IO.
- Ändern: `apps/api/src/realtime/realtime.service.ts` — nutzt beide Module,
  bekommt `encounter:subscribe`, verliert `resolveTournamentId`.
- Neu: `apps/worker/src/statistics/build-statistics-matches.ts` — reine
  Auswahl und Abbildung der Statistikspiele, Doppel fallen heraus.
- Neu: `apps/worker/src/statistics/build-statistics-matches.spec.ts` — Unit.
- Ändern: `apps/worker/src/main.ts` — nutzt die reine Funktion, überspringt
  Doppel schon bei der Ereignisauswahl.
- Ändern: `docs/superpowers/plans/2026-09-02-team-encounter-roadmap.md` — die
  Schnittstelle Phase 4 → 5 nennt vier Ereignisse, tatsächlich sind es fünf.

---

### Task 1: Reines Routing-Modul

**Dateien:**
- Neu: `apps/api/src/realtime/event-routing.ts`
- Test: `apps/api/src/realtime/event-routing.spec.ts`

**Schnittstellen:**
- Konsumiert: nichts.
- Produziert: `RealtimeScope`, `RealtimeBroadcast`, `RoutableEvent`,
  `parseSubscriptionId(value: unknown): string | null`,
  `toBroadcast(event: RoutableEvent, scope: RealtimeScope | null): RealtimeBroadcast | null`.
  Task 2 und 3 bauen darauf.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`apps/api/src/realtime/event-routing.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseSubscriptionId, toBroadcast } from "./event-routing.js";

const event = {
  id: "11111111-1111-4111-8111-111111111111",
  eventType: "ENCOUNTER_SLOT_COMPLETED",
  occurredAt: new Date("2026-09-03T18:30:00.000Z"),
};

describe("toBroadcast", () => {
  it("sendet Turnierereignisse in den Turnierraum", () => {
    const broadcast = toBroadcast(
      { ...event, eventType: "TOURNAMENT_MATCH_COMPLETED" },
      { kind: "tournament", id: "22222222-2222-4222-8222-222222222222" },
    );

    expect(broadcast).toEqual({
      room: "tournament:22222222-2222-4222-8222-222222222222",
      event: "tournament:changed",
      payload: {
        eventId: event.id,
        eventType: "TOURNAMENT_MATCH_COMPLETED",
        tournamentId: "22222222-2222-4222-8222-222222222222",
        occurredAt: "2026-09-03T18:30:00.000Z",
      },
    });
  });

  it("sendet Begegnungsereignisse in den Begegnungsraum", () => {
    const broadcast = toBroadcast(event, {
      kind: "encounter",
      id: "33333333-3333-4333-8333-333333333333",
    });

    expect(broadcast).toEqual({
      room: "encounter:33333333-3333-4333-8333-333333333333",
      event: "encounter:changed",
      payload: {
        eventId: event.id,
        eventType: "ENCOUNTER_SLOT_COMPLETED",
        encounterId: "33333333-3333-4333-8333-333333333333",
        occurredAt: "2026-09-03T18:30:00.000Z",
      },
    });
  });

  it("sendet nichts ohne Geltungsbereich", () => {
    expect(toBroadcast(event, null)).toBeNull();
  });
});

describe("parseSubscriptionId", () => {
  it("nimmt eine UUID an", () => {
    expect(parseSubscriptionId("33333333-3333-4333-8333-333333333333")).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
  });

  it("weist alles andere ab", () => {
    expect(parseSubscriptionId("tournament:1")).toBeNull();
    expect(parseSubscriptionId(42)).toBeNull();
    expect(parseSubscriptionId(undefined)).toBeNull();
    expect(parseSubscriptionId({ toString: () => "x" })).toBeNull();
  });
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag prüfen**

```bash
cd apps/api && npx vitest run src/realtime/event-routing.spec.ts
```

Erwartet: FAIL, `Failed to resolve import "./event-routing.js"`.

- [ ] **Schritt 3: Modul schreiben**

`apps/api/src/realtime/event-routing.ts`:

```ts
/**
 * Reine Abbildung eines Outbox-Ereignisses auf Raum, Kanal und Nutzlast.
 * Ohne Datenbank, ohne Socket.IO — damit die Verteilungsregel ohne
 * Infrastruktur prüfbar bleibt.
 */

export type RealtimeScope =
  | { readonly kind: "tournament"; readonly id: string }
  | { readonly kind: "encounter"; readonly id: string };

export interface RoutableEvent {
  readonly id: string;
  readonly eventType: string;
  readonly occurredAt: Date;
}

export interface RealtimeBroadcast {
  readonly room: string;
  readonly event: string;
  readonly payload: Readonly<Record<string, string>>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Abonnements kommen vom Client und sind unvertraut: nur eine UUID darf zu
 * einem Raumnamen werden, sonst liesse sich in fremde Räume horchen.
 */
export function parseSubscriptionId(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

export function toBroadcast(
  event: RoutableEvent,
  scope: RealtimeScope | null,
): RealtimeBroadcast | null {
  if (scope === null) return null;
  const occurredAt = event.occurredAt.toISOString();
  if (scope.kind === "tournament") {
    return {
      room: `tournament:${scope.id}`,
      event: "tournament:changed",
      payload: {
        eventId: event.id,
        eventType: event.eventType,
        tournamentId: scope.id,
        occurredAt,
      },
    };
  }
  return {
    room: `encounter:${scope.id}`,
    event: "encounter:changed",
    payload: {
      eventId: event.id,
      eventType: event.eventType,
      encounterId: scope.id,
      occurredAt,
    },
  };
}
```

- [ ] **Schritt 4: Test laufen lassen, Erfolg prüfen**

```bash
cd apps/api && npx vitest run src/realtime/event-routing.spec.ts
```

Erwartet: PASS, 5 Tests.

- [ ] **Schritt 5: Committen**

```bash
git add apps/api/src/realtime/event-routing.ts apps/api/src/realtime/event-routing.spec.ts
git commit -m "feat: route realtime events by tournament or encounter scope"
```

---

### Task 2: Auflösung und Pollerschleife mit einspeisbarem Broadcaster

**Dateien:**
- Neu: `apps/api/src/realtime/publish-outbox.ts`
- Test: `apps/api/src/realtime/publish-outbox.integration.spec.ts`

**Schnittstellen:**
- Konsumiert: `toBroadcast`, `RealtimeScope` aus Task 1.
- Produziert: `RealtimeBroadcaster` (Methode
  `emit(room: string, event: string, payload: Readonly<Record<string, string>>): void`),
  `resolveScope(database, event): Promise<RealtimeScope | null>`,
  `publishOutboxBatch(database, broadcaster, limit?): Promise<number>`.
  Task 3 speist `RealtimeService` als Broadcaster ein.

Warum ein eingespeister Broadcaster: ein echter Socket.IO-Server bräuchte im
Test Redis, einen HTTP-Server und `socket.io-client`, das im API-Paket nicht
liegt. Die Verteilungsregel ist aber eine Datenbank- und Routingfrage. Der
aufzeichnende Broadcaster prüft genau das, deterministisch.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`apps/api/src/realtime/publish-outbox.integration.spec.ts`. Er legt eine
eigene Organisation mit zufälliger Id an und räumt in `afterAll` auf — wie
`encounters.integration.spec.ts`. Er braucht **keine** Begegnung im Vollausbau:
geprüft wird die Auflösung, also genügen die Zeilen, an denen sie hängt.

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  competitions,
  encounterSlots,
  encounters,
  matches,
  organizations,
  outboxEvents,
  teams,
  tournamentMatches,
  tournamentStages,
  tournaments,
} from "@darts-platform/database";

import { DatabaseService } from "../database/database.service.js";
import { publishOutboxBatch, type RealtimeBroadcaster } from "./publish-outbox.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const database = databaseService.database;

interface Recorded {
  readonly room: string;
  readonly event: string;
  readonly payload: Readonly<Record<string, string>>;
}

function recorder(): RealtimeBroadcaster & { readonly sent: Recorded[] } {
  const sent: Recorded[] = [];
  return {
    sent,
    emit(room, event, payload) {
      sent.push({ room, event, payload });
    },
  };
}

const organizationId = randomUUID();
let tournamentId = "";
let encounterId = "";
let encounterMatchId = "";
let tournamentMatchId = "";

beforeAll(async () => {
  await database.insert(organizations).values({
    id: organizationId,
    name: "Realtime Test",
    slug: `realtime-${organizationId.slice(0, 8)}`,
  });

  // Turnier- und Begegnungszeilen entstehen hier direkt in den Tabellen und
  // nicht ueber die Repositories: geprueft wird die Aufloesung des
  // Geltungsbereichs, nicht der Ablauf. Die vollstaendigen Ablaeufe deckt
  // encounters.integration.spec.ts ab. Direktes Schreiben erzeugt keine
  // Outbox-Zeilen, jeder Test legt seine Ereignisse also selbst an.
  const [tournament] = await database
    .insert(tournaments)
    .values({
      organizationId,
      name: "Realtime Cup",
      format: "SINGLE_ELIMINATION",
      groupCount: 1,
      qualifyPerGroup: 1,
      knockoutSize: 2,
      seeding: "RANDOM",
      startsAt: new Date("2026-09-03T18:00:00.000Z"),
    })
    .returning();
  tournamentId = tournament?.id ?? "";

  const [stage] = await database
    .insert(tournamentStages)
    .values({
      organizationId,
      tournamentId,
      key: "ko",
      sequence: 1,
      name: "Finale",
      type: "SINGLE_ELIMINATION",
      status: "READY",
    })
    .returning();

  const [tournamentScoringMatch] = await database
    .insert(matches)
    .values({ organizationId, bestOfLegs: 3, startingSeat: 1 })
    .returning();
  tournamentMatchId = tournamentScoringMatch?.id ?? "";

  await database.insert(tournamentMatches).values({
    organizationId,
    tournamentId,
    stageId: stage?.id ?? "",
    key: "ko-1",
    stageLabel: "Finale",
    round: 1,
    position: 1,
    status: "IN_PROGRESS",
    scoringMatchId: tournamentMatchId,
  });

  const [competition] = await database
    .insert(competitions)
    .values({
      organizationId,
      type: "LEAGUE",
      name: "Realtime Liga",
      slug: `liga-${organizationId.slice(0, 8)}`,
      status: "ACTIVE",
    })
    .returning();
  const [home] = await database
    .insert(teams)
    .values({ organizationId, name: "Heim" })
    .returning();
  const [away] = await database
    .insert(teams)
    .values({ organizationId, name: "Gast" })
    .returning();

  const [encounter] = await database
    .insert(encounters)
    .values({
      organizationId,
      competitionId: competition?.id ?? "",
      matchday: 1,
      homeTeamId: home?.id ?? "",
      awayTeamId: away?.id ?? "",
      scheduledAt: new Date("2026-09-03T20:00:00.000Z"),
    })
    .returning();
  encounterId = encounter?.id ?? "";

  const [encounterScoringMatch] = await database
    .insert(matches)
    .values({ organizationId, bestOfLegs: 3, startingSeat: 1 })
    .returning();
  encounterMatchId = encounterScoringMatch?.id ?? "";

  await database.insert(encounterSlots).values({
    organizationId,
    encounterId,
    sequence: 1,
    role: "REGULAR",
    discipline: "SINGLES",
    label: "Einzel 1",
    startingScore: 501,
    inRule: "STRAIGHT",
    outRule: "DOUBLE",
    bestOfLegs: 3,
    legsToWinSet: 2,
    setsToWin: 1,
    status: "IN_PROGRESS",
    matchId: encounterMatchId,
  });
});

afterAll(async () => {
  await database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.onApplicationShutdown();
});

describe("publishOutboxBatch", () => {
  it("verteilt ein Begegnungsereignis in den Begegnungsraum", async () => {
    const [event] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Encounter",
        aggregateId: encounterId,
        eventType: "ENCOUNTER_STARTED",
        payload: { encounterId },
      })
      .returning();
    const broadcaster = recorder();

    await publishOutboxBatch(database, broadcaster);

    const delivered = broadcaster.sent.find((entry) => entry.payload.eventId === event?.id);
    expect(delivered?.room).toBe(`encounter:${encounterId}`);
    expect(delivered?.event).toBe("encounter:changed");
    expect(delivered?.payload.eventType).toBe("ENCOUNTER_STARTED");
    expect(delivered?.payload.encounterId).toBe(encounterId);
    const [stored] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, event?.id ?? ""));
    expect(stored?.publishedAt).not.toBeNull();
  });

  it("verteilt das Scoring eines Begegnungsmatches in den Begegnungsraum", async () => {
    await database.insert(outboxEvents).values({
      organizationId,
      aggregateType: "Match",
      aggregateId: encounterMatchId,
      eventType: "VISIT_RECORDED",
      payload: { matchId: encounterMatchId },
    });
    const broadcaster = recorder();

    await publishOutboxBatch(database, broadcaster);

    expect(broadcaster.sent.map((entry) => entry.room)).toContain(
      `encounter:${encounterId}`,
    );
  });

  it("verteilt das Scoring eines Turniermatches weiterhin in den Turnierraum", async () => {
    await database.insert(outboxEvents).values({
      organizationId,
      aggregateType: "Match",
      aggregateId: tournamentMatchId,
      eventType: "VISIT_RECORDED",
      payload: { matchId: tournamentMatchId },
    });
    const broadcaster = recorder();

    await publishOutboxBatch(database, broadcaster);

    expect(broadcaster.sent.map((entry) => entry.room)).toContain(
      `tournament:${tournamentId}`,
    );
  });

  it("stempelt ein nicht zuordenbares Ereignis, ohne zu senden", async () => {
    const [event] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Player",
        aggregateId: randomUUID(),
        eventType: "PLAYER_RENAMED",
        payload: {},
      })
      .returning();
    const broadcaster = recorder();

    await publishOutboxBatch(database, broadcaster);

    expect(broadcaster.sent).toEqual([]);
    const [stored] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, event?.id ?? ""));
    expect(stored?.publishedAt).not.toBeNull();
  });

  it("verteilt ein bereits gestempeltes Ereignis kein zweites Mal", async () => {
    await database.insert(outboxEvents).values({
      organizationId,
      aggregateType: "Encounter",
      aggregateId: encounterId,
      eventType: "ENCOUNTER_COMPLETED",
      payload: { encounterId },
    });
    const first = recorder();
    await publishOutboxBatch(database, first);
    const second = recorder();

    await publishOutboxBatch(database, second);

    expect(first.sent.length).toBeGreaterThan(0);
    expect(second.sent).toEqual([]);
  });
});
```

`inArray` wird in dieser Datei nicht gebraucht — im Importblock von
`drizzle-orm` weglassen, sonst meckert Lint. Das `afterAll` löscht über die
Organisation; alle abhängigen Zeilen hängen an `onDelete: "cascade"`, ausser
`teams` (`restrict` auf `encounters`) — die Begegnung wird durch den Cascade
über die Organisation vorher entfernt, die Reihenfolge stimmt also.

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag prüfen**

```bash
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/realtime/publish-outbox.integration.spec.ts
```

Erwartet: FAIL, `Failed to resolve import "./publish-outbox.js"`.
Läuft die Datenbank nicht, scheitert er stattdessen am Verbindungsaufbau —
dann zuerst `pnpm infra:up`.

- [ ] **Schritt 3: Modul schreiben**

`apps/api/src/realtime/publish-outbox.ts`:

```ts
import { and, asc, eq, isNull } from "drizzle-orm";

import { encounterSlots, outboxEvents, tournamentMatches } from "@darts-platform/database";

import type { DatabaseService } from "../database/database.service.js";
import { toBroadcast, type RealtimeBroadcast, type RealtimeScope } from "./event-routing.js";

type Database = DatabaseService["database"];

export interface RealtimeBroadcaster {
  emit(room: string, event: string, payload: RealtimeBroadcast["payload"]): void;
}

interface ResolvableEvent {
  readonly organizationId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
}

/**
 * Ein Match gehoert entweder zu einem Turnier oder zu einem Begegnungsslot.
 * Beide Quellen muessen befragt werden: ein Ligaspiel steht nicht in
 * `tournament_matches`, und ohne die zweite Abfrage bliebe der Spielabend
 * ohne Live-Verteilung.
 *
 * Ein abgebrochenes Match verliert seinen Slotbezug in derselben Transaktion,
 * in der `MATCH_ABORTED` entsteht. Dieses eine Ereignis ist danach keinem
 * Raum mehr zuzuordnen — der Begegnungsraum erfaehrt den Abbruch ueber
 * `ENCOUNTER_SLOT_REOPENED`, das die Abbruchtransaktion mitschreibt.
 */
export async function resolveScope(
  database: Database,
  event: ResolvableEvent,
): Promise<RealtimeScope | null> {
  if (event.aggregateType === "Tournament") {
    return { kind: "tournament", id: event.aggregateId };
  }
  if (event.aggregateType === "Encounter") {
    return { kind: "encounter", id: event.aggregateId };
  }
  if (event.aggregateType !== "Match") return null;

  const [scheduled] = await database
    .select({ tournamentId: tournamentMatches.tournamentId })
    .from(tournamentMatches)
    .where(
      and(
        eq(tournamentMatches.organizationId, event.organizationId),
        eq(tournamentMatches.scoringMatchId, event.aggregateId),
      ),
    )
    .limit(1);
  if (scheduled !== undefined) {
    return { kind: "tournament", id: scheduled.tournamentId };
  }

  const [slot] = await database
    .select({ encounterId: encounterSlots.encounterId })
    .from(encounterSlots)
    .where(
      and(
        eq(encounterSlots.organizationId, event.organizationId),
        eq(encounterSlots.matchId, event.aggregateId),
      ),
    )
    .limit(1);
  return slot === undefined ? null : { kind: "encounter", id: slot.encounterId };
}

/**
 * Verteilt einen Stapel unpublizierter Ereignisse und stempelt jedes einzeln.
 * Der Stempel faellt auch dann, wenn kein Raum zustaendig ist — sonst liefe
 * der Poller ewig gegen dieselbe Zeile.
 */
export async function publishOutboxBatch(
  database: Database,
  broadcaster: RealtimeBroadcaster,
  limit = 100,
): Promise<number> {
  const events = await database
    .select()
    .from(outboxEvents)
    .where(isNull(outboxEvents.publishedAt))
    .orderBy(asc(outboxEvents.occurredAt))
    .limit(limit);

  for (const event of events) {
    const broadcast = toBroadcast(event, await resolveScope(database, event));
    if (broadcast !== null) {
      broadcaster.emit(broadcast.room, broadcast.event, broadcast.payload);
    }
    await database
      .update(outboxEvents)
      .set({ publishedAt: new Date() })
      .where(and(eq(outboxEvents.id, event.id), isNull(outboxEvents.publishedAt)));
  }
  return events.length;
}
```

- [ ] **Schritt 4: Test laufen lassen, Erfolg prüfen**

```bash
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/realtime/publish-outbox.integration.spec.ts
```

Erwartet: PASS, 5 Tests.

- [ ] **Schritt 5: Committen**

```bash
git add apps/api/src/realtime/publish-outbox.ts apps/api/src/realtime/publish-outbox.integration.spec.ts
git commit -m "feat: resolve encounter scope when publishing outbox events"
```

---

### Task 3: RealtimeService auf die neuen Module ziehen

**Dateien:**
- Ändern: `apps/api/src/realtime/realtime.service.ts` (ersetzt `register`,
  `publishOutbox` und `resolveTournamentId`)

**Schnittstellen:**
- Konsumiert: `parseSubscriptionId` (Task 1), `publishOutboxBatch` und
  `RealtimeBroadcaster` (Task 2).
- Produziert: den Socket-Kanal `encounter:subscribe` mit Nutzlast
  `{ encounterId: string }` und das Ereignis `encounter:changed` — darauf baut
  Phase 6 die Live-Ansicht der Begegnung.

- [ ] **Schritt 1: `register` und den Poller ersetzen**

In `apps/api/src/realtime/realtime.service.ts` die Importe ergänzen und die
drei Methoden austauschen. `outboxEvents`, `tournamentMatches`, `and`, `asc`,
`eq`, `isNull` werden dort nicht mehr gebraucht — ihre Importe entfernen,
sonst schlägt Lint zu.

```ts
import { parseSubscriptionId } from "./event-routing.js";
import { publishOutboxBatch, type RealtimeBroadcaster } from "./publish-outbox.js";
```

Klassensignatur:

```ts
export class RealtimeService implements OnApplicationShutdown, RealtimeBroadcaster {
```

Methoden:

```ts
  public emit(room: string, event: string, payload: Readonly<Record<string, string>>): void {
    this.io?.to(room).emit(event, payload);
  }

  private register(socket: Socket): void {
    socket.on("tournament:subscribe", (payload: SubscribePayload) => {
      const tournamentId = parseSubscriptionId(payload?.tournamentId);
      if (tournamentId === null) return;
      void socket.join(`tournament:${tournamentId}`);
    });
    socket.on("encounter:subscribe", (payload: SubscribePayload) => {
      const encounterId = parseSubscriptionId(payload?.encounterId);
      if (encounterId === null) return;
      void socket.join(`encounter:${encounterId}`);
    });
  }

  private async publishOutbox(): Promise<void> {
    if (this.publishing || this.io === null) return;
    this.publishing = true;
    try {
      await publishOutboxBatch(this.database.database, this);
    } catch (error) {
      this.logger.error("Outbox konnte nicht publiziert werden", error);
    } finally {
      this.publishing = false;
    }
  }
```

Und die Nutzlast-Schnittstelle erweitern:

```ts
interface SubscribePayload {
  readonly tournamentId?: unknown;
  readonly encounterId?: unknown;
}
```

- [ ] **Schritt 2: Typen und Lint prüfen**

```bash
pnpm --filter @darts-platform/api typecheck
pnpm --filter @darts-platform/api lint
```

Erwartet: beide grün. Ein Fehler „is declared but its value is never read"
zeigt einen vergessenen Importrest an.

- [ ] **Schritt 3: Die Tests aus Task 1 und 2 erneut laufen lassen**

```bash
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/realtime
```

Erwartet: PASS, 10 Tests.

- [ ] **Schritt 4: Committen**

```bash
git add apps/api/src/realtime/realtime.service.ts
git commit -m "feat: broadcast encounter changes over a dedicated socket room"
```

---

### Task 4: Statistik zählt nur Einzelspiele

**Dateien:**
- Neu: `apps/worker/src/statistics/build-statistics-matches.ts`
- Test: `apps/worker/src/statistics/build-statistics-matches.spec.ts`

**Schnittstellen:**
- Konsumiert: `StatisticsMatch` aus `@darts-platform/statistics`.
- Produziert: `CompletedMatchRow`, `ParticipantRow`, `LegRow`, `VisitRow`,
  `buildStatisticsMatches(input): readonly StatisticsMatch[]` — Task 5 ruft sie
  aus `main.ts`.

Fachliche Regel (Spec „Statistik"): gewertet wird ein Match nur, wenn **beide**
Sitze genau eine Person tragen. Ein Doppel liefert je Sitz zwei
Teilnehmerzeilen; die alte Auswahl der ersten beiden Zeilen hätte dort zwei
Personen **derselben** Seite als Gegner gewertet.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`apps/worker/src/statistics/build-statistics-matches.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildStatisticsMatches } from "./build-statistics-matches.js";

const completedAt = new Date("2026-09-03T20:00:00.000Z");

const singles = {
  matches: [{ id: "match-1", winnerSeat: 1, completedAt }],
  participants: [
    { matchId: "match-1", seat: 1, playerId: "home", displayName: "Heim", legsWon: 2 },
    { matchId: "match-1", seat: 2, playerId: "away", displayName: "Gast", legsWon: 1 },
  ],
  legs: [
    { id: "leg-1", matchId: "match-1", winnerSeat: 1 },
    { id: "leg-2", matchId: "match-1", winnerSeat: 2 },
    { id: "leg-3", matchId: "match-1", winnerSeat: 1 },
  ],
  visits: [
    {
      matchId: "match-1",
      legId: "leg-1",
      throwerPlayerId: "home",
      appliedPoints: 180,
      dartsThrown: 3,
      checkoutAttempts: 0,
      outcome: "SCORED",
      revertedAt: null,
    },
  ],
};

describe("buildStatisticsMatches", () => {
  it("wertet ein Einzel mit beiden Sitzen", () => {
    const result = buildStatisticsMatches(singles);

    expect(result).toHaveLength(1);
    expect(result[0]?.winnerPlayerId).toBe("home");
    expect(result[0]?.participants.map((participant) => participant.playerId)).toEqual([
      "home",
      "away",
    ]);
    expect(result[0]?.participants[0]?.setsWon).toBe(1);
    expect(result[0]?.participants[1]?.setsWon).toBe(0);
    expect(result[0]?.legs.map((leg) => leg.winnerPlayerId)).toEqual([
      "home",
      "away",
      "home",
    ]);
    expect(result[0]?.visits).toHaveLength(1);
  });

  it("verwirft ein Doppel, statt zwei Personen derselben Seite gegeneinander zu werten", () => {
    const result = buildStatisticsMatches({
      ...singles,
      participants: [
        { matchId: "match-1", seat: 1, playerId: "home-a", displayName: "Heim A", legsWon: 2 },
        { matchId: "match-1", seat: 1, playerId: "home-b", displayName: "Heim B", legsWon: 2 },
        { matchId: "match-1", seat: 2, playerId: "away-a", displayName: "Gast A", legsWon: 1 },
        { matchId: "match-1", seat: 2, playerId: "away-b", displayName: "Gast B", legsWon: 1 },
      ],
    });

    expect(result).toEqual([]);
  });

  it("verwirft ein Match ohne zweiten Sitz", () => {
    const result = buildStatisticsMatches({
      ...singles,
      participants: [singles.participants[0]!],
    });

    expect(result).toEqual([]);
  });

  it("verwirft ein Match, dessen Siegersitz keine Person traegt", () => {
    const result = buildStatisticsMatches({
      ...singles,
      matches: [{ id: "match-1", winnerSeat: 3, completedAt }],
    });

    expect(result).toEqual([]);
  });

  it("laesst ein Leg ohne Siegersitz ohne Person stehen", () => {
    const result = buildStatisticsMatches({
      ...singles,
      legs: [{ id: "leg-1", matchId: "match-1", winnerSeat: null }],
    });

    expect(result[0]?.legs[0]?.winnerPlayerId).toBeNull();
  });

  it("ordnet Legs und Visits ihrem eigenen Match zu", () => {
    const result = buildStatisticsMatches({
      matches: [
        { id: "match-1", winnerSeat: 1, completedAt },
        { id: "match-2", winnerSeat: 2, completedAt },
      ],
      participants: [
        ...singles.participants,
        { matchId: "match-2", seat: 1, playerId: "home", displayName: "Heim", legsWon: 0 },
        { matchId: "match-2", seat: 2, playerId: "away", displayName: "Gast", legsWon: 2 },
      ],
      legs: [
        { id: "leg-1", matchId: "match-1", winnerSeat: 1 },
        { id: "leg-9", matchId: "match-2", winnerSeat: 2 },
      ],
      visits: singles.visits,
    });

    expect(result).toHaveLength(2);
    expect(result[1]?.legs.map((leg) => leg.id)).toEqual(["leg-9"]);
    expect(result[1]?.visits).toEqual([]);
  });
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag prüfen**

```bash
pnpm --filter @darts-platform/worker test
```

Erwartet: FAIL, `Failed to resolve import "./build-statistics-matches.js"`.

- [ ] **Schritt 3: Modul schreiben**

`apps/worker/src/statistics/build-statistics-matches.ts`:

```ts
import type { StatisticsMatch } from "@darts-platform/statistics";

export interface CompletedMatchRow {
  readonly id: string;
  readonly winnerSeat: number;
  readonly completedAt: Date;
}

export interface ParticipantRow {
  readonly matchId: string;
  readonly seat: number;
  readonly playerId: string;
  readonly displayName: string;
  readonly legsWon: number;
}

export interface LegRow {
  readonly id: string;
  readonly matchId: string;
  readonly winnerSeat: number | null;
}

export interface VisitRow {
  readonly matchId: string;
  readonly legId: string;
  readonly throwerPlayerId: string;
  readonly appliedPoints: number;
  readonly dartsThrown: number;
  readonly checkoutAttempts: number;
  readonly outcome: string;
  readonly revertedAt: Date | null;
}

export interface StatisticsSource {
  readonly matches: readonly CompletedMatchRow[];
  readonly participants: readonly ParticipantRow[];
  readonly legs: readonly LegRow[];
  readonly visits: readonly VisitRow[];
}

type VisitOutcome = "SCORED" | "BUST" | "LEG_WON" | "SET_WON" | "MATCH_WON";

/**
 * Baut die Statistikspiele einer Person.
 *
 * Gewertet wird ausschliesslich das Einzel — erkennbar daran, dass beide
 * Sitze genau eine Person tragen (Spec „Statistik", Reglement Anhang 1). Ein
 * Doppel traegt je Sitz zwei Personen; wuerde es mitgewertet, stuenden zwei
 * Personen derselben Seite als Gegner gegeneinander und ein 701-Doppel
 * verschoebe die Averages aller 501-Einzel.
 */
export function buildStatisticsMatches(source: StatisticsSource): readonly StatisticsMatch[] {
  return source.matches.flatMap((match): StatisticsMatch[] => {
    const participants = source.participants.filter(
      (participant) => participant.matchId === match.id,
    );
    const ofSeat = (seat: number): readonly ParticipantRow[] =>
      participants.filter((participant) => participant.seat === seat);
    const home = ofSeat(1);
    const away = ofSeat(2);
    if (home.length !== 1 || away.length !== 1 || participants.length !== 2) return [];

    const first = home[0];
    const second = away[0];
    if (first === undefined || second === undefined) return [];

    const playerOfSeat = (seat: number | null): string | null => {
      if (seat === 1) return first.playerId;
      if (seat === 2) return second.playerId;
      return null;
    };
    const winnerPlayerId = playerOfSeat(match.winnerSeat);
    if (winnerPlayerId === null) return [];

    return [
      {
        id: match.id,
        completedAt: match.completedAt,
        winnerPlayerId,
        participants: [
          {
            playerId: first.playerId,
            displayName: first.displayName,
            legsWon: first.legsWon,
            setsWon: match.winnerSeat === 1 ? 1 : 0,
          },
          {
            playerId: second.playerId,
            displayName: second.displayName,
            legsWon: second.legsWon,
            setsWon: match.winnerSeat === 2 ? 1 : 0,
          },
        ],
        legs: source.legs
          .filter((leg) => leg.matchId === match.id)
          .map((leg) => ({ id: leg.id, winnerPlayerId: playerOfSeat(leg.winnerSeat) })),
        visits: source.visits
          .filter((visit) => visit.matchId === match.id)
          .map((visit) => ({
            legId: visit.legId,
            playerId: visit.throwerPlayerId,
            appliedPoints: visit.appliedPoints,
            dartsThrown: visit.dartsThrown,
            checkoutAttempts: visit.checkoutAttempts,
            outcome: visit.outcome as VisitOutcome,
            reverted: visit.revertedAt !== null,
          })),
      },
    ];
  });
}
```

- [ ] **Schritt 4: Test laufen lassen, Erfolg prüfen**

```bash
pnpm --filter @darts-platform/worker test
```

Erwartet: PASS, 6 neue Tests plus die beiden bestehenden aus
`module-format.spec.ts`.

- [ ] **Schritt 5: Committen**

```bash
git add apps/worker/src/statistics/
git commit -m "feat: keep doubles out of the singles statistics aggregate"
```

---

### Task 5: Worker auf die reine Auswahl umstellen

**Dateien:**
- Ändern: `apps/worker/src/main.ts` (`rebuild` und `run`)

**Schnittstellen:**
- Konsumiert: `buildStatisticsMatches` aus Task 4.
- Produziert: nichts für spätere Tasks.

- [ ] **Schritt 1: `rebuild` auf die reine Funktion umstellen**

Import ergänzen:

```ts
import { buildStatisticsMatches } from "./statistics/build-statistics-matches.js";
```

Der Block, der `statisticsMatches` aus `completed.flatMap(...)` baut
(einschliesslich des überholten Kommentars „Ein Sitz traegt in dieser Phase
genau eine Person"), wird ersetzt durch:

```ts
  const statisticsMatches = buildStatisticsMatches({
    matches: completed,
    participants: participantRows,
    legs: legRows.map((leg) => ({ id: leg.id, matchId: leg.matchId, winnerSeat: leg.winnerSeat })),
    visits: visitRows.map((visit) => ({
      matchId: visit.matchId,
      legId: visit.legId,
      throwerPlayerId: visit.throwerPlayerId,
      appliedPoints: visit.appliedPoints,
      dartsThrown: visit.dartsThrown,
      checkoutAttempts: visit.checkoutAttempts,
      outcome: visit.outcome,
      revertedAt: visit.revertedAt,
    })),
  });
```

`import { calculatePlayerStatistics, type StatisticsMatch }` verliert den
Typimport — `StatisticsMatch` wird hier nicht mehr genannt.

- [ ] **Schritt 2: Ereignisauswahl in `run` um Doppel kürzen**

Heute lädt `run` je `MATCH_COMPLETED` alle `matchParticipantPlayers` und ruft
für **jede** Person `rebuild`. Bei einem Doppel sind das vier Läufe, die nach
Task 4 nichts mehr beitragen. Die Auswahl bekommt deshalb die Teilnehmerzeile
mit und überspringt Doppel:

```ts
      const participantRows = await connection.database
        .select({ playerId: matchParticipantPlayers.playerId, participantId: matchParticipantPlayers.participantId })
        .from(matchParticipantPlayers)
        .where(and(eq(matchParticipantPlayers.organizationId, event.organizationId), eq(matchParticipantPlayers.matchId, event.aggregateId)));
      // Ein Doppel traegt je Sitz mehr als eine Person und zaehlt in der
      // Einzelrangliste nicht mit (Spec „Statistik"). Das Ereignis gilt
      // trotzdem als verarbeitet, sonst laeuft der Poller ewig dagegen.
      const seats = new Set(participantRows.map((participant) => participant.participantId));
      const isSingles = seats.size === participantRows.length;
      if (isSingles) {
        for (const participant of participantRows) await rebuild(participant.playerId, event.organizationId);
      }
      await connection.database.update(outboxEvents).set({ statisticsProcessedAt: new Date() }).where(and(eq(outboxEvents.id, event.id), isNull(outboxEvents.statisticsProcessedAt)));
```

- [ ] **Schritt 3: Typen und Lint prüfen**

```bash
pnpm --filter @darts-platform/worker typecheck
pnpm --filter @darts-platform/worker lint
pnpm --filter @darts-platform/worker test
```

Erwartet: alle drei grün.

- [ ] **Schritt 4: Committen**

```bash
git add apps/worker/src/main.ts
git commit -m "refactor: build worker statistics from the shared singles selection"
```

---

### Task 6: Ende-zu-Ende-Nachweis am Begegnungsmatch

**Dateien:**
- Ändern: `apps/api/src/encounters/encounters.integration.spec.ts` (ein Test
  am Ende der bestehenden `describe`-Gruppe für den gespielten Slot)

**Schnittstellen:**
- Konsumiert: `publishOutboxBatch` (Task 2).
- Produziert: nichts.

Der Nachweis, den die Spec verlangt („Realtime-Ereignisse erst nach
erfolgreichem Commit"): ein real gespielter Slot erzeugt seine Ereignisse in
der Scoring-Transaktion, und der Poller findet sie danach mit dem richtigen
Raum. Die bestehende Datei hat den vollständigen Aufbau bis zum beendeten
Match bereits; dieser Test hängt sich daran.

- [ ] **Schritt 1: Den Test schreiben**

Am Ende der Datei, im `describe`, das eine Begegnung bis zum gespielten Slot
führt — der vorhandene Aufbau wird wiederverwendet, keine zweite Begegnung
anlegen:

```ts
  it("verteilt die Ereignisse eines gespielten Slots in den Begegnungsraum", async () => {
    const sent: { readonly room: string; readonly event: string }[] = [];

    await publishOutboxBatch(databaseService.database, {
      emit(room, event) {
        sent.push({ room, event });
      },
    });

    const encounterRooms = sent.filter((entry) => entry.room === `encounter:${encounterId}`);
    expect(encounterRooms.length).toBeGreaterThan(0);
    expect(encounterRooms.every((entry) => entry.event === "encounter:changed")).toBe(true);
    const [remaining] = await databaseService.database
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.organizationId, organizationId), isNull(outboxEvents.publishedAt)))
      .limit(1);
    expect(remaining).toBeUndefined();
  });
```

Import ergänzen:

```ts
import { publishOutboxBatch } from "../realtime/publish-outbox.js";
```

sowie `isNull` aus `drizzle-orm`, falls die Datei es noch nicht importiert.
`encounterId` und `organizationId` sind die Bezeichner des bestehenden
Aufbaus — beim Schreiben die tatsächlichen Namen aus der Datei übernehmen.

- [ ] **Schritt 2: Test laufen lassen**

```bash
cd apps/api && npx dotenv -e ../../.env -- npx vitest run src/encounters/encounters.integration.spec.ts
```

Erwartet: PASS, die bestehenden Tests plus dieser eine.

- [ ] **Schritt 3: Committen**

```bash
git add apps/api/src/encounters/encounters.integration.spec.ts
git commit -m "test: prove a played encounter slot reaches the encounter room"
```

---

### Task 7: Roadmap berichtigen und Phase abschliessen

**Dateien:**
- Ändern: `docs/superpowers/plans/2026-09-02-team-encounter-roadmap.md`
  (Abschnitt „Phase 4 → 5, 6")
- Ändern: `docs/superpowers/plans/2026-09-02-phase-5-realtime-progression.md`
  (Ergebnisabschnitt, wie Phase 4 ihn führt)

- [ ] **Schritt 1: Die Schnittstelle auf fünf Ereignisse berichtigen**

Die Roadmap nennt vier Ereignisse. Phase 4 hat `ENCOUNTER_SLOT_REOPENED`
ergänzt (Rücknahme einer Board-Zuweisung und Matchabbruch). Die Roadmap sagt:
wer die Namen ändert, ändert die Roadmap mit. Im Abschnitt „Phase 4 → 5, 6"
die Aufzählung ersetzen durch:

```text
REST unter `/api/v1` wie im Spec-Abschnitt „API", Outbox-Ereignisse
`ENCOUNTER_STARTED`, `ENCOUNTER_SLOT_ASSIGNED`, `ENCOUNTER_SLOT_COMPLETED`,
`ENCOUNTER_SLOT_REOPENED`, `ENCOUNTER_COMPLETED` mit
`aggregate_type = 'Encounter'`.
```

Und für Phase 5 → 6 ergänzen:

```text
### Phase 5 → 6

Socket-Kanal `encounter:subscribe` mit `{ encounterId }`, Ereignis
`encounter:changed` mit `{ eventId, eventType, encounterId, occurredAt }`.
```

- [ ] **Schritt 2: Vollverifikation**

Erst jetzt, nicht zwischendurch (Roadmap-Sessionregel 3):

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Erwartet: alle vier grün. Fehlschläge werden behoben, nicht übergangen
(AGENTS.md §20).

- [ ] **Schritt 3: Ergebnis festhalten**

An diesen Plan einen Abschnitt „Ergebnis" anhängen: was umgesetzt wurde, jede
Abweichung von diesem Plan mit Begründung, und was für Phase 6 offen bleibt.

- [ ] **Schritt 4: Committen und nach `develop` mergen**

```bash
git add docs/superpowers/plans/
git commit -m "docs: record the phase 5 result and correct the roadmap interface"
git checkout develop
git merge --no-ff feature/phase-5-realtime-progression
git branch -d feature/phase-5-realtime-progression
```

Nicht nach `origin` pushen — `develop` ist der lokale Integrationsbranch.

---

## Abnahmekriterien

- Alle fünf Encounter-Ereignisse erreichen `encounter:<id>` als
  `encounter:changed`; nichts wird mehr stumm gestempelt.
- Das Scoring eines Begegnungsmatches (`VISIT_RECORDED`, `MATCH_COMPLETED`)
  erreicht denselben Raum, Turniermatches unverändert den Turnierraum.
- Ein Ereignis wird höchstens einmal verteilt und danach gestempelt.
- Ein Abonnement mit etwas anderem als einer UUID tritt keinem Raum bei.
- Ein Doppel verändert `player_statistic_aggregates` nicht; ein Einzel wie
  bisher.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` sind grün.

## Nicht im Umfang

- Web-UI und der Client für `encounter:subscribe` — Phase 6.
- E2E-Tests — Phase 7.
- Eine Doppelstatistik mit Disziplin-Dimension (Spec „Statistik" nennt sie
  ausdrücklich als eigene Arbeit).
- Saison-Tabellenberechnung.
