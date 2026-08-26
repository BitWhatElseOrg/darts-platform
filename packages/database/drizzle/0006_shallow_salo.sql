ALTER TABLE "matches" ADD COLUMN "legs_to_win_set" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "sets_to_win" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "legs_to_win_set" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "sets_to_win" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_legs_to_win_set_check" CHECK ("matches"."legs_to_win_set" > 0);--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_sets_to_win_check" CHECK ("matches"."sets_to_win" > 0);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_legs_to_win_set_check" CHECK ("tournaments"."legs_to_win_set" > 0);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_sets_to_win_check" CHECK ("tournaments"."sets_to_win" > 0);