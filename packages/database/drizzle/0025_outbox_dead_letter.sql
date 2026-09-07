ALTER TABLE "outbox_events" ADD COLUMN "publish_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "publish_not_before" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "publish_dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "publish_last_error" text;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "statistics_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "statistics_not_before" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "statistics_dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "statistics_last_error" text;--> statement-breakpoint
CREATE INDEX "outbox_events_dead_lettered_idx" ON "outbox_events" USING btree ("occurred_at") WHERE "outbox_events"."publish_dead_lettered_at" is not null or "outbox_events"."statistics_dead_lettered_at" is not null;