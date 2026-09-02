CREATE TABLE "competition_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"role" varchar(20) DEFAULT 'REGULAR' NOT NULL,
	"discipline" varchar(20) NOT NULL,
	"label" varchar(60) NOT NULL,
	"home_position" integer,
	"away_position" integer,
	"starting_score" integer NOT NULL,
	"in_rule" varchar(10) DEFAULT 'STRAIGHT' NOT NULL,
	"out_rule" varchar(10) DEFAULT 'DOUBLE' NOT NULL,
	"max_rounds" integer,
	"best_of_legs" integer NOT NULL,
	"legs_to_win_set" integer DEFAULT 2 NOT NULL,
	"sets_to_win" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "competition_slots_role_check" CHECK ("competition_slots"."role" in ('REGULAR', 'DECIDER')),
	CONSTRAINT "competition_slots_discipline_check" CHECK ("competition_slots"."discipline" in ('SINGLES', 'DOUBLES')),
	CONSTRAINT "competition_slots_sequence_check" CHECK ("competition_slots"."sequence" > 0),
	CONSTRAINT "competition_slots_starting_score_check" CHECK ("competition_slots"."starting_score" in (301, 501, 701)),
	CONSTRAINT "competition_slots_in_rule_check" CHECK ("competition_slots"."in_rule" in ('STRAIGHT', 'DOUBLE')),
	CONSTRAINT "competition_slots_out_rule_check" CHECK ("competition_slots"."out_rule" in ('SINGLE', 'DOUBLE', 'MASTER')),
	CONSTRAINT "competition_slots_max_rounds_check" CHECK ("competition_slots"."max_rounds" is null or "competition_slots"."max_rounds" > 0),
	CONSTRAINT "competition_slots_best_of_legs_check" CHECK ("competition_slots"."best_of_legs" > 0 and mod("competition_slots"."best_of_legs", 2) = 1),
	CONSTRAINT "competition_slots_distance_check" CHECK ("competition_slots"."legs_to_win_set" > 0 and "competition_slots"."sets_to_win" > 0),
	CONSTRAINT "competition_slots_positions_discipline_check" CHECK (("competition_slots"."discipline" = 'SINGLES') = ("competition_slots"."home_position" is not null)),
	CONSTRAINT "competition_slots_positions_pair_check" CHECK (("competition_slots"."home_position" is null) = ("competition_slots"."away_position" is null)),
	CONSTRAINT "competition_slots_home_position_check" CHECK ("competition_slots"."home_position" is null or "competition_slots"."home_position" > 0),
	CONSTRAINT "competition_slots_away_position_check" CHECK ("competition_slots"."away_position" is null or "competition_slots"."away_position" > 0)
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"status" varchar(30) NOT NULL,
	"points_win" integer DEFAULT 3 NOT NULL,
	"points_draw" integer DEFAULT 1 NOT NULL,
	"points_loss" integer DEFAULT 0 NOT NULL,
	"points_decider_bonus" integer DEFAULT 1 NOT NULL,
	"decider_rule" varchar(20) DEFAULT 'NONE' NOT NULL,
	"lineup_positions" integer DEFAULT 4 NOT NULL,
	"min_nominations" integer DEFAULT 4 NOT NULL,
	"min_nominations_shorthanded" integer DEFAULT 3 NOT NULL,
	"max_substitutions_per_encounter" integer DEFAULT 4 NOT NULL,
	"max_doubles_per_player" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitions_type_check" CHECK ("competitions"."type" in ('LEAGUE')),
	CONSTRAINT "competitions_status_check" CHECK ("competitions"."status" in ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "competitions_decider_rule_check" CHECK ("competitions"."decider_rule" in ('NONE', 'EXTRA_SLOT')),
	CONSTRAINT "competitions_points_order_check" CHECK ("competitions"."points_win" >= "competitions"."points_draw" and "competitions"."points_draw" >= "competitions"."points_loss"),
	CONSTRAINT "competitions_points_loss_check" CHECK ("competitions"."points_loss" >= 0),
	CONSTRAINT "competitions_decider_bonus_check" CHECK ("competitions"."points_decider_bonus" >= 0),
	CONSTRAINT "competitions_decider_bonus_rule_check" CHECK ("competitions"."points_decider_bonus" = 0 or "competitions"."decider_rule" = 'EXTRA_SLOT'),
	CONSTRAINT "competitions_lineup_positions_check" CHECK ("competitions"."lineup_positions" > 0),
	CONSTRAINT "competitions_min_nominations_check" CHECK ("competitions"."min_nominations" >= "competitions"."lineup_positions"),
	CONSTRAINT "competitions_min_nominations_shorthanded_check" CHECK ("competitions"."min_nominations_shorthanded" > 0 and "competitions"."min_nominations_shorthanded" <= "competitions"."min_nominations"),
	CONSTRAINT "competitions_max_substitutions_check" CHECK ("competitions"."max_substitutions_per_encounter" >= 0),
	CONSTRAINT "competitions_max_doubles_check" CHECK ("competitions"."max_doubles_per_player" >= 0),
	CONSTRAINT "competitions_version_check" CHECK ("competitions"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "encounter_commands" (
	"command_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"payload" jsonb NOT NULL,
	"resulting_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "encounter_commands_type_check" CHECK ("encounter_commands"."type" in ('SUBMIT_NOMINATIONS', 'SUBMIT_DOUBLES', 'SUBSTITUTE_PLAYER', 'START_ENCOUNTER', 'ASSIGN_SLOT', 'RELEASE_BOARD', 'DECLARE_WALKOVER', 'DECLARE_ENCOUNTER_FORFEIT', 'CANCEL_ENCOUNTER')),
	CONSTRAINT "encounter_commands_version_check" CHECK ("encounter_commands"."resulting_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "encounter_lineup_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"side" varchar(10) NOT NULL,
	"position" integer NOT NULL,
	"player_id" uuid NOT NULL,
	CONSTRAINT "encounter_lineup_entries_side_check" CHECK ("encounter_lineup_entries"."side" in ('HOME', 'AWAY')),
	CONSTRAINT "encounter_lineup_entries_position_check" CHECK ("encounter_lineup_entries"."position" in (1, 2))
);
--> statement-breakpoint
CREATE TABLE "encounter_nominations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"side" varchar(10) NOT NULL,
	"player_id" uuid NOT NULL,
	"position" integer,
	"origin" varchar(20) DEFAULT 'SQUAD' NOT NULL,
	CONSTRAINT "encounter_nominations_side_check" CHECK ("encounter_nominations"."side" in ('HOME', 'AWAY')),
	CONSTRAINT "encounter_nominations_position_check" CHECK ("encounter_nominations"."position" is null or "encounter_nominations"."position" > 0),
	CONSTRAINT "encounter_nominations_origin_check" CHECK ("encounter_nominations"."origin" in ('SQUAD', 'GUEST'))
);
--> statement-breakpoint
CREATE TABLE "encounter_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"role" varchar(20) NOT NULL,
	"discipline" varchar(20) NOT NULL,
	"label" varchar(60) NOT NULL,
	"home_position" integer,
	"away_position" integer,
	"starting_score" integer NOT NULL,
	"in_rule" varchar(10) NOT NULL,
	"out_rule" varchar(10) NOT NULL,
	"max_rounds" integer,
	"best_of_legs" integer NOT NULL,
	"legs_to_win_set" integer NOT NULL,
	"sets_to_win" integer NOT NULL,
	"status" varchar(30) DEFAULT 'WAITING' NOT NULL,
	"board_id" uuid,
	"match_id" uuid,
	"winner_side" varchar(10),
	"result_type" varchar(20),
	"home_legs" integer DEFAULT 0 NOT NULL,
	"away_legs" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "encounter_slots_status_check" CHECK ("encounter_slots"."status" in ('WAITING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'WALKOVER', 'CANCELLED')),
	CONSTRAINT "encounter_slots_role_check" CHECK ("encounter_slots"."role" in ('REGULAR', 'DECIDER')),
	CONSTRAINT "encounter_slots_discipline_check" CHECK ("encounter_slots"."discipline" in ('SINGLES', 'DOUBLES')),
	CONSTRAINT "encounter_slots_sequence_check" CHECK ("encounter_slots"."sequence" > 0),
	CONSTRAINT "encounter_slots_version_check" CHECK ("encounter_slots"."version" >= 0),
	CONSTRAINT "encounter_slots_winner_side_check" CHECK ("encounter_slots"."winner_side" is null or "encounter_slots"."winner_side" in ('HOME', 'AWAY')),
	CONSTRAINT "encounter_slots_result_type_check" CHECK ("encounter_slots"."result_type" is null or "encounter_slots"."result_type" in ('PLAYED', 'WALKOVER')),
	CONSTRAINT "encounter_slots_result_status_check" CHECK (("encounter_slots"."status" in ('COMPLETED', 'WALKOVER')) = ("encounter_slots"."result_type" is not null)),
	CONSTRAINT "encounter_slots_result_winner_check" CHECK ("encounter_slots"."result_type" is null or "encounter_slots"."winner_side" is not null),
	CONSTRAINT "encounter_slots_walkover_match_check" CHECK ("encounter_slots"."result_type" <> 'WALKOVER' or "encounter_slots"."match_id" is null),
	CONSTRAINT "encounter_slots_positions_discipline_check" CHECK (("encounter_slots"."discipline" = 'SINGLES') = ("encounter_slots"."home_position" is not null)),
	CONSTRAINT "encounter_slots_positions_pair_check" CHECK (("encounter_slots"."home_position" is null) = ("encounter_slots"."away_position" is null)),
	CONSTRAINT "encounter_slots_legs_check" CHECK ("encounter_slots"."home_legs" >= 0 and "encounter_slots"."away_legs" >= 0)
);
--> statement-breakpoint
CREATE TABLE "encounter_substitutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"side" varchar(10) NOT NULL,
	"position" integer NOT NULL,
	"out_player_id" uuid NOT NULL,
	"in_player_id" uuid NOT NULL,
	"effective_from_sequence" integer NOT NULL,
	"reason" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "encounter_substitutions_side_check" CHECK ("encounter_substitutions"."side" in ('HOME', 'AWAY')),
	CONSTRAINT "encounter_substitutions_position_check" CHECK ("encounter_substitutions"."position" > 0),
	CONSTRAINT "encounter_substitutions_sequence_check" CHECK ("encounter_substitutions"."effective_from_sequence" > 0),
	CONSTRAINT "encounter_substitutions_players_distinct_check" CHECK ("encounter_substitutions"."out_player_id" <> "encounter_substitutions"."in_player_id")
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"matchday" integer NOT NULL,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"venue" varchar(120),
	"status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"home_points" integer DEFAULT 0 NOT NULL,
	"away_points" integer DEFAULT 0 NOT NULL,
	"home_games" integer DEFAULT 0 NOT NULL,
	"away_games" integer DEFAULT 0 NOT NULL,
	"home_legs" integer DEFAULT 0 NOT NULL,
	"away_legs" integer DEFAULT 0 NOT NULL,
	"result" varchar(20),
	"result_type" varchar(20),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "encounters_teams_distinct_check" CHECK ("encounters"."home_team_id" <> "encounters"."away_team_id"),
	CONSTRAINT "encounters_matchday_check" CHECK ("encounters"."matchday" > 0),
	CONSTRAINT "encounters_version_check" CHECK ("encounters"."version" >= 0),
	CONSTRAINT "encounters_status_check" CHECK ("encounters"."status" in ('DRAFT', 'LINEUPS_OPEN', 'READY', 'RUNNING', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "encounters_result_check" CHECK ("encounters"."result" is null or "encounters"."result" in ('HOME_WIN', 'AWAY_WIN', 'DRAW')),
	CONSTRAINT "encounters_result_type_check" CHECK ("encounters"."result_type" is null or "encounters"."result_type" in ('PLAYED', 'DECIDER', 'FORFEIT')),
	CONSTRAINT "encounters_completed_result_check" CHECK (("encounters"."status" = 'COMPLETED') = ("encounters"."result" is not null)),
	CONSTRAINT "encounters_result_pair_check" CHECK (("encounters"."result" is null) = ("encounters"."result_type" is null)),
	CONSTRAINT "encounters_draw_result_type_check" CHECK ("encounters"."result" <> 'DRAW' or "encounters"."result_type" = 'PLAYED')
);
--> statement-breakpoint
CREATE TABLE "team_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"role" varchar(20) DEFAULT 'PLAYER' NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	CONSTRAINT "team_players_role_check" CHECK ("team_players"."role" in ('PLAYER', 'CAPTAIN')),
	CONSTRAINT "team_players_validity_check" CHECK ("team_players"."valid_to" is null or "team_players"."valid_to" > "team_players"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"short_name" varchar(20),
	"status" varchar(30) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_name_not_empty" CHECK (length(trim("teams"."name")) > 0),
	CONSTRAINT "teams_status_check" CHECK ("teams"."status" in ('ACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
ALTER TABLE "score_commands" DROP CONSTRAINT "score_commands_type_check";--> statement-breakpoint
ALTER TABLE "competition_slots" ADD CONSTRAINT "competition_slots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_slots" ADD CONSTRAINT "competition_slots_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_commands" ADD CONSTRAINT "encounter_commands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_commands" ADD CONSTRAINT "encounter_commands_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_lineup_entries" ADD CONSTRAINT "encounter_lineup_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_lineup_entries" ADD CONSTRAINT "encounter_lineup_entries_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_lineup_entries" ADD CONSTRAINT "encounter_lineup_entries_slot_id_encounter_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."encounter_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_lineup_entries" ADD CONSTRAINT "encounter_lineup_entries_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_nominations" ADD CONSTRAINT "encounter_nominations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_nominations" ADD CONSTRAINT "encounter_nominations_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_nominations" ADD CONSTRAINT "encounter_nominations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_slots" ADD CONSTRAINT "encounter_slots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_slots" ADD CONSTRAINT "encounter_slots_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_slots" ADD CONSTRAINT "encounter_slots_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_slots" ADD CONSTRAINT "encounter_slots_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_substitutions" ADD CONSTRAINT "encounter_substitutions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_substitutions" ADD CONSTRAINT "encounter_substitutions_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_substitutions" ADD CONSTRAINT "encounter_substitutions_out_player_id_players_id_fk" FOREIGN KEY ("out_player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_substitutions" ADD CONSTRAINT "encounter_substitutions_in_player_id_players_id_fk" FOREIGN KEY ("in_player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_players" ADD CONSTRAINT "team_players_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_players" ADD CONSTRAINT "team_players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_players" ADD CONSTRAINT "team_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competition_slots_competition_sequence_unique" ON "competition_slots" USING btree ("competition_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_slots_competition_decider_unique" ON "competition_slots" USING btree ("competition_id","role") WHERE "competition_slots"."role" = 'DECIDER';--> statement-breakpoint
CREATE UNIQUE INDEX "competition_slots_singles_pairing_unique" ON "competition_slots" USING btree ("competition_id","home_position","away_position") WHERE "competition_slots"."discipline" = 'SINGLES';--> statement-breakpoint
CREATE INDEX "competition_slots_organization_idx" ON "competition_slots" USING btree ("organization_id","competition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitions_organization_slug_unique" ON "competitions" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "competitions_organization_status_idx" ON "competitions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "encounter_commands_organization_encounter_idx" ON "encounter_commands" USING btree ("organization_id","encounter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "encounter_lineup_entries_slot_side_position_unique" ON "encounter_lineup_entries" USING btree ("slot_id","side","position");--> statement-breakpoint
CREATE UNIQUE INDEX "encounter_lineup_entries_slot_side_player_unique" ON "encounter_lineup_entries" USING btree ("slot_id","side","player_id");--> statement-breakpoint
CREATE INDEX "encounter_lineup_entries_organization_encounter_idx" ON "encounter_lineup_entries" USING btree ("organization_id","encounter_id");--> statement-breakpoint
CREATE INDEX "encounter_lineup_entries_encounter_player_idx" ON "encounter_lineup_entries" USING btree ("encounter_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "encounter_nominations_side_player_unique" ON "encounter_nominations" USING btree ("encounter_id","side","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "encounter_nominations_side_position_unique" ON "encounter_nominations" USING btree ("encounter_id","side","position");--> statement-breakpoint
CREATE INDEX "encounter_nominations_organization_encounter_idx" ON "encounter_nominations" USING btree ("organization_id","encounter_id");--> statement-breakpoint
CREATE INDEX "encounter_nominations_encounter_player_idx" ON "encounter_nominations" USING btree ("encounter_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "encounter_slots_encounter_sequence_unique" ON "encounter_slots" USING btree ("encounter_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "encounter_slots_match_unique" ON "encounter_slots" USING btree ("match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "encounter_slots_board_in_progress_unique" ON "encounter_slots" USING btree ("board_id") WHERE "encounter_slots"."status" = 'IN_PROGRESS';--> statement-breakpoint
CREATE INDEX "encounter_slots_organization_encounter_status_idx" ON "encounter_slots" USING btree ("organization_id","encounter_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "encounter_substitutions_side_position_sequence_unique" ON "encounter_substitutions" USING btree ("encounter_id","side","position","effective_from_sequence");--> statement-breakpoint
CREATE INDEX "encounter_substitutions_organization_encounter_idx" ON "encounter_substitutions" USING btree ("organization_id","encounter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_public_id_unique" ON "encounters" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_matchday_home_unique" ON "encounters" USING btree ("competition_id","matchday","home_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_matchday_away_unique" ON "encounters" USING btree ("competition_id","matchday","away_team_id");--> statement-breakpoint
CREATE INDEX "encounters_organization_competition_status_idx" ON "encounters" USING btree ("organization_id","competition_id","status");--> statement-breakpoint
CREATE INDEX "encounters_organization_scheduled_idx" ON "encounters" USING btree ("organization_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_players_team_player_from_unique" ON "team_players" USING btree ("team_id","player_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "team_players_team_player_active_unique" ON "team_players" USING btree ("team_id","player_id") WHERE "team_players"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "team_players_organization_player_idx" ON "team_players" USING btree ("organization_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_organization_name_unique" ON "teams" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "teams_organization_status_idx" ON "teams" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "score_commands" ADD CONSTRAINT "score_commands_type_check" CHECK ("score_commands"."type" in ('SUBMIT_VISIT', 'UNDO_LAST_VISIT', 'ABORT_MATCH', 'DECIDE_LEG_START', 'DECIDE_LEG_BY_BULL'));