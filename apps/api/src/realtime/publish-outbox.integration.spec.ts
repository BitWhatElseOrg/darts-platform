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
    await publishOutboxBatch(database, first);
    const second = recorder();

    await publishOutboxBatch(database, second);

    // Nur die eigenen Raeume pruefen: der Poller arbeitet global, und
    // parallel laufende Testdateien schreiben in dieselbe Outbox.
    const ownRooms = (entries: readonly Recorded[]): readonly Recorded[] =>
      entries.filter((entry) => entry.room === `encounter:${encounterId}`);
    expect(ownRooms(first.sent).length).toBeGreaterThan(0);
    expect(ownRooms(second.sent)).toEqual([]);
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

    await Promise.all([publishOutboxBatch(database, first), publishOutboxBatch(database, second)]);

    const delivered = [...first.sent, ...second.sent].filter((entry) => own.has(entry.payload.eventId ?? ""));
    expect(delivered).toHaveLength(20);
    expect(new Set(delivered.map((entry) => entry.payload.eventId)).size).toBe(20);
  }, 30_000);
});
