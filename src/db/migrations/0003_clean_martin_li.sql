ALTER TABLE "issue_activities" DROP CONSTRAINT "issue_activities_issue_id_review_issues_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_tags" DROP CONSTRAINT "issue_tags_issue_id_review_issues_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_activities" DROP COLUMN "issue_id";--> statement-breakpoint
ALTER TABLE "issue_activities" DROP COLUMN "summary";--> statement-breakpoint
ALTER TABLE "issue_tags" DROP COLUMN "issue_id";--> statement-breakpoint
ALTER TABLE "review_issues" DROP COLUMN "verified_at";--> statement-breakpoint
ALTER TABLE "review_issues" DROP COLUMN "line_start";--> statement-breakpoint
ALTER TABLE "review_issues" DROP COLUMN "line_end";--> statement-breakpoint
ALTER TABLE "review_issues" DROP COLUMN "detected_at";--> statement-breakpoint
ALTER TABLE "review_sessions" DROP COLUMN "reviewed_at";