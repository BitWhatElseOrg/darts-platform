import { z } from "zod";

export const clubSideSchema = z.enum(["A", "B"]);

export const clubDuelParticipantInputSchema = z.object({
  playerId: z.uuid(),
  side: clubSideSchema,
});

/** Grenzen wie `CLUB_DUEL_LIMITS` in der Engine (Spec, Entscheide). */
export const clubDuelSettingsSchema = z.object({
  sideAName: z.string().trim().min(1).max(120),
  sideBName: z.string().trim().min(1).max(120),
  qualifyingRounds: z.number().int().min(1).max(15),
  finalRoundSize: z.number().int().min(2).max(6),
  thirdPlaceMatch: z.boolean().default(true),
});

export const clubDuelPreviewInputSchema = clubDuelSettingsSchema.pick({ qualifyingRounds: true, finalRoundSize: true, thirdPlaceMatch: true }).extend({
  sideACount: z.number().int().min(1).max(256),
  sideBCount: z.number().int().min(1).max(256),
  boardCount: z.number().int().min(1).max(64),
  bestOfLegs: z.number().int().min(1).max(21),
});

export const clubDuelPreviewSchema = z.object({
  qualifyingMatches: z.number().int().nonnegative(),
  finalRoundMatches: z.number().int().nonnegative(),
  finalMatches: z.number().int().nonnegative(),
  totalMatches: z.number().int().nonnegative(),
  matchesPerPlayer: z.object({
    sideA: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }),
    sideB: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }),
  }),
  estimatedMinutes: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export const clubStandingRowSchema = z.object({
  position: z.number().int().positive(),
  playerId: z.uuid(),
  displayName: z.string(),
  side: clubSideSchema,
  played: z.number().int().nonnegative(),
  won: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
  legsFor: z.number().int().nonnegative(),
  legsAgainst: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1),
  legDifferencePerMatch: z.number(),
  withdrawn: z.boolean(),
  /** Platz in der Finalrunde nach aktuellem Stand (nur Rangliste je Verein). */
  qualified: z.boolean(),
});

export const clubCrossStandingRowSchema = z.object({
  position: z.number().int().positive(),
  playerId: z.uuid(),
  displayName: z.string(),
  side: clubSideSchema,
  played: z.number().int().nonnegative(),
  won: z.number().int().nonnegative(),
  legDifference: z.number().int(),
  qualifyingRank: z.number().int().positive(),
});

export const clubCrossMatchSchema = z.object({
  matchId: z.uuid(),
  round: z.number().int().positive(),
  rankA: z.number().int().positive(),
  rankB: z.number().int().positive(),
  playerAId: z.uuid().nullable(),
  playerBId: z.uuid().nullable(),
  status: z.enum(["WAITING", "READY", "IN_PROGRESS", "COMPLETED", "BYE", "CANCELLED"]),
  winnerPlayerId: z.uuid().nullable(),
  /** Legs [A, B]; null solange nicht gespielt oder Walkover. */
  legs: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable(),
});

const clubMatchStatusSchema = z.enum(["WAITING", "READY", "IN_PROGRESS", "COMPLETED", "BYE", "CANCELLED"]);

/** Match einer Quali-Runde oder des Finals, immer aus Sicht A/B (nicht participantOne/Two). */
export const clubRoundMatchSchema = z.object({
  matchId: z.uuid(),
  position: z.number().int().positive(),
  playerAId: z.uuid().nullable(),
  playerBId: z.uuid().nullable(),
  status: clubMatchStatusSchema,
  resultType: z.enum(["PLAYED", "WALKOVER", "BYE"]).nullable(),
  winnerPlayerId: z.uuid().nullable(),
  /** Legs [A, B]; null solange nicht gespielt oder Walkover. */
  legs: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable(),
});

export const clubFinalMatchSchema = clubRoundMatchSchema;

export const clubScoreSchema = z.object({
  pointsA: z.number().int().nonnegative(),
  pointsB: z.number().int().nonnegative(),
  legDifferenceA: z.number().int(),
  leader: z.enum(["A", "B", "TIED"]),
});

export const clubDuelDashboardSchema = clubDuelSettingsSchema.extend({
  /** Höchste bisher gepaarte Quali-Runde. */
  currentRound: z.number().int().nonnegative(),
  rounds: z.array(z.object({
    round: z.number().int().positive(),
    matchIds: z.array(z.uuid()),
    matches: z.array(clubRoundMatchSchema),
    pausedPlayerIds: z.array(z.uuid()),
  })),
  standings: z.object({
    overall: z.array(clubStandingRowSchema),
    sideA: z.array(clubStandingRowSchema),
    sideB: z.array(clubStandingRowSchema),
  }),
  finalRound: z.object({
    sideA: z.array(clubCrossStandingRowSchema),
    sideB: z.array(clubCrossStandingRowSchema),
    matches: z.array(clubCrossMatchSchema),
  }),
  finals: z.object({
    final: clubFinalMatchSchema.nullable(),
    thirdPlace: clubFinalMatchSchema.nullable(),
  }),
  score: clubScoreSchema,
});

export type ClubSide = z.infer<typeof clubSideSchema>;
export type ClubDuelPreviewInput = z.infer<typeof clubDuelPreviewInputSchema>;
export type ClubDuelPreviewResponse = z.infer<typeof clubDuelPreviewSchema>;
export type ClubDuelDashboard = z.infer<typeof clubDuelDashboardSchema>;
export type ClubStandingRowResponse = z.infer<typeof clubStandingRowSchema>;
export type ClubCrossStandingRowResponse = z.infer<typeof clubCrossStandingRowSchema>;
export type ClubCrossMatchResponse = z.infer<typeof clubCrossMatchSchema>;
export type ClubRoundMatchResponse = z.infer<typeof clubRoundMatchSchema>;
export type ClubScoreResponse = z.infer<typeof clubScoreSchema>;
