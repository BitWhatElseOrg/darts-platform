ALTER TABLE "players" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Ein Konto ist je Organisation hoechstens ein Spieler. Beliebig viele Spieler
-- bleiben kontolos, deshalb der partielle Index statt eines Unique-Constraints.
CREATE UNIQUE INDEX "players_organization_user_unique" ON "players" USING btree ("organization_id","user_id") WHERE "user_id" is not null;--> statement-breakpoint
CREATE INDEX "players_user_id_idx" ON "players" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD COLUMN "player_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;
