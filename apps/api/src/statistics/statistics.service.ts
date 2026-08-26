import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { calculatePlayerStatistics, type StatisticsMatch } from "@darts-platform/statistics";
import { playerStatisticsProfileSchema, type PlayerStatisticsProfile } from "@darts-platform/schemas";
import type { AuthContext } from "../auth/auth.types.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { StatisticsRepository } from "./statistics.repository.js";

@Injectable()
export class StatisticsService {
  public constructor(
    @Inject(StatisticsRepository) private readonly repository: StatisticsRepository,
    @Inject(MatchesRepository) private readonly matches: MatchesRepository,
    @Inject(OrganizationAccessService) private readonly access: OrganizationAccessService,
  ) {}

  public async profile(input: { readonly organizationId: string; readonly playerId: string; readonly auth: AuthContext }): Promise<PlayerStatisticsProfile> {
    await this.access.requirePermission({ organizationId: input.organizationId, userId: input.auth.user.id, permission: "statistics:read" });
    const data = await this.repository.getData(input.organizationId, input.playerId);
    if (data === null) throw new NotFoundException("Spieler nicht gefunden.");
    const states = await Promise.all(data.matchIds.map((matchId) => this.matches.getState(input.organizationId, matchId)));
    const statisticsMatches: StatisticsMatch[] = states.flatMap((state) => {
      if (state === null || state.winnerPlayerId === null) return [];
      const matchLegs = data.legs.filter((leg) => leg.matchId === state.id);
      const [first, second] = state.participants;
      return [{
        id: state.id,
        completedAt: state.updatedAt,
        winnerPlayerId: state.winnerPlayerId,
        participants: [
          { playerId: first.playerId, displayName: first.displayName, legsWon: first.legsWon, setsWon: first.setsWon },
          { playerId: second.playerId, displayName: second.displayName, legsWon: second.legsWon, setsWon: second.setsWon },
        ],
        legs: matchLegs.map((leg) => ({ id: leg.id, winnerPlayerId: leg.winnerPlayerId })),
        visits: data.visits.filter((visit) => visit.matchId === state.id).map((visit) => ({ legId: visit.legId, playerId: visit.playerId, appliedPoints: visit.appliedPoints, dartsThrown: visit.dartsThrown, checkoutAttempts: visit.checkoutAttempts, outcome: visit.outcome as "SCORED" | "BUST" | "LEG_WON" | "SET_WON" | "MATCH_WON", reverted: visit.revertedAt !== null })),
      }];
    });
    const aggregate = calculatePlayerStatistics(input.playerId, statisticsMatches);
    return playerStatisticsProfileSchema.parse({
      player: { id: data.player.id, publicId: data.player.publicId, displayName: data.player.displayName, nickname: data.player.nickname, status: data.player.status },
      ...aggregate,
      generatedAt: new Date(),
    });
  }
}
