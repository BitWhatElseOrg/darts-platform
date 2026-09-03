import { z } from "zod";

import { inRuleSchema, outRuleSchema } from "./tournament";

export const teamStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export const teamPlayerRoleSchema = z.enum(["PLAYER", "CAPTAIN"]);
export const competitionTypeSchema = z.enum(["LEAGUE"]);
export const competitionStatusSchema = z.enum(["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED"]);

/**
 * `EXTRA_SLOT` bildet Reglement 2.2.2 ab: bei 9:9 Spielen entscheidet ein
 * Doppel, dessen Sieger einen Zusatzpunkt erhält.
 */
export const deciderRuleSchema = z.enum(["NONE", "EXTRA_SLOT"]);
export const slotRoleSchema = z.enum(["REGULAR", "DECIDER"]);
export const disciplineSchema = z.enum(["SINGLES", "DOUBLES"]);
export const encounterSideSchema = z.enum(["HOME", "AWAY"]);
export const encounterStatusSchema = z.enum([
  "DRAFT",
  "LINEUPS_OPEN",
  "READY",
  "RUNNING",
  "COMPLETED",
  "CANCELLED",
]);
export const encounterResultSchema = z.enum(["HOME_WIN", "AWAY_WIN", "DRAW"]);
export const encounterResultTypeSchema = z.enum(["PLAYED", "DECIDER", "FORFEIT"]);
export const encounterSlotStatusSchema = z.enum([
  "WAITING",
  "READY",
  "IN_PROGRESS",
  "COMPLETED",
  "WALKOVER",
  "CANCELLED",
]);
export const slotResultTypeSchema = z.enum(["PLAYED", "WALKOVER"]);

/** `GUEST` hält eine Aushilfe nach Reglement 1.2.3 fest, ohne den Kader zu verfälschen. */
export const nominationOriginSchema = z.enum(["SQUAD", "GUEST"]);

export const teamMemberSchema = z.object({
  playerId: z.uuid(),
  displayName: z.string(),
  role: teamPlayerRoleSchema,
  validFrom: z.coerce.date(),
  validTo: z.coerce.date().nullable(),
});

export const teamSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  name: z.string(),
  shortName: z.string().nullable(),
  status: teamStatusSchema,
  members: z.array(teamMemberSchema),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const teamListSchema = z.array(teamSchema);

export const competitionSlotSchema = z.object({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  role: slotRoleSchema,
  discipline: disciplineSchema,
  label: z.string(),
  homePosition: z.number().int().positive().nullable(),
  awayPosition: z.number().int().positive().nullable(),
  startingScore: z.number().int().positive(),
  inRule: inRuleSchema,
  outRule: outRuleSchema,
  maxRounds: z.number().int().positive().nullable(),
  bestOfLegs: z.number().int().positive(),
  legsToWinSet: z.number().int().positive(),
  setsToWin: z.number().int().positive(),
});

export const competitionSummarySchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  type: competitionTypeSchema,
  name: z.string(),
  slug: z.string(),
  status: competitionStatusSchema,
  version: z.number().int().nonnegative(),
  pointsWin: z.number().int().nonnegative(),
  pointsDraw: z.number().int().nonnegative(),
  pointsLoss: z.number().int().nonnegative(),
  pointsDeciderBonus: z.number().int().nonnegative(),
  deciderRule: deciderRuleSchema,
  lineupPositions: z.number().int().positive(),
  minNominations: z.number().int().positive(),
  minNominationsShorthanded: z.number().int().positive(),
  maxSubstitutionsPerEncounter: z.number().int().nonnegative(),
  maxDoublesPerPlayer: z.number().int().nonnegative(),
  slotCount: z.number().int().nonnegative(),
  encounterCount: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const competitionListSchema = z.array(competitionSummarySchema);

export const competitionDetailSchema = competitionSummarySchema.extend({
  slots: z.array(competitionSlotSchema),
});

