ALTER TABLE "matches" ADD COLUMN "in_rule" varchar(10) DEFAULT 'STRAIGHT' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "out_rule" varchar(10) DEFAULT 'DOUBLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "max_rounds" integer;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "in_rule" varchar(10) DEFAULT 'STRAIGHT' NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "out_rule" varchar(10) DEFAULT 'DOUBLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "max_rounds" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_in_rule_check" CHECK ("matches"."in_rule" in ('STRAIGHT', 'DOUBLE'));--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_out_rule_check" CHECK ("matches"."out_rule" in ('SINGLE', 'DOUBLE', 'MASTER'));--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_max_rounds_check" CHECK ("matches"."max_rounds" is null or "matches"."max_rounds" > 0);--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_in_rule_check" CHECK ("tournaments"."in_rule" in ('STRAIGHT', 'DOUBLE'));--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_out_rule_check" CHECK ("tournaments"."out_rule" in ('SINGLE', 'DOUBLE', 'MASTER'));--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_max_rounds_check" CHECK ("tournaments"."max_rounds" is null or "tournaments"."max_rounds" > 0);--> statement-breakpoint
UPDATE "matches" SET "out_rule" = CASE WHEN "double_out" THEN 'DOUBLE' ELSE 'SINGLE' END;--> statement-breakpoint
UPDATE "tournaments" SET "out_rule" = CASE WHEN "double_out" THEN 'DOUBLE' ELSE 'SINGLE' END;
