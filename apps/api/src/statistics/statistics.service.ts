import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { calculatePlayerStatistics, type StatisticsMatch } from "@darts-platform/statistics";
import { frequentScoresSchema, playerStatisticsProfileSchema, type FrequentScores, type PlayerStatisticsProfile } from "@darts-platform/schemas";
import type { AuthContext } from "../auth/auth.types.js";
import { MatchesRepository } from "../matches/matches.repository.js";
import { OrganizationAccessService } from "../organizations/organization-access.service.js";
import { StatisticsRepository } from "./statistics.repository.js";

/** Fallback-Werte, wenn weder Spieler noch Organisation genug Aufnahmen fuer eine Auswertung haben. */
const DEFAULT_SCORES = [26, 41, 45, 60, 81, 85] as const;
/** Ab dieser Aufnahmenanzahl gelten die eigenen Werte einer Person als aussagekraeftig genug. */
const MINIMUM_VISITS = 30;

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
    const statesById = await this.matches.getStates(input.organizationId, data.matchIds);
    const states = data.matchIds.map((matchId) => statesById.get(matchId) ?? null);
    const statisticsMatches: StatisticsMatch[] = states.flatMap((state) => {
      if (state === null || state.winnerPlayerId === null) return [];
      const matchLegs = data.legs.filter((leg) => leg.matchId === state.id);
      const [first, second] = state.participants;
      // state.participants ist nach Sitz sortiert; ein Sitz traegt hier genau eine Person.
      const playerOfSeat = (seat: number | null): string | null =>
        seat === null ? null : (seat === 1 ? first.playerId : second.playerId);
      return [{
        id: state.id,
        completedAt: state.updatedAt,
        winnerPlayerId: state.winnerPlayerId,
        participants: [
          { playerId: first.playerId, displayName: first.displayName, legsWon: first.legsWon, setsWon: first.setsWon },
          { playerId: second.playerId, displayName: second.displayName, legsWon: second.legsWon, setsWon: second.setsWon },
        ],
        legs: matchLegs.map((leg) => ({ id: leg.id, winnerPlayerId: playerOfSeat(leg.winnerSeat) })),
        visits: data.visits.filter((visit) => visit.matchId === state.id).map((visit) => ({ legId: visit.legId, playerId: visit.throwerPlayerId, appliedPoints: visit.appliedPoints, dartsThrown: visit.dartsThrown, checkoutAttempts: visit.checkoutAttempts, outcome: visit.outcome as "SCORED" | "BUST" | "LEG_WON" | "SET_WON" | "MATCH_WON", reverted: visit.revertedAt !== null })),
      }];
    });
    const aggregate = calculatePlayerStatistics(input.playerId, statisticsMatches);
    return playerStatisticsProfileSchema.parse({
      player: { id: data.player.id, publicId: data.player.publicId, displayName: data.player.displayName, nickname: data.player.nickname, status: data.player.status },
      ...aggregate,
      generatedAt: new Date(),
    });
  }

  /**
   * Die Schnellwerte fuer das Runden-Keypad: bevorzugt die haeufigsten
   * Aufnahmesummen der Person selbst, sonst der Organisation, sonst ein
   * fixer Default-Satz. `getData` waere hier ueberdimensioniert - das laedt
   * alle Matches, Legs und Visits der Person, nur um ihre Existenz zu klaeren.
   */
  public async frequentScores(input: { readonly organizationId: string; readonly playerId: string; readonly auth: AuthContext }): Promise<FrequentScores> {
    await this.access.requirePermission({ organizationId: input.organizationId, userId: input.auth.user.id, permission: "statistics:read" });
    if (!(await this.repository.playerExists(input.organizationId, input.playerId))) {
      throw new NotFoundException("Spieler nicht gefunden.");
    }
    const own = await this.repository.visitCount(input.organizationId, input.playerId);
    const rows =
      own >= MINIMUM_VISITS
        ? await this.repository.frequentScores({ organizationId: input.organizationId, playerId: input.playerId, limit: 6 })
        : await this.repository.frequentScores({ organizationId: input.organizationId, playerId: null, limit: 6 });
    const source = rows.length < 6 ? "DEFAULT" : own >= MINIMUM_VISITS ? "PLAYER" : "ORGANIZATION";
    const scores = source === "DEFAULT" ? [...DEFAULT_SCORES] : rows.map((row) => row.points).sort((a, b) => a - b);
    return frequentScoresSchema.parse({ scores, source });
  }
}