export const encounterSummarySchema = z.object({
  id: z.uuid(),
  publicId: z.uuid(),
  organizationId: z.uuid(),
  competitionId: z.uuid(),
  matchday: z.number().int().positive(),
  homeTeamId: z.uuid(),
  homeTeamName: z.string(),
  awayTeamId: z.uuid(),
  awayTeamName: z.string(),
  scheduledAt: z.coerce.date(),
  venue: z.string().nullable(),
  status: encounterStatusSchema,
  version: z.number().int().nonnegative(),
  homePoints: z.number().int().nonnegative(),
  awayPoints: z.number().int().nonnegative(),
  homeGames: z.number().int().nonnegative(),
  awayGames: z.number().int().nonnegative(),
  homeLegs: z.number().int().nonnegative(),
  awayLegs: z.number().int().nonnegative(),
  result: encounterResultSchema.nullable(),
  resultType: encounterResultTypeSchema.nullable(),
  completedAt: z.coerce.date().nullable(),
});

export const encounterListSchema = z.array(encounterSummarySchema);

export const encounterPlayerSchema = z.object({
  playerId: z.uuid(),
  displayName: z.string(),
});

/**
 * Die Besetzung einer Seite in einem Slot. Sie ist bei Einzeln abgeleitet
 * (Meldung an der Position, überschrieben durch die jüngste Auswechslung) und
 * wird deshalb nie vom Client bestimmt.
 */
export const slotSideOccupancySchema = z.object({
  players: z.array(encounterPlayerSchema),
  complete: z.boolean(),
});

export const encounterSlotSchema = z.object({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  role: slotRoleSchema,
  discipline: disciplineSchema,
  label: z.string(),
  homePosition: z.number().int().positive().nullable(),
  awayPosition: z.number().int().positive().nullable(),
  startingScore: z.number().int().positive(),
  inRule: inRuleSchema,
  outRule: outRuleSchema,
  maxRounds: z.number().int().positive().nullable(),
  bestOfLegs: z.number().int().positive(),
  legsToWinSet: z.number().int().positive(),
  setsToWin: z.number().int().positive(),
  status: encounterSlotStatusSchema,
  boardId: z.uuid().nullable(),
  boardName: z.string().nullable(),
  matchId: z.uuid().nullable(),
  winnerSide: encounterSideSchema.nullable(),
  resultType: slotResultTypeSchema.nullable(),
  homeLegs: z.number().int().nonnegative(),
  awayLegs: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  completedAt: z.coerce.date().nullable(),
  home: slotSideOccupancySchema,
  away: slotSideOccupancySchema,
});

export const encounterNominationSchema = z.object({
  playerId: z.uuid(),
  displayName: z.string(),
  position: z.number().int().positive().nullable(),
  origin: nominationOriginSchema,
});

export const encounterSubstitutionSchema = z.object({
  id: z.uuid(),
  side: encounterSideSchema,
  position: z.number().int().positive(),
  outPlayerId: z.uuid(),
  outDisplayName: z.string(),
  inPlayerId: z.uuid(),
  inDisplayName: z.string(),
  effectiveFromSequence: z.number().int().positive(),
  reason: z.string().nullable(),
  createdAt: z.coerce.date(),
});

/**
 * `revealed` bildet Reglement 2.1.1 ab: der Heim-Captain darf verdeckt
 * melden. Solange nur eine Seite gemeldet hat, liefert der Server die
 * gegnerische Meldung als leere Liste. Das ist eine Serverentscheidung, keine
 * Frage der Oberfläche.
 */
export const encounterSideLineupSchema = z.object({
  side: encounterSideSchema,
  teamId: z.uuid(),
  teamName: z.string(),
  submitted: z.boolean(),
  revealed: z.boolean(),
  nominations: z.array(encounterNominationSchema),
  substitutions: z.array(encounterSubstitutionSchema),
});

