import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { parseApplicationEnvironment } from "@darts-platform/config";
import {
  competitions,
  createDatabaseConnection,
  encounterSlots,
  encounters,
  matches,
  organizations,
  teams,
} from "@darts-platform/database";

import { DatabaseService } from "../database/database.service.js";
import { lockEncounterScoringContext } from "./encounter-scoring-lock.js";

const environment = parseApplicationEnvironment(process.env);
const databaseService = new DatabaseService(environment);
/** Zweite Verbindung: sie haelt die Begegnungszeile, waehrend die erste zugreift. */
const holder = createDatabaseConnection(environment.DATABASE_URL);

const organizationId = randomUUID();
const encounterId = randomUUID();
let scoringMatchId = "";

/** Die Kennung des Treiberfehlers steht erst in der cause-Kette. */
function codeOf(error: unknown): string | null {
  for (let candidate: unknown = error, depth = 0; depth < 5; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return null;
    const row = candidate as { readonly code?: unknown; readonly cause?: unknown };
    if (typeof row.code === "string") return row.code;
    candidate = row.cause;
  }
  return null;
}

beforeAll(async () => {
  // Kaltstart der zweiten Verbindung vorwegnehmen: ohne diesen Warmlauf
  // gewinnt der Scoringpfad (bereits etablierte Verbindung) das Wettrennen um
  // die Begegnungszeile, weil `holder` erst hier den TCP-Handshake macht.
  await holder.check();
  const competitionId = randomUUID();
  const homeTeamId = randomUUID();
  const awayTeamId = randomUUID();
  await databaseService.database.insert(organizations).values({
    id: organizationId,
    name: "Lock Order Club",
    slug: `lock-order-${organizationId}`,
    timezone: "Europe/Zurich",
    locale: "de-CH",
  });
  await databaseService.database.insert(competitions).values({
    id: competitionId,
    organizationId,
    type: "LEAGUE",
    name: `Lock Order Liga ${competitionId}`,
    slug: `lock-order-${competitionId}`,
    status: "ACTIVE",
  });
  await databaseService.database.insert(teams).values([
    { id: homeTeamId, organizationId, name: `Heimteam ${homeTeamId}` },
    { id: awayTeamId, organizationId, name: `Gastteam ${awayTeamId}` },
  ]);
  await databaseService.database.insert(encounters).values({
    id: encounterId,
    organizationId,
    competitionId,
    matchday: 1,
    homeTeamId,
    awayTeamId,
    scheduledAt: new Date("2026-09-06T19:00:00.000Z"),
    status: "RUNNING",
  });
  const [created] = await databaseService.database
    .insert(matches)
    .values({ organizationId, bestOfLegs: 1, startingSeat: 1, currentSeat: 1 })
    .returning();
  if (created === undefined) throw new Error("Expected the scoring match.");
  scoringMatchId = created.id;
  await databaseService.database.insert(encounterSlots).values({
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
    maxRounds: null,
    bestOfLegs: 1,
    legsToWinSet: 1,
    setsToWin: 1,
    status: "IN_PROGRESS",
    matchId: scoringMatchId,
  });
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await holder.close();
  await databaseService.onApplicationShutdown();
});

describe("lockEncounterScoringContext", () => {
  /**
   * Befund I6: der Scoringpfad sperrte `matches` zuerst und die Begegnung erst
   * beim Slotabschluss, der Begegnungspfad genau andersherum — Postgres brach
   * eine der Transaktionen mit 40P01 ab, und der Client sah einen 500. Der
   * Test beweist die neue Reihenfolge: haelt jemand die Begegnungszeile, kommt
   * der Scoringpfad gar nicht erst an die Matchzeile.
   */
  it("nimmt die Begegnungszeile, bevor der Scoringpfad weiterlaeuft", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = holder.database.transaction(async (transaction) => {
      await transaction
        .select({ id: encounters.id })
        .from(encounters)
        .where(eq(encounters.id, encounterId))
        .for("update")
        .limit(1);
      await held;
    });

    const blocked = databaseService.database
      .transaction(async (transaction) => {
        await transaction.execute(sql`set local lock_timeout = '250ms'`);
        await lockEncounterScoringContext(transaction, organizationId, scoringMatchId);
      })
      .then(() => null, (error: unknown) => codeOf(error));

    // 55P03: lock_not_available. Ohne die vorgezogene Begegnungssperre liefe
    // die Funktion durch und der Test bekaeme `null`.
    await expect(blocked).resolves.toBe("55P03");

    release?.();
    await holding;
  }, 30_000);

  it("laesst ein Match ohne Begegnungsbezug unberuehrt durch", async () => {
    const [standalone] = await databaseService.database
      .insert(matches)
      .values({ organizationId, bestOfLegs: 1, startingSeat: 1, currentSeat: 1 })
      .returning();
    if (standalone === undefined) throw new Error("Expected the standalone match.");

    await expect(
      databaseService.database.transaction(async (transaction) => {
        await transaction.execute(sql`set local lock_timeout = '250ms'`);
        await lockEncounterScoringContext(transaction, organizationId, standalone.id);
      }),
    ).resolves.toBeUndefined();
  }, 30_000);
});
