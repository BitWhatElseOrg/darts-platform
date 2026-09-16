-- Wer ein Leg anwirft, ist eine Match-Regel mit drei Auspraegungen statt eines
-- Flags: `LEAGUE` folgt Reglement 2.2.9 (Leg 1 Heim, Leg 2 Gast, ab Leg 3
-- Bull), `BULL_EVERY_LEG` gilt fuer das Entscheidungsdoppel, `BULL_FIRST_LEG`
-- fuer freie Matches und Turniermatches ohne Heimseite.
ALTER TABLE "matches" ADD COLUMN "leg_start_rule" varchar(20) DEFAULT 'BULL_FIRST_LEG' NOT NULL;--> statement-breakpoint
-- Bestehende Matches behalten ihr Verhalten Zeile fuer Zeile: nur das
-- Entscheidungsdoppel trug bisher das Flag.
UPDATE "matches" SET "leg_start_rule" = CASE WHEN "bull_off_from_leg_one" THEN 'BULL_EVERY_LEG' ELSE 'LEAGUE' END;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_leg_start_rule_check" CHECK ("matches"."leg_start_rule" in ('LEAGUE', 'BULL_EVERY_LEG', 'BULL_FIRST_LEG'));--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN "bull_off_from_leg_one";
