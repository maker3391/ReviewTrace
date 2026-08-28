import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { repositories, reviewIssues, reviewSessions } from "@/db/schema";
import { OPEN_ISSUE_STATUSES, type ScmProvider } from "@/types/review";
import type { ProjectScope } from "@/types/tenant";

/**
 * Repository 조회.
 *
 * 🔴 **이 Feature 가 `repositories` 표의 주인이다.** Dashboard 도 Project 화면도 여기를
 * 부른다 — 반대로 이 파일이 그쪽을 알지 않는다. 화면 쪽을 들어내도 이 파일은 그대로 선다.
 *
 * 🔴 **모든 질의에 `workspaceId` 와 `projectId` 를 겹쳐서 건다.** 한쪽만 걸면 그 값을 잘못
 * 얻은 경로 하나가 곧바로 다른 Tenant 를 읽는다(CLAUDE.md 11).
 */

/** 목록 한 줄. 「어느 저장소를 봐야 하는가」까지만 답한다. */
export interface RepositoryStatus {
  id: string;
  fullName: string;
  defaultBranch: string;
  reviewCount: number;
  openIssueCount: number;
  lastReviewAt: Date | null;
}

/** 상세 화면이 그리는 것. 목록보다 몇 칸 더 안다. */
export interface RepositoryDetail extends RepositoryStatus {
  provider: ScmProvider;
  owner: string;
  name: string;
  htmlUrl: string | null;
  isActive: boolean;
  createdAt: Date;
}

/**
 * Project 의 Repository 목록 — Review·Issue 상태까지.
 *
 * 🔴 **Repository 마다 다시 세지 않는다.** Review 와 Issue 를 각각 Repository 단위로 접어
 * 둔 뒤 붙인다 — Join 을 곧장 겹치면 행이 곱해져 센 값이 부풀어 오른다.
 */
export async function listRepositoryStatuses(
  scope: ProjectScope,
  executor: DbExecutor = db(),
): Promise<RepositoryStatus[]> {
  const stats = repositoryStats(scope, executor);

  return executor
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
      defaultBranch: repositories.defaultBranch,
      reviewCount: sql<number>`coalesce(${stats.review.reviewCount}, 0)`,
      openIssueCount: sql<number>`coalesce(${stats.issue.openIssueCount}, 0)`,
      lastReviewAt: sql<Date | null>`${stats.review.lastReviewAt}`,
    })
    .from(repositories)
    .leftJoin(stats.review, eq(stats.review.repositoryId, repositories.id))
    .leftJoin(stats.issue, eq(stats.issue.repositoryId, repositories.id))
    .where(
      and(
        eq(repositories.workspaceId, scope.workspaceId),
        eq(repositories.projectId, scope.projectId),
      ),
    )
    .orderBy(asc(repositories.name));
}

/** 상세 화면. 🔴 범위 밖이면 `null` 이다 — 「없는 것」과 「남의 것」을 구분하지 않는다. */
export async function findRepositoryDetail(
  scope: ProjectScope,
  repositoryId: string,
  executor: DbExecutor = db(),
): Promise<RepositoryDetail | null> {
  const stats = repositoryStats(scope, executor);

  const rows = await executor
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
      defaultBranch: repositories.defaultBranch,
      provider: repositories.provider,
      owner: repositories.owner,
      name: repositories.name,
      htmlUrl: repositories.htmlUrl,
      isActive: repositories.isActive,
      createdAt: repositories.createdAt,
      reviewCount: sql<number>`coalesce(${stats.review.reviewCount}, 0)`,
      openIssueCount: sql<number>`coalesce(${stats.issue.openIssueCount}, 0)`,
      lastReviewAt: sql<Date | null>`${stats.review.lastReviewAt}`,
    })
    .from(repositories)
    .leftJoin(stats.review, eq(stats.review.repositoryId, repositories.id))
    .leftJoin(stats.issue, eq(stats.issue.repositoryId, repositories.id))
    .where(
      and(
        eq(repositories.id, repositoryId),
        eq(repositories.workspaceId, scope.workspaceId),
        eq(repositories.projectId, scope.projectId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Repository 단위로 접어 둔 Review·Issue 집계.
 *
 * Workspace 로만 좁힌다 — 어느 Project 인지는 바깥 질의가 `repositories` 로 거른다.
 * 여기까지 Project 조건을 내리면 Subquery 가 Project 마다 달라져 재사용할 수 없다.
 */
function repositoryStats(scope: ProjectScope, executor: DbExecutor) {
  const review = executor
    .select({
      repositoryId: reviewSessions.repositoryId,
      reviewCount: sql<number>`count(*)::int`.as("review_count"),
      lastReviewAt: sql<Date | null>`max(${reviewSessions.createdAt})`.as(
        "last_review_at",
      ),
    })
    .from(reviewSessions)
    .where(eq(reviewSessions.workspaceId, scope.workspaceId))
    .groupBy(reviewSessions.repositoryId)
    .as("review_stats");

  const issue = executor
    .select({
      repositoryId: reviewIssues.repositoryId,
      openIssueCount:
        sql<number>`count(*) filter (where ${inArray(reviewIssues.status, OPEN_ISSUE_STATUSES)})::int`.as(
          "open_issue_count",
        ),
    })
    .from(reviewIssues)
    .where(eq(reviewIssues.workspaceId, scope.workspaceId))
    .groupBy(reviewIssues.repositoryId)
    .as("issue_stats");

  return { review, issue };
}

/** Repository 를 옮길 때 고를 수 있는 목록. 같은 Workspace 안의 것만 나온다. */
export interface RepositoryMoveOption {
  id: string;
  fullName: string;
  projectId: string;
}

export async function listWorkspaceRepositories(
  workspaceId: string,
  executor: DbExecutor = db(),
): Promise<RepositoryMoveOption[]> {
  return executor
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
      projectId: repositories.projectId,
    })
    .from(repositories)
    .where(eq(repositories.workspaceId, workspaceId))
    .orderBy(asc(repositories.fullName));
}
