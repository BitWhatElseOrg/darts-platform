CREATE TABLE "board_controller_leases" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"controller_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_controller_leases" ADD CONSTRAINT "board_controller_leases_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_controller_leases" ADD CONSTRAINT "board_controller_leases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_controller_leases" ADD CONSTRAINT "board_controller_leases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_controller_leases_organization_expiry_idx" ON "board_controller_leases" USING btree ("organization_id","expires_at");