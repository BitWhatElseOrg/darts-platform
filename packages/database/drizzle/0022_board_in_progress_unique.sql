CREATE UNIQUE INDEX "matches_board_in_progress_unique" ON "matches" USING btree ("board_id") WHERE "matches"."status" = 'IN_PROGRESS';
