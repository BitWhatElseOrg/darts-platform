import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { parseApplicationEnvironment } from "@darts-platform/config";
import { competitions, memberships, organizations, players, teams, users } from "@darts-platform/database";
import type { CompetitionSlotInput } from "@darts-platform/schemas";

import type { AuthContext } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import { EncountersRepository } from "../encounters/encounters.repository.js";
import { EncountersService } from "../encounters/encounters.service.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { OrganizationsRepository } from "../organizations/organizations.repository.js";
import { CompetitionsRepository } from "./competitions.repository.js";
import { CompetitionsService } from "./competitions.service.js";

const databaseService = new DatabaseService(parseApplicationEnvironment(process.env));
const access = new OrganizationAccessService(new OrganizationsRepository(databaseService));
const service = new CompetitionsService(new CompetitionsRepository(databaseService), access);
const encountersService = new EncountersService(new EncountersRepository(databaseService), access);

const organizationId = randomUUID();
const userId = randomUUID();
const homeTeamId = randomUUID();
const awayTeamId = randomUUID();
const playerIds = Array.from({ length: 8 }, () => randomUUID());

const auth: AuthContext = {
  user: { id: userId, email: `competition-${userId}@example.test`, name: "Competition Owner" },
  session: { id: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
};
const audit = { correlationId: randomUUID(), ip: "127.0.0.1", userAgent: "vitest" } as const;

const distance = {
  startingScore: 501 as const,
  inRule: "STRAIGHT" as const,
  outRule: "DOUBLE" as const,
  maxRounds: null,
  bestOfLegs: 3,
  legsToWinSet: 2,
  setsToWin: 1,
};

/** Zwei Aufstellungspositionen: vier Einzel, ein Doppel, ein Entscheidungsdoppel. */
function template(): CompetitionSlotInput[] {
  const slots: CompetitionSlotInput[] = [];
  let sequence = 1;
  for (let home = 1; home <= 2; home += 1) {
    for (let away = 1; away <= 2; away += 1) {
      slots.push({
        sequence,
        role: "REGULAR",
        discipline: "SINGLES",
        label: `Einzel ${home}-${away}`,
        homePosition: home,
        awayPosition: away,
        ...distance,
      });
      sequence += 1;
    }
  }
  slots.push({ sequence, role: "REGULAR", discipline: "DOUBLES", label: "Doppel", homePosition: null, awayPosition: null, ...distance });
  slots.push({ sequence: sequence + 1, role: "DECIDER", discipline: "DOUBLES", label: "Entscheidungsdoppel", homePosition: null, awayPosition: null, ...distance });
  return slots;
}

async function create(slots: CompetitionSlotInput[] = template()): Promise<string> {
  const competition = await service.create({
    organizationId,
    data: {
      type: "LEAGUE",
      name: `Liga ${randomUUID().slice(0, 8)}`,
      slug: `liga-${randomUUID()}`,
      status: "ACTIVE",
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      pointsDeciderBonus: 1,
      deciderRule: "EXTRA_SLOT",
      lineupPositions: 2,
      minNominations: 2,
      minNominationsShorthanded: 1,
      maxSubstitutionsPerEncounter: 4,
      maxDoublesPerPlayer: 1,
      slots,
    },
    auth,
    audit,
  });
  return competition.id;
}

beforeAll(async () => {
  await databaseService.database.insert(users).values({ id: userId, email: auth.user.email, displayName: auth.user.name });
  await databaseService.database.insert(organizations).values({ id: organizationId, name: "Competition Club", slug: `competition-${organizationId}`, timezone: "Europe/Zurich", locale: "de-CH" });
  await databaseService.database.insert(memberships).values({ organizationId, userId, role: "OWNER", status: "ACTIVE" });
  await databaseService.database.insert(players).values(
    playerIds.map((id, index) => ({ id, organizationId, displayName: `Wettbewerb ${index + 1}`, status: "ACTIVE" })),
  );
  await databaseService.database.insert(teams).values([
    { id: homeTeamId, organizationId, name: `Heim ${homeTeamId.slice(0, 8)}`, status: "ACTIVE" },
    { id: awayTeamId, organizationId, name: `Gast ${awayTeamId.slice(0, 8)}`, status: "ACTIVE" },
  ]);
});

afterAll(async () => {
  await databaseService.database.delete(organizations).where(eq(organizations.id, organizationId));
  await databaseService.database.delete(users).where(eq(users.id, userId));
  await databaseService.onApplicationShutdown();
});

describe("competitions and their encounter template", () => {
  it("stores the template and derives the slot count", async () => {
    const competitionId = await create();
    const competition = await service.get({ organizationId, competitionId, auth });
    expect(competition.slotCount).toBe(6);
    expect(competition.encounterCount).toBe(0);
    expect(competition.version).toBe(0);
    expect(competition.slots.map((slot) => slot.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(competition.slots.at(-1)).toMatchObject({ role: "DECIDER", discipline: "DOUBLES" });
  }, 30_000);

  it("refuses an incomplete round robin with the code from the spec", async () => {
    const incomplete = template().filter((slot) => slot.sequence !== 4);
    const renumbered = incomplete.map((slot, index) => ({ ...slot, sequence: index + 1 }));
    await expect(create(renumbered)).rejects.toMatchObject({
      response: { code: "TEMPLATE_ROUND_ROBIN_INCOMPLETE" },
      status: 422,
    });
  }, 30_000);

  it("refuses a decider that is not the last slot", async () => {
    const slots = template();
    const misplaced = slots.map((slot) =>
      slot.sequence === 5 ? { ...slot, role: "DECIDER" as const } : slot,
    );
    await expect(create(misplaced)).rejects.toMatchObject({
      response: { code: "TEMPLATE_INVALID" },
      status: 422,
    });
  }, 30_000);

  it("refuses an even leg distance before touching the database", async () => {
    const slots = template().map((slot) => ({ ...slot, bestOfLegs: 3, legsToWinSet: 3 }));
    await expect(create(slots)).rejects.toMatchObject({
      response: { code: "TEMPLATE_INVALID" },
      status: 422,
    });
  }, 30_000);

  it("refuses a duplicate slug in the same organization", async () => {
    const slug = `liga-${randomUUID()}`;
    const payload = {
      type: "LEAGUE" as const,
      name: "Doppelte Liga",
      slug,
      status: "DRAFT" as const,
      pointsWin: 3,
      pointsDraw: 1,
      pointsLoss: 0,
      pointsDeciderBonus: 0,
      deciderRule: "NONE" as const,
      lineupPositions: 2,
      minNominations: 2,
      minNominationsShorthanded: 1,
      maxSubstitutionsPerEncounter: 4,
      maxDoublesPerPlayer: 1,
      slots: template().filter((slot) => slot.role !== "DECIDER"),
    };
    await service.create({ organizationId, data: payload, auth, audit });
    await expect(service.create({ organizationId, data: payload, auth, audit })).rejects.toMatchObject({
      response: { code: "COMPETITION_SLUG_TAKEN" },
    });
  }, 30_000);

  it("bumps the version and rejects a stale update", async () => {
    const competitionId = await create();
    const renamed = await service.update({
      organizationId,
      competitionId,
      data: { commandId: randomUUID(), expectedVersion: 0, name: "Nationalliga A" },
      auth,
      audit,
    });
    expect(renamed).toMatchObject({ name: "Nationalliga A", version: 1 });

    await expect(
      service.update({
        organizationId,
        competitionId,
        data: { commandId: randomUUID(), expectedVersion: 0, name: "Zu spät" },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "COMPETITION_VERSION_CONFLICT" } });
  }, 30_000);

  /**
   * Die Kopie in `encounter_slots` schützt bereits angesetzte Begegnungen; die
   * Sperre verhindert, dass eine laufende Saison ihre Vorlage unter sich
   * wegzieht.
   */
  it("locks the template once an encounter of the competition runs", async () => {
    const competitionId = await create();
    const encounter = await encountersService.schedule({
      organizationId,
      competitionId,
      data: {
        matchday: 1,
        homeTeamId,
        awayTeamId,
        scheduledAt: new Date("2026-09-18T19:30:00.000Z"),
        venue: null,
      },
      auth,
      audit,
    });

    // Solange die Begegnung nur angesetzt ist, bleibt die Vorlage änderbar.
    const shortened = await service.update({
      organizationId,
      competitionId,
      data: { commandId: randomUUID(), expectedVersion: 0, slots: template() },
      auth,
      audit,
    });
    expect(shortened.slotCount).toBe(6);
    expect(shortened.encounterCount).toBe(1);

    await encountersService.declareForfeit({
      organizationId,
      encounterId: encounter.id,
      data: {
        commandId: randomUUID(),
        expectedVersion: encounter.version,
        forfeitSide: "AWAY",
        reason: "Mannschaft nicht angetreten.",
      },
      auth,
      audit,
    });

    await expect(
      service.update({
        organizationId,
        competitionId,
        data: { commandId: randomUUID(), expectedVersion: 1, slots: template() },
        auth,
        audit,
      }),
    ).rejects.toMatchObject({ response: { code: "COMPETITION_TEMPLATE_LOCKED" } });

    // Ohne Slots bleibt der Wettbewerb weiterhin pflegbar.
    const renamed = await service.update({
      organizationId,
      competitionId,
      data: { commandId: randomUUID(), expectedVersion: 1, status: "COMPLETED" },
      auth,
      audit,
    });
    expect(renamed.status).toBe("COMPLETED");
  }, 30_000);

  /**
   * Befund aus Phase 5: die Vorgaben von `points_decider_bonus` und
   * `decider_rule` widersprachen der eigenen Check-Constraint, sodass ein
   * INSERT allein aus den Vorgaben unmöglich war. Über die API fiel das nie
   * auf, weil das Repository beide Werte immer explizit setzt.
   */
  it("inserts a competition row from the table defaults alone", async () => {
    const inserted = await databaseService.database
      .insert(competitions)
      .values({
        organizationId,
        type: "LEAGUE",
        name: "Nur Vorgaben",
        slug: `nur-vorgaben-${randomUUID()}`,
        status: "DRAFT",
      })
      .returning({ id: competitions.id, pointsDeciderBonus: competitions.pointsDeciderBonus });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.pointsDeciderBonus).toBe(0);
  }, 30_000);
});
