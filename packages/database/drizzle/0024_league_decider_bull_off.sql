-- Reglement 2.2.9: das Entscheidungsdoppel wird immer ausgebullt. Bestehende
-- Matches erhalten false und verhalten sich unveraendert; ein Bestandscheck
-- eruebrigt sich deshalb.
ALTER TABLE "matches" ADD COLUMN "bull_off_from_leg_one" boolean DEFAULT false NOT NULL;
