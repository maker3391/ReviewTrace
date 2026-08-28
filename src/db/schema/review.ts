import {
  boolean,
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
import { projects } from "@/db/schema/project";
import { workspaces } from "@/db/schema/workspace";

/**
 * Review Knowledge 의 정본.
 *
 * ```
 * Workspace -> Project -> Repository -> ReviewSession -> ReviewIssue -> IssueActivity
 *                                                                    \- IssueTag -- Tag
 * ```
 *
 * 🔴 검색·Filter·Statistics 에 쓰이는 값은 JSONB 에 몰아넣지 않고 Column 으로 둔다(CLAUDE.md 10).
 *
 * ## 왜 `workspace_id` 를 아래 표들이 다시 들고 있는가
 *
 * Tenant 격리는 **모든 조회에** 붙는다(CLAUDE.md 11). Repository 를 거쳐 올라가야만
 * Workspace 를 알 수 있으면 Issue 목록 한 번에도 Join 이 두 단계 붙고, 그 Join 을 빠뜨린
 * 질의가 곧 데이터 유출이 된다. 소유 관계는 여전히 위 그림이고, 이 Column 은 **격리를
 * 값싸고 잊기 어렵게** 만들기 위한 것이다.
 */

export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /**
     * 이 Repository 가 속한 업무 단위(스펙 1).
     *
     * 🔴 **소유는 Project 가 하고, Tenant 판정은 여전히 `workspaceId` 가 한다.**
     * Project 는 반드시 한 Workspace 안에 있으므로 둘은 어긋날 수 없다 — 어긋나지 않게
     * 지키는 자리는 Application Layer 다(`project-service.ts` 의 `resolveIngestProject`).
     */
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: scmProviderEnum("provider").notNull(),
    /** Provider 쪽 식별자. GitHub 에서 Repository 이름이 바뀌어도 같은 대상임을 잃지 않는다. */
    externalRepositoryId: text("external_repository_id").notNull(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    htmlUrl: text("html_url"),
    /**
     * 연결을 끊어도 **행을 지우지 않는다.** 지우면 그 아래 Review Knowledge 가 통째로 사라진다.
     */
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /**
     * UNIQUE(workspaceId, provider, externalRepositoryId).
     *
     * Agent 가 보낸 Repository 를 Upsert 하는 자리의 최종 방어선이다.
     * `fullName` 이 아니라 외부 식별자로 잡는 이유는 **이름이 바뀌어도 같은 저장소**이기 때문이다.
     * 같은 GitHub Repository 를 서로 다른 Workspace 가 각각 연결하는 것은 정상이다.
     */
    uniqueIndex("repositories_workspace_external_id_unique").on(
      table.workspaceId,
      table.provider,
      table.externalRepositoryId,
    ),
    // Workspace 의 Repository 목록.
    index("repositories_workspace_idx").on(table.workspaceId),
    // Project 화면의 Repository 목록이자 Project 단위 집계가 타는 Join 축.
    index("repositories_project_idx").on(table.projectId, table.name),
  ],
);

