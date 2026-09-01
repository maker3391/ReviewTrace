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
  codeEvidenceKindEnum,
  evidenceVerificationEnum,
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
 * \- IssueTag -- Tag
 * ```
 *
 * 🔴 검색·Filter·Statistics 에 쓰이는 값은 JSONB 에 몰아넣지 않고 Column 으로 둔다.
 *
 * ## 왜 `workspace_id` 를 아래 표들이 다시 들고 있는가
 *
 * Tenant 격리는 **모든 조회에** 붙는다. Repository 를 거쳐 올라가야만
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
    /** 🔴 PR 은 Optional Metadata 다. Domain Root 가 아니다. */
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

/** 가장 중요한 Domain. 다른 것 때문에 이 모델을 왜곡하지 않는다. */
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

    /**
     * 왜 그렇게 됐는가.
     *
     * 🔴 `description`(무엇이 문제인가)과 **다른 질문에 답한다.** 증상만 쌓이면 같은
     * 원인을 매번 새 Issue 로 다시 발견한다 — 재사용되는 Knowledge 는 원인 쪽이다.
     */
    rootCause: text("root_cause"),
    /**
     * 이 문제가 실제로 터지는 경로.
     *
     * SECURITY 면 공격 경로, 그 밖이면 실패 경로다. 한 칸으로 두는 이유는 **같은 질문**
     * 이기 때문이다 — 「무엇을 어떻게 하면 이게 터지는가」. Category 로 이미 갈라져 있어
     * 칸을 둘로 나눌 이유가 없다.
     */
    failurePath: text("failure_path"),

    /** 반복되는 문제의 정규화된 개념. Category·Tag 와 다르다. */
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
     * 행이 하나로 유지돼야 `IssueActivity` 가 한 줄기 History 로 쌓인다.
     */
    source: text("source"),
    externalId: text("external_id"),

    /**
     * 🔴 `resolved = true` 만 남기지 않는다. **어떻게 해결했는가가 Knowledge 의 핵심**이다.
     * 상세 과정은 issue_activities 가 갖고, 여기에는 최종 요약만 둔다.
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
    // 「이 Repository 에서 반복되는 Pattern」 조회.
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

    /**
     * ## Decision Record — 왜 `review_issues` 가 아니라 여기인가
     *
     * 한 Issue 는 **여러 번 고쳐진다**.
     *
     * ```
     * Codex DETECTED -> Claude FIX_ATTEMPTED -> Codex REVIEWED_AGAIN
     * -> Claude FIX_ATTEMPTED -> Codex RESOLVED
     * ```
     *
     * 🔴 이 값들을 Issue 에 두면 **두 번째 시도가 첫 번째 시도의 판단을 덮어쓴다.**
     * 그러면 「무엇을 먼저 해 봤고 왜 그것으로는 안 됐는가」가 사라진다 — 그것이야말로
     * 다음 Review 에서 재사용되는 Knowledge 다. 그래서 판단은 **행위에 붙는다.**
     *
     * `review_issues.resolutionSummary` 는 그대로 남는다. 저것은 **최종 해결 요약 문서**이고
     * 이것은 **그 결론에 이른 각 판단**이다 — 겹치지 않는다.
     *
     * 대부분의 Activity(`COMMENT`·`REOPENED`)에는 전부 `NULL` 이다. 별도 표로 빼지 않는
     * 이유는 **Activity 를 읽는 자리가 곧 판단을 읽는 자리**이기 때문이다 — 나눠 두면
     * History 를 그릴 때마다 Join 이 하나 더 붙고, 얻는 것이 없다.
     */
    /** 무엇을 했는가. `review_issues.suggestion`(해 보라)과 다르다 — 이것은 「했다」다. */
    solution: text("solution"),
    /** 왜 그것을 골랐는가. */
    decisionReason: text("decision_reason"),
    /** 무엇을 함께 검토했고 왜 버렸는가. */
    alternativesConsidered: text("alternatives_considered"),
    /** 그 선택으로 무엇을 내주었는가. */
    tradeOff: text("trade_off"),
    /** 고쳐졌음을 어떻게 확인했는가. */
    verification: text("verification"),
    /** 다시 무너지는 것을 무엇이 막는가. */
    regressionTest: text("regression_test"),
    /** 그래도 남아 있는 위험. */
    residualRisk: text("residual_risk"),

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

/**
 * Issue 를 실제 코드에 붙들어 매는 근거(스펙 15).
 *
 * ```
 * ReviewIssue --< IssueCodeEvidence >-- IssueActivity(선택)
 * ```
 *
 * ## 왜 Column 이 아니라 표인가
 *
 * 한 Issue 에는 **BEFORE 와 AFTER 가 각각 여럿** 있을 수 있고(파일이 여러 개, 고침이
 * 여러 번), AFTER 는 **어느 시도가 만든 것인지**까지 알아야 History 가 이어진다.
 * Column 으로는 1:N 도 소속도 표현할 수 없다.
 *
 * ## 🔴 「Agent 가 보냈다」와 「GitHub 에 그렇게 있다」를 갈라 둔다
 *
 * `snapshot` 은 Agent 가 보낸 코드이고, `verification` 은 우리가 GitHub 에서 확인한
 * 결과다. 둘을 한 칸으로 합치면 화면이 확인되지 않은 코드를 확인된 것처럼 그린다.
 *
 * 🔴 **Repository 전체를 복제하지 않는다**. 저장하는 것은 Issue 가 가리키는
 * **줄 범위**뿐이다.
 */
export const issueCodeEvidences = pgTable(
  "issue_code_evidences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    reviewIssueId: uuid("review_issue_id")
      .notNull()
      .references(() => reviewIssues.id, { onDelete: "cascade" }),
    /**
     * 이 근거를 만든 행위. BEFORE 는 발견 행위, AFTER 는 그 고침 행위다.
     *
     * `NULL` 을 허용하는 이유는 **행위 없이 근거만 붙는 경우**(뒤늦게 Evidence 만 첨부)를
     * 막을 이유가 없기 때문이다. 소유는 언제나 Issue 가 한다.
     */
    issueActivityId: uuid("issue_activity_id").references(
      () => issueActivities.id,
      { onDelete: "cascade" },
    ),

    kind: codeEvidenceKindEnum("kind").notNull(),

    /** 🔴 Commit 은 **필수**다. 없으면 이 코드가 언제의 것인지 영원히 알 수 없다. */
    commitSha: text("commit_sha").notNull(),
    filePath: text("file_path").notNull(),
    startLine: integer("start_line"),
    endLine: integer("end_line"),

    /** Agent 가 보낸 코드 조각. 저장소가 사라지거나 Private 여도 화면이 무언가는 보여 준다. */
    snapshot: text("snapshot"),

    verification: evidenceVerificationEnum("verification")
      .notNull()
      .default("UNVERIFIED"),
    /** 확인을 **시도한** 시각. 결과가 `UNAVAILABLE` 이어도 찍힌다. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Issue 상세가 BEFORE/AFTER 를 나눠 그린다.
    index("issue_code_evidences_issue_idx").on(table.reviewIssueId, table.kind),
    // 한 시도가 남긴 근거를 History 줄 옆에 붙인다.
    index("issue_code_evidences_activity_idx").on(table.issueActivityId),
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
