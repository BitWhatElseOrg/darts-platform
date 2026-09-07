DO $$
DECLARE
  duplicate_report text;
BEGIN
  -- Bestandscheck vor dem Aufbau des partiellen Unique-Index: existieren
  -- bereits zwei IN_PROGRESS-Matches auf derselben Scheibe (genau der
  -- Zustand, den der Bug bis hierhin erlaubte), scheitert CREATE UNIQUE
  -- INDEX ohnehin mit "key is duplicated" -- diese Meldung nennt zusaetzlich
  -- die betroffenen board_id und match_id, statt die blosse Postgres-Meldung
  -- stehen zu lassen. Die Auswahl, welches der beiden Matches beendet wird,
  -- bleibt eine menschliche Entscheidung (siehe DATABASE_SCHEMA.md) --
  -- automatisch waere hier reines Raten.
  SELECT string_agg(
    format('Board %s: Matches %s', duplicates.board_id, duplicates.match_ids),
    '; '
    ORDER BY duplicates.board_id
  )
  INTO duplicate_report
  FROM (
    SELECT
      board_id,
      string_agg(id::text, ', ' ORDER BY id) AS match_ids
    FROM "matches"
    WHERE status = 'IN_PROGRESS' AND board_id IS NOT NULL
    GROUP BY board_id
    HAVING count(*) > 1
  ) AS duplicates;

  IF duplicate_report IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0022 abgebrochen: mehrere IN_PROGRESS-Matches auf derselben Scheibe (%). Eines der genannten Matches ueber den bestehenden Abbruchpfad (abort) beenden und die Migration danach erneut ausfuehren.', duplicate_report;
  END IF;
END $$;

CREATE UNIQUE INDEX "matches_board_in_progress_unique" ON "matches" USING btree ("board_id") WHERE "matches"."status" = 'IN_PROGRESS';
