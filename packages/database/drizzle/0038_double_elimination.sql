-- Doppel-K.-o. (Spec 2026-10-03-doppel-ko-und-swiss-design, ADR 0022): Format,
-- Stage-Typen, Quellen-Art je Platz. Bestehende Quellen sind alle Sieger-Quellen.
ALTER TABLE "tournament_matches" ADD COLUMN "source_one_kind" varchar(10);--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD COLUMN "source_two_kind" varchar(10);--> statement-breakpoint
UPDATE "tournament_matches" SET "source_one_kind" = 'WINNER' WHERE "source_one_match_id" is not null;--> statement-breakpoint
UPDATE "tournament_matches" SET "source_two_kind" = 'WINNER' WHERE "source_two_match_id" is not null;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_source_one_kind_check" CHECK (("tournament_matches"."source_one_match_id" is null and "tournament_matches"."source_one_kind" is null) or ("tournament_matches"."source_one_match_id" is not null and "tournament_matches"."source_one_kind" is not null and "tournament_matches"."source_one_kind" in ('WINNER', 'LOSER')));--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_source_two_kind_check" CHECK (("tournament_matches"."source_two_match_id" is null and "tournament_matches"."source_two_kind" is null) or ("tournament_matches"."source_two_match_id" is not null and "tournament_matches"."source_two_kind" is not null and "tournament_matches"."source_two_kind" in ('WINNER', 'LOSER')));--> statement-breakpoint
ALTER TABLE "tournaments" DROP CONSTRAINT "tournaments_format_check";--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_format_check" CHECK ("tournaments"."format" in ('GROUPS_THEN_KNOCKOUT', 'ROUND_ROBIN', 'SINGLE_ELIMINATION', 'CLUB_DUEL', 'DOUBLE_ELIMINATION'));--> statement-breakpoint
ALTER TABLE "tournament_stages" DROP CONSTRAINT "tournament_stages_type_check";--> statement-breakpoint
ALTER TABLE "tournament_stages" ADD CONSTRAINT "tournament_stages_type_check" CHECK ("tournament_stages"."type" in ('GROUP', 'ROUND_ROBIN', 'SINGLE_ELIMINATION', 'CLUB_SWISS', 'CLUB_CROSS_ROUND_ROBIN', 'DOUBLE_ELIMINATION_UPPER', 'DOUBLE_ELIMINATION_LOWER', 'GRAND_FINAL'));
