DO $$
DECLARE
  violations text[] := '{}';
  offenders text;
BEGIN
  -- Bestandscheck vor den Constraints. Postgres meldete sonst nur
  -- "violates check constraint" ohne die betroffenen Zeilen. Welcher Stand
  -- einer widerspruechlichen Zeile stimmt, ist eine fachliche Entscheidung
  -- und gehoert nicht in eine Migration -- deshalb Abbruch mit Namen statt
  -- automatischer Korrektur (dieselbe Systematik wie Migration 0022).
  SELECT string_agg(id::text, ', ' ORDER BY id) INTO offenders
  FROM "matches"
  WHERE (status = 'COMPLETED') <> (winner_seat IS NOT NULL AND completed_at IS NOT NULL);
  IF offenders IS NOT NULL THEN
    violations := violations || format('matches_completion_check (matches: %s)', offenders);
  END IF;

  SELECT string_agg(id::text, ', ' ORDER BY id) INTO offenders
  FROM "legs"
  WHERE (status = 'COMPLETED') <> (winner_seat IS NOT NULL);
  IF offenders IS NOT NULL THEN
    violations := violations || format('legs_completion_check (legs: %s)', offenders);
  END IF;

  SELECT string_agg(id::text, ', ' ORDER BY id) INTO offenders
  FROM "visits"
  WHERE outcome <> 'BUST' AND score_after <> score_before - applied_points;
  IF offenders IS NOT NULL THEN
    violations := violations || format('visits_scored_arithmetic_check (visits: %s)', offenders);
  END IF;

  SELECT string_agg(id::text, ', ' ORDER BY id) INTO offenders
  FROM "visits"
  WHERE outcome = 'BUST' AND (applied_points <> 0 OR score_after <> score_before);
  IF offenders IS NOT NULL THEN
    violations := violations || format('visits_bust_arithmetic_check (visits: %s)', offenders);
  END IF;

  SELECT string_agg(id::text, ', ' ORDER BY id) INTO offenders
  FROM "visits"
  WHERE outcome LIKE '%WON' AND score_after <> 0;
  IF offenders IS NOT NULL THEN
    violations := violations || format('visits_won_arithmetic_check (visits: %s)', offenders);
  END IF;

  SELECT string_agg(format('%s/%s', match_id, resulting_version), ', ') INTO offenders
  FROM (
    SELECT match_id, resulting_version FROM "score_commands"
    GROUP BY match_id, resulting_version HAVING count(*) > 1
  ) AS duplicates;
  IF offenders IS NOT NULL THEN
    violations := violations || format('score_commands_match_version_unique (match/version: %s)', offenders);
  END IF;

  SELECT string_agg(format('%s/%s', tournament_id, resulting_version), ', ') INTO offenders
  FROM (
    SELECT tournament_id, resulting_version FROM "tournament_commands"
    GROUP BY tournament_id, resulting_version HAVING count(*) > 1
  ) AS duplicates;
  IF offenders IS NOT NULL THEN
    violations := violations || format('tournament_commands_tournament_version_unique (tournament/version: %s)', offenders);
  END IF;

  SELECT string_agg(format('%s/%s', encounter_id, resulting_version), ', ') INTO offenders
  FROM (
    SELECT encounter_id, resulting_version FROM "encounter_commands"
    GROUP BY encounter_id, resulting_version HAVING count(*) > 1
  ) AS duplicates;
  IF offenders IS NOT NULL THEN
    violations := violations || format('encounter_commands_encounter_version_unique (encounter/version: %s)', offenders);
  END IF;

  IF array_length(violations, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0023 abgebrochen: %. Die genannten Zeilen fachlich klaeren und die Migration danach erneut ausfuehren.', array_to_string(violations, ' | ');
  END IF;
END $$;

ALTER TABLE "outbox_events" ADD COLUMN "sequence" bigserial NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "encounter_commands_encounter_version_unique" ON "encounter_commands" USING btree ("encounter_id","resulting_version");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_events_sequence_unique" ON "outbox_events" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_publication_idx" ON "outbox_events" USING btree ("sequence") WHERE "outbox_events"."published_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_events_pending_statistics_idx" ON "outbox_events" USING btree ("sequence") WHERE "outbox_events"."statistics_processed_at" is null and "outbox_events"."event_type" = 'MATCH_COMPLETED';--> statement-breakpoint
CREATE UNIQUE INDEX "score_commands_match_version_unique" ON "score_commands" USING btree ("match_id","resulting_version");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_commands_tournament_version_unique" ON "tournament_commands" USING btree ("tournament_id","resulting_version");--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_completion_check" CHECK (("legs"."status" = 'COMPLETED') = ("legs"."winner_seat" is not null));--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_completion_check" CHECK (("matches"."status" = 'COMPLETED') = ("matches"."winner_seat" is not null and "matches"."completed_at" is not null));--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_scored_arithmetic_check" CHECK ("visits"."outcome" = 'BUST' or "visits"."score_after" = "visits"."score_before" - "visits"."applied_points");--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_bust_arithmetic_check" CHECK ("visits"."outcome" <> 'BUST' or ("visits"."applied_points" = 0 and "visits"."score_after" = "visits"."score_before"));--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_won_arithmetic_check" CHECK ("visits"."outcome" not like '%WON' or "visits"."score_after" = 0);