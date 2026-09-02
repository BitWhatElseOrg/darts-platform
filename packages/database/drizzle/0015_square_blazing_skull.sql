ALTER TABLE "visits" RENAME COLUMN "player_id" TO "thrower_player_id";--> statement-breakpoint
ALTER TABLE "legs" DROP CONSTRAINT "legs_starting_player_id_players_id_fk";
--> statement-breakpoint
ALTER TABLE "legs" DROP CONSTRAINT "legs_winner_player_id_players_id_fk";
--> statement-breakpoint
ALTER TABLE "match_participants" DROP CONSTRAINT "match_participants_player_id_players_id_fk";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT "matches_starting_player_id_players_id_fk";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT "matches_current_player_id_players_id_fk";
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT "matches_winner_player_id_players_id_fk";
--> statement-breakpoint
ALTER TABLE "visits" DROP CONSTRAINT "visits_player_id_players_id_fk";
--> statement-breakpoint
DROP INDEX "match_participants_match_player_unique";--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_thrower_player_id_players_id_fk" FOREIGN KEY ("thrower_player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legs" DROP COLUMN "starting_player_id";--> statement-breakpoint
ALTER TABLE "legs" DROP COLUMN "winner_player_id";--> statement-breakpoint
ALTER TABLE "match_participants" DROP COLUMN "player_id";--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN "starting_player_id";--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN "current_player_id";--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN "winner_player_id";