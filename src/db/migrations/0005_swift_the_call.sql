CREATE TYPE "public"."code_evidence_kind" AS ENUM('BEFORE', 'AFTER');--> statement-breakpoint
CREATE TYPE "public"."evidence_verification" AS ENUM('UNVERIFIED', 'VERIFIED', 'MISMATCH', 'UNAVAILABLE');--> statement-breakpoint
CREATE TABLE "issue_code_evidences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"review_issue_id" uuid NOT NULL,
	"issue_activity_id" uuid,
	"kind" "code_evidence_kind" NOT NULL,
	"commit_sha" text NOT NULL,
	"file_path" text NOT NULL,
	"start_line" integer,
	"end_line" integer,
	"snapshot" text,
	"verification" "evidence_verification" DEFAULT 'UNVERIFIED' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_activities" ADD COLUMN "solution" text;--> statement-breakpoint
ALTER TABLE "issue_activities" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "issue_activities" ADD COLUMN "alternatives_considered" text;--> statement-breakpoint
ALTER TABLE "issue_activities" ADD COLUMN "trade_off" text;--> statement-breakpoint
ALTER TABLE "issue_activities" ADD COLUMN "verification" text;--> statement-breakpoint
ALTER TABLE "issue_activities" ADD COLUMN "regression_test" text;--> statement-breakpoint
ALTER TABLE "issue_activities" ADD COLUMN "residual_risk" text;--> statement-breakpoint
ALTER TABLE "review_issues" ADD COLUMN "root_cause" text;--> statement-breakpoint
ALTER TABLE "review_issues" ADD COLUMN "failure_path" text;--> statement-breakpoint
ALTER TABLE "issue_code_evidences" ADD CONSTRAINT "issue_code_evidences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_code_evidences" ADD CONSTRAINT "issue_code_evidences_review_issue_id_review_issues_id_fk" FOREIGN KEY ("review_issue_id") REFERENCES "public"."review_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_code_evidences" ADD CONSTRAINT "issue_code_evidences_issue_activity_id_issue_activities_id_fk" FOREIGN KEY ("issue_activity_id") REFERENCES "public"."issue_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_code_evidences_issue_idx" ON "issue_code_evidences" USING btree ("review_issue_id","kind");--> statement-breakpoint
CREATE INDEX "issue_code_evidences_activity_idx" ON "issue_code_evidences" USING btree ("issue_activity_id");