CREATE TABLE "visit_darts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"dart_index" integer NOT NULL,
	"segment" integer NOT NULL,
	"multiplier" integer NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_darts_index_check" CHECK ("visit_darts"."dart_index" between 1 and 3),
	CONSTRAINT "visit_darts_segment_check" CHECK ("visit_darts"."segment" between 0 and 20 or "visit_darts"."segment" = 25),
	CONSTRAINT "visit_darts_multiplier_check" CHECK ("visit_darts"."multiplier" between 1 and 3),
	CONSTRAINT "visit_darts_miss_check" CHECK ("visit_darts"."segment" <> 0 or "visit_darts"."multiplier" = 1),
	CONSTRAINT "visit_darts_bull_check" CHECK ("visit_darts"."segment" <> 25 or "visit_darts"."multiplier" <= 2),
	CONSTRAINT "visit_darts_value_check" CHECK ("visit_darts"."value" = "visit_darts"."segment" * "visit_darts"."multiplier")
);
--> statement-breakpoint
ALTER TABLE "visit_darts" ADD CONSTRAINT "visit_darts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_darts" ADD CONSTRAINT "visit_darts_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visit_darts_visit_index_unique" ON "visit_darts" USING btree ("visit_id","dart_index");--> statement-breakpoint
CREATE INDEX "visit_darts_organization_visit_idx" ON "visit_darts" USING btree ("organization_id","visit_id");--> statement-breakpoint
CREATE INDEX "visits_organization_thrower_idx" ON "visits" USING btree ("organization_id","thrower_player_id");