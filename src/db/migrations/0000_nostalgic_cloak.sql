CREATE TYPE "public"."issue_activity_type" AS ENUM('DETECTED', 'FIX_ATTEMPTED', 'REVIEWED_AGAIN', 'RESOLVED', 'REOPENED', 'IGNORED', 'COMMENT');--> statement-breakpoint
CREATE TYPE "public"."issue_category" AS ENUM('ARCHITECTURE', 'SECURITY', 'PERFORMANCE', 'DATABASE', 'TRANSACTION', 'CONCURRENCY', 'API', 'VALIDATION', 'EXCEPTION_HANDLING', 'TESTING', 'CLEAN_CODE', 'RELIABILITY');--> statement-breakpoint
CREATE TYPE "public"."issue_severity" AS ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'IGNORED');--> statement-breakpoint
CREATE TYPE "public"."review_target_type" AS ENUM('PULL_REQUEST', 'COMMIT', 'BRANCH', 'REPOSITORY', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."reviewer_type" AS ENUM('AGENT', 'HUMAN');--> statement-breakpoint
CREATE TYPE "public"."scm_provider" AS ENUM('GITHUB');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('OWNER', 'ADMIN', 'MEMBER');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" DEFAULT 'MEMBER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"type" "issue_activity_type" NOT NULL,
	"actor_type" "reviewer_type" NOT NULL,
	"actor_name" text NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_tags" (
	"issue_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "issue_tags_issue_id_tag_id_pk" PRIMARY KEY("issue_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "scm_provider" NOT NULL,
	"external_repository_id" text,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"review_session_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"severity" "issue_severity" NOT NULL,
	"category" "issue_category" NOT NULL,
	"status" "issue_status" DEFAULT 'OPEN' NOT NULL,
	"pattern_key" text,
	"file_path" text,
	"line_start" integer,
	"line_end" integer,
	"resolution_summary" text,
	"verified_at" timestamp with time zone,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repository_id" uuid NOT NULL,
	"target_type" "review_target_type" NOT NULL,
	"branch" text,
	"commit_sha" text,
	"pull_request_number" integer,
	"reviewer_type" "reviewer_type" NOT NULL,
	"reviewer_name" text NOT NULL,
	"raw_payload" jsonb,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_activities" ADD CONSTRAINT "issue_activities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_activities" ADD CONSTRAINT "issue_activities_issue_id_review_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."review_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tags" ADD CONSTRAINT "issue_tags_issue_id_review_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."review_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_tags" ADD CONSTRAINT "issue_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_issues" ADD CONSTRAINT "review_issues_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_issues" ADD CONSTRAINT "review_issues_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_issues" ADD CONSTRAINT "review_issues_review_session_id_review_sessions_id_fk" FOREIGN KEY ("review_session_id") REFERENCES "public"."review_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_unique" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_workspace_idx" ON "api_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_unique" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "issue_activities_issue_created_at_idx" ON "issue_activities" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_tags_tag_idx" ON "issue_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_workspace_full_name_unique" ON "repositories" USING btree ("workspace_id","provider","full_name");--> statement-breakpoint
CREATE INDEX "review_issues_workspace_list_idx" ON "review_issues" USING btree ("workspace_id","status","severity","detected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "review_issues_repository_idx" ON "review_issues" USING btree ("repository_id","detected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "review_issues_pattern_idx" ON "review_issues" USING btree ("repository_id","pattern_key");--> statement-breakpoint
CREATE INDEX "review_issues_session_idx" ON "review_issues" USING btree ("review_session_id");--> statement-breakpoint
CREATE INDEX "review_sessions_repository_reviewed_at_idx" ON "review_sessions" USING btree ("repository_id","reviewed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "tags_workspace_name_unique" ON "tags" USING btree ("workspace_id","name");