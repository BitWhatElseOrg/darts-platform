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
  type Database,
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

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function currentBackendPid(transaction: DatabaseTransaction): Promise<number> {
  const [row] = await transaction.execute(sql<{ readonly pid: number }>`select pg_backend_pid() as pid`);
  if (row === undefined || typeof row.pid !== "number") throw new Error("Expected PostgreSQL backend PID.");
  return row.pid;
}

/**
 * Wartet deterministisch, bis `backendPid` wegen `blockingBackendPid` auf
 * `relation` blockiert ist. Kopie aus `tournament-scoring-lock.integration.spec.ts`
 * (dort ebenfalls lokal, nicht geteilt — diesem Repository-Muster folgt auch
 * diese Datei). Ohne diese Barriere ist der Start zweier Transaktionen ein
 * Wettrennen: je nachdem, welche Verbindung kalt oder warm ist, gewinnt mal
 * die eine, mal die andere Seite, und der Test wird flaky statt aussagekraeftig.
 */
async function waitForBackendToBlockOnRelation(input: {
  readonly database: Database;
  readonly backendPid: number;
  readonly blockingBackendPid: number;
  readonly relation: "encounters";
}): Promise<void> {
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    const waiting = await input.database.execute(sql`
      select activity.pid
      from pg_stat_activity as activity
      where activity.pid = ${input.backendPid}
        and activity.wait_event_type = 'Lock'
        and ${input.blockingBackendPid} = any(pg_blocking_pids(activity.pid))
        and activity.query like ${`%${input.relation}%`}
      limit 1
    `);
    if (waiting.length === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Backend did not block on ${input.relation}.`);
}

interface LockRow {
  readonly relation: string;
  readonly locktype: string;
  readonly mode: string;
  readonly granted: boolean;
}

/**
 * Zeigt, welche Tabellen- oder Zeilensperren `pid` gerade auf `encounters`,
 * `encounter_slots` und `matches` haelt. Das beweist die Reihenfolge direkter
 * als das blosse Blockieren auf `encounters`: eine Implementierung, die zuerst
 * `encounter_slots` sperrt und danach `encounters`, wuerde am Ende ebenfalls
 * auf `encounters` blockieren — pg_locks zeigt aber, ob vorher schon eine
 * gewaehrte Schreibsperre auf Slot oder Match stand. Der eigentliche
 * Zeilen-Wartezustand selbst laeuft ueber `transactionid`-Sperren
 * (`waitingTransactionId` unten), nicht ueber diese `relation`-gebundenen
 * Eintraege — ein wartendes `SELECT ... FOR UPDATE` erzeugt hier keine eigene
 * Zeile mit `granted = false`.
 */
/**
 * `execute()` liefert Zeilen roh als `Record<string, unknown>` zurueck; das
 * Typargument von `sql<T>` steuert dabei nicht die tatsaechliche Form. Diese
 * Funktion prueft die erwarteten Spalten zur Laufzeit, statt sich blind auf
 * einen Typ zu verlassen.
 */
function toLockRow(row: Record<string, unknown>): LockRow {
  const { relation, locktype, mode, granted } = row;
  if (typeof relation !== "string" || typeof locktype !== "string" || typeof mode !== "string" || typeof granted !== "boolean") {
    throw new Error("Unexpected pg_locks row shape.");
  }
  return { relation, locktype, mode, granted };
}

async function lockRowsForBackend(database: Database, pid: number): Promise<readonly LockRow[]> {
  const rows = await database.execute(sql`
    select pg_class.relname as relation, pg_locks.locktype, pg_locks.mode, pg_locks.granted
    from pg_locks
    join pg_class on pg_class.oid = pg_locks.relation
    where pg_locks.pid = ${pid}
      and pg_class.relname in ('encounters', 'encounter_slots', 'matches')
  `);
  return rows.map(toLockRow);
}

/** `transactionid` (xid) kommt vom Treiber als String oder Number zurueck. */
function toTransactionId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

/**
 * Die Wartezeile eines `SELECT ... FOR UPDATE` haengt nicht an der Relation,
 * sondern an der Transaktions-ID der haltenden Transaktion (Postgres wartet
 * intern per `XactLockTableWait` auf deren xid). Liefert die `transactionid`,
 * auf die `pid` mit einer ungewaehrten Sperre wartet, oder `null`.
 */
async function waitingTransactionId(database: Database, pid: number): Promise<string | null> {
  const [row] = await database.execute(sql`
    select transactionid
    from pg_locks
    where pid = ${pid} and locktype = 'transactionid' and granted = false
    limit 1
  `);
  return row === undefined ? null : toTransactionId(row.transactionid);
}

/** Prueft, ob `pid` die angegebene Transaktions-ID selbst haelt (`granted = true`). */
async function holdsTransactionId(database: Database, pid: number, transactionId: string): Promise<boolean> {
  const [row] = await database.execute(sql`
    select transactionid
    from pg_locks
    where pid = ${pid} and locktype = 'transactionid' and granted = true and transactionid = ${transactionId}
    limit 1
  `);
  return row !== undefined;
}

beforeAll(async () => {
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
   * Test beweist die neue Reihenfolge ueber `pg_locks`, nicht nur ueber
   * Blockieren: haelt jemand die Begegnungszeile, steht der Scoringpfad davor
   * an, ohne vorher schon eine Schreibsperre auf Slot oder Match gehalten zu
   * haben.
   */
  it("nimmt die Begegnungszeile, bevor der Scoringpfad Slot oder Match beruehrt", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holderLocked!: () => void;
    const holderIsLocked = new Promise<void>((resolve) => {
      holderLocked = resolve;
    });
    let holderBackendPid!: number;
    const holding = holder.database.transaction(async (transaction) => {
      holderBackendPid = await currentBackendPid(transaction);
      await transaction
        .select({ id: encounters.id })
        .from(encounters)
        .where(eq(encounters.id, encounterId))
        .for("update")
        .limit(1);
      holderLocked();
      await held;
    });
    await holderIsLocked;

    let scoringBackendStarted!: (backendPid: number) => void;
    const scoringBackendStartedPromise = new Promise<number>((resolve) => {
      scoringBackendStarted = resolve;
    });
    const scoring = databaseService.database.transaction(async (transaction) => {
      scoringBackendStarted(await currentBackendPid(transaction));
      await lockEncounterScoringContext(transaction, organizationId, scoringMatchId);
    });

    const scoringBackendPid = await scoringBackendStartedPromise;
    await waitForBackendToBlockOnRelation({
      database: databaseService.database,
      backendPid: scoringBackendPid,
      blockingBackendPid: holderBackendPid,
      relation: "encounters",
    });

    // Positiv: der Scoringpfad wartet nicht irgendwo, sondern genau auf die
    // Transaktion, die die Begegnungszeile haelt.
    const waitingOn = await waitingTransactionId(databaseService.database, scoringBackendPid);
    expect(waitingOn).not.toBeNull();
    if (waitingOn !== null) {
      await expect(holdsTransactionId(databaseService.database, holderBackendPid, waitingOn)).resolves.toBe(true);
    }

    // Negativ: er hat Slot oder Match noch nicht mit einer Schreibsperre
    // beruehrt. Genau das unterscheidet die richtige von der falschen
    // Reihenfolge, die am Ende ebenfalls auf `encounters` blockieren wuerde.
    const locks = await lockRowsForBackend(databaseService.database, scoringBackendPid);
    const slotOrMatchLocks = locks.filter(
      (lock) => lock.relation === "encounter_slots" || lock.relation === "matches",
    );
    expect(
      slotOrMatchLocks.every(
        (lock) => lock.locktype !== "tuple" && lock.mode !== "RowExclusiveLock" && lock.mode !== "RowShareLock",
      ),
    ).toBe(true);

    release?.();
    await holding;
    await expect(scoring).resolves.toBeUndefined();
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
