import { z } from "zod";

export const tournamentStatusSchema = z.enum([
  "DRAFT",
  "READY",
  "GROUP_STAGE",
  "KNOCKOUT",
  "COMPLETED",
]);

export const tournamentFormatSchema = z.enum([
  "GROUPS_THEN_KNOCKOUT",
  "ROUND_ROBIN",
  "SINGLE_ELIMINATION",
]);

export const seedingModeSchema = z.enum(["SEEDED", "RANDOM"]);

export const boardSlotStateSchema = z.enum(["FREE", "PLAYING", "BLOCKED"]);

/**
 * Readiness is decided by the scheduling engine, never by the client.
 * The surface renders the decision and its reason; it does not compute it.
 */
export const queueReadinessSchema = z.enum([
  "READY",
  "BLOCKED_PLAYER_BUSY",
  "BLOCKED_PARTICIPANT_UNDECIDED",
  "BLOCKED_NO_BOARD",
  "BLOCKED_STAGE_NOT_OPEN",
]);

export const conflictSeveritySchema = z.enum(["WARNING", "BLOCKING"]);

export const tournamentSummarySchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  name: z.string(),
  status: tournamentStatusSchema,
  format: tournamentFormatSchema,
  participantCount: z.number().int().nonnegative(),
  boardCount: z.number().int().nonnegative(),
  playedMatches: z.number().int().nonnegative(),
  totalMatches: z.number().int().nonnegative(),
  startsAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const tournamentListSchema = z.array(tournamentSummarySchema);

export const slotParticipantSchema = z.object({
  playerId: z.uuid(),
  displayName: z.string(),
  remaining: z.number().int().nonnegative(),
  legsWon: z.number().int().nonnegative(),
  isActive: z.boolean(),
  /** Server-derived: the remaining score can be finished with the darts in hand. */
  onFinish: z.boolean(),
  /** Server-derived checkout route, e.g. "T20 D20". Never assembled in the client. */
  checkoutRoute: z.string().nullable(),
});

export const boardSlotMatchSchema = z.object({
  matchId: z.uuid(),
  version: z.number().int().nonnegative(),
  stageLabel: z.string(),
  legNumber: z.number().int().positive(),
  bestOfLegs: z.number().int().positive(),
  startedAt: z.coerce.date(),
  /** Server-derived: running longer than this stage's expected duration. */
  overrunning: z.boolean(),
  participants: z.tuple([slotParticipantSchema, slotParticipantSchema]),
});

export const boardSlotSchema = z.object({
  boardId: z.uuid(),
  boardName: z.string(),
  /** Position in the venue's board numbering; the surface indexes by it. */
  ringNumber: z.number().int().positive(),
  state: boardSlotStateSchema,
  blockedReason: z.string().nullable(),
  match: boardSlotMatchSchema.nullable(),
});

export const queueParticipantSchema = z.object({
  playerId: z.uuid().nullable(),
  displayName: z.string(),
});

export const queueEntrySchema = z.object({
  matchId: z.uuid(),
  position: z.number().int().positive(),
  stageLabel: z.string(),
  readiness: queueReadinessSchema,
  blockedReason: z.string().nullable(),
  participants: z.tuple([queueParticipantSchema, queueParticipantSchema]),
});

export const tournamentConflictSchema = z.object({
  id: z.uuid(),
  severity: conflictSeveritySchema,
  code: z.string(),
  message: z.string(),
  subject: z.string(),
  detectedAt: z.coerce.date(),
});

export const groupStandingRowSchema = z.object({
  position: z.number().int().positive(),
  playerId: z.uuid(),
  displayName: z.string(),
  played: z.number().int().nonnegative(),
  won: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
  legsFor: z.number().int().nonnegative(),
  legsAgainst: z.number().int().nonnegative(),
  legDifference: z.number().int(),
  points: z.number().int().nonnegative(),
  qualified: z.boolean(),
});

