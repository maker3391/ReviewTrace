CREATE TYPE "public"."agent_review_language" AS ENUM('ko', 'en');--> statement-breakpoint
ALTER TABLE "agent_principals" ADD COLUMN "review_language" "agent_review_language" DEFAULT 'en' NOT NULL;