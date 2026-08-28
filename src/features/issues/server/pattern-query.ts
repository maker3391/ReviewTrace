import "server-only";

import { and, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { repositories, reviewIssues } from "@/db/schema";
import type { ProjectScope, WorkspaceScope } from "@/types/tenant";
import type { IssueCategory } from "@/types/review";

/**
 * 반복되는 문제의 집계.
 *
 * 🔴 **Tag 개수가 아니다.** Pattern 은 반복되는 문제의 **정규화된 개념**이고,
 * Tag 는 검색용 자유 Keyword 다(CLAUDE.md 3).
 *
 * ## 왜 여기 있는가
 *
 * Pattern 은 `review_issues` 에서 나온다 — 그러니 그 표를 가진 Feature 가 갖는다.
 * Dashboard 두 개가 각자 같은 질의를 적고 있었는데, 그러면 한쪽만 고쳐 **두 화면이 같은
 * Workspace 를 다른 숫자로 그리는** 일이 생긴다. 세는 규칙은 한 곳이다.
 *
 * 🔴 **Dashboard 가 이 함수를 부르지, 이 함수가 Dashboard 를 알지 않는다.** 화면 쪽 Feature 를
 * 통째로 들어내도 이 파일은 그대로 선다.
 */
export interface PatternCount {
  patternKey: string;
  category: IssueCategory;
  occurrences: number;
  resolvedCount: number;
  lastDetectedAt: Date;
}

/**
 * Workspace 전체, 또는 그 안의 Project 하나에서 반복되는 Pattern.
 *
 * `projectId` 를 주면 Repository 를 Join 해 좁힌다 — `review_issues` 에는 `project_id` 가
 * 없다(소유는 Repository 가 갖는다).
 */
export async function findFrequentPatterns(
  input: { scope: WorkspaceScope | ProjectScope; limit: number },
  executor: DbExecutor = db(),
): Promise<PatternCount[]> {
  const projectId = "projectId" in input.scope ? input.scope.projectId : null;

  const conditions: SQL[] = [
    eq(reviewIssues.workspaceId, input.scope.workspaceId),
    isNotNull(reviewIssues.patternKey),
  ];
  if (projectId !== null) {
    conditions.push(eq(repositories.projectId, projectId));
  }

  /**
   * Repository Join 을 «늘» 건다.
   *
   * 조건이 있을 때만 붙이면 조건과 Join 이 갈라져 빠뜨리기 쉽다. FK 가 `NOT NULL` 이라
   * Join 을 더해도 행 수는 변하지 않는다.
   */
  return executor
    .select({
      patternKey: sql<string>`${reviewIssues.patternKey}`,
      category: reviewIssues.category,
      // count(*) 는 bigint 라 Driver 가 문자열로 준다. 세는 값은 숫자로 받는다.
      occurrences: sql<number>`count(*)::int`,
      resolvedCount: sql<number>`count(*) filter (where ${reviewIssues.status} = 'RESOLVED')::int`,
      lastDetectedAt: sql<Date>`max(${reviewIssues.firstDetectedAt})`,
    })
    .from(reviewIssues)
    .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
    .where(and(...conditions))
    .groupBy(reviewIssues.patternKey, reviewIssues.category)
    .orderBy(
      desc(sql`count(*)`),
      desc(sql`max(${reviewIssues.firstDetectedAt})`),
    )
    .limit(input.limit);
}
