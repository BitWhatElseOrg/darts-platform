ALTER TABLE "tournaments" ADD COLUMN "public_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "visibility" varchar(20) DEFAULT 'PRIVATE' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tournaments_public_id_unique" ON "tournaments" USING btree ("public_id");--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_visibility_check" CHECK ("tournaments"."visibility" in ('PRIVATE', 'PUBLIC'));
--> statement-breakpoint
-- Der Bestand behaelt sein heutiges Verhalten: bis hierher war jedes Turnier
-- oeffentlich abrufbar, sobald jemand die interne ID kannte. Die Vorgabe
-- `PRIVATE` greift ab der naechsten Einfuegung.
UPDATE "tournaments" SET "visibility" = 'PUBLIC';