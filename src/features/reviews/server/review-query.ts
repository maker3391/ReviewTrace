import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { repositories, reviewIssues, reviewSessions } from "@/db/schema";
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
 * 🔴 **Review 대상은 Pull Request 에 한정하지 않는다**(CLAUDE.md 2). `targetType` 이
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
  issues: ReviewIssueRow[];
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
 * 숫자가 남의 것을 세지 않는다(CLAUDE.md 10 — 겹쳐서 건다).
 */
const issueCount = sql<number>`(
  select count(*)::int from ${reviewIssues}
  where ${reviewIssues.reviewSessionId} = ${reviewSessions.id}
    and ${reviewIssues.workspaceId} = ${reviewSessions.workspaceId}
)`;

/**
 * Project 의 Review 목록.
 *
 * Pagination 은 아직 없다. 실제로 넘칠 때 만든다(CLAUDE.md 18) — 지금은 상한만 둔다.
 */
const LIST_LIMIT = 50;

export async function listProjectReviews(
  scope: ProjectScope,
  executor: DbExecutor = db(),
  limit: number = LIST_LIMIT,
): Promise<ReviewListItem[]> {
  return executor
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
    .where(
      and(
        eq(reviewSessions.workspaceId, scope.workspaceId),
        eq(repositories.projectId, scope.projectId),
      ),
    )
    .orderBy(desc(reviewSessions.createdAt))
    .limit(limit);
}

/** 한 Repository 의 최근 Review. Repository 상세가 쓴다. */
export async function listRepositoryReviews(
  scope: ProjectScope,
  repositoryId: string,
  limit: number,
  executor: DbExecutor = db(),
): Promise<ReviewListItem[]> {
  return executor
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
    .where(
      and(
        eq(reviewSessions.repositoryId, repositoryId),
        eq(reviewSessions.workspaceId, scope.workspaceId),
        eq(repositories.projectId, scope.projectId),
      ),
    )
    .orderBy(desc(reviewSessions.createdAt))
    .limit(limit);
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

  const issues = await executor
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
    .orderBy(reviewIssues.severity, desc(reviewIssues.firstDetectedAt));

  return { ...session, issues };
}
