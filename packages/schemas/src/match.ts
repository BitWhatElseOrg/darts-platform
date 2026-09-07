import { z } from "zod";

import { inRuleSchema, outRuleSchema } from "./tournament";

export const matchStatusSchema = z.enum(["IN_PROGRESS", "COMPLETED"]);
export const visitOutcomeSchema = z.enum(["SCORED", "BUST", "LEG_WON", "SET_WON", "MATCH_WON"]);
export const createMatchSchema = z.object({
  playerOneId: z.uuid(), playerTwoId: z.uuid(), startingPlayerId: z.uuid(),
  boardId: z.uuid().nullable().optional(),
  bestOfLegs: z.number().int().min(1).max(21).refine((value) => value % 2 === 1, "Best of legs must be odd."),
  bestOfSets: z.number().int().min(1).max(21).refine((value) => value % 2 === 1, "Best of sets must be odd.").default(1),
}).refine((value) => value.playerOneId !== value.playerTwoId, { message: "A match requires two different players.", path: ["playerTwoId"] })
  .refine((value) => [value.playerOneId, value.playerTwoId].includes(value.startingPlayerId), { message: "Starting player must participate in the match.", path: ["startingPlayerId"] });
/**
 * Ein einzelner Wurf. Segment 0 ist der Fehlwurf, 25 das Bull; beide tragen
 * keinen dritten Ring, deshalb die beiden Sonderregeln.
 */
