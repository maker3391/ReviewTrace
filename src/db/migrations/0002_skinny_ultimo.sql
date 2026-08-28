ALTER TYPE "public"."issue_status" ADD VALUE 'FALSE_POSITIVE';--> statement-breakpoint
ALTER TYPE "public"."issue_status" ADD VALUE 'REOPENED';--> statement-breakpoint
ALTER TYPE "public"."reviewer_type" ADD VALUE 'SYSTEM';--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "workspace_role" DEFAULT 'MEMBER' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_invitations" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ALTER COLUMN "role" SET DEFAULT 'MEMBER'::text;--> statement-breakpoint
ALTER TABLE "workspace_members" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "workspace_members" ALTER COLUMN "role" SET DEFAULT 'MEMBER'::text;--> statement-breakpoint
DROP TYPE "public"."workspace_role";--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('OWNER', 'MEMBER');--> statement-breakpoint
ALTER TABLE "workspace_invitations" ALTER COLUMN "role" SET DEFAULT 'MEMBER'::"public"."workspace_role";--> statement-breakpoint
ALTER TABLE "workspace_invitations" ALTER COLUMN "role" SET DATA TYPE "public"."workspace_role" USING "role"::"public"."workspace_role";--> statement-breakpoint
ALTER TABLE "workspace_members" ALTER COLUMN "role" SET DEFAULT 'MEMBER'::"public"."workspace_role";--> statement-breakpoint
ALTER TABLE "workspace_members" ALTER COLUMN "role" SET DATA TYPE "public"."workspace_role" USING "role"::"public"."workspace_role";--> statement-breakpoint
DROP INDEX "workspace_members_user_idx";--> statement-breakpoint
DROP INDEX "repositories_workspace_full_name_unique";--> statement-breakpoint
DROP INDEX "review_sessions_repository_reviewed_at_idx";--> statement-breakpoint
DROP INDEX "tags_workspace_name_unique";--> statement-breakpoint
DROP INDEX "issue_activities_issue_created_at_idx";--> statement-breakpoint
DROP INDEX "review_issues_workspace_list_idx";--> statement-breakpoint
DROP INDEX "review_issues_repository_idx";--> statement-breakpoint
ALTER TABLE "issue_tags" DROP CONSTRAINT "issue_tags_issue_id_tag_id_pk";--> statement-breakpoint
ALTER TABLE "repositories" ALTER COLUMN "external_repository_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "personal_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "issue_activities" ADD COLUMN "review_issue_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_activities" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "issue_activities" ADD COLUMN "commit_sha" text;--> statement-breakpoint
ALTER TABLE "issue_tags" ADD COLUMN "review_issue_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "html_url" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "review_issues" ADD COLUMN "start_line" integer;--> statement-breakpoint
ALTER TABLE "review_issues" ADD COLUMN "end_line" integer;--> statement-breakpoint
ALTER TABLE "review_issues" ADD COLUMN "suggestion" text;--> statement-breakpoint
ALTER TABLE "review_issues" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "review_issues" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "review_issues" ADD COLUMN "first_detected_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD COLUMN "reviewer_version" text;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD COLUMN "started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "normalized_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitations_token_hash_unique" ON "workspace_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "workspace_invitations_workspace_idx" ON "workspace_invitations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_invitations_email_idx" ON "workspace_invitations" USING btree ("email");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_personal_owner_id_users_id_fk" FOREIGN KEY ("personal_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_activities" ADD CONSTRAINT "issue_activities_review_issue_id_review_issues_id_fk" FOREIGN KEY ("review_issue_id") REFERENCES "public"."review_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tags" ADD CONSTRAINT "issue_tags_review_issue_id_review_issues_id_fk" FOREIGN KEY ("review_issue_id") REFERENCES "public"."review_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_members_user_workspace_idx" ON "workspace_members" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_personal_owner_unique" ON "workspaces" USING btree ("personal_owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_workspace_external_id_unique" ON "repositories" USING btree ("workspace_id","provider","external_repository_id");--> statement-breakpoint
CREATE INDEX "repositories_workspace_idx" ON "repositories" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_issues_repository_external_id_unique" ON "review_issues" USING btree ("repository_id","source","external_id");--> statement-breakpoint
CREATE INDEX "review_issues_workspace_category_idx" ON "review_issues" USING btree ("workspace_id","category","first_detected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "review_sessions_repository_idempotency_key_unique" ON "review_sessions" USING btree ("repository_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "review_sessions_repository_created_at_idx" ON "review_sessions" USING btree ("repository_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "review_sessions_repository_commit_idx" ON "review_sessions" USING btree ("repository_id","commit_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_workspace_normalized_name_unique" ON "tags" USING btree ("workspace_id","normalized_name");--> statement-breakpoint
CREATE INDEX "issue_activities_issue_created_at_idx" ON "issue_activities" USING btree ("review_issue_id","created_at");--> statement-breakpoint
CREATE INDEX "review_issues_workspace_list_idx" ON "review_issues" USING btree ("workspace_id","status","severity","first_detected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "review_issues_repository_idx" ON "review_issues" USING btree ("repository_id","first_detected_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "issue_tags" ADD CONSTRAINT "issue_tags_review_issue_id_tag_id_pk" PRIMARY KEY("review_issue_id","tag_id");