export const reviewSessions = pgTable(
  "review_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    reviewerVersion: text("reviewer_version"),

    summary: text("summary"),

    /**
     * 같은 Review 의 재전송을 한 번으로 접기 위한 열쇠.
     *
     * Agent 는 Network 실패로 같은 Review 를 다시 보낼 수 있다. 아래 unique 가
     * 두 번째 INSERT 를 막아 **ReviewSession 이 무한히 늘지 않게** 한다.
     * 보내지 않으면 `NULL` 이고, PostgreSQL 은 NULL 을 서로 다른 값으로 보므로 제약에 걸리지 않는다.
     */
    idempotencyKey: text("idempotency_key"),

    /**
     * Agent 가 보낸 원본 Payload.
     * 구조가 Client 마다 다르고 JSON 형태 보존이 실제로 필요한 유일한 자리라 JSONB 를 쓴다.
     */
    rawPayload: jsonb("raw_payload"),

    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("review_sessions_repository_idempotency_key_unique").on(
      table.repositoryId,
      table.idempotencyKey,
    ),
    // Repository 상세 화면의 「최근 Review」 목록.
    index("review_sessions_repository_created_at_idx").on(
      table.repositoryId,
      table.createdAt.desc(),
    ),
    // 「이 Commit 을 누가 언제 봤나」 — 재전송 판단과 Commit 단위 조회.
    index("review_sessions_repository_commit_idx").on(
      table.repositoryId,
      table.commitSha,
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
    startLine: integer("start_line"),
    endLine: integer("end_line"),

    /** Agent 가 제안한 수정 방향. Resolution 과 다르다 — 이것은 「해 보라」이고 저것은 「했다」다. */
    suggestion: text("suggestion"),

    /**
     * 보낸 쪽의 식별자.
     *
     * 같은 문제를 다음 Review 가 다시 보고해도 **행을 새로 만들지 않기 위한** 열쇠다.
     * 행이 하나로 유지돼야 `IssueActivity` 가 한 줄기 History 로 쌓인다(CLAUDE.md 2).
     */
    source: text("source"),
    externalId: text("external_id"),

    /**
     * 🔴 `resolved = true` 만 남기지 않는다. **어떻게 해결했는가가 Knowledge 의 핵심**이다.
     * 상세 과정은 issue_activities 가 갖고, 여기에는 최종 요약만 둔다(CLAUDE.md 2).
     */
    resolutionSummary: text("resolution_summary"),

    /** 처음 발견된 시각. 다시 보고돼도 이 값은 바뀌지 않는다. */
    firstDetectedAt: timestamp("first_detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** REOPENED 되면 다시 `NULL` 로 돌아간다 — 상태와 시각이 어긋나지 않게 한다. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /**
     * 같은 외부 Issue 를 Repository 안에서 한 행으로 유지한다.
     * `source`·`externalId` 를 보내지 않으면 `NULL` 이라 제약에 걸리지 않는다.
     */
    uniqueIndex("review_issues_repository_external_id_unique").on(
      table.repositoryId,
      table.source,
      table.externalId,
    ),
    // Issue 목록 화면의 기본 질의: Workspace 로 좁히고 status·severity 로 거른 뒤 최신순.
    index("review_issues_workspace_list_idx").on(
      table.workspaceId,
      table.status,
      table.severity,
      table.firstDetectedAt.desc(),
    ),
    // Knowledge Context 의 「이 영역에서 반복되는 문제」.
    index("review_issues_workspace_category_idx").on(
      table.workspaceId,
      table.category,
      table.firstDetectedAt.desc(),
    ),
    // Repository 별 조회·통계.
    index("review_issues_repository_idx").on(
      table.repositoryId,
      table.firstDetectedAt.desc(),
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
    reviewIssueId: uuid("review_issue_id")
      .notNull()
      .references(() => reviewIssues.id, { onDelete: "cascade" }),

    type: issueActivityTypeEnum("type").notNull(),
    actorType: reviewerTypeEnum("actor_type").notNull(),
    actorName: text("actor_name").notNull(),
    description: text("description"),
    /** 어느 Commit 에서 벌어진 일인지. 「고쳤다」를 코드와 이을 수 있게 한다. */
    commitSha: text("commit_sha"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Issue 상세의 History 타임라인.
    index("issue_activities_issue_created_at_idx").on(
      table.reviewIssueId,
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
    /** 사람에게 보여 주는 원래 표기. */
    name: text("name").notNull(),
    /**
     * 비교·중복 판정에 쓰는 값(소문자·공백 정리).
     *
     * 표시용 이름으로 중복을 막으면 `Race-Condition` 과 `race-condition` 이 두 개로 늘어
     * 같은 Knowledge 가 갈라진다.
     */
    normalizedName: text("normalized_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // 같은 Tag 를 Workspace 안에서 한 번만 만든다 — Agent 가 매 Review 마다 보내도 늘지 않는다.
    uniqueIndex("tags_workspace_normalized_name_unique").on(
      table.workspaceId,
      table.normalizedName,
    ),
  ],
);

export const issueTags = pgTable(
  "issue_tags",
  {
    reviewIssueId: uuid("review_issue_id")
      .notNull()
      .references(() => reviewIssues.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.reviewIssueId, table.tagId] }),
    // 「이 Tag 가 붙은 Issue」 역방향 조회.
    index("issue_tags_tag_idx").on(table.tagId),
  ],
);
