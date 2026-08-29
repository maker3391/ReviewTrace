DROP INDEX IF EXISTS "workspace_invitations_live_email_unique";--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitations_live_email_unique" ON "workspace_invitations" USING btree ("workspace_id","email") WHERE "workspace_invitations"."accepted_at" is null and "workspace_invitations"."revoked_at" is null;
