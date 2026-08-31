import {
 index,
 pgTable,
 text,
 timestamp,
 uniqueIndex,
 uuid,
} from "drizzle-orm/pg-core";
import { isNull, sql } from "drizzle-orm";

import { projects } from "@/db/schema/project";
import { users, workspaces } from "@/db/schema/workspace";

/**
 * 사람이 직접 쓰는 Knowledge — Wiki.
 *
 * 🔴 **Wiki 와 Review Knowledge 를 한 데이터로 억지로 합치지 않는다**(스펙 8).
 * 둘은 연결될 수 있지만 **출처가 다르다.**
 *
 * | | 무엇 | 어디서 온다 |
 * |---|---|---|
 * | **Wiki** (이 표) | Explicit Knowledge — 정해서 적은 것 | 사람이 쓴다 |
 * | **Pattern · Resolution** (`review_issues`) | Observed Knowledge — 겪어서 쌓인 것 | Review 가 남긴다 |
 *
 * 규칙을 `review_issues` 에 끼워 넣으면 「관측된 사실」과 「우리가 정한 것」이 섞여
 * 통계가 거짓이 된다.
 *
 * ## Scope 는 `project_id` 하나로 가른다
 *
 * ```
 * project_id IS NULL -> Workspace Knowledge (개발 공통 규칙 · Git/PR 규칙 · Security 정책)
 * project_id 있음 -> Project Knowledge (업무 규칙 · Architecture Decision · 장애 기록)
 * ```
 *
 * 두 표로 나누지 않는 이유는 목록·상세·작성·수정이 **완전히 같은 화면**이기 때문이다.
 * 다른 것은 어느 범위에 걸리는가뿐이다.
 *
 * 🔴 `workspace_id` 는 Project Knowledge 에도 **함께** 둔다. Tenant 격리는 모든 조회에
 * 붙고, Project 를 거쳐 올라가야만 Workspace 를 알 수 있으면 그 Join 을
 * 빠뜨린 질의가 곧 데이터 유출이 된다. `review_issues` 와 같은 이유다.
 */
export const knowledgePages = pgTable(
 "knowledge_pages",
 {
 id: uuid("id").primaryKey().defaultRandom(),
 workspaceId: uuid("workspace_id")
.notNull()
.references(() => workspaces.id, { onDelete: "cascade" }),
 /** `NULL` 이면 Workspace Knowledge 다. 값이 있으면 그 Project 의 Knowledge 다. */
 projectId: uuid("project_id").references(() => projects.id, {
 onDelete: "cascade",
 }),

 title: text("title").notNull(),
 /** 주소에 나가는 식별자(`/w/{ws}/knowledge/{slug}`). */
 slug: text("slug").notNull(),
 /** Markdown 원문. Block Editor·협업 편집을 만들지 않는다(스펙 9). */
 content: text("content").notNull(),

 createdBy: uuid("created_by").references(() => users.id, {
 onDelete: "set null",
 }),

 createdAt: timestamp("created_at", { withTimezone: true })
.notNull()
.defaultNow(),
 updatedAt: timestamp("updated_at", { withTimezone: true })
.notNull()
.defaultNow(),
 },
 (table) => [
 /**
 * 🔴 **Scope 마다 따로 잠근다.** `UNIQUE(workspace_id, project_id, slug)` 하나로 두면
 * PostgreSQL 이 NULL 을 서로 다른 값으로 보기 때문에 **Workspace Knowledge 만 제약이
 * 통째로 풀린다** — 같은 slug 를 몇 번이든 만들 수 있게 된다.
 *
 * 그래서 부분 unique 두 개다. Workspace 쪽은 `project_id IS NULL` 인 행만,
 * Project 쪽은 그 Project 안에서만 잠근다.
 */
 uniqueIndex("knowledge_pages_workspace_slug_unique")
.on(table.workspaceId, table.slug)
.where(isNull(table.projectId)),
 uniqueIndex("knowledge_pages_project_slug_unique")
.on(table.projectId, table.slug)
.where(sql`${table.projectId} is not null`),

 // Workspace Knowledge 목록 — 최근 수정순.
 index("knowledge_pages_workspace_updated_at_idx").on(
 table.workspaceId,
 table.updatedAt.desc(),
),
 // Project Knowledge 목록 — 최근 수정순.
 index("knowledge_pages_project_updated_at_idx").on(
 table.projectId,
 table.updatedAt.desc(),
),
 ],
);