export const encounterDeciderSchema = z.object({
  status: z.enum(["REGULAR_SLOTS_PENDING", "NOT_REQUIRED", "REQUIRED", "COMPLETED"]),
  required: z.boolean(),
  slotSequence: z.number().int().positive().nullable(),
});

export const encounterDetailSchema = encounterSummarySchema.extend({
  competitionName: z.string(),
  deciderRule: deciderRuleSchema,
  lineupPositions: z.number().int().positive(),
  minNominations: z.number().int().positive(),
  minNominationsShorthanded: z.number().int().positive(),
  maxSubstitutionsPerEncounter: z.number().int().nonnegative(),
  maxDoublesPerPlayer: z.number().int().nonnegative(),
  decider: encounterDeciderSchema,
  home: encounterSideLineupSchema,
  away: encounterSideLineupSchema,
  slots: z.array(encounterSlotSchema),
});

/** Die öffentliche Ansicht trägt keine Meldungen und keine Auswechselhistorie. */
export const publicEncounterSchema = z.object({
  publicId: z.uuid(),
  competitionName: z.string(),
  matchday: z.number().int().positive(),
  homeTeamName: z.string(),
  awayTeamName: z.string(),
  scheduledAt: z.coerce.date(),
  venue: z.string().nullable(),
  status: encounterStatusSchema,
  homePoints: z.number().int().nonnegative(),
  awayPoints: z.number().int().nonnegative(),
  homeGames: z.number().int().nonnegative(),
  awayGames: z.number().int().nonnegative(),
  homeLegs: z.number().int().nonnegative(),
  awayLegs: z.number().int().nonnegative(),
  result: encounterResultSchema.nullable(),
  resultType: encounterResultTypeSchema.nullable(),
  completedAt: z.coerce.date().nullable(),
  slots: z.array(
    encounterSlotSchema.pick({
      sequence: true,
      role: true,
      discipline: true,
      label: true,
      status: true,
      boardName: true,
      winnerSide: true,
      resultType: true,
      homeLegs: true,
      awayLegs: true,
      home: true,
      away: true,
    }),
  ),
  generatedAt: z.coerce.date(),
});

export const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(120),
  shortName: z.string().trim().min(1).max(20).nullable().default(null),
});

export const updateTeamSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  shortName: z.string().trim().min(1).max(20).nullable().optional(),
  status: teamStatusSchema.optional(),
});

export const addTeamMemberSchema = z.object({
  playerId: z.uuid(),
  role: teamPlayerRoleSchema.default("PLAYER"),
  validFrom: z.coerce.date().optional(),
});

export const competitionSlotInputSchema = z.object({
  sequence: z.number().int().positive().max(100),
  role: slotRoleSchema.default("REGULAR"),
  discipline: disciplineSchema,
  label: z.string().trim().min(1).max(60),
  homePosition: z.number().int().positive().max(20).nullable().default(null),
  awayPosition: z.number().int().positive().max(20).nullable().default(null),
  startingScore: z.union([z.literal(301), z.literal(501), z.literal(701)]),
  inRule: inRuleSchema.default("STRAIGHT"),
  outRule: outRuleSchema.default("DOUBLE"),
  maxRounds: z.number().int().min(1).max(99).nullable().default(null),
  bestOfLegs: z
    .number()
    .int()
    .min(1)
    .max(21)
    .refine((value) => value % 2 === 1, "Best of legs must be odd."),
  legsToWinSet: z.number().int().min(1).max(11).default(2),
  setsToWin: z.number().int().min(1).max(11).default(1),
});

