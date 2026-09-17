-- Profilbilder liegen als Bytes in der Datenbank statt in einem Bucket
-- (ADR 0016): keine zweite Konsistenzdomäne, keine Zugangsdaten je Umgebung,
-- Löschen per Fremdschlüssel. Gespeichert wird ausschliesslich das vom Server
-- erzeugte 256-px-WebP, nie die hochgeladene Datei.
CREATE TABLE "player_avatars" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "player_id" uuid NOT NULL,
  "content_type" varchar(50) NOT NULL,
  "bytes" bytea NOT NULL,
  "byte_size" integer NOT NULL,
  "checksum" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "player_avatars" ADD CONSTRAINT "player_avatars_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_avatars" ADD CONSTRAINT "player_avatars_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_avatars_player_unique" ON "player_avatars" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "player_avatars_organization_idx" ON "player_avatars" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "player_avatars" ADD CONSTRAINT "player_avatars_content_type_check" CHECK ("player_avatars"."content_type" = 'image/webp');--> statement-breakpoint
ALTER TABLE "player_avatars" ADD CONSTRAINT "player_avatars_byte_size_check" CHECK ("player_avatars"."byte_size" > 0 and "player_avatars"."byte_size" <= 262144);