export const dartSchema = z
  .object({
    segment: z.number().int().min(0).max(25),
    multiplier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .refine((dart) => dart.segment <= 20 || dart.segment === 25, { message: "Segment must be 0-20 or 25.", path: ["segment"] })
  .refine((dart) => dart.segment !== 0 || dart.multiplier === 1, { message: "A miss carries no multiplier.", path: ["multiplier"] })
  .refine((dart) => dart.segment !== 25 || dart.multiplier <= 2, { message: "Bull has no triple.", path: ["multiplier"] });

export const submitVisitSchema = z.object({
  commandId: z.uuid(), expectedVersion: z.number().int().nonnegative(), playerId: z.uuid(),
  points: z.number().int().min(0).max(180), dartsThrown: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  checkoutDouble: z.number().int().min(1).max(25).nullable().optional(),
  checkoutAttempts: z.number().int().min(0).max(3).optional(),
  controllerId: z.uuid().optional(),
  darts: z.array(dartSchema).min(1).max(3).optional(),
  /**
   * Das abschliessende Segment einer Aufnahme ohne Einzelwuerfe, mit
   * Multiplikator. Verallgemeinert `checkoutDouble`, das per `checkoutValue`
   * nur D1-D20 und Bull tragen kann und damit kein Triple-Finish unter Master
   * Out belegen konnte. Optional und rueckwaertskompatibel: fehlt das Feld,
   * wertet die Engine die Aufnahme unveraendert.
   */
  checkoutSegment: dartSchema.optional(),
  // Ausdrueckliche Meldung "kein gueltiges Finish", unabhaengig von der
  // Ausgangsregel -- siehe x01.ts, SubmitVisitCommand.checkoutMissed.
  checkoutMissed: z.boolean().optional(),
}).refine((value) => (value.checkoutAttempts ?? 0) <= value.dartsThrown, { message: "Checkout attempts cannot exceed darts thrown.", path: ["checkoutAttempts"] })
  .refine((value) => value.darts === undefined || value.darts.length === value.dartsThrown, { message: "The number of darts must match dartsThrown.", path: ["darts"] })
  .refine(
    (value) => value.darts === undefined || value.darts.reduce((sum, dart) => sum + dart.segment * dart.multiplier, 0) === value.points,
    { message: "The darts must add up to the visit score.", path: ["darts"] },
  )
  .refine((value) => !(value.checkoutMissed === true && value.checkoutDouble !== undefined && value.checkoutDouble !== null), { message: "Checkout missed cannot be combined with a checkout double.", path: ["checkoutMissed"] })
  .refine((value) => !(value.checkoutMissed === true && value.darts !== undefined), { message: "Checkout missed cannot be combined with recorded darts.", path: ["checkoutMissed"] })
  // Das Checkout-Segment ist der Beleg fuer eine Aufnahme OHNE Einzelwuerfe.
  // Liegen Wuerfe vor, entscheidet der letzte Wurf; ein zweiter, moeglicher-
  // weise widersprechender Beleg daneben waere nicht entscheidbar. Dieselbe
  // Ueberlegung gilt gegen `checkoutMissed` (Finish und Nicht-Finish) und
  // gegen `checkoutDouble` (zwei Segmentangaben zur selben Aufnahme).
  .refine((value) => !(value.checkoutSegment !== undefined && value.darts !== undefined), { message: "A checkout segment cannot be combined with recorded darts.", path: ["checkoutSegment"] })
  .refine((value) => !(value.checkoutSegment !== undefined && value.checkoutMissed === true), { message: "A checkout segment cannot be combined with a missed checkout.", path: ["checkoutSegment"] })
  .refine((value) => !(value.checkoutSegment !== undefined && value.checkoutDouble !== undefined && value.checkoutDouble !== null), { message: "A checkout segment cannot be combined with a checkout double.", path: ["checkoutSegment"] });
export const undoVisitSchema = z.object({ commandId: z.uuid(), expectedVersion: z.number().int().nonnegative(), controllerId: z.uuid().optional() });
/**
 * Reglement 2.2.9: ab Leg drei entscheidet ein Wurf auf Bull, wer beginnt; beim
 * Entscheidungsdoppel (sudden death) schon ab Leg eins. Welche Grenze gilt,
 * entscheidet der Server anhand von `matches.bull_off_from_leg_one` — der
 * Vertrag lässt deshalb jede Legnummer zu und die Engine lehnt ab
 * (`LEG_START_FIXED`).
 */
export const decideLegStartSchema = z.object({
  commandId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  legNumber: z.number().int().min(1).max(99),
  startingSeat: z.union([z.literal(1), z.literal(2)]),
  controllerId: z.uuid().optional(),
});

/** Anhang 2: ist die Rundengrenze erreicht, entscheidet ein Ausbullen das Leg. */
export const decideLegByBullSchema = z.object({
  commandId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  winnerSeat: z.union([z.literal(1), z.literal(2)]),
  controllerId: z.uuid().optional(),
});

export const abortMatchSchema = z.object({
  commandId: z.uuid(), expectedVersion: z.number().int().nonnegative(), controllerId: z.uuid().optional(),
  reason: z.string().trim().min(3).max(500),
});
export const abortMatchResponseSchema = z.object({ matchId: z.uuid(), status: z.literal("ABORTED"), tournamentMatchId: z.uuid().nullable() });
export const boardControllerLeaseRequestSchema = z.object({ controllerId: z.uuid(), force: z.boolean().default(false) });
export const boardControllerLeaseSchema = z.object({ controllerId: z.uuid(), owned: z.boolean(), expiresAt: z.coerce.date() });
/**
 * Eine Seite des Matches. Im Doppel trägt sie zwei Personen; `players` ist
 * deshalb die Wahrheit, `playerId` und `displayName` benennen weiterhin die
 * erste Person der Seite. `isActive` heisst „diese Seite ist am Wurf",
 * `players[].isThrowing` benennt die Person, die tatsächlich wirft.
 */
export const matchSidePlayerSchema = z.object({
  playerId: z.uuid(),
  displayName: z.string(),
  isThrowing: z.boolean(),
});
export const matchParticipantStateSchema = z.object({
  seat: z.union([z.literal(1), z.literal(2)]),
  players: z.array(matchSidePlayerSchema).min(1).max(2),
  playerId: z.uuid(), displayName: z.string(), remaining: z.number().int().nonnegative(),
  legsWon: z.number().int().nonnegative(), legsWonInSet: z.number().int().nonnegative(), setsWon: z.number().int().nonnegative(), isActive: z.boolean(),
  /**
   * Hat diese Seite im laufenden Leg eroeffnet? Unter Straight In immer wahr,
   * unter Double In erst ab dem eroeffnenden Doppel. Die Flaeche braucht die
   * Angabe, um die Eroeffnungsaufnahme Wurf fuer Wurf zu verlangen
   * (x01.ts, `assertWritableVisit`); der Rueckfall ueber `remaining` waere
   * unscharf, weil Eroeffnung und Bust in derselben Aufnahme den Reststand
   * auf dem Startwert stehen lassen.
   */
  openedInLeg: z.boolean(),
});
export const matchVisitSchema = z.object({
  id: z.uuid(), commandId: z.uuid(), playerId: z.uuid(), playerDisplayName: z.string(),
  legNumber: z.number().int().positive(), points: z.number().int().nonnegative(),
  appliedPoints: z.number().int().nonnegative(), dartsThrown: z.number().int().min(1).max(3),
  scoreBefore: z.number().int().nonnegative(), scoreAfter: z.number().int().nonnegative(),
  checkoutDouble: z.number().int().nullable(), outcome: visitOutcomeSchema, reverted: z.boolean(),
  checkoutAttempts: z.number().int().min(0).max(3),
  darts: z.array(dartSchema),
  createdAt: z.coerce.date(),
});
/**
 * Woher das Match seine oeffentliche Live-Ansicht bezieht. Ein freies Match
 * ohne Wettbewerbsbezug traegt null.
 */
export const matchLiveTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TOURNAMENT"), tournamentId: z.uuid() }),
  z.object({ kind: z.literal("ENCOUNTER"), publicId: z.uuid() }),
]).nullable();
export const matchStateSchema = z.object({
  id: z.uuid(), organizationId: z.uuid(), boardId: z.uuid().nullable(), boardName: z.string().nullable(),
  status: matchStatusSchema, version: z.number().int().nonnegative(), startingScore: z.number().int().positive(),
  /** Die Spielart gehört in den Zustand: das Scoreboard muss sie nennen können. */
  inRule: inRuleSchema, outRule: outRuleSchema,
  /** Reglement 2.2.9: beim Entscheidungsdoppel wird schon Leg 1 ausgebullt. */
  bullOffFromLegOne: z.boolean(),
  bestOfLegs: z.number().int().positive(), legsToWin: z.number().int().positive(),
  bestOfSets: z.number().int().positive(), setsToWin: z.number().int().positive(), currentSetNumber: z.number().int().positive(),
  currentLegNumber: z.number().int().positive(), currentLegVersion: z.number().int().nonnegative(),
  currentPlayerId: z.uuid().nullable(), winnerPlayerId: z.uuid().nullable(),
  participants: z.tuple([matchParticipantStateSchema, matchParticipantStateSchema]),
  visits: z.array(matchVisitSchema), createdAt: z.coerce.date(), updatedAt: z.coerce.date(),
  liveTarget: matchLiveTargetSchema,
});
export const matchListSchema = z.array(matchStateSchema);
export type CreateMatchInput = z.infer<typeof createMatchSchema>;
export type SubmitVisitInput = z.infer<typeof submitVisitSchema>;
export type UndoVisitInput = z.infer<typeof undoVisitSchema>;
export type DecideLegStartInput = z.infer<typeof decideLegStartSchema>;
export type DecideLegByBullInput = z.infer<typeof decideLegByBullSchema>;
export type AbortMatchInput = z.infer<typeof abortMatchSchema>;
export type AbortMatchResponse = z.infer<typeof abortMatchResponseSchema>;
export type MatchStateResponse = z.infer<typeof matchStateSchema>;
export type BoardControllerLeaseRequest = z.infer<typeof boardControllerLeaseRequestSchema>;
export type BoardControllerLeaseResponse = z.infer<typeof boardControllerLeaseSchema>;
export type Dart = z.infer<typeof dartSchema>;
export type MatchLiveTarget = z.infer<typeof matchLiveTargetSchema>;
