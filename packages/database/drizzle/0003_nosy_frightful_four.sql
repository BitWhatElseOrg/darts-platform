CREATE TABLE "tournament_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"ring_number" integer NOT NULL,
	CONSTRAINT "tournament_boards_ring_check" CHECK ("tournament_boards"."ring_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "tournament_commands" (
	"command_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"payload" jsonb NOT NULL,
	"resulting_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_commands_type_check" CHECK ("tournament_commands"."type" in ('ASSIGN_MATCH', 'RELEASE_BOARD')),
	CONSTRAINT "tournament_commands_version_check" CHECK ("tournament_commands"."resulting_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tournament_group_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"seed" integer NOT NULL,
	CONSTRAINT "tournament_group_participants_seed_check" CHECK ("tournament_group_participants"."seed" > 0)
);
--> statement-breakpoint
CREATE TABLE "tournament_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"key" varchar(80) NOT NULL,
	"label" varchar(20) NOT NULL,
	"sequence" integer NOT NULL,
	"qualify_count" integer NOT NULL,
	CONSTRAINT "tournament_groups_sequence_check" CHECK ("tournament_groups"."sequence" > 0),
	CONSTRAINT "tournament_groups_qualify_count_check" CHECK ("tournament_groups"."qualify_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "tournament_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"group_id" uuid,
	"key" varchar(120) NOT NULL,
	"stage_label" varchar(120) NOT NULL,
	"round" integer NOT NULL,
	"position" integer NOT NULL,
	"status" varchar(30) NOT NULL,
	"participant_one_id" uuid,
	"participant_two_id" uuid,
	"participant_one_ref" jsonb,
	"participant_two_ref" jsonb,
	"source_one_match_id" uuid,
	"source_two_match_id" uuid,
	"board_id" uuid,
	"scoring_match_id" uuid,
	"winner_player_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_matches_round_check" CHECK ("tournament_matches"."round" > 0),
	CONSTRAINT "tournament_matches_position_check" CHECK ("tournament_matches"."position" > 0),
	CONSTRAINT "tournament_matches_version_check" CHECK ("tournament_matches"."version" >= 0),
	CONSTRAINT "tournament_matches_status_check" CHECK ("tournament_matches"."status" in ('WAITING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'BYE', 'CANCELLED')),
	CONSTRAINT "tournament_matches_participants_different" CHECK ("tournament_matches"."participant_one_id" is null or "tournament_matches"."participant_two_id" is null or "tournament_matches"."participant_one_id" <> "tournament_matches"."participant_two_id")
);
--> statement-breakpoint
CREATE TABLE "tournament_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"seed" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_participants_seed_check" CHECK ("tournament_participants"."seed" > 0)
);
--> statement-breakpoint
CREATE TABLE "tournament_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"key" varchar(80) NOT NULL,
	"sequence" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" varchar(40) NOT NULL,
	"status" varchar(30) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_stages_sequence_check" CHECK ("tournament_stages"."sequence" > 0),
	CONSTRAINT "tournament_stages_type_check" CHECK ("tournament_stages"."type" in ('GROUP', 'ROUND_ROBIN', 'SINGLE_ELIMINATION')),
	CONSTRAINT "tournament_stages_status_check" CHECK ("tournament_stages"."status" in ('OPEN', 'WAITING', 'COMPLETED'))
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"status" varchar(30) DEFAULT 'READY' NOT NULL,
	"format" varchar(40) NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"starting_score" integer DEFAULT 501 NOT NULL,
	"double_out" boolean DEFAULT true NOT NULL,
	"best_of_legs" integer DEFAULT 3 NOT NULL,
	"group_count" integer NOT NULL,
	"qualify_per_group" integer NOT NULL,
	"knockout_size" integer NOT NULL,
	"seeding" varchar(20) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournaments_name_not_empty" CHECK (length(trim("tournaments"."name")) > 0),
	CONSTRAINT "tournaments_status_check" CHECK ("tournaments"."status" in ('READY', 'GROUP_STAGE', 'KNOCKOUT', 'COMPLETED')),
	CONSTRAINT "tournaments_format_check" CHECK ("tournaments"."format" in ('GROUPS_THEN_KNOCKOUT', 'ROUND_ROBIN', 'SINGLE_ELIMINATION')),
	CONSTRAINT "tournaments_version_check" CHECK ("tournaments"."version" >= 0),
	CONSTRAINT "tournaments_starting_score_check" CHECK ("tournaments"."starting_score" in (301, 501, 701)),
	CONSTRAINT "tournaments_best_of_legs_check" CHECK ("tournaments"."best_of_legs" > 0 and mod("tournaments"."best_of_legs", 2) = 1),
	CONSTRAINT "tournaments_group_count_check" CHECK ("tournaments"."group_count" between 1 and 32),
	CONSTRAINT "tournaments_qualify_per_group_check" CHECK ("tournaments"."qualify_per_group" between 1 and 8),
	CONSTRAINT "tournaments_knockout_size_check" CHECK ("tournaments"."knockout_size" in (2, 4, 8, 16, 32, 64)),
	CONSTRAINT "tournaments_seeding_check" CHECK ("tournaments"."seeding" in ('SEEDED', 'RANDOM'))
);
--> statement-breakpoint
ALTER TABLE "tournament_boards" ADD CONSTRAINT "tournament_boards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_boards" ADD CONSTRAINT "tournament_boards_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_boards" ADD CONSTRAINT "tournament_boards_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_commands" ADD CONSTRAINT "tournament_commands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_commands" ADD CONSTRAINT "tournament_commands_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_group_participants" ADD CONSTRAINT "tournament_group_participants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_group_participants" ADD CONSTRAINT "tournament_group_participants_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_group_participants" ADD CONSTRAINT "tournament_group_participants_group_id_tournament_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."tournament_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_group_participants" ADD CONSTRAINT "tournament_group_participants_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_groups" ADD CONSTRAINT "tournament_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_groups" ADD CONSTRAINT "tournament_groups_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_groups" ADD CONSTRAINT "tournament_groups_stage_id_tournament_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."tournament_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_stage_id_tournament_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."tournament_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_group_id_tournament_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."tournament_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_participant_one_id_players_id_fk" FOREIGN KEY ("participant_one_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_participant_two_id_players_id_fk" FOREIGN KEY ("participant_two_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_scoring_match_id_matches_id_fk" FOREIGN KEY ("scoring_match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_winner_player_id_players_id_fk" FOREIGN KEY ("winner_player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_stages" ADD CONSTRAINT "tournament_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_stages" ADD CONSTRAINT "tournament_stages_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_boards_tournament_board_unique" ON "tournament_boards" USING btree ("tournament_id","board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_boards_tournament_ring_unique" ON "tournament_boards" USING btree ("tournament_id","ring_number");--> statement-breakpoint
CREATE INDEX "tournament_boards_organization_idx" ON "tournament_boards" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "tournament_commands_organization_tournament_idx" ON "tournament_commands" USING btree ("organization_id","tournament_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_group_participants_group_player_unique" ON "tournament_group_participants" USING btree ("group_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_group_participants_tournament_player_unique" ON "tournament_group_participants" USING btree ("tournament_id","player_id");--> statement-breakpoint
CREATE INDEX "tournament_group_participants_organization_idx" ON "tournament_group_participants" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_groups_tournament_key_unique" ON "tournament_groups" USING btree ("tournament_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_groups_stage_sequence_unique" ON "tournament_groups" USING btree ("stage_id","sequence");--> statement-breakpoint
CREATE INDEX "tournament_groups_organization_idx" ON "tournament_groups" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_matches_tournament_key_unique" ON "tournament_matches" USING btree ("tournament_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_matches_scoring_match_unique" ON "tournament_matches" USING btree ("scoring_match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_matches_active_board_unique" ON "tournament_matches" USING btree ("board_id") WHERE "tournament_matches"."status" = 'IN_PROGRESS';--> statement-breakpoint
CREATE INDEX "tournament_matches_organization_tournament_status_idx" ON "tournament_matches" USING btree ("organization_id","tournament_id","status");--> statement-breakpoint
CREATE INDEX "tournament_matches_source_one_idx" ON "tournament_matches" USING btree ("source_one_match_id");--> statement-breakpoint
CREATE INDEX "tournament_matches_source_two_idx" ON "tournament_matches" USING btree ("source_two_match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_participants_tournament_player_unique" ON "tournament_participants" USING btree ("tournament_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_participants_tournament_seed_unique" ON "tournament_participants" USING btree ("tournament_id","seed");--> statement-breakpoint
CREATE INDEX "tournament_participants_organization_idx" ON "tournament_participants" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_stages_tournament_key_unique" ON "tournament_stages" USING btree ("tournament_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_stages_tournament_sequence_unique" ON "tournament_stages" USING btree ("tournament_id","sequence");--> statement-breakpoint
CREATE INDEX "tournament_stages_organization_idx" ON "tournament_stages" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "tournaments_organization_status_idx" ON "tournaments" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "tournaments_organization_starts_at_idx" ON "tournaments" USING btree ("organization_id","starts_at");