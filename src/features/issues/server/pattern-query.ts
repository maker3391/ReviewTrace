import "server-only";

import {
  and,
  desc,
  eq,
  isNotNull,
  sql,
  type SQL,
} from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { asCount, asDate } from "@/db/raw-value";
import { issueActivities, repositories, reviewIssues } from "@/db/schema";
import type { ProjectScope, WorkspaceScope } from "@/types/tenant";
import type { IssueCategory, IssueSeverity } from "@/types/review";

/**
 * 반복되는 문제의 집계.
 *
 * 🔴 **Tag 개수가 아니다.** Pattern 은 반복되는 문제의 **정규화된 개념**이고,
 * Tag 는 검색용 자유 Keyword 다.
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
  /** 이 Pattern에 속한 고유 Issue 행 수. */
  uniqueIssues: number;
  /** 최초 발견 1회 + 이후 REVIEWED_AGAIN 수. */
  encounters: number;
  /** @deprecated 호환 이름. 값의 의미는 이제 `encounters`와 같다. */
  occurrences: number;
  resolvedCount: number;
  lastEncounterAt: Date;
  /** @deprecated 호환 이름. 값의 의미는 이제 `lastEncounterAt`과 같다. */
  lastDetectedAt: Date;
}

/**
 * Workspace 전체, 또는 그 안의 Project 하나에서 반복되는 Pattern.
 *
 * `projectId` 를 주면 Repository 를 Join 해 좁힌다 — `review_issues` 에는 `project_id` 가
 * 없다(소유는 Repository 가 갖는다).
 */
export async function findFrequentPatterns(
  input: {
    scope: WorkspaceScope | ProjectScope;
    repositoryId?: string | null;
    category?: IssueCategory | null;
    severity?: IssueSeverity | null;
    patternKey?: string | null;
    limit: number;
  },
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
  if (input.repositoryId != null) {
    conditions.push(eq(reviewIssues.repositoryId, input.repositoryId));
  }
  if (input.category != null) {
    conditions.push(eq(reviewIssues.category, input.category));
  }
  if (input.severity != null) {
    conditions.push(eq(reviewIssues.severity, input.severity));
  }
  if (input.patternKey != null) {
    conditions.push(eq(reviewIssues.patternKey, input.patternKey));
  }

  /**
   * 한 Issue의 첫 encounter는 그 Issue 행 자체다. 이후 같은 Issue를 다시 만난 것은
   * `REVIEWED_AGAIN` Activity로 남는다. FIX_ATTEMPTED·RESOLVED·COMMENT까지 세지 않는다.
   *
   * `DETECTED` Activity를 별도로 더하지 않는 이유는 최초 Issue와 1:1이기 때문이다. 행과
   * DETECTED를 둘 다 세면 첫 발견이 두 번 된다. 이 방식은 legacy Issue에 DETECTED Activity가
   * 빠져 있어도 최초 발견 1회를 보존한다.
   */
  const uniqueIssues = sql<number>`count(distinct ${reviewIssues.id})::int`;
  const repeatedEncounters = sql<number>`count(${issueActivities.id}) filter (where ${issueActivities.type} = 'REVIEWED_AGAIN')::int`;
  const encounters = sql<number>`(${uniqueIssues} + ${repeatedEncounters})::int`;
  const lastEncounterAt = sql<Date>`greatest(
    max(${reviewIssues.firstDetectedAt}),
    coalesce(
      max(${issueActivities.createdAt}) filter (where ${issueActivities.type} = 'REVIEWED_AGAIN'),
      max(${reviewIssues.firstDetectedAt})
    )
  )`;

  /**
   * Repository Join 을 «늘» 건다.
   *
   * 조건이 있을 때만 붙이면 조건과 Join 이 갈라져 빠뜨리기 쉽다. FK 가 `NOT NULL` 이라
   * Join 을 더해도 행 수는 변하지 않는다.
   */
  const rows = await executor
    .select({
      patternKey: sql<string>`${reviewIssues.patternKey}`,
      category: reviewIssues.category,
      uniqueIssues,
      encounters,
      // 기존 consumer가 읽는 이름은 encounter 의미의 호환 alias로 유지한다.
      occurrences: encounters,
      resolvedCount: sql<number>`count(distinct ${reviewIssues.id}) filter (where ${reviewIssues.status} = 'RESOLVED')::int`,
      lastEncounterAt,
      lastDetectedAt: lastEncounterAt,
    })
    .from(reviewIssues)
    .innerJoin(
      repositories,
      and(
        eq(repositories.id, reviewIssues.repositoryId),
        eq(repositories.workspaceId, reviewIssues.workspaceId),
      ),
    )
    .leftJoin(
      issueActivities,
      and(
        eq(issueActivities.reviewIssueId, reviewIssues.id),
        eq(issueActivities.workspaceId, reviewIssues.workspaceId),
        /**
         * 🔴 **결과를 바꾸지 않는다.** 이 질의가 `issue_activities` 를 쓰는 자리는
         * `repeatedEncounters` 와 `lastEncounterAt` 둘뿐이고 **둘 다 이미 이 조건으로
         * FILTER 된다** — 나머지 Activity 는 붙어 봤자 아무 집계에도 들어가지 않고
         * 행만 부풀린다(`count(distinct)` 가 그것을 도로 걷어낸다).
         *
         * 🔴 **그런데 성능은 바꾼다.** 이 조건이 ON 에 있어야 PostgreSQL 이
         * `issue_activities_reviewed_again_idx`(partial)를 쓸 수 있다고 판단한다.
         * FILTER 안에만 두면 그 Index 는 영원히 쓰이지 않는다.
         * 실측: 29.2ms → 14.5ms(같은 데이터셋 5회 중앙값, 결과 집합은 동일).
         *
         * FILTER 는 그대로 둔다 — 규칙이 한 자리에만 적혀 있으면 다음 사람이 ON 을
         * 지웠을 때 집계가 조용히 틀려진다.
         */
        eq(issueActivities.type, "REVIEWED_AGAIN"),
      ),
    )
    .where(and(...conditions))
    .groupBy(reviewIssues.patternKey, reviewIssues.category)
    .orderBy(
      desc(encounters),
      desc(lastEncounterAt),
    )
    .limit(input.limit);

  // 🔴 원시 SQL 조각의 타입 단언을 실제 값으로 맞춘다(`db/raw-value.ts`).
  return rows.map((row) => ({
    ...row,
    uniqueIssues: asCount(row.uniqueIssues),
    encounters: asCount(row.encounters),
    occurrences: asCount(row.occurrences),
    resolvedCount: asCount(row.resolvedCount),
    lastEncounterAt: asDate(row.lastEncounterAt),
    lastDetectedAt: asDate(row.lastDetectedAt),
  }));
}
