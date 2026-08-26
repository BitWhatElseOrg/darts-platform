CREATE TABLE "player_statistic_aggregates" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "statistics_processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "player_statistic_aggregates" ADD CONSTRAINT "player_statistic_aggregates_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_statistic_aggregates" ADD CONSTRAINT "player_statistic_aggregates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_statistic_aggregates_organization_idx" ON "player_statistic_aggregates" USING btree ("organization_id");