export const groupStandingSchema = z.object({
  groupLabel: z.string(),
  qualifyCount: z.number().int().nonnegative(),
  playedMatches: z.number().int().nonnegative(),
  totalMatches: z.number().int().nonnegative(),
  rows: z.array(groupStandingRowSchema),
});

export const tournamentResultSchema = z.object({
  matchId: z.uuid(),
  stageLabel: z.string(),
  participantNames: z.tuple([z.string(), z.string()]),
  winnerPlayerId: z.uuid(),
  winnerDisplayName: z.string(),
  completedAt: z.coerce.date(),
});

export const bracketMatchSchema = z.object({
  matchId: z.uuid(),
  stageLabel: z.string(),
  round: z.number().int().positive(),
  position: z.number().int().positive(),
  status: z.enum(["WAITING", "READY", "IN_PROGRESS", "COMPLETED", "BYE", "CANCELLED"]),
  participantNames: z.tuple([z.string(), z.string()]),
  winnerDisplayName: z.string().nullable(),
});

export const tournamentDashboardSchema = z.object({
  tournament: z.object({
    id: z.uuid(),
    organizationId: z.uuid(),
    name: z.string(),
    status: tournamentStatusSchema,
    format: tournamentFormatSchema,
    version: z.number().int().nonnegative(),
    stageLabel: z.string(),
    startingScore: z.number().int().positive(),
    doubleOut: z.boolean(),
    playedMatches: z.number().int().nonnegative(),
    totalMatches: z.number().int().nonnegative(),
    startsAt: z.coerce.date(),
  }),
  boards: z.array(boardSlotSchema),
  queue: z.array(queueEntrySchema),
  conflicts: z.array(tournamentConflictSchema),
  groups: z.array(groupStandingSchema),
  bracket: z.array(bracketMatchSchema),
  recentResults: z.array(tournamentResultSchema),
  generatedAt: z.coerce.date(),
});

export const tournamentStructurePreviewSchema = z.object({
  groups: z.array(
    z.object({ label: z.string(), participantCount: z.number().int().nonnegative() }),
  ),
  groupMatchCount: z.number().int().nonnegative(),
  knockoutSize: z.number().int().nonnegative(),
  knockoutMatchCount: z.number().int().nonnegative(),
  byes: z.number().int().nonnegative(),
  totalMatches: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export const tournamentStructurePreviewInputSchema = z.object({
  format: tournamentFormatSchema.default("GROUPS_THEN_KNOCKOUT"),
  participantCount: z.number().int().min(2).max(256),
  groupCount: z.number().int().min(1).max(32),
  qualifyPerGroup: z.number().int().min(1).max(8),
  knockoutSize: z.union([
    z.literal(2),
    z.literal(4),
    z.literal(8),
    z.literal(16),
    z.literal(32),
    z.literal(64),
  ]),
});

export const createTournamentSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    startsAt: z.coerce.date(),
    format: tournamentFormatSchema,
    startingScore: z.union([z.literal(301), z.literal(501), z.literal(701)]),
    doubleOut: z.boolean(),
    bestOfLegs: z
      .number()
      .int()
      .min(1)
      .max(21)
      .refine((value) => value % 2 === 1, "Best of legs must be odd."),
    participantIds: z.array(z.uuid()).min(4).max(256),
    groupCount: z.number().int().min(1).max(32),
    qualifyPerGroup: z.number().int().min(1).max(8),
    knockoutSize: z.union([
      z.literal(2),
      z.literal(4),
      z.literal(8),
      z.literal(16),
      z.literal(32),
      z.literal(64),
    ]),
    seeding: seedingModeSchema,
    boardIds: z.array(z.uuid()).min(1).max(64),
  })
  .refine((value) => new Set(value.participantIds).size === value.participantIds.length, {
    message: "A participant may only be entered once.",
    path: ["participantIds"],
  })
  .refine((value) => new Set(value.boardIds).size === value.boardIds.length, {
    message: "A board may only be selected once.",
    path: ["boardIds"],
  })
  .refine(
    (value) =>
      value.format !== "GROUPS_THEN_KNOCKOUT" ||
      value.participantIds.length >= value.groupCount * 2,
    {
      message: "Every group needs at least two participants.",
      path: ["groupCount"],
    },
  )
  .refine(
    (value) =>
      value.format !== "GROUPS_THEN_KNOCKOUT" ||
      value.qualifyPerGroup <= Math.floor(value.participantIds.length / value.groupCount),
    {
      message: "A group cannot qualify more participants than it contains.",
      path: ["qualifyPerGroup"],
    },
  )
  .refine(
    (value) =>
      value.format !== "GROUPS_THEN_KNOCKOUT" ||
      value.groupCount * value.qualifyPerGroup >= 2,
    {
      message: "At least two participants must qualify.",
      path: ["qualifyPerGroup"],
    },
  )
  .refine(
    (value) =>
      value.format !== "GROUPS_THEN_KNOCKOUT" ||
      value.groupCount * value.qualifyPerGroup === value.knockoutSize,
    {
      message: "The knockout bracket size must equal the number of qualifiers.",
      path: ["knockoutSize"],
    },
  )
  .refine(
    (value) =>
      value.format !== "SINGLE_ELIMINATION" ||
      value.participantIds.length <= value.knockoutSize,
    {
      message: "The knockout bracket must fit every participant.",
      path: ["knockoutSize"],
    },
  )
  .refine(
    (value) => {
      const entrants =
        value.format === "GROUPS_THEN_KNOCKOUT"
          ? value.groupCount * value.qualifyPerGroup
          : value.participantIds.length;
      return value.format === "ROUND_ROBIN" || entrants >= value.knockoutSize / 2;
    },
    {
      message: "The knockout bracket would contain an empty first-round match.",
      path: ["knockoutSize"],
    },
  );

