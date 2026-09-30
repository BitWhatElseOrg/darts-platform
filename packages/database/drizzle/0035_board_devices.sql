-- Ein fest montiertes Tablet, das die Matches seiner Scheibe ohne
-- Benutzer-Login scort (Spec 2026-09-30-scheiben-tablet, ADR 0019).
-- Gespeichert wird nur der Hash; den Klartext gibt es einmal, in der
-- Antwort, die das Geraet einrichtet. Kein Ablaufdatum: geschuetzt wird
-- ueber Widerruf und die Sichtbarkeit von last_seen_at.
CREATE TABLE "board_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "board_id" uuid NOT NULL,
  "secret_hash" char(64) NOT NULL,
  "label" varchar(80) NOT NULL,
  "created_by" uuid NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "board_devices_secret_hash_format_check" CHECK ("board_devices"."secret_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "board_devices_label_not_empty" CHECK (length(trim("board_devices"."label")) > 0)
);--> statement-breakpoint
-- Eine Lease haelt entweder eine Person oder ein Scheiben-Tablet.
ALTER TABLE "board_controller_leases" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "actor_device_id" uuid;--> statement-breakpoint
ALTER TABLE "board_controller_leases" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "board_devices" ADD CONSTRAINT "board_devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_devices" ADD CONSTRAINT "board_devices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Ziel des zusammengesetzten Fremdschluessels aus board_devices: ein Geraet
-- gehoert zur Organisation seiner Scheibe, erzwungen von der Datenbank. Der
-- Unique-Index muss vor dem Fremdschluessel stehen, sonst fehlt ihm sein Ziel.
CREATE UNIQUE INDEX "boards_id_organization_unique" ON "boards" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "board_devices" ADD CONSTRAINT "board_devices_board_organization_fk" FOREIGN KEY ("board_id","organization_id") REFERENCES "public"."boards"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_devices_secret_hash_unique" ON "board_devices" USING btree ("secret_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "board_devices_board_active_unique" ON "board_devices" USING btree ("board_id") WHERE "board_devices"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "board_devices_organization_idx" ON "board_devices" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_device_id_board_devices_id_fk" FOREIGN KEY ("actor_device_id") REFERENCES "public"."board_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_controller_leases" ADD CONSTRAINT "board_controller_leases_device_id_board_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."board_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Beide leer bleibt zulaessig (System-Ereignisse, geloeschte Akteure).
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_single_actor_check" CHECK (num_nonnulls("audit_events"."actor_user_id", "audit_events"."actor_device_id") <= 1);--> statement-breakpoint
ALTER TABLE "board_controller_leases" ADD CONSTRAINT "board_controller_leases_actor_check" CHECK (num_nonnulls("board_controller_leases"."user_id", "board_controller_leases"."device_id") = 1);
