import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { repositories, reviewIssues } from "@/db/schema";
import {
  listKnowledgeExcerpts,
  type KnowledgeExcerpt,
} from "@/features/knowledge/server/knowledge-page-service";
import { findProjectBySlug } from "@/features/projects/server/project-service";
import type { KnowledgeContextQuery } from "@/features/knowledge/schemas/knowledge-context-query";
import type {
  IssueCategory,
  IssueSeverity,
  IssueStatus,
} from "@/types/review";

/**
 * `GET /api/v1/knowledge/context` (스펙 34·35).
 *
 * Agent 가 **개발·Review 를 시작하기 전에** 과거 Knowledge 를 읽어 가는 자리다(CLAUDE.md 14).
 *
 * 🔴 **LLM 도 Vector Search 도 쓰지 않는다.** PostgreSQL 의 `COUNT` · `GROUP BY` ·
 * `FILTER` · `ORDER BY` · `LIMIT` 만으로 만든다(스펙 34 · CLAUDE.md 17).
 *
 * 🔴 **통계를 JavaScript 에서 세지 않는다.** 전체 ReviewIssue 를 가져와 `reduce` 로 세면
 * Issue 가 만 건이 되는 순간 요청 하나가 표를 통째로 읽는다. 세는 일은 Database 가 한다.
 *
 * 🔴 **필요한 Column 만 조회한다.** `description`·`suggestion` 은 길고, Agent 가 목록
 * 단계에서 읽을 값이 아니다.
 *
 * 네 묶음은 서로 독립이라 함께 던진다 — Round Trip 은 Issue 수와 무관하게 4번이다.
 */

/** 미해결로 보는 상태. `IGNORED`·`FALSE_POSITIVE` 는 「더 보지 않기로 한 것」이라 뺀다. */
const UNRESOLVED_STATUSES: readonly IssueStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "REOPENED",
];

/** 「지금 당장 봐야 하는」 등급. */
const HIGH_SEVERITIES: readonly IssueSeverity[] = ["CRITICAL", "HIGH"];

export interface FrequentPattern {
  patternKey: string;
  category: IssueCategory;
  occurrences: number;
  resolvedCount: number;
  lastDetectedAt: Date;
}

export interface KnowledgeIssueSummary {
  id: string;
  title: string;
  severity: IssueSeverity;
  category: IssueCategory;
  status: IssueStatus;
  patternKey: string | null;
  filePath: string | null;
  startLine: number | null;
  repositoryId: string;
  firstDetectedAt: Date;
}

export interface PastResolution {
  id: string;
  title: string;
  category: IssueCategory;
  severity: IssueSeverity;
  patternKey: string | null;
  filePath: string | null;
  resolutionSummary: string;
  resolvedAt: Date;
}

export interface KnowledgeContext {
  /**
   * 이 응답이 어느 범위를 본 것인가.
   *
   * 🔴 **Agent 에게 «무엇을 못 봤는지»를 알린다.** 없는 Project slug 를 보냈을 때
   * 빈 결과만 돌려주면 「이 Project 는 문제가 없다」로 읽힌다 — 실제로는 조회가
   * 엉뚱한 곳을 본 것이다.
   */
  scope: {
    projectSlug: string | null;
    /** 요청한 slug 가 이 Workspace 에서 실제로 찾아졌는가. slug 를 안 보냈으면 `null`. */
    projectResolved: boolean | null;
  };
  /** 사람이 적은 Wiki(스펙 10). Review 가 남긴 것과 **출처가 다르다**. */
  wiki: KnowledgeExcerpt[];
  frequentPatterns: FrequentPattern[];
  recentHighSeverityIssues: KnowledgeIssueSummary[];
  unresolvedIssues: KnowledgeIssueSummary[];
  pastResolutions: PastResolution[];
}

/** 목록 세 묶음이 함께 쓰는 Column 집합. 여기 없는 Column 은 조회하지 않는다. */
const issueSummaryColumns = {
  id: reviewIssues.id,
  title: reviewIssues.title,
  severity: reviewIssues.severity,
  category: reviewIssues.category,
  status: reviewIssues.status,
  patternKey: reviewIssues.patternKey,
  filePath: reviewIssues.filePath,
  startLine: reviewIssues.startLine,
  repositoryId: reviewIssues.repositoryId,
  firstDetectedAt: reviewIssues.firstDetectedAt,
};

