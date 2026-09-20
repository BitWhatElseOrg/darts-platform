-- Versandauftraege fuer ausgehende Mails (ADR 0017). Eine Zeile je Mail;
-- Payload bis zum Versand, danach geleert. Retry/Backoff/Dead-Letter nach
-- dem Muster von outbox_events, aber als eigene Tabelle: ein Mailauftrag
-- ist kein Domaenenereignis.
CREATE TABLE "email_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid,
  "invitation_id" uuid,
  "kind" varchar(30) NOT NULL,
  "recipient" varchar(320) NOT NULL,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "provider_message_id" varchar(200),
  "attempts" integer DEFAULT 0 NOT NULL,
  "not_before" timestamp with time zone,
  "dead_lettered_at" timestamp with time zone,
  "last_error" text
);--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_invitation_id_organization_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."organization_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_deliveries_pending_idx" ON "email_deliveries" USING btree ("created_at") WHERE "email_deliveries"."sent_at" is null and "email_deliveries"."dead_lettered_at" is null;--> statement-breakpoint
CREATE INDEX "email_deliveries_sent_at_idx" ON "email_deliveries" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_dead_lettered_at_idx" ON "email_deliveries" USING btree ("dead_lettered_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_invitation_created_idx" ON "email_deliveries" USING btree ("invitation_id","created_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_organization_created_idx" ON "email_deliveries" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_kind_check" CHECK ("email_deliveries"."kind" in ('INVITATION', 'PASSWORD_RESET'));--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_open_has_payload_check" CHECK ("email_deliveries"."payload" is not null or "email_deliveries"."sent_at" is not null or "email_deliveries"."dead_lettered_at" is not null);
