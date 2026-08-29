import { z } from "zod";

export const matchStatusSchema = z.enum(["IN_PROGRESS", "COMPLETED"]);
export const visitOutcomeSchema = z.enum(["SCORED", "BUST", "LEG_WON", "SET_WON", "MATCH_WON"]);
export const createMatchSchema = z.object({
  playerOneId: z.uuid(), playerTwoId: z.uuid(), startingPlayerId: z.uuid(),
  boardId: z.uuid().nullable().optional(),
  bestOfLegs: z.number().int().min(1).max(21).refine((value) => value % 2 === 1, "Best of legs must be odd."),
  bestOfSets: z.number().int().min(1).max(21).refine((value) => value % 2 === 1, "Best of sets must be odd.").default(1),
}).refine((value) => value.playerOneId !== value.playerTwoId, { message: "A match requires two different players.", path: ["playerTwoId"] })
  .refine((value) => [value.playerOneId, value.playerTwoId].includes(value.startingPlayerId), { message: "Starting player must participate in the match.", path: ["startingPlayerId"] });
export const submitVisitSchema = z.object({
  commandId: z.uuid(), expectedVersion: z.number().int().nonnegative(), playerId: z.uuid(),
  points: z.number().int().min(0).max(180), dartsThrown: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  checkoutDouble: z.number().int().min(1).max(25).nullable().optional(),
  checkoutAttempts: z.number().int().min(0).max(3).optional(),
  controllerId: z.uuid().optional(),
}).refine((value) => (value.checkoutAttempts ?? 0) <= value.dartsThrown, { message: "Checkout attempts cannot exceed darts thrown.", path: ["checkoutAttempts"] });
export const undoVisitSchema = z.object({ commandId: z.uuid(), expectedVersion: z.number().int().nonnegative(), controllerId: z.uuid().optional() });
export const abortMatchSchema = z.object({
  commandId: z.uuid(), expectedVersion: z.number().int().nonnegative(), controllerId: z.uuid().optional(),
  reason: z.string().trim().max(500).optional(),
});
export const abortMatchResponseSchema = z.object({ matchId: z.uuid(), status: z.literal("ABORTED"), tournamentMatchId: z.uuid().nullable() });
export const boardControllerLeaseRequestSchema = z.object({ controllerId: z.uuid(), force: z.boolean().default(false) });
export const boardControllerLeaseSchema = z.object({ controllerId: z.uuid(), owned: z.boolean(), expiresAt: z.coerce.date() });
export const matchParticipantStateSchema = z.object({
  playerId: z.uuid(), displayName: z.string(), remaining: z.number().int().nonnegative(),
  legsWon: z.number().int().nonnegative(), legsWonInSet: z.number().int().nonnegative(), setsWon: z.number().int().nonnegative(), isActive: z.boolean(),
});
export const matchVisitSchema = z.object({
  id: z.uuid(), commandId: z.uuid(), playerId: z.uuid(), playerDisplayName: z.string(),
  legNumber: z.number().int().positive(), points: z.number().int().nonnegative(),
  appliedPoints: z.number().int().nonnegative(), dartsThrown: z.number().int().min(1).max(3),
  scoreBefore: z.number().int().nonnegative(), scoreAfter: z.number().int().nonnegative(),
  checkoutDouble: z.number().int().nullable(), outcome: visitOutcomeSchema, reverted: z.boolean(),
  checkoutAttempts: z.number().int().min(0).max(3),
  createdAt: z.coerce.date(),
});
export const matchStateSchema = z.object({
  id: z.uuid(), organizationId: z.uuid(), boardId: z.uuid().nullable(), boardName: z.string().nullable(),
  status: matchStatusSchema, version: z.number().int().nonnegative(), startingScore: z.number().int().positive(),
  bestOfLegs: z.number().int().positive(), legsToWin: z.number().int().positive(),
  bestOfSets: z.number().int().positive(), setsToWin: z.number().int().positive(), currentSetNumber: z.number().int().positive(),
  currentLegNumber: z.number().int().positive(), currentLegVersion: z.number().int().nonnegative(),
  currentPlayerId: z.uuid().nullable(), winnerPlayerId: z.uuid().nullable(),
  participants: z.tuple([matchParticipantStateSchema, matchParticipantStateSchema]),
  visits: z.array(matchVisitSchema), createdAt: z.coerce.date(), updatedAt: z.coerce.date(),
});
export const matchListSchema = z.array(matchStateSchema);
export type CreateMatchInput = z.infer<typeof createMatchSchema>;
export type SubmitVisitInput = z.infer<typeof submitVisitSchema>;
export type UndoVisitInput = z.infer<typeof undoVisitSchema>;
export type AbortMatchInput = z.infer<typeof abortMatchSchema>;
export type AbortMatchResponse = z.infer<typeof abortMatchResponseSchema>;
export type MatchStateResponse = z.infer<typeof matchStateSchema>;
export type BoardControllerLeaseRequest = z.infer<typeof boardControllerLeaseRequestSchema>;
export type BoardControllerLeaseResponse = z.infer<typeof boardControllerLeaseSchema>;