const competitionRulesShape = {
  pointsWin: z.number().int().min(0).max(20).default(3),
  pointsDraw: z.number().int().min(0).max(20).default(1),
  pointsLoss: z.number().int().min(0).max(20).default(0),
  /** Ohne Entscheidungsdoppel gibt es keinen Zusatzpunkt; siehe Transform unten. */
  pointsDeciderBonus: z.number().int().min(0).max(20).optional(),
  deciderRule: deciderRuleSchema.default("NONE"),
  lineupPositions: z.number().int().min(1).max(20).default(4),
  minNominations: z.number().int().min(1).max(40).default(4),
  minNominationsShorthanded: z.number().int().min(1).max(40).default(3),
  maxSubstitutionsPerEncounter: z.number().int().min(0).max(40).default(4),
  maxDoublesPerPlayer: z.number().int().min(0).max(20).default(1),
};

export const createCompetitionSchema = z
  .object({
    type: competitionTypeSchema.default("LEAGUE"),
    name: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Slug must be lowercase and hyphen separated."),
    status: competitionStatusSchema.default("DRAFT"),
    ...competitionRulesShape,
    slots: z.array(competitionSlotInputSchema).min(1).max(100),
  })
  .transform((value) => ({
    ...value,
    pointsDeciderBonus:
      value.pointsDeciderBonus ?? (value.deciderRule === "EXTRA_SLOT" ? 1 : 0),
  }))
  .refine((value) => value.minNominations >= value.lineupPositions, {
    message: "minNominations must cover every lineup position.",
    path: ["minNominations"],
  })
  .refine((value) => value.minNominationsShorthanded <= value.minNominations, {
    message: "minNominationsShorthanded must not exceed minNominations.",
    path: ["minNominationsShorthanded"],
  })
  // Die Meldepruefung zaehlt besetzte Aufstellungspositionen; mehr als
  // `lineupPositions` kann es davon nicht geben. Eine hoehere Untergrenze
  // liesse den Wettbewerb anlegen, aber nie eine Begegnung melden.
  .refine((value) => value.minNominationsShorthanded <= value.lineupPositions, {
    message: "minNominationsShorthanded must not exceed lineupPositions.",
    path: ["minNominationsShorthanded"],
  })
  .refine((value) => value.pointsWin >= value.pointsDraw && value.pointsDraw >= value.pointsLoss, {
    message: "Points must be ordered win >= draw >= loss.",
    path: ["pointsWin"],
  })
  .refine((value) => value.pointsDeciderBonus === 0 || value.deciderRule === "EXTRA_SLOT", {
    message: "A decider bonus needs the EXTRA_SLOT decider rule.",
    path: ["pointsDeciderBonus"],
  });

export const updateCompetitionSchema = z.object({
  commandId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(120).optional(),
  status: competitionStatusSchema.optional(),
  slots: z.array(competitionSlotInputSchema).min(1).max(100).optional(),
});

export const createEncounterSchema = z.object({
  matchday: z.number().int().min(1).max(999),
  homeTeamId: z.uuid(),
  awayTeamId: z.uuid(),
  scheduledAt: z.coerce.date(),
  venue: z.string().trim().min(1).max(120).nullable().default(null),
});

const encounterCommandShape = {
  commandId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
};

export const submitNominationsSchema = z.object({
  ...encounterCommandShape,
  side: encounterSideSchema,
  nominations: z
    .array(
      z.object({
        position: z.number().int().min(1).max(20).nullable(),
        playerId: z.uuid(),
        origin: nominationOriginSchema.default("SQUAD"),
      }),
    )
    .min(1)
    .max(40),
});

export const submitDoublesSchema = z.object({
  ...encounterCommandShape,
  side: encounterSideSchema,
  pairings: z
    .array(
      z.object({
        sequence: z.number().int().min(1).max(100),
        playerIds: z.array(z.uuid()).length(2),
      }),
    )
    .min(1)
    .max(20),
});

export const substitutePlayerSchema = z.object({
  ...encounterCommandShape,
  side: encounterSideSchema,
  position: z.number().int().min(1).max(20),
  outPlayerId: z.uuid(),
  inPlayerId: z.uuid(),
  effectiveFromSequence: z.number().int().min(1).max(100),
  reason: z.string().trim().min(3).max(200).nullable().default(null),
});

