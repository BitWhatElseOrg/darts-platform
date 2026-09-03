import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";
import { legs, matches, matchParticipantPlayers, players, visits } from "@darts-platform/database";
import { DatabaseService } from "../database/database.service.js";

@Injectable()
export class StatisticsRepository {
  public constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  public async getData(organizationId: string, playerId: string) {
    const [player] = await this.database.database.select().from(players).where(and(eq(players.organizationId, organizationId), eq(players.id, playerId))).limit(1);
    if (player === undefined) return null;
    const matchRows = await this.database.database
      .select({ id: matches.id })
      .from(matchParticipantPlayers)
      .innerJoin(matches, and(eq(matches.id, matchParticipantPlayers.matchId), eq(matches.organizationId, organizationId)))
      .where(and(eq(matchParticipantPlayers.organizationId, organizationId), eq(matchParticipantPlayers.playerId, playerId), eq(matches.status, "COMPLETED")))
      .orderBy(asc(matches.completedAt));
    const matchIds = matchRows.map((row) => row.id);
    if (matchIds.length === 0) return { player, matchIds, legs: [], visits: [] };
    const [legRows, visitRows] = await Promise.all([
      this.database.database.select().from(legs).where(and(eq(legs.organizationId, organizationId), inArray(legs.matchId, matchIds))).orderBy(asc(legs.legNumber)),
      this.database.database.select().from(visits).where(and(eq(visits.organizationId, organizationId), inArray(visits.matchId, matchIds))).orderBy(asc(visits.sequence)),
    ]);
    return { player, matchIds, legs: legRows, visits: visitRows };
  }
}
