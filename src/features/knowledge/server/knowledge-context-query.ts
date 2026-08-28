import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { reviewIssues } from "@/db/schema";
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
   * 🔴 **모든 묶음의 첫 조건이 Workspace 다.**
   *
   * `repositoryId` 는 요청이 보낸 값이라 Filter 일 뿐이다 — 다른 Tenant 의 Repository ID 를
   * 적어도 이 조건이 함께 걸려 아무것도 나오지 않는다(스펙 15).
   */
  const filters: SQL[] = [eq(reviewIssues.workspaceId, workspaceId)];

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

  const [frequentPatterns, recentHighSeverityIssues, unresolvedIssues, pastResolutions] =
    await Promise.all([
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
        .where(and(scope, inArray(reviewIssues.severity, HIGH_SEVERITIES)))
        .orderBy(desc(reviewIssues.firstDetectedAt))
        .limit(limit),

      executor
        .select(issueSummaryColumns)
        .from(reviewIssues)
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
    frequentPatterns,
    recentHighSeverityIssues,
    unresolvedIssues,
    pastResolutions,
  };
}
