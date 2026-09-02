CREATE TABLE "match_participant_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "match_participant_players_position_check" CHECK ("match_participant_players"."position" in (1, 2))
);
--> statement-breakpoint
ALTER TABLE "legs" ADD COLUMN "starting_seat" integer;--> statement-breakpoint
ALTER TABLE "legs" ADD COLUMN "winner_seat" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "starting_seat" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "current_seat" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "winner_seat" integer;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "seat" integer;--> statement-breakpoint
ALTER TABLE "match_participant_players" ADD CONSTRAINT "match_participant_players_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participant_players" ADD CONSTRAINT "match_participant_players_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participant_players" ADD CONSTRAINT "match_participant_players_participant_id_match_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."match_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participant_players" ADD CONSTRAINT "match_participant_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_participant_players_participant_position_unique" ON "match_participant_players" USING btree ("participant_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "match_participant_players_match_player_unique" ON "match_participant_players" USING btree ("match_id","player_id");--> statement-breakpoint
CREATE INDEX "match_participant_players_organization_player_idx" ON "match_participant_players" USING btree ("organization_id","player_id");
--> statement-breakpoint
INSERT INTO "match_participant_players"
  ("organization_id", "match_id", "participant_id", "player_id", "position")
SELECT mp."organization_id", mp."match_id", mp."id", mp."player_id", 1
FROM "match_participants" mp;
--> statement-breakpoint
UPDATE "matches" m SET "starting_seat" = mp."seat"
FROM "match_participants" mp
WHERE mp."match_id" = m."id" AND mp."player_id" = m."starting_player_id";
--> statement-breakpoint
UPDATE "matches" m SET "current_seat" = mp."seat"
FROM "match_participants" mp
WHERE mp."match_id" = m."id" AND mp."player_id" = m."current_player_id";
--> statement-breakpoint
UPDATE "matches" m SET "winner_seat" = mp."seat"
FROM "match_participants" mp
WHERE mp."match_id" = m."id" AND mp."player_id" = m."winner_player_id";
--> statement-breakpoint
UPDATE "legs" l SET "starting_seat" = mp."seat"
FROM "match_participants" mp
WHERE mp."match_id" = l."match_id" AND mp."player_id" = l."starting_player_id";
--> statement-breakpoint
UPDATE "legs" l SET "winner_seat" = mp."seat"
FROM "match_participants" mp
WHERE mp."match_id" = l."match_id" AND mp."player_id" = l."winner_player_id";
--> statement-breakpoint
UPDATE "visits" v SET "seat" = mp."seat"
FROM "match_participants" mp
WHERE mp."match_id" = v."match_id" AND mp."player_id" = v."player_id";
--> statement-breakpoint
ALTER TABLE "legs" ALTER COLUMN "starting_seat" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "starting_seat" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "visits" ALTER COLUMN "seat" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_starting_seat_check" CHECK ("legs"."starting_seat" in (1, 2));--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_winner_seat_check" CHECK ("legs"."winner_seat" is null or "legs"."winner_seat" in (1, 2));--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_starting_seat_check" CHECK ("matches"."starting_seat" in (1, 2));--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_current_seat_check" CHECK ("matches"."current_seat" is null or "matches"."current_seat" in (1, 2));--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_seat_check" CHECK ("matches"."winner_seat" is null or "matches"."winner_seat" in (1, 2));--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_seat_check" CHECK ("visits"."seat" in (1, 2));
