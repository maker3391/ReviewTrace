import "server-only";

import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { asCount } from "@/db/raw-value";
import { repositories, reviewIssues, reviewSessions } from "@/db/schema";
import { paginate, type PageRequest, type PageResult } from "@/lib/pagination";
import type {
  IssueCategory,
  IssueSeverity,
  IssueStatus,
  ReviewerType,
  ReviewTargetType,
} from "@/types/review";
import type { ProjectScope } from "@/types/tenant";

/**
 * ReviewSession 조회.
 *
 * 🔴 **이 Feature 가 `review_sessions` 표의 주인이다.** Dashboard 도 목록 화면도 여기를
 * 부른다 — 반대로 이 파일이 그쪽을 알지 않는다.
 *
 * 🔴 **Review 대상은 Pull Request 에 한정하지 않는다**. `targetType` 이
 * `COMMIT`·`BRANCH`·`REPOSITORY`·`MANUAL` 일 수 있어 PR 번호를 앞세우지 않는다.
 */

export interface ReviewListItem {
  id: string;
  reviewerName: string;
  reviewerType: ReviewerType;
  repositoryFullName: string;
  targetType: ReviewTargetType;
  branch: string | null;
  commitSha: string | null;
  issueCount: number;
  createdAt: Date;
}

/** 한 Review 가 남긴 Issue 한 줄. 상세 화면에서 펼친다. */
export interface ReviewIssueRow {
  id: string;
  title: string;
  severity: IssueSeverity;
  category: IssueCategory;
  status: IssueStatus;
  patternKey: string | null;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
}

export interface ReviewDetail extends ReviewListItem {
  repositoryId: string;
  reviewerVersion: string | null;
  pullRequestNumber: number | null;
  summary: string | null;
  startedAt: Date;
  completedAt: Date | null;
  /**
   * 🔴 **한 쪽만 담는다.** Agent API 는 한 Review 에 **최대 500건**을 받으므로
   * 전부 그리면 행 500개가 한 화면에 쏟아진다 — 목록 화면 전부에
   * 이동 줄을 넣으면서 이 자리만 빠져 있었다.
   */
  issues: PageResult<ReviewIssueRow>;
}

/**
 * 한 Review 가 몇 건을 남겼는가.
 *
 * 목록에서 Issue 를 Join 해 세면 Review 마다 행이 곱해진다. 상관 Subquery 로 센다 —
 * `review_issues_session_idx` 가 그것을 받는다.
 *
 * 🔴 **바깥이 Workspace 로 좁혀졌다고 안쪽까지 좁혀지지는 않는다.** 안쪽 조건은
 * `review_session_id` 하나뿐이고, 그것이 Workspace 를 넘지 않는다는 보증은 Database 에
 * 없다 — `review_issues.review_session_id` 는 단일 Column FK 라 두 표의 `workspace_id` 가
 * 같다는 것을 강제하지 못한다. 지금은 저장 코드가 늘 같은 값을 넣어 맞지만, 그것은
 * **애플리케이션 규약**이지 제약이 아니다. 안쪽에도 함께 걸어 두면 규약이 깨져도
 * 숫자가 남의 것을 세지 않는다 — 조건을 겹쳐 두면 어느 한쪽을 틀려도 결과가 비어서 돌아온다.
 */
const issueCount = sql<number>`(
 select count(*)::int from ${reviewIssues}
 where ${reviewIssues.reviewSessionId} = ${reviewSessions.id}
 and ${reviewIssues.workspaceId} = ${reviewSessions.workspaceId}
)`;

/**
 * 「이 Project 의 Review」를 가리는 조건.
 *
 * 🔴 **한 곳에서 만든다.** 목록과 세는 질의가 조건을 따로 적으면 한쪽만 고쳐졌을 때
 * 표에 12줄이 있는데 「38건」이라고 적히는 화면이 된다.
 */
function projectScopeConditions(scope: ProjectScope): SQL[] {
  return [
    eq(reviewSessions.workspaceId, scope.workspaceId),
    eq(repositories.projectId, scope.projectId),
  ];
}

/** 목록 한 쪽을 읽는다. 🔴 Dashboard 의 「최근 N건」과 **같은 select** 를 쓴다. */
function selectReviewList(
  executor: DbExecutor,
  conditions: SQL[],
  limit: number,
  offset: number,
) {
  return (
    executor
      .select({
        id: reviewSessions.id,
        reviewerName: reviewSessions.reviewerName,
        reviewerType: reviewSessions.reviewerType,
        repositoryFullName: repositories.fullName,
        targetType: reviewSessions.targetType,
        branch: reviewSessions.branch,
        commitSha: reviewSessions.commitSha,
        issueCount,
        createdAt: reviewSessions.createdAt,
      })
      .from(reviewSessions)
      .innerJoin(repositories, eq(repositories.id, reviewSessions.repositoryId))
      .where(and(...conditions))
      // 같은 시각의 행이 쪽마다 뒤바뀌지 않게 id 로 한 번 더 고정한다.
      .orderBy(desc(reviewSessions.createdAt), desc(reviewSessions.id))
      .limit(limit)
      .offset(offset)
  );
}

/**
 * Project 의 Review 「최근 N건」.
 *
 * 🔴 **목록 «화면»이 쓰는 것이 아니다.** Dashboard 처럼 앞부분만 필요한 자리의 것이다 —
 * 화면은 `findProjectReviewPage` 를 쓴다.
 */