export async function findKnowledgeContext(
  input: { workspaceId: string; query: KnowledgeContextQuery },
  executor: DbExecutor = db(),
): Promise<KnowledgeContext> {
  const { workspaceId, query } = input;

  /**
   * 🔴 Project 도 **slug 가 아니라 소속으로** 찾는다. 조회는 언제나 API Key 가 정한
   * Workspace 안에서 돌고, 그 안에 없는 slug 면 `null` 이다(스펙 3).
   */
  const project =
    query.projectSlug === null
      ? null
      : await findProjectBySlug(workspaceId, query.projectSlug, executor);

  /**
   * 없는 Project 를 지목했으면 **빈 결과를 준다.**
   *
   * Workspace 전체로 넓혀 답하면 Agent 는 그것을 그 Project 의 Knowledge 로 읽는다 —
   * 묻지 않은 것에 답하는 쪽이 아무것도 못 찾는 쪽보다 나쁘다. `scope` 가 이유를 알린다.
   */
  if (query.projectSlug !== null && project === null) {
    return {
      scope: { projectSlug: query.projectSlug, projectResolved: false },
      wiki: [],
      frequentPatterns: [],
      recentHighSeverityIssues: [],
      unresolvedIssues: [],
      pastResolutions: [],
    };
  }

  /**
   * 🔴 **모든 묶음의 첫 조건이 Workspace 다.**
   *
   * `repositoryId` 는 요청이 보낸 값이라 Filter 일 뿐이다 — 다른 Tenant 의 Repository ID 를
   * 적어도 이 조건이 함께 걸려 아무것도 나오지 않는다(스펙 15).
   */
  const filters: SQL[] = [eq(reviewIssues.workspaceId, workspaceId)];

  if (project !== null) {
    filters.push(eq(repositories.projectId, project.projectId));
  }
  if (query.repositoryId !== null) {
    filters.push(eq(reviewIssues.repositoryId, query.repositoryId));
  }
  if (query.category !== null) {
    filters.push(eq(reviewIssues.category, query.category));
  }
  if (query.severity !== null) {
    filters.push(eq(reviewIssues.severity, query.severity));
  }
  if (query.pattern !== null) {
    filters.push(eq(reviewIssues.patternKey, query.pattern));
  }

  const scope = and(...filters);
  const limit = query.limit;

  const [
    wiki,
    frequentPatterns,
    recentHighSeverityIssues,
    unresolvedIssues,
    pastResolutions,
  ] = await Promise.all([
      /**
       * 사람이 적은 Wiki(스펙 10).
       *
       * Project 를 지정하면 **Workspace 공통 규칙과 그 Project 문서를 함께** 준다 —
       * 공통 규칙을 빼고 주면 Agent 가 그것을 모르는 채로 작업한다.
       */
      listKnowledgeExcerpts(
        {
          workspaceId,
          projectId: project?.projectId ?? null,
          limit,
        },
        executor,
      ),

      executor
        .select({
          patternKey: sql<string>`${reviewIssues.patternKey}`,
          category: reviewIssues.category,
          // `count(*)` 는 bigint 라 Driver 가 문자열로 준다. 세는 값은 숫자로 받는다.
          occurrences: sql<number>`count(*)::int`,
          resolvedCount: sql<number>`count(*) filter (where ${reviewIssues.status} = 'RESOLVED')::int`,
          lastDetectedAt: sql<Date>`max(${reviewIssues.firstDetectedAt})`,
        })
        .from(reviewIssues)
        .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
        .where(and(scope, isNotNull(reviewIssues.patternKey)))
        .groupBy(reviewIssues.patternKey, reviewIssues.category)
        .orderBy(
          desc(sql`count(*)`),
          desc(sql`max(${reviewIssues.firstDetectedAt})`),
        )
        .limit(limit),

      executor
        .select(issueSummaryColumns)
        .from(reviewIssues)
        .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
        .where(and(scope, inArray(reviewIssues.severity, HIGH_SEVERITIES)))
        .orderBy(desc(reviewIssues.firstDetectedAt))
        .limit(limit),

      executor
        .select(issueSummaryColumns)
        .from(reviewIssues)
        .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
        .where(and(scope, inArray(reviewIssues.status, UNRESOLVED_STATUSES)))
        /**
         * `severity` 는 PostgreSQL enum 이고, enum 의 정렬은 **선언 순서**를 따른다.
         * 선언 순서가 `CRITICAL · HIGH · MEDIUM · LOW · INFO`(`src/types/review.ts`)라
         * 오름차순이 곧 「급한 것부터」다 — 정렬용 CASE 문을 따로 두지 않는다.
         */
        .orderBy(asc(reviewIssues.severity), desc(reviewIssues.firstDetectedAt))
        .limit(limit),

      executor
        .select({
          id: reviewIssues.id,
          title: reviewIssues.title,
          category: reviewIssues.category,
          severity: reviewIssues.severity,
          patternKey: reviewIssues.patternKey,
          filePath: reviewIssues.filePath,
          resolutionSummary: sql<string>`${reviewIssues.resolutionSummary}`,
          resolvedAt: sql<Date>`${reviewIssues.resolvedAt}`,
        })
        .from(reviewIssues)
        .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
        .where(
          and(
            scope,
            eq(reviewIssues.status, "RESOLVED"),
            // 🔴 「해결됐다」만 있고 **어떻게 해결했는지가 없는** 행은 Knowledge 가 아니다.
            isNotNull(reviewIssues.resolutionSummary),
            isNotNull(reviewIssues.resolvedAt),
          ),
        )
        .orderBy(desc(reviewIssues.resolvedAt))
        .limit(limit),
    ]);

  return {
    scope: {
      projectSlug: query.projectSlug,
      projectResolved: query.projectSlug === null ? null : true,
    },
    wiki,
    frequentPatterns,
    recentHighSeverityIssues,
    unresolvedIssues,
    pastResolutions,
  };
}
