import { z } from "zod";

export const competitorKindSchema = z.enum(["PLAYER", "PAIR", "TEAM"]);
export const advancedStageTypeSchema = z.enum(["ROUND_ROBIN", "SINGLE_ELIMINATION", "DOUBLE_ELIMINATION", "SWISS", "PLACEMENT"]);
export const advancedStageSchema = z.object({
  key: z.string().trim().min(1).max(40),
  type: advancedStageTypeSchema,
  rounds: z.number().int().min(1).max(15).optional(),
  advance: z.number().int().min(1).max(256).optional(),
});
export const advancedFormatPreviewInputSchema = z.object({
  participantCount: z.number().int().min(2).max(256),
  competitorKind: competitorKindSchema,
  bestOfLegs: z.number().int().min(1).max(21).refine((value) => value % 2 === 1),
  bestOfSets: z.number().int().min(1).max(21).refine((value) => value % 2 === 1),
  stages: z.array(advancedStageSchema).min(1).max(8),
});
export const advancedFormatPreviewSchema = z.object({
  participantCount: z.number().int().positive(),
  competitorKind: competitorKindSchema,
  bestOfLegs: z.number().int().positive(),
  bestOfSets: z.number().int().positive(),
  totalMatches: z.number().int().nonnegative(),
  stages: z.array(z.object({ key: z.string(), type: advancedStageTypeSchema, entrantCount: z.number().int().positive(), advancingCount: z.number().int().positive(), matchCount: z.number().int().nonnegative() })),
  warnings: z.array(z.string()),
});
export type AdvancedFormatPreviewInput = z.infer<typeof advancedFormatPreviewInputSchema>;
export type AdvancedFormatPreview = z.infer<typeof advancedFormatPreviewSchema>;
