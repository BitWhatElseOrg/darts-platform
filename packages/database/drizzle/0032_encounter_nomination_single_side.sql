DO $$
DECLARE
  duplicate_report text;
BEGIN
  -- DRA 6.10.3: Kein Spieler darf in einem Darts-Event fuer mehr als ein Team
  -- spielen. Die Meldung prueft das bisher nur je Seite; eine Aushilfe
  -- (`origin = 'GUEST'`) ist an keinen Kader gebunden, und `team_players`
  -- erlaubt dieselbe Person in mehreren Mannschaften. Stand dieselbe Person auf
  -- beiden Seiten, verwarf `createX01Match` das erzeugte Match beim Lesen mit
  -- DUPLICATE_PLAYER -- also erst, als es laengst angelegt war.
  --
  -- Bestandscheck vor dem Index: welche der beiden Meldungen zurueckgenommen
  -- wird, bleibt eine menschliche Entscheidung (siehe DATABASE_SCHEMA.md).
  SELECT string_agg(
    format('Begegnung %s: Person %s', duplicates.encounter_id, duplicates.player_id),
    '; '
    ORDER BY duplicates.encounter_id, duplicates.player_id
  )
  INTO duplicate_report
  FROM (
    SELECT encounter_id, player_id
    FROM "encounter_nominations"
    GROUP BY encounter_id, player_id
    HAVING count(*) > 1
  ) AS duplicates;

  IF duplicate_report IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0032 abgebrochen: dieselbe Person ist auf beiden Seiten einer Begegnung gemeldet (%). Die betroffene Meldung einer Seite korrigieren und die Migration danach erneut ausfuehren.', duplicate_report;
  END IF;
END $$;--> statement-breakpoint
-- Der bisherige nicht eindeutige Index auf denselben Spalten geht im neuen
-- Unique auf; er trug nur die Suche nach (Begegnung, Person).
DROP INDEX IF EXISTS "encounter_nominations_encounter_player_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "encounter_nominations_encounter_player_unique" ON "encounter_nominations" USING btree ("encounter_id","player_id");
