ALTER TABLE "organization_invitations" ADD COLUMN "claim_token_hash" varchar(64);--> statement-breakpoint
UPDATE "organization_invitations"
SET "status" = 'EXPIRED', "updated_at" = now()
WHERE "status" = 'PENDING';--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_pending_claim_check" CHECK ("organization_invitations"."status" <> 'PENDING' or "organization_invitations"."claim_token_hash" is not null);--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_claim_hash_format_check" CHECK ("organization_invitations"."claim_token_hash" is null or "organization_invitations"."claim_token_hash" ~ '^[a-f0-9]{64}$');
