-- Vereinsduell (Spec 2026-10-01-vereinsduell-design): Gastspieler, Format
-- CLUB_DUEL mit Vereinsnamen/Runden/Finalrunde, Seite je Teilnehmer, neue
-- Phasentypen, Status FINAL_ROUND, ein Spieler je Runde nur einmal.
ALTER TABLE "players" ADD COLUMN "kind" varchar(10) DEFAULT 'MEMBER' NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "guest_club_name" varchar(120);--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "guest_command_id" uuid;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_kind_check" CHECK ("players"."kind" in ('MEMBER', 'GUEST'));--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_guest_club_name_check" CHECK (("players"."kind" = 'GUEST' and "players"."guest_club_name" is not null and length(trim("players"."guest_club_name")) > 0) or ("players"."kind" = 'MEMBER' and "players"."guest_club_name" is null));--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_guest_no_account_check" CHECK ("players"."kind" = 'MEMBER' or "players"."user_id" is null);--> statement-breakpoint
CREATE UNIQUE INDEX "players_guest_command_name_unique" ON "players" ("organization_id", "guest_command_id", "display_name") WHERE "players"."guest_command_id" is not null;--> statement-breakpoint
CREATE INDEX "players_organization_kind_idx" ON "players" ("organization_id", "kind");--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "side_a_name" varchar(120);--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "side_b_name" varchar(120);--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "qualifying_rounds" integer;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "final_round_size" integer;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "third_place_match" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" DROP CONSTRAINT "tournaments_status_check";--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_status_check" CHECK ("tournaments"."status" in ('READY', 'GROUP_STAGE', 'FINAL_ROUND', 'KNOCKOUT', 'COMPLETED'));--> statement-breakpoint
ALTER TABLE "tournaments" DROP CONSTRAINT "tournaments_format_check";--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_format_check" CHECK ("tournaments"."format" in ('GROUPS_THEN_KNOCKOUT', 'ROUND_ROBIN', 'SINGLE_ELIMINATION', 'CLUB_DUEL'));--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_qualifying_rounds_check" CHECK ("tournaments"."qualifying_rounds" is null or "tournaments"."qualifying_rounds" between 1 and 15);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_final_round_size_check" CHECK ("tournaments"."final_round_size" is null or "tournaments"."final_round_size" between 2 and 6);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_club_duel_settings_check" CHECK (("tournaments"."format" = 'CLUB_DUEL' and "tournaments"."side_a_name" is not null and "tournaments"."side_b_name" is not null and "tournaments"."qualifying_rounds" is not null and "tournaments"."final_round_size" is not null) or ("tournaments"."format" <> 'CLUB_DUEL' and "tournaments"."side_a_name" is null and "tournaments"."side_b_name" is null and "tournaments"."qualifying_rounds" is null and "tournaments"."final_round_size" is null));--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD COLUMN "side" char(1);--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_side_check" CHECK ("tournament_participants"."side" is null or "tournament_participants"."side" in ('A', 'B'));--> statement-breakpoint
ALTER TABLE "tournament_stages" DROP CONSTRAINT "tournament_stages_type_check";--> statement-breakpoint
ALTER TABLE "tournament_stages" ADD CONSTRAINT "tournament_stages_type_check" CHECK ("tournament_stages"."type" in ('GROUP', 'ROUND_ROBIN', 'SINGLE_ELIMINATION', 'CLUB_SWISS', 'CLUB_CROSS_ROUND_ROBIN'));--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_matches_stage_round_participant_one_unique" ON "tournament_matches" ("stage_id", "round", "participant_one_id") WHERE "tournament_matches"."participant_one_id" is not null and "tournament_matches"."group_id" is null and "tournament_matches"."status" <> 'CANCELLED';--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_matches_stage_round_participant_two_unique" ON "tournament_matches" ("stage_id", "round", "participant_two_id") WHERE "tournament_matches"."participant_two_id" is not null and "tournament_matches"."group_id" is null and "tournament_matches"."status" <> 'CANCELLED';
