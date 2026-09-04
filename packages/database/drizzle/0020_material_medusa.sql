-- Eine Mannschaft führt genau einen aktiven Captain.
-- Bestehende Kader können mehrere tragen, weil die Rollenauswahl der Fläche
-- nach dem Aufnehmen stehen blieb. Alle ausser dem zuerst aufgenommenen
-- Captain werden auf PLAYER zurückgesetzt, damit der Index greifen kann.
UPDATE "team_players" AS "later"
SET "role" = 'PLAYER'
WHERE "later"."valid_to" IS NULL
  AND "later"."role" = 'CAPTAIN'
  AND EXISTS (
    SELECT 1
    FROM "team_players" AS "first"
    WHERE "first"."team_id" = "later"."team_id"
      AND "first"."valid_to" IS NULL
      AND "first"."role" = 'CAPTAIN'
      AND ("first"."valid_from", "first"."id") < ("later"."valid_from", "later"."id")
  );
--> statement-breakpoint
CREATE UNIQUE INDEX "team_players_team_captain_unique" ON "team_players" USING btree ("team_id") WHERE "team_players"."valid_to" is null and "team_players"."role" = 'CAPTAIN';
