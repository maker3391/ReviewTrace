import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users, workspaces } from "@/db/schema/workspace";

/**
 * Workspace 와 Repository 사이의 업무 단위.
 *
 * ```
 * Workspace -> Project -> Repository -> ReviewSession -> ReviewIssue
 * ```
 *
 * 🔴 **Workspace 를 Project 처럼 쓰지 않는다.** Workspace 는 Tenant·Member·권한·API Key·
 * 공통 Knowledge 의 경계이고, Project 는 **하나의 제품 또는 업무 단위**다. 한 Workspace
 * (`CodeApex`)가 여러 Project(`SMIL` · `Code Intelligence` · `ERP`)를 갖는다.
 *
 * 🔴 **Project 는 Tenant 경계가 아니다.** 접근 판정의 정본은 여전히 `workspace_members` 다
 * (CLAUDE.md 11). Project 는 그 안에서 「무엇을 보고 있는가」를 가른다 —
 * Project 별 세부 권한은 실제 요구가 생기기 전에 만들지 않는다.
 *
 * 🔴 **Project 와 Repository 를 1:1 로 묶지 않는다.** 하나의 Project 가 `smil-fe`·`smil-be`·
 * `smil-agent` 를 함께 갖는 것이 정상이다.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    /**
     * 주소에 그대로 나가는 식별자(`/w/{workspaceSlug}/p/{projectSlug}`).
     *
     * 🔴 Workspace slug 와 같은 성격이다 — **Context 표시일 뿐 권한 증명이 아니다.**
     * 주소를 남의 Project 로 바꿔도 아래 unique 가 Workspace 안에서만 유효하고,
     * 조회는 소속이 확인된 `workspaceId` 로 한 번 더 좁힌다.
     */
    slug: text("slug").notNull(),
    description: text("description"),

    /** 만든 사람. 사람이 지워져도 Project 와 그 아래 Knowledge 는 남는다. */
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
     * UNIQUE(workspaceId, slug).
     *
     * 🔴 slug 는 **Workspace 안에서만** 유일하다. 서로 다른 회사가 각각 `erp` 라는 Project 를
     * 갖는 것은 정상이고, 전역 unique 로 두면 먼저 만든 Workspace 가 이름을 선점한다.
     *
     * 이 제약이 「같은 이름을 두 번 만들지 못한다」의 최종 방어선이다 —
     * 응용 코드의 「있는지 보고 없으면 만든다」만으로는 동시 요청의 틈이 막히지 않는다.
     */
    uniqueIndex("projects_workspace_slug_unique").on(
      table.workspaceId,
      table.slug,
    ),
    // Workspace Dashboard 와 사이드바의 Project 목록.
    index("projects_workspace_idx").on(table.workspaceId, table.name),
  ],
);
