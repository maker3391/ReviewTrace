CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Repository 를 Project 아래로 옮긴다.
--
-- 🔴 한 문장으로 NOT NULL 을 붙이면 이미 행이 있는 Database 에서 실패한다.
--    셋으로 나눈다 — 비워 두고 채운 뒤 잠근다. 그래야 기존 Repository 가 사라지지 않는다.
--
-- 이 저장소의 Database 에서는 `repositories` 가 **0행**이라 가운데 두 문장이 아무것도 하지
-- 않는다(2026-08-28 확인). 그래서 여기서는 Default Project 가 하나도 만들어지지 않는다 —
-- 아래 INSERT 는 **실제로 Repository 를 가진 Workspace 에만** 걸린다.
ALTER TABLE "repositories" ADD COLUMN "project_id" uuid;--> statement-breakpoint

-- Repository 를 가진 Workspace 마다 수용 Project 를 하나 만든다.
INSERT INTO "projects" ("workspace_id", "name", "slug", "description")
SELECT DISTINCT r."workspace_id", 'Default', 'default',
       'Project 도입 전부터 있던 Repository 를 수용하기 위해 만들어진 Project'
FROM "repositories" r;--> statement-breakpoint

UPDATE "repositories" r
SET "project_id" = p."id"
FROM "projects" p
WHERE p."workspace_id" = r."workspace_id"
  AND p."slug" = 'default'
  AND r."project_id" IS NULL;--> statement-breakpoint

ALTER TABLE "repositories" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_pages" ADD CONSTRAINT "knowledge_pages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_pages" ADD CONSTRAINT "knowledge_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_pages" ADD CONSTRAINT "knowledge_pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_slug_unique" ON "projects" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "projects_workspace_idx" ON "projects" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_pages_workspace_slug_unique" ON "knowledge_pages" USING btree ("workspace_id","slug") WHERE "knowledge_pages"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_pages_project_slug_unique" ON "knowledge_pages" USING btree ("project_id","slug") WHERE "knowledge_pages"."project_id" is not null;--> statement-breakpoint
CREATE INDEX "knowledge_pages_workspace_updated_at_idx" ON "knowledge_pages" USING btree ("workspace_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "knowledge_pages_project_updated_at_idx" ON "knowledge_pages" USING btree ("project_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repositories_project_idx" ON "repositories" USING btree ("project_id","name");