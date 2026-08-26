CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"status" varchar(30) DEFAULT 'AVAILABLE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boards_name_not_empty" CHECK (length(trim("boards"."name")) > 0),
	CONSTRAINT "boards_status_check" CHECK ("boards"."status" in ('AVAILABLE', 'IN_USE', 'OFFLINE'))
);
--> statement-breakpoint
CREATE TABLE "legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"leg_number" integer NOT NULL,
	"starting_player_id" uuid NOT NULL,
	"winner_player_id" uuid,
	"status" varchar(30) DEFAULT 'IN_PROGRESS' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legs_number_check" CHECK ("legs"."leg_number" > 0),
	CONSTRAINT "legs_status_check" CHECK ("legs"."status" in ('IN_PROGRESS', 'COMPLETED')),
	CONSTRAINT "legs_version_check" CHECK ("legs"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "match_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"seat" integer NOT NULL,
	"legs_won" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "match_participants_seat_check" CHECK ("match_participants"."seat" in (1, 2)),
	CONSTRAINT "match_participants_legs_won_check" CHECK ("match_participants"."legs_won" >= 0)
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"board_id" uuid,
	"status" varchar(30) DEFAULT 'IN_PROGRESS' NOT NULL,
	"starting_score" integer DEFAULT 501 NOT NULL,
	"best_of_legs" integer NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"starting_player_id" uuid NOT NULL,
	"current_player_id" uuid,
	"winner_player_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_status_check" CHECK ("matches"."status" in ('IN_PROGRESS', 'COMPLETED')),
	CONSTRAINT "matches_starting_score_check" CHECK ("matches"."starting_score" >= 2),
	CONSTRAINT "matches_best_of_legs_check" CHECK ("matches"."best_of_legs" > 0 and mod("matches"."best_of_legs", 2) = 1),
	CONSTRAINT "matches_version_check" CHECK ("matches"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"aggregate_type" varchar(100) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "score_commands" (
	"command_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"payload" jsonb NOT NULL,
	"resulting_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_commands_type_check" CHECK ("score_commands"."type" in ('SUBMIT_VISIT', 'UNDO_LAST_VISIT')),
	CONSTRAINT "score_commands_version_check" CHECK ("score_commands"."resulting_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"leg_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"points" integer NOT NULL,
	"applied_points" integer NOT NULL,
	"darts_thrown" integer NOT NULL,
	"score_before" integer NOT NULL,
	"score_after" integer NOT NULL,
	"checkout_double" integer,
	"outcome" varchar(30) NOT NULL,
	"reverted_at" timestamp with time zone,
	"reverted_by_command_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_points_check" CHECK ("visits"."points" between 0 and 180),
	CONSTRAINT "visits_applied_points_check" CHECK ("visits"."applied_points" between 0 and 180),
	CONSTRAINT "visits_darts_check" CHECK ("visits"."darts_thrown" between 1 and 3),
	CONSTRAINT "visits_scores_check" CHECK ("visits"."score_before" >= 0 and "visits"."score_after" >= 0),
	CONSTRAINT "visits_checkout_double_check" CHECK ("visits"."checkout_double" is null or "visits"."checkout_double" between 1 and 20 or "visits"."checkout_double" = 25),
	CONSTRAINT "visits_outcome_check" CHECK ("visits"."outcome" in ('SCORED', 'BUST', 'LEG_WON', 'SET_WON', 'MATCH_WON'))
);
--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_starting_player_id_players_id_fk" FOREIGN KEY ("starting_player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_winner_player_id_players_id_fk" FOREIGN KEY ("winner_player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_starting_player_id_players_id_fk" FOREIGN KEY ("starting_player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_current_player_id_players_id_fk" FOREIGN KEY ("current_player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_player_id_players_id_fk" FOREIGN KEY ("winner_player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_commands" ADD CONSTRAINT "score_commands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_commands" ADD CONSTRAINT "score_commands_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_leg_id_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "public"."legs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boards_organization_name_unique" ON "boards" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "boards_organization_id_idx" ON "boards" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legs_match_number_unique" ON "legs" USING btree ("match_id","leg_number");--> statement-breakpoint
CREATE INDEX "legs_organization_match_idx" ON "legs" USING btree ("organization_id","match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_participants_match_player_unique" ON "match_participants" USING btree ("match_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_participants_match_seat_unique" ON "match_participants" USING btree ("match_id","seat");--> statement-breakpoint
CREATE INDEX "match_participants_organization_id_idx" ON "match_participants" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "matches_organization_status_idx" ON "matches" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "matches_board_id_idx" ON "matches" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("published_at","occurred_at");--> statement-breakpoint
CREATE INDEX "outbox_events_organization_aggregate_idx" ON "outbox_events" USING btree ("organization_id","aggregate_id");--> statement-breakpoint
CREATE INDEX "score_commands_organization_match_idx" ON "score_commands" USING btree ("organization_id","match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_command_id_unique" ON "visits" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_match_sequence_unique" ON "visits" USING btree ("match_id","sequence");--> statement-breakpoint
CREATE INDEX "visits_organization_match_idx" ON "visits" USING btree ("organization_id","match_id");--> statement-breakpoint
CREATE INDEX "visits_leg_id_idx" ON "visits" USING btree ("leg_id");