export const startEncounterSchema = z.object(encounterCommandShape);

export const assignEncounterSlotSchema = z.object({
  ...encounterCommandShape,
  boardId: z.uuid(),
});

export const releaseEncounterSlotSchema = z.object(encounterCommandShape);

/** Eine Begründung ist Pflicht und wird auditiert (Reglement 2.2.6). */
export const declareSlotWalkoverSchema = z.object({
  ...encounterCommandShape,
  winnerSide: encounterSideSchema,
  reason: z.string().trim().min(3).max(500),
});

export const declareEncounterForfeitSchema = z.object({
  ...encounterCommandShape,
  forfeitSide: encounterSideSchema,
  reason: z.string().trim().min(3).max(500),
});

export const cancelEncounterSchema = z.object({
  ...encounterCommandShape,
  reason: z.string().trim().min(3).max(500),
});

export type TeamStatus = z.infer<typeof teamStatusSchema>;
export type TeamPlayerRole = z.infer<typeof teamPlayerRoleSchema>;
export type TeamMember = z.infer<typeof teamMemberSchema>;
export type TeamResponse = z.infer<typeof teamSchema>;
export type CompetitionType = z.infer<typeof competitionTypeSchema>;
export type CompetitionStatus = z.infer<typeof competitionStatusSchema>;
export type DeciderRule = z.infer<typeof deciderRuleSchema>;
export type SlotRole = z.infer<typeof slotRoleSchema>;
export type Discipline = z.infer<typeof disciplineSchema>;
export type CompetitionSlotResponse = z.infer<typeof competitionSlotSchema>;
export type CompetitionSummary = z.infer<typeof competitionSummarySchema>;
export type CompetitionDetail = z.infer<typeof competitionDetailSchema>;
export type EncounterSide = z.infer<typeof encounterSideSchema>;
export type EncounterStatus = z.infer<typeof encounterStatusSchema>;
export type EncounterResult = z.infer<typeof encounterResultSchema>;
export type EncounterResultType = z.infer<typeof encounterResultTypeSchema>;
export type EncounterSlotStatus = z.infer<typeof encounterSlotStatusSchema>;
export type SlotResultType = z.infer<typeof slotResultTypeSchema>;
export type NominationOrigin = z.infer<typeof nominationOriginSchema>;
export type EncounterSummary = z.infer<typeof encounterSummarySchema>;
export type EncounterSlotView = z.infer<typeof encounterSlotSchema>;
export type EncounterSideLineup = z.infer<typeof encounterSideLineupSchema>;
export type EncounterDetail = z.infer<typeof encounterDetailSchema>;
export type PublicEncounter = z.infer<typeof publicEncounterSchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;
export type CompetitionSlotInput = z.infer<typeof competitionSlotInputSchema>;
export type CreateCompetitionInput = z.infer<typeof createCompetitionSchema>;
export type UpdateCompetitionInput = z.infer<typeof updateCompetitionSchema>;
export type CreateEncounterInput = z.infer<typeof createEncounterSchema>;
export type SubmitNominationsInput = z.infer<typeof submitNominationsSchema>;
export type SubmitDoublesInput = z.infer<typeof submitDoublesSchema>;
export type SubstitutePlayerInput = z.infer<typeof substitutePlayerSchema>;
export type StartEncounterInput = z.infer<typeof startEncounterSchema>;
export type AssignEncounterSlotInput = z.infer<typeof assignEncounterSlotSchema>;
export type ReleaseEncounterSlotInput = z.infer<typeof releaseEncounterSlotSchema>;
export type DeclareSlotWalkoverInput = z.infer<typeof declareSlotWalkoverSchema>;
export type DeclareEncounterForfeitInput = z.infer<typeof declareEncounterForfeitSchema>;
export type CancelEncounterInput = z.infer<typeof cancelEncounterSchema>;