const LIST_LIMIT = 50;

export async function listProjectReviews(
  scope: ProjectScope,
  executor: DbExecutor = db(),
  limit: number = LIST_LIMIT,
): Promise<ReviewListItem[]> {
  return selectReviewList(executor, projectScopeConditions(scope), limit, 0);
}

/**
 * Project 의 Review 목록 — 한 쪽씩.
 *
 * 🔴 **전부 가져와 화면에서 자르지 않는다.** `LIMIT`/`OFFSET` 은 Database 가 하고,
 * 총 건수도 Database 가 센다. 예전에는 상한 50건에서 **말없이 잘려** 51번째 Review 를
 * 화면에서 볼 방법이 아예 없었다.
 */
export async function findProjectReviewPage(
  scope: ProjectScope,
  request: PageRequest,
  executor: DbExecutor = db(),
): Promise<PageResult<ReviewListItem>> {
  const conditions = projectScopeConditions(scope);

  return paginate(request, {
    count: async () => {
      const rows = await executor
        .select({ value: count() })
        .from(reviewSessions)
        .innerJoin(
          repositories,
          eq(repositories.id, reviewSessions.repositoryId),
        )
        .where(and(...conditions));

      return rows[0]?.value ?? 0;
    },
    rows: (limit, offset) =>
      selectReviewList(executor, conditions, limit, offset),
  });
}

/** 한 Repository 의 최근 Review. Repository 상세가 쓴다. */
export async function listRepositoryReviews(
  scope: ProjectScope,
  repositoryId: string,
  limit: number,
  executor: DbExecutor = db(),
): Promise<ReviewListItem[]> {
  return selectReviewList(
    executor,
    [
      eq(reviewSessions.repositoryId, repositoryId),
      ...projectScopeConditions(scope),
    ],
    limit,
    0,
  );
}

/**
 * Review 상세와 그것이 남긴 Issue.
 *
 * 🔴 범위 밖이면 `null` 이다 — 「없는 Review」와 「남의 Review」를 구분해 알려 주지 않는다.
 * Issue 는 Session 을 찾은 «뒤에» 읽는다. 못 찾으면 질의를 던지지도 않는다.
 */
export async function findReviewDetail(
  scope: ProjectScope,
  reviewSessionId: string,
  request: PageRequest,
  executor: DbExecutor = db(),
): Promise<ReviewDetail | null> {
  const rows = await executor
    .select({
      id: reviewSessions.id,
      repositoryId: reviewSessions.repositoryId,
      reviewerName: reviewSessions.reviewerName,
      reviewerType: reviewSessions.reviewerType,
      reviewerVersion: reviewSessions.reviewerVersion,
      repositoryFullName: repositories.fullName,
      targetType: reviewSessions.targetType,
      branch: reviewSessions.branch,
      commitSha: reviewSessions.commitSha,
      pullRequestNumber: reviewSessions.pullRequestNumber,
      summary: reviewSessions.summary,
      startedAt: reviewSessions.startedAt,
      completedAt: reviewSessions.completedAt,
      issueCount,
      createdAt: reviewSessions.createdAt,
    })
    .from(reviewSessions)
    .innerJoin(repositories, eq(repositories.id, reviewSessions.repositoryId))
    .where(
      and(
        eq(reviewSessions.id, reviewSessionId),
        eq(reviewSessions.workspaceId, scope.workspaceId),
        eq(repositories.projectId, scope.projectId),
      ),
    )
    .limit(1);

  const session = rows[0];
  if (session === undefined) {
    return null;
  }

  const issues = await paginate(request, {
    /*
 🔴 **다시 세지 않는다.** 위 `issueCount` 가 **같은 조건**으로 이미 세어 왔고,
 머리글의 「N건」이 그 값이다 — 따로 세면 두 숫자가 갈릴 수 있다.
 🔴 `asCount` 를 통과시키는 이유는 그것이 원시 `sql<number>` 이기 때문이다
 (`src/db/raw-value.ts` — 단언은 검사되지 않는다).
 */
    count: () => Promise.resolve(asCount(session.issueCount)),
    rows: (limit, offset) =>
      executor
        .select({
          id: reviewIssues.id,
          title: reviewIssues.title,
          severity: reviewIssues.severity,
          category: reviewIssues.category,
          status: reviewIssues.status,
          patternKey: reviewIssues.patternKey,
          filePath: reviewIssues.filePath,
          startLine: reviewIssues.startLine,
          endLine: reviewIssues.endLine,
        })
        .from(reviewIssues)
        .where(
          and(
            eq(reviewIssues.reviewSessionId, session.id),
            // Session 을 이미 범위 안에서 찾았지만, 조건을 겹쳐 두는 편이 잊기 어렵다.
            eq(reviewIssues.workspaceId, scope.workspaceId),
          ),
        )
        /*
 🔴 **`id` 로 동점을 끊는다.** `severity` 와 시각이 같은 행이 여럿이면 순서가
 질의마다 달라질 수 있고, 그러면 쪽을 넘길 때 **같은 행이 두 번 나오거나
 아예 빠진다.** 이동 줄이 없을 때는 드러나지 않던 요구다.
 */
        .orderBy(
          reviewIssues.severity,
          desc(reviewIssues.firstDetectedAt),
          reviewIssues.id,
        )
        .limit(limit)
        .offset(offset),
  });

  return { ...session, issues };
}
