import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  OUTBOX_MAX_ATTEMPTS,
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
  type OutboxLogger,
} from "@darts-platform/database";

import { DatabaseService } from "../database/database.service.js";
import {
  publishOutboxBatch,
  resolveScope,
  type OutboxExecutor,
  type RealtimeBroadcaster,
} from "./publish-outbox.js";

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

interface LoggedRecord {
  readonly level: "error" | "warn" | "log" | "debug";
  readonly fields: Readonly<Record<string, unknown>>;
}

function logRecorder(): OutboxLogger & { readonly records: LoggedRecord[] } {
  const records: LoggedRecord[] = [];
  return {
    records,
    emit(level, fields) {
      records.push({ level, fields });
    },
  };
}

const silentLogger: OutboxLogger = { emit: () => undefined };

/**
 * Executor-Doppel, das jeden `select`-Aufruf zaehlt, ohne das Verhalten der
 * echten Datenbank zu veraendern — so laesst sich pruefen, ob der
 * `publicIdCache` einen zweiten Zugriff tatsaechlich erspart.
 */
function countingExecutor(onQuery: () => void): OutboxExecutor {
  return new Proxy(database as object, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (property === "select" && typeof value === "function") {
        return (...args: unknown[]) => {
          onQuery();
          return (value as (...innerArgs: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  }) as OutboxExecutor;
}

/** Broadcaster, der genau ein Ereignis nicht zustellen kann. */
function poisonedRecorder(
  poisonEventId: string,
): RealtimeBroadcaster & { readonly sent: Recorded[] } {
  const sent: Recorded[] = [];
  return {
    sent,
    emit(room, event, payload) {
      if (payload.eventId === poisonEventId) {
        throw new Error("Zustellung fehlgeschlagen");
      }
      sent.push({ room, event, payload });
    },
  };
}

const organizationId = randomUUID();
let tournamentId = "";
let tournamentPublicId = "";
let encounterId = "";
let encounterPublicId = "";
let encounterMatchId = "";
let tournamentMatchId = "";

beforeAll(async () => {
  await database.insert(organizations).values({
    id: organizationId,
    name: "Realtime Test",
    slug: `realtime-${organizationId.slice(0, 8)}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
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
  tournamentPublicId = tournament?.publicId ?? "";

  const [stage] = await database
    .insert(tournamentStages)
    .values({
      organizationId,
      tournamentId,
      key: "ko",
      sequence: 1,
      name: "Finale",
      type: "SINGLE_ELIMINATION",
      status: "OPEN",
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
      // Die Tabellenvorgaben allein (Bonus 1, Regel NONE) verletzen
      // competitions_decider_bonus_rule_check — der Bonus muss hier gesetzt
      // werden, obwohl dieser Test kein Entscheidungsdoppel braucht.
      pointsDeciderBonus: 0,
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
  encounterPublicId = encounter?.publicId ?? "";

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
    homePosition: 1,
    awayPosition: 1,
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

    await publishOutboxBatch(database, broadcaster, { logger: silentLogger });

    const delivered = broadcaster.sent.find((entry) => entry.payload.eventId === event?.id);
    expect(delivered?.room).toBe(`encounter:${encounterPublicId}`);
    expect(delivered?.event).toBe("encounter:changed");
    expect(delivered?.payload.eventType).toBe("ENCOUNTER_STARTED");
    expect(delivered?.payload.publicId).toBe(encounterPublicId);
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

    await publishOutboxBatch(database, broadcaster, { logger: silentLogger });

    expect(broadcaster.sent.map((entry) => entry.room)).toContain(
      `encounter:${encounterPublicId}`,
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

    await publishOutboxBatch(database, broadcaster, { logger: silentLogger });

    expect(broadcaster.sent.map((entry) => entry.room)).toContain(
      `tournament:${tournamentPublicId}`,
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

    await publishOutboxBatch(database, broadcaster, { logger: silentLogger });

    expect(broadcaster.sent.filter((entry) => entry.payload.eventId === event?.id)).toEqual([]);
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
    await publishOutboxBatch(database, first, { logger: silentLogger });
    const second = recorder();

    await publishOutboxBatch(database, second, { logger: silentLogger });

    // Nur die eigenen Raeume pruefen: der Poller arbeitet global, und
    // parallel laufende Testdateien schreiben in dieselbe Outbox.
    const ownRooms = (entries: readonly Recorded[]): readonly Recorded[] =>
      entries.filter((entry) => entry.room === `encounter:${encounterPublicId}`);
    expect(ownRooms(first.sent).length).toBeGreaterThan(0);
    expect(ownRooms(second.sent)).toEqual([]);
  });

  it("fragt die oeffentliche ID nur einmal je Turnier ab", async () => {
    // Ein frisches Turnier, damit der Cache garantiert noch keinen Eintrag
    // dafuer hat — andere Tests dieser Datei haben `tournamentId` laengst
    // aufgeloest.
    const [freshTournament] = await database
      .insert(tournaments)
      .values({
        organizationId,
        name: "Cache Cup",
        format: "SINGLE_ELIMINATION",
        groupCount: 1,
        qualifyPerGroup: 1,
        knockoutSize: 2,
        seeding: "RANDOM",
        startsAt: new Date("2026-09-03T18:00:00.000Z"),
      })
      .returning();
    const aggregateId = freshTournament?.id ?? "";
    let queries = 0;
    const executor = countingExecutor(() => {
      queries += 1;
    });

    await resolveScope(executor, { organizationId, aggregateType: "Tournament", aggregateId });
    await resolveScope(executor, { organizationId, aggregateType: "Tournament", aggregateId });

    expect(queries).toBe(1);
  });

  /**
   * Befund I8: der Poller las ohne `FOR UPDATE SKIP LOCKED`. Zwei Repliken
   * lasen denselben Stapel und sendeten jedes Ereignis zweimal — der Stempel
   * war idempotent, der Versand nicht. Zwanzig Ereignisse, damit das Fenster
   * zwischen Lesen und Stempeln im alten Verhalten sicher getroffen wird.
   */
  it("laesst eine zweite Replik denselben Stapel nicht ein zweites Mal senden", async () => {
    const created = await database
      .insert(outboxEvents)
      .values(
        Array.from({ length: 20 }, () => ({
          organizationId,
          aggregateType: "Match",
          aggregateId: encounterMatchId,
          eventType: "VISIT_RECORDED",
          payload: { matchId: encounterMatchId },
        })),
      )
      .returning({ id: outboxEvents.id });
    const own = new Set(created.map((row) => row.id));
    const first = recorder();
    const second = recorder();

    await Promise.all([
      publishOutboxBatch(database, first, { logger: silentLogger }),
      publishOutboxBatch(database, second, { logger: silentLogger }),
    ]);

    const delivered = [...first.sent, ...second.sent].filter((entry) => own.has(entry.payload.eventId ?? ""));
    expect(delivered).toHaveLength(20);
    expect(new Set(delivered.map((entry) => entry.payload.eventId)).size).toBe(20);
  }, 30_000);

  /**
   * At-least-once (Ruling 9): gesendet wird vor dem Stempeln, damit ein
   * Absturz zwischen Versand und Commit nichts verliert. Ein fehlschlagender
   * Sendevorgang darf trotzdem nicht die uebrigen Ereignisse des Stapels
   * verschlucken — er bleibt aber selbst ungestempelt, damit der naechste
   * Durchlauf ihn erneut versucht.
   *
   * Seit Befund F-1 wirft `publishOutboxBatch` dafuer kein `AggregateError`
   * mehr: der Fehlversuch wird stattdessen gebucht (Task 3, siehe
   * "publishOutboxBatch — Fehlerbehandlung" unten) und der Aufrufer muss
   * ihn nicht mehr per Exception erkennen.
   */
  it("sendet die uebrigen Ereignisse trotz eines fehlschlagenden Sendevorgangs, laesst das fehlgeschlagene aber ungestempelt", async () => {
    const created = await database
      .insert(outboxEvents)
      .values(
        Array.from({ length: 3 }, () => ({
          organizationId,
          aggregateType: "Encounter",
          aggregateId: encounterId,
          eventType: "ENCOUNTER_STARTED",
          payload: { encounterId },
        })),
      )
      .returning({ id: outboxEvents.id });
    const failingId = created[0]?.id ?? "";
    const succeedingIds = created.slice(1).map((row) => row.id);
    const sent: Recorded[] = [];
    const broadcaster: RealtimeBroadcaster = {
      emit(room, event, payload) {
        if (payload.eventId === failingId) {
          throw new Error("Verbindung verloren");
        }
        sent.push({ room, event, payload });
      },
    };

    await publishOutboxBatch(database, broadcaster, { logger: silentLogger });

    const ownDelivered = sent.filter((entry) =>
      created.some((row) => row.id === entry.payload.eventId),
    );
    expect(ownDelivered).toHaveLength(2);
    const stored = await database
      .select({ id: outboxEvents.id, publishedAt: outboxEvents.publishedAt })
      .from(outboxEvents)
      .where(
        inArray(
          outboxEvents.id,
          created.map((row) => row.id),
        ),
      );
    const failing = stored.find((row) => row.id === failingId);
    expect(failing?.publishedAt).toBeNull();
    const succeeding = stored.filter((row) => succeedingIds.includes(row.id));
    expect(succeeding.every((row) => row.publishedAt !== null)).toBe(true);
  });
});

describe("publishOutboxBatch — Fehlerbehandlung", () => {
  it("verteilt nachfolgende Ereignisse, obwohl eines fehlschlägt", async () => {
    const [poison] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Encounter",
        aggregateId: encounterId,
        eventType: "ENCOUNTER_STARTED",
        payload: { encounterId },
        occurredAt: new Date("2026-09-06T10:00:00.000Z"),
      })
      .returning();
    const [healthy] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Encounter",
        aggregateId: encounterId,
        eventType: "ENCOUNTER_COMPLETED",
        payload: { encounterId },
        occurredAt: new Date("2026-09-06T10:00:01.000Z"),
      })
      .returning();
    const broadcaster = poisonedRecorder(poison?.id ?? "");
    const logger = logRecorder();

    await publishOutboxBatch(database, broadcaster, { logger, limit: 500 });

    expect(
      broadcaster.sent.some((entry) => entry.payload.eventId === healthy?.id),
    ).toBe(true);
    const [storedHealthy] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, healthy?.id ?? ""));
    expect(storedHealthy?.publishedAt).not.toBeNull();
    const [storedPoison] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, poison?.id ?? ""));
    expect(storedPoison?.publishedAt).toBeNull();
    expect(storedPoison?.publishAttempts).toBe(1);
    expect(storedPoison?.publishNotBefore).not.toBeNull();
    expect(storedPoison?.publishLastError).toBe("Zustellung fehlgeschlagen");
    expect(logger.records.map((entry) => entry.fields.event)).toContain(
      "outbox.retry_scheduled",
    );
  });

  it("legt ein dauerhaft fehlschlagendes Ereignis nach OUTBOX_MAX_ATTEMPTS Versuchen ins Dead Letter", async () => {
    const start = new Date("2026-09-06T11:00:00.000Z");
    const [poison] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Encounter",
        aggregateId: encounterId,
        eventType: "ENCOUNTER_STARTED",
        payload: { encounterId },
        occurredAt: start,
      })
      .returning();
    const broadcaster = poisonedRecorder(poison?.id ?? "");
    const logger = logRecorder();

    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      const clock = new Date(start.getTime() + attempt * 600_000);
      await publishOutboxBatch(database, broadcaster, {
        logger,
        limit: 500,
        now: () => clock,
      });
    }

    const [stored] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, poison?.id ?? ""));
    expect(stored?.publishAttempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(stored?.publishDeadLetteredAt).not.toBeNull();
    expect(stored?.publishNotBefore).toBeNull();
    const deadLetter = logger.records.find(
      (entry) => entry.fields.event === "outbox.dead_letter",
    );
    expect(deadLetter?.level).toBe("error");
    expect(deadLetter?.fields).toMatchObject({
      consumer: "publish",
      eventId: poison?.id,
      eventType: "ENCOUNTER_STARTED",
      aggregateId: encounterId,
      attempts: OUTBOX_MAX_ATTEMPTS,
      lastError: "Zustellung fehlgeschlagen",
    });
  });

  it("zieht ein Ereignis im Dead Letter nicht mehr", async () => {
    const [dead] = await database
      .insert(outboxEvents)
      .values({
        organizationId,
        aggregateType: "Encounter",
        aggregateId: encounterId,
        eventType: "ENCOUNTER_COMPLETED",
        payload: { encounterId },
        publishAttempts: OUTBOX_MAX_ATTEMPTS,
        publishDeadLetteredAt: new Date("2026-09-06T12:00:00.000Z"),
        publishLastError: "Zustellung fehlgeschlagen",
      })
      .returning();
    const broadcaster = recorder();

    await publishOutboxBatch(database, broadcaster, {
      logger: silentLogger,
      limit: 500,
    });

    expect(
      broadcaster.sent.filter((entry) => entry.payload.eventId === dead?.id),
    ).toEqual([]);
    const [stored] = await database
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, dead?.id ?? ""));
    expect(stored?.publishedAt).toBeNull();
  });
  /**
   * `resolveScope` liegt im `try` je Ereignis — das genuegt aber nur fuer
   * JavaScript-Fehler. Ein Postgres-Fehler beendet die ganze Transaktion:
   * jede weitere Anweisung scheitert danach mit "current transaction is
   * aborted", also auch die Zuordnung der uebrigen Ereignisse und der
   * Stempel-`UPDATE`. Ein einzelnes kaputtes Ereignis kostete so den ganzen
   * Tick. Mit einem Savepoint je Ereignis kostet es nur sich selbst.
   */
  it("verliert bei einem Datenbankfehler in der Zuordnung nur das betroffene Ereignis", async () => {
    const created = await database
      .insert(outboxEvents)
      .values(
        Array.from({ length: 3 }, () => ({
          organizationId,
          aggregateType: "Encounter",
          aggregateId: encounterId,
          eventType: "ENCOUNTER_STARTED",
          payload: { encounterId },
        })),
      )
      .returning({ id: outboxEvents.id });
    const poisonId = created[0]?.id ?? "";
    const healthyIds = created.slice(1).map((row) => row.id);
    const broadcaster = recorder();
    const logger = logRecorder();

    await publishOutboxBatch(database, broadcaster, {
      logger,
      limit: 500,
      resolveScope: async (executor, event) => {
        if (event.id === poisonId) {
          // Ein echter Postgres-Fehler, nicht ein geworfenes JS-Objekt: nur
          // er vergiftet die Transaktion.
          await executor.execute(sql`select 1 / 0`);
        }
        return resolveScope(executor, event);
      },
    });

    const deliveredIds = broadcaster.sent
      .map((entry) => entry.payload.eventId ?? "")
      .filter((eventId) => created.some((row) => row.id === eventId));
    expect(deliveredIds.sort()).toEqual([...healthyIds].sort());

    const stored = await database
      .select({
        id: outboxEvents.id,
        publishedAt: outboxEvents.publishedAt,
        publishAttempts: outboxEvents.publishAttempts,
      })
      .from(outboxEvents)
      .where(
        inArray(
          outboxEvents.id,
          created.map((row) => row.id),
        ),
      );
    for (const row of stored) {
      if (row.id === poisonId) {
        expect(row.publishedAt).toBeNull();
        expect(row.publishAttempts).toBe(1);
      } else {
        expect(row.publishedAt).not.toBeNull();
      }
    }
  }, 30_000);
});
