-- Korrektur von Liga-Resultaten (Spec 2026-10-01-liga-resultatkorrektur):
-- die Leitung oeffnet ein gespieltes Spiel einer abgeschlossenen Begegnung
-- wieder. Das Kommando laeuft wie die uebrigen Begegnungskommandos ueber
-- `encounter_commands` (Idempotenz und Zielversion) und braucht dafuer einen
-- eigenen Typ.
ALTER TABLE "encounter_commands" DROP CONSTRAINT "encounter_commands_type_check";--> statement-breakpoint
ALTER TABLE "encounter_commands" ADD CONSTRAINT "encounter_commands_type_check" CHECK ("encounter_commands"."type" in ('SUBMIT_NOMINATIONS', 'SUBMIT_DOUBLES', 'SUBSTITUTE_PLAYER', 'START_ENCOUNTER', 'ASSIGN_SLOT', 'RELEASE_BOARD', 'DECLARE_WALKOVER', 'DECLARE_ENCOUNTER_FORFEIT', 'CANCEL_ENCOUNTER', 'CORRECT_ENCOUNTER_RESULT'));