/** Board assignment is a mutation: idempotent by commandId, guarded by version. */
export const assignMatchSchema = z.object({
  commandId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  matchId: z.uuid(),
  boardId: z.uuid(),
});

export const releaseBoardSchema = z.object({
  commandId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  boardId: z.uuid(),
});

export const correctTournamentResultSchema = z.object({
  commandId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  matchId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
});

export type TournamentStatus = z.infer<typeof tournamentStatusSchema>;
export type TournamentFormat = z.infer<typeof tournamentFormatSchema>;
export type SeedingMode = z.infer<typeof seedingModeSchema>;
export type BoardSlotState = z.infer<typeof boardSlotStateSchema>;
export type QueueReadiness = z.infer<typeof queueReadinessSchema>;
export type ConflictSeverity = z.infer<typeof conflictSeveritySchema>;
export type TournamentSummary = z.infer<typeof tournamentSummarySchema>;
export type BoardSlot = z.infer<typeof boardSlotSchema>;
export type BoardSlotMatch = z.infer<typeof boardSlotMatchSchema>;
export type SlotParticipant = z.infer<typeof slotParticipantSchema>;
export type QueueEntry = z.infer<typeof queueEntrySchema>;
export type TournamentConflict = z.infer<typeof tournamentConflictSchema>;
export type GroupStanding = z.infer<typeof groupStandingSchema>;
export type GroupStandingRow = z.infer<typeof groupStandingRowSchema>;
export type TournamentResult = z.infer<typeof tournamentResultSchema>;
export type TournamentDashboard = z.infer<typeof tournamentDashboardSchema>;
export type TournamentStructurePreview = z.infer<typeof tournamentStructurePreviewSchema>;
export type TournamentStructurePreviewInput = z.infer<
  typeof tournamentStructurePreviewInputSchema
>;
export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;
export type AssignMatchInput = z.infer<typeof assignMatchSchema>;
export type ReleaseBoardInput = z.infer<typeof releaseBoardSchema>;
export type CorrectTournamentResultInput = z.infer<typeof correctTournamentResultSchema>;
