import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  issueActivityTypeEnum,
  issueCategoryEnum,
  issueSeverityEnum,
  issueStatusEnum,
  reviewTargetTypeEnum,
  reviewerTypeEnum,
  scmProviderEnum,
} from "@/db/schema/enums";
import { workspaces } from "@/db/schema/workspace";

/**
 * Review Knowledge 의 정본.
 *
 * ```
 * Repository -> ReviewSession -> ReviewIssue -> IssueActivity
 *                                            \- IssueTag -- Tag
 * ```
 *
 * 🔴 검색·Filter·Statistics 에 쓰이는 값은 JSONB 에 몰아넣지 않고 Column 으로 둔다(CLAUDE.md 10).
 */

export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: scmProviderEnum("provider").notNull(),
    /** Provider 쪽 식별자. GitHub 에서 Repository 이름이 바뀌어도 같은 대상임을 잃지 않는다. */
    externalRepositoryId: text("external_repository_id"),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // 같은 Workspace 안에서 같은 Repository 를 두 번 등록하지 못하게 한다.
    // Agent 가 `owner/name` 만 보내고 없으면 만드는 흐름(CLAUDE.md 13)의 최종 방어선이다.
    uniqueIndex("repositories_workspace_full_name_unique").on(
      table.workspaceId,
      table.provider,
      table.fullName,
    ),
  ],
);

export const reviewSessions = pgTable(
  "review_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Tenant Scoping 을 위해 들고 있는다 — 조회마다 repositories 를 거치지 않는다.
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),

    targetType: reviewTargetTypeEnum("target_type").notNull(),
    branch: text("branch"),
    commitSha: text("commit_sha"),
    /** 🔴 PR 은 Optional Metadata 다. Domain Root 가 아니다(CLAUDE.md 2). */
    pullRequestNumber: integer("pull_request_number"),

    reviewerType: reviewerTypeEnum("reviewer_type").notNull(),
    /** `codex` · `claude-code` · 사람 이름. Agent 종류를 코드로 못 박지 않는다. */
    reviewerName: text("reviewer_name").notNull(),

    /**
     * Agent 가 보낸 원본 Payload.
     * 구조가 Client 마다 다르고 JSON 형태 보존이 실제로 필요한 유일한 자리라 JSONB 를 쓴다.
     */
    rawPayload: jsonb("raw_payload"),

    reviewedAt: timestamp("reviewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Repository 상세 화면의 「최근 Review」 목록.
    index("review_sessions_repository_reviewed_at_idx").on(
      table.repositoryId,
      table.reviewedAt.desc(),
    ),
  ],
);

/** 가장 중요한 Domain. 다른 것 때문에 이 모델을 왜곡하지 않는다(CLAUDE.md 2). */
export const reviewIssues = pgTable(
  "review_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    reviewSessionId: uuid("review_session_id")
      .notNull()
      .references(() => reviewSessions.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    description: text("description"),

    severity: issueSeverityEnum("severity").notNull(),
    category: issueCategoryEnum("category").notNull(),
    status: issueStatusEnum("status").notNull().default("OPEN"),

    /** 반복되는 문제의 정규화된 개념. Category·Tag 와 다르다(CLAUDE.md 3). */
    patternKey: text("pattern_key"),

    /** Code Location. 파일·줄이 있어야 같은 문제를 다시 짚을 수 있다. */
    filePath: text("file_path"),
    lineStart: integer("line_start"),
    lineEnd: integer("line_end"),

    /**
     * 🔴 `resolved = true` 만 남기지 않는다. **어떻게 해결했는가가 Knowledge 의 핵심**이다.
     * 상세 과정은 issue_activities 가 갖고, 여기에는 최종 요약만 둔다(CLAUDE.md 2).
     */
    resolutionSummary: text("resolution_summary"),
    /** Verification 을 통과한 시각. 「고쳤다고 주장한 것」과 「확인된 것」을 구분한다. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),

    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Issue 목록 화면의 기본 질의: Workspace 로 좁히고 status·severity 로 거른 뒤 최신순.
    index("review_issues_workspace_list_idx").on(
      table.workspaceId,
      table.status,
      table.severity,
      table.detectedAt.desc(),
    ),
    // Repository 별 조회·통계.
    index("review_issues_repository_idx").on(
      table.repositoryId,
      table.detectedAt.desc(),
    ),
    // 「이 Repository 에서 반복되는 Pattern」 조회(CLAUDE.md 14).
    index("review_issues_pattern_idx").on(table.repositoryId, table.patternKey),
    // 한 Review 결과 펼쳐 보기.
    index("review_issues_session_idx").on(table.reviewSessionId),
  ],
);

export const issueActivities = pgTable(
  "issue_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => reviewIssues.id, { onDelete: "cascade" }),

    type: issueActivityTypeEnum("type").notNull(),
    actorType: reviewerTypeEnum("actor_type").notNull(),
    actorName: text("actor_name").notNull(),
    summary: text("summary"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Issue 상세의 History 타임라인.
    index("issue_activities_issue_created_at_idx").on(
      table.issueId,
      table.createdAt,
    ),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // 같은 Tag 를 Workspace 안에서 한 번만 만든다 — Agent 가 매 Review 마다 보내도 늘지 않는다.
    uniqueIndex("tags_workspace_name_unique").on(table.workspaceId, table.name),
  ],
);

export const issueTags = pgTable(
  "issue_tags",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => reviewIssues.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.issueId, table.tagId] }),
    // 「이 Tag 가 붙은 Issue」 역방향 조회.
    index("issue_tags_tag_idx").on(table.tagId),
  ],
);
