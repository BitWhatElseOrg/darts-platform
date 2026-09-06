import { z } from "zod";

export const careerStatisticsSchema = z.object({
  matchesPlayed: z.number().int().nonnegative(), wins: z.number().int().nonnegative(), losses: z.number().int().nonnegative(),
  threeDartAverage: z.number().nonnegative(), firstNineAverage: z.number().nonnegative(),
  // Unter Straight Out (Reglement 1.1, Klasse C) ist die Quote nicht definiert.
  checkoutPercentage: z.number().min(0).max(100).nullable(),
  checkoutAttempts: z.number().int().nonnegative().nullable(),
  checkouts: z.number().int().nonnegative().nullable(),
  oneEighties: z.number().int().nonnegative(),
  highFinish: z.number().int().nonnegative(), bestLeg: z.number().int().positive().nullable(), dartsPerLeg: z.number().nonnegative(),
});
export const playerStatisticsProfileSchema = z.object({
  player: z.object({ id: z.uuid(), publicId: z.uuid(), displayName: z.string(), nickname: z.string().nullable(), status: z.enum(["ACTIVE", "INACTIVE"]) }),
  career: careerStatisticsSchema,
  matchHistory: z.array(z.object({ matchId: z.uuid(), playedAt: z.coerce.date(), opponentPlayerId: z.uuid(), opponentDisplayName: z.string(), won: z.boolean(), legsWon: z.number().int().nonnegative(), legsLost: z.number().int().nonnegative(), setsWon: z.number().int().nonnegative(), setsLost: z.number().int().nonnegative(), threeDartAverage: z.number().nonnegative() })),
  headToHead: z.array(z.object({ opponentPlayerId: z.uuid(), opponentDisplayName: z.string(), matchesPlayed: z.number().int().positive(), wins: z.number().int().nonnegative(), losses: z.number().int().nonnegative() })),
  rankingHistory: z.array(z.object({ matchId: z.uuid(), recordedAt: z.coerce.date(), rating: z.number().int().positive() })),
  generatedAt: z.coerce.date(),
});
export type PlayerStatisticsProfile = z.infer<typeof playerStatisticsProfileSchema>;

export const frequentScoresSourceSchema = z.enum(["PLAYER", "ORGANIZATION", "DEFAULT"]);
export const frequentScoresSchema = z.object({
  scores: z.array(z.number().int().min(0).max(180)).max(6),
  source: frequentScoresSourceSchema,
});
export type FrequentScores = z.infer<typeof frequentScoresSchema>;
