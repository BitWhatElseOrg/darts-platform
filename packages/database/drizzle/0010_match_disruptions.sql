ALTER TABLE "matches" DROP CONSTRAINT "matches_status_check";--> statement-breakpoint
ALTER TABLE "score_commands" DROP CONSTRAINT "score_commands_type_check";--> statement-breakpoint
ALTER TABLE "tournament_commands" DROP CONSTRAINT "tournament_commands_type_check";--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD COLUMN "result_type" varchar(20);--> statement-breakpoint
UPDATE "tournament_matches" SET "result_type" = 'PLAYED' WHERE "status" = 'COMPLETED';--> statement-breakpoint
UPDATE "tournament_matches" SET "result_type" = 'BYE' WHERE "status" = 'BYE';--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD COLUMN "status" varchar(20) DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD COLUMN "withdrawal_reason" text;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_status_check" CHECK ("matches"."status" in ('IN_PROGRESS', 'COMPLETED', 'ABORTED'));--> statement-breakpoint
ALTER TABLE "score_commands" ADD CONSTRAINT "score_commands_type_check" CHECK ("score_commands"."type" in ('SUBMIT_VISIT', 'UNDO_LAST_VISIT', 'ABORT_MATCH'));--> statement-breakpoint
ALTER TABLE "tournament_commands" ADD CONSTRAINT "tournament_commands_type_check" CHECK ("tournament_commands"."type" in ('ASSIGN_MATCH', 'RELEASE_BOARD', 'RESULT_CORRECTION', 'WITHDRAW_PARTICIPANT'));--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_result_type_check" CHECK ("tournament_matches"."result_type" is null or "tournament_matches"."result_type" in ('PLAYED', 'BYE', 'WALKOVER'));--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_result_type_consistency" CHECK (("tournament_matches"."status" = 'COMPLETED' and "tournament_matches"."result_type" in ('PLAYED', 'WALKOVER')) or ("tournament_matches"."status" = 'BYE' and "tournament_matches"."result_type" = 'BYE') or ("tournament_matches"."status" not in ('COMPLETED', 'BYE') and "tournament_matches"."result_type" is null));--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_status_check" CHECK ("tournament_participants"."status" in ('ACTIVE', 'WITHDRAWN'));--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_withdrawal_check" CHECK (("tournament_participants"."status" = 'ACTIVE' and "tournament_participants"."withdrawn_at" is null and "tournament_participants"."withdrawal_reason" is null) or ("tournament_participants"."status" = 'WITHDRAWN' and "tournament_participants"."withdrawn_at" is not null and length(trim("tournament_participants"."withdrawal_reason")) between 3 and 500));
