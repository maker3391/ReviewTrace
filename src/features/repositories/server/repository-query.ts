import "server-only";

import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { paginate, type PageRequest, type PageResult } from "@/lib/pagination";
import {
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
} from "@/db/schema";
import { asCount, asNullableDate } from "@/db/raw-value";
import { AppError } from "@/lib/errors";
import { OPEN_ISSUE_STATUSES, type ScmProvider } from "@/types/review";
import type { ProjectScope } from "@/types/tenant";

/**
 * Repository 조회.
 *
 * 🔴 **이 Feature 가 `repositories` 표의 주인이다.** Dashboard 도 Project 화면도 여기를
 * 부른다 — 반대로 이 파일이 그쪽을 알지 않는다. 화면 쪽을 들어내도 이 파일은 그대로 선다.
 *
 * 🔴 **모든 질의에 `workspaceId` 와 `projectId` 를 겹쳐서 건다.** 한쪽만 걸면 그 값을 잘못
 * 얻은 경로 하나가 곧바로 다른 Tenant 를 읽는다.
 */

/** 목록 한 줄. 「어느 저장소를 봐야 하는가」까지만 답한다. */
export interface RepositoryStatus {
  id: string;
  fullName: string;
  defaultBranch: string;
  reviewCount: number;
  openIssueCount: number;
  lastReviewAt: Date | null;
  htmlUrl: string | null;
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
  // 상한 없이 전부 — Dashboard 의 요약처럼 「이 Project 의 저장소 전부」가 필요한 자리다.
  return selectRepositoryStatuses(scope, executor, null, 0);
}

/** GitHub picker에서 현재 Project에 이미 연결된 행만 제외하기 위한 최소 identity 조회. */
export async function listProjectRepositoryIdentities(
  scope: ProjectScope,
  executor: DbExecutor = db(),
): Promise<{ externalRepositoryId: string; fullName: string }[]> {
  return executor
    .select({
      externalRepositoryId: repositories.externalRepositoryId,
      fullName: repositories.fullName,
    })
    .from(repositories)
    .where(
      and(
        ...scopeConditions(scope),
        eq(repositories.provider, "GITHUB"),
      ),
    );
}

/**
 * Repository 목록 — 한 쪽씩.
 *
 * 🔴 **세는 질의에는 집계 Subquery 를 붙이지 않는다.** 세는 것은 `repositories` 행 수일
 * 뿐이라 Review·Issue 를 접어 둘 이유가 없다 — 붙이면 쪽마다 쓸데없는 집계가 한 번 더 돈다.
 */
export async function findRepositoryStatusPage(
  scope: ProjectScope,
  request: PageRequest,
  executor: DbExecutor = db(),
): Promise<PageResult<RepositoryStatus>> {
  return paginate(request, {
    count: async () => {
      const rows = await executor
        .select({ value: count() })
        .from(repositories)
        .where(and(...scopeConditions(scope)));

      return rows[0]?.value ?? 0;
    },
    rows: (limit, offset) =>
      selectRepositoryStatuses(scope, executor, limit, offset),
  });
}

/** 🔴 목록과 세는 질의가 **같은 조건**을 쓰게 한 곳에서 만든다. */
function scopeConditions(scope: ProjectScope) {
  return [
    eq(repositories.workspaceId, scope.workspaceId),
    eq(repositories.projectId, scope.projectId),
  ];
}

async function selectRepositoryStatuses(
  scope: ProjectScope,
  executor: DbExecutor,
  /** `null` 이면 상한을 걸지 않는다. */
  limit: number | null,
  offset: number,
): Promise<RepositoryStatus[]> {
  const stats = repositoryStats(scope, executor);

  const query = executor
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
      defaultBranch: repositories.defaultBranch,
      reviewCount: sql<number>`coalesce(${stats.review.reviewCount}, 0)`,
      openIssueCount: sql<number>`coalesce(${stats.issue.openIssueCount}, 0)`,
      lastReviewAt: sql<Date | null>`${stats.review.lastReviewAt}`,
      htmlUrl: repositories.htmlUrl,
    })
    .from(repositories)
    .leftJoin(stats.review, eq(stats.review.repositoryId, repositories.id))
    .leftJoin(stats.issue, eq(stats.issue.repositoryId, repositories.id))
    .where(and(...scopeConditions(scope)))
    // 이름이 같은 Repository 는 없지만, 쪽을 넘길 때의 순서는 id 로 못박아 둔다.
    .orderBy(asc(repositories.name), asc(repositories.id))
    .$dynamic();

  const rows = await (limit === null
    ? query
    : query.limit(limit).offset(offset));

  // 🔴 원시 SQL 조각의 타입 단언을 실제 값으로 맞춘다(`db/raw-value.ts`).
  return rows.map(normalizeRepositoryStatus);
}

function normalizeRepositoryStatus<T extends RepositoryStatus>(row: T): T {
  return {
    ...row,
    reviewCount: asCount(row.reviewCount),
    openIssueCount: asCount(row.openIssueCount),
    lastReviewAt: asNullableDate(row.lastReviewAt),
  };
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

  const row = rows[0];
  return row === undefined ? null : normalizeRepositoryStatus(row);
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

/**
 * Repository 를 같은 Workspace 안의 다른 Project 로 옮긴다.
 *
 * 🔴 **Workspace 를 넘지 못한다.** 조건에 `workspace_id` 가 두 번 든다 — 옮길 Repository 를
 * 찾을 때 한 번, 옮겨 갈 Project 가 같은 Workspace 인지 볼 때 한 번. 하나라도 어긋나면
 * 아무 행도 잡히지 않는다.
 *
 * 🔴 **Review Knowledge 는 따라간다.** `review_sessions`·`review_issues` 는 Repository 를
 * 가리키므로 행을 옮길 필요가 없다 — Project 로 좁히는 조회가 Repository 를 Join 하기 때문에
 * 이 한 번의 UPDATE 로 아래가 전부 함께 이동한다. 이것이 `project_id` 를 하위 표에 복사하지
 * 않은 이유이기도 하다.
 *
 * 🔴 **출발지도 조건이다.** 화면은 언제나 「이 Project 의 이 Repository 를 옮긴다」이고,
 * 그 화면이 Repository 를 **읽을 때** 쓴 범위는 `{workspaceId, projectId}` 였다
 * (`findRepositoryDetail`). 읽기와 쓰기의 범위가 어긋나면 **Project A 화면에서 주소와
 * ID 만 알면 Project B 의 Repository 를 옮길 수 있다.**
 *
 * @throws {AppError} 대상이나 목적지가 범위 밖이면 `NOT_FOUND`.
 */
export async function moveRepositoryToProject(
  input: {
    /** 🔴 소속 확인을 통과한 값. */
    workspaceId: string;
    repositoryId: string;
    /**
     * 지금 이 Repository 가 있다고 «주장하는» Project — 요청이 시작된 화면의 것이다.
     *
     * 주면 조건이 하나 더 겹친다. 화면에서 오는 요청은 **반드시 준다.**
     * Project 화면 밖에서 부르는 자리(Workspace 범위의 정리·이관)는 이것을 모르므로
     * Workspace 까지만 좁힌다.
     */
    sourceProjectId?: string;
    targetProjectId: string;
  },
  executor: DbExecutor = db(),
): Promise<void> {
  const target = await executor
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.targetProjectId),
        eq(projects.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);

  if (target[0] === undefined) {
    throw new AppError("MOVE_TARGET_PROJECT_NOT_FOUND");
  }

  const moved = await executor
    .update(repositories)
    .set({ projectId: input.targetProjectId, updatedAt: new Date() })
    .where(
      and(
        eq(repositories.id, input.repositoryId),
        eq(repositories.workspaceId, input.workspaceId),
        // 출발지를 아는 요청은 그것까지 조건으로 건다. 다르면 아무 행도 잡히지 않는다.
        ...(input.sourceProjectId === undefined
          ? []
          : [eq(repositories.projectId, input.sourceProjectId)]),
      ),
    )
    .returning({ id: repositories.id });

  if (moved.length === 0) {
    throw new AppError("REPOSITORY_NOT_FOUND");
  }
}
