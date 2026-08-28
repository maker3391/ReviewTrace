import "server-only";

import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  knowledgePages,
  repositories,
  reviewIssues,
  reviewSessions,
} from "@/db/schema";
import type { PatternCount } from "@/features/dashboard/server/workspace-dashboard-query";
import {
  OPEN_ISSUE_STATUSES,
  type IssueCategory,
  type IssueSeverity,
  type ReviewTargetType,
} from "@/types/review";

/**
 * Project Dashboard 의 조회(스펙 6).
 *
 * 답해야 하는 질문 — **「이 Project 에서 지금 무슨 문제가 나고 있고 무엇이 반복되는가?」**
 *
 * 🔴 **Tenant 판정을 여기서 하지 않는다.** 이 함수가 받는 `workspaceId`·`projectId` 는
 * `requireProject` 가 이미 「이 사용자가 이 Workspace 의 멤버이고, 그 Project 가 그
 * Workspace 것이다」를 확인한 값이다(`src/lib/auth/require-project.ts`).
 *
 * 그럼에도 **모든 질의에 `workspaceId` 를 함께 건다.** `projectId` 하나만으로 좁히면,
 * 그 값을 잘못 얻은 경로 하나가 곧바로 다른 Tenant 의 데이터를 읽는다 — 조건을 겹쳐 두면
 * 어느 한쪽을 틀려도 결과가 비어서 돌아온다(CLAUDE.md 11).
 *
 * 🔴 **Repository 상세 Dashboard 로 키우지 않는다**(스펙 6). Repository 별 상태는
 * 「어디를 봐야 하는가」까지만 보여 주고, 그 아래는 Repository 화면이 답한다.
 */

const RECENT_WINDOW = sql`now() - interval '30 days'`;

const SECTION_LIMIT = 8;

export interface ProjectKpi {
  recentReviews: number;
  recentIssuesFound: number;
  openIssues: number;
  /**
   * 해결률 — 최근 30일에 발견된 것 중 해결된 비율(0~100).
   *
   * 🔴 전체 기간으로 재지 않는다. 오래된 Project 일수록 분모가 커져 최근에 무슨 일이
   * 벌어지고 있는지가 묻힌다. 최근 30일에 발견된 것이 없으면 `null` 이다 — 0% 로 그리면
   * 「하나도 못 고쳤다」는 거짓말이 된다.
   */
  resolutionRate: number | null;
}

/** Project 화면의 Open Issue 한 줄. Repository 와 나이가 함께 와야 고를 수 있다. */
export interface ProjectOpenIssue {
  id: string;
  title: string;
  severity: IssueSeverity;
  category: IssueCategory;
  repositoryFullName: string;
  filePath: string | null;
  firstDetectedAt: Date;
}

export interface ProjectReviewEntry {
  id: string;
  reviewerName: string;
  repositoryFullName: string;
  targetType: ReviewTargetType;
  branch: string | null;
  commitSha: string | null;
  issueCount: number;
  createdAt: Date;
}

/** Repository 별 상태 한 줄. 「어느 저장소를 봐야 하는가」까지만 답한다. */
export interface ProjectRepositoryStatus {
  id: string;
  fullName: string;
  defaultBranch: string;
  reviewCount: number;
  openIssueCount: number;
  lastReviewAt: Date | null;
}

/** Knowledge 진입점 한 줄. 사람이 쓴 Wiki 다 — Pattern·Resolution 과 출처가 다르다. */
export interface KnowledgeEntry {
  slug: string;
  title: string;
  updatedAt: Date;
}

/** 「이렇게 고쳤다」의 기록. Wiki 가 아니라 Review 가 남긴 Knowledge 다. */
export interface RecentResolution {
  id: string;
  title: string;
  severity: IssueSeverity;
  patternKey: string | null;
  resolutionSummary: string;
  resolvedAt: Date;
}

export interface ProjectDashboard {
  kpi: ProjectKpi;
  openIssues: ProjectOpenIssue[];
  frequentPatterns: PatternCount[];
  recentReviews: ProjectReviewEntry[];
  repositories: ProjectRepositoryStatus[];
  knowledgePages: KnowledgeEntry[];
  recentResolutions: RecentResolution[];
}

export interface ProjectScope {
  /** 🔴 소속 확인을 통과한 값. */
  workspaceId: string;
  /** 🔴 그 Workspace 안에 있다는 것이 확인된 값. */
  projectId: string;
}

export async function findProjectDashboard(
  scope: ProjectScope,
  executor: DbExecutor = db(),
): Promise<ProjectDashboard> {
  const openIssue = inArray(reviewIssues.status, OPEN_ISSUE_STATUSES);

  /**
   * Project 범위의 Issue 조건.
   *
   * `review_issues` 에는 `project_id` 가 없다 — 소유는 Repository 가 갖고 있고, 그것을
   * 하위 표마다 다시 복사하지 않는다(스펙 1). 대신 Repository 를 Join 해 좁힌다.
   * `repositories_project_idx` 가 그 Join 을 받는다.
   */
  const issueScope = and(
    eq(reviewIssues.workspaceId, scope.workspaceId),
    eq(repositories.projectId, scope.projectId),
  );

  const [
    kpi,
    openIssues,
    frequentPatterns,
    recentReviews,
    repositoryRows,
    knowledgeRows,
    recentResolutions,
  ] = await Promise.all([
    findKpi(scope, executor),

    executor
      .select({
        id: reviewIssues.id,
        title: reviewIssues.title,
        severity: reviewIssues.severity,
        category: reviewIssues.category,
        repositoryFullName: repositories.fullName,
        filePath: reviewIssues.filePath,
        firstDetectedAt: reviewIssues.firstDetectedAt,
      })
      .from(reviewIssues)
      .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
      .where(and(issueScope, openIssue))
      // 급한 것부터, 같은 등급 안에서는 오래된 것부터(enum 선언 순서 = 심각도 순서).
      .orderBy(asc(reviewIssues.severity), asc(reviewIssues.firstDetectedAt))
      .limit(SECTION_LIMIT),

    executor
      .select({
        patternKey: sql<string>`${reviewIssues.patternKey}`,
        category: reviewIssues.category,
        occurrences: sql<number>`count(*)::int`,
        resolvedCount: sql<number>`count(*) filter (where ${reviewIssues.status} = 'RESOLVED')::int`,
        lastDetectedAt: sql<Date>`max(${reviewIssues.firstDetectedAt})`,
      })
      .from(reviewIssues)
      .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
      .where(and(issueScope, isNotNull(reviewIssues.patternKey)))
      .groupBy(reviewIssues.patternKey, reviewIssues.category)
      .orderBy(
        desc(sql`count(*)`),
        desc(sql`max(${reviewIssues.firstDetectedAt})`),
      )
      .limit(SECTION_LIMIT),

    executor
      .select({
        id: reviewSessions.id,
        reviewerName: reviewSessions.reviewerName,
        repositoryFullName: repositories.fullName,
        targetType: reviewSessions.targetType,
        branch: reviewSessions.branch,
        commitSha: reviewSessions.commitSha,
        issueCount: sql<number>`(
          select count(*)::int from ${reviewIssues}
          where ${reviewIssues.reviewSessionId} = ${reviewSessions.id}
        )`,
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
      .limit(SECTION_LIMIT),

    findRepositoryStatuses(scope, executor),

    executor
      .select({
        slug: knowledgePages.slug,
        title: knowledgePages.title,
        updatedAt: knowledgePages.updatedAt,
      })
      .from(knowledgePages)
      .where(
        and(
          eq(knowledgePages.workspaceId, scope.workspaceId),
          eq(knowledgePages.projectId, scope.projectId),
        ),
      )
      .orderBy(desc(knowledgePages.updatedAt))
      .limit(5),

    executor
      .select({
        id: reviewIssues.id,
        title: reviewIssues.title,
        severity: reviewIssues.severity,
        patternKey: reviewIssues.patternKey,
        resolutionSummary: sql<string>`${reviewIssues.resolutionSummary}`,
        resolvedAt: sql<Date>`${reviewIssues.resolvedAt}`,
      })
      .from(reviewIssues)
      .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
      .where(
        and(
          issueScope,
          eq(reviewIssues.status, "RESOLVED"),
          // 🔴 「해결됐다」만 있고 어떻게 해결했는지가 없는 행은 Knowledge 가 아니다.
          isNotNull(reviewIssues.resolutionSummary),
          isNotNull(reviewIssues.resolvedAt),
        ),
      )
      .orderBy(desc(reviewIssues.resolvedAt))
      .limit(5),
  ]);

  return {
    kpi,
    openIssues,
    frequentPatterns,
    recentReviews,
    repositories: repositoryRows,
    knowledgePages: knowledgeRows,
    recentResolutions,
  };
}

async function findKpi(
  scope: ProjectScope,
  executor: DbExecutor,
): Promise<ProjectKpi> {
  const openIssue = inArray(reviewIssues.status, OPEN_ISSUE_STATUSES);
  const recentlyFound = sql`${reviewIssues.firstDetectedAt} >= ${RECENT_WINDOW}`;

  const [issueRows, reviewRows] = await Promise.all([
    executor
      .select({
        recentIssuesFound: sql<number>`count(*) filter (where ${recentlyFound})::int`,
        recentResolved: sql<number>`count(*) filter (where ${recentlyFound} and ${reviewIssues.status} = 'RESOLVED')::int`,
        openIssues: sql<number>`count(*) filter (where ${openIssue})::int`,
      })
      .from(reviewIssues)
      .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
      .where(
        and(
          eq(reviewIssues.workspaceId, scope.workspaceId),
          eq(repositories.projectId, scope.projectId),
        ),
      ),

    executor
      .select({ recentReviews: sql<number>`count(*)::int` })
      .from(reviewSessions)
      .innerJoin(repositories, eq(repositories.id, reviewSessions.repositoryId))
      .where(
        and(
          eq(reviewSessions.workspaceId, scope.workspaceId),
          eq(repositories.projectId, scope.projectId),
          gte(reviewSessions.createdAt, RECENT_WINDOW),
        ),
      ),
  ]);

  const found = issueRows[0]?.recentIssuesFound ?? 0;
  const resolved = issueRows[0]?.recentResolved ?? 0;

  return {
    recentReviews: reviewRows[0]?.recentReviews ?? 0,
    recentIssuesFound: found,
    openIssues: issueRows[0]?.openIssues ?? 0,
    // 분모가 0이면 비율이 없다. 0% 로 그리지 않는다 — 없는 것과 못 한 것은 다르다.
    resolutionRate: found === 0 ? null : Math.round((resolved / found) * 100),
  };
}

/**
 * Repository 별 상태.
 *
 * 🔴 **Repository 마다 다시 세지 않는다.** Review 와 Issue 를 각각 Repository 단위로 접어
 * 둔 뒤 붙인다 — Join 을 곧장 겹치면 행이 곱해져 센 값이 부풀어 오른다.
 */
async function findRepositoryStatuses(
  scope: ProjectScope,
  executor: DbExecutor,
): Promise<ProjectRepositoryStatus[]> {
  const reviewStats = executor
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

  const issueStats = executor
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

  return executor
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
      defaultBranch: repositories.defaultBranch,
      reviewCount: sql<number>`coalesce(${reviewStats.reviewCount}, 0)`,
      openIssueCount: sql<number>`coalesce(${issueStats.openIssueCount}, 0)`,
      lastReviewAt: sql<Date | null>`${reviewStats.lastReviewAt}`,
    })
    .from(repositories)
    .leftJoin(reviewStats, eq(reviewStats.repositoryId, repositories.id))
    .leftJoin(issueStats, eq(issueStats.repositoryId, repositories.id))
    .where(
      and(
        eq(repositories.workspaceId, scope.workspaceId),
        eq(repositories.projectId, scope.projectId),
      ),
    )
    .orderBy(asc(repositories.name));
}

/** Project 화면의 Repository 목록. Dashboard 와 같은 값을 쓴다 — 두 번 정의하지 않는다. */
export async function findProjectRepositories(
  scope: ProjectScope,
  executor: DbExecutor = db(),
): Promise<ProjectRepositoryStatus[]> {
  return findRepositoryStatuses(scope, executor);
}

/**
 * Project 화면의 Review 목록.
 *
 * Dashboard 의 「최근 Review」와 달리 상한이 크다 — 목록 화면이기 때문이다.
 * Pagination 이 필요해지면 그때 만든다(CLAUDE.md 18).
 */
const REVIEW_LIST_LIMIT = 50;

export async function findProjectReviews(
  scope: ProjectScope,
  executor: DbExecutor = db(),
): Promise<ProjectReviewEntry[]> {
  return executor
    .select({
      id: reviewSessions.id,
      reviewerName: reviewSessions.reviewerName,
      repositoryFullName: repositories.fullName,
      targetType: reviewSessions.targetType,
      branch: reviewSessions.branch,
      commitSha: reviewSessions.commitSha,
      issueCount: sql<number>`(
        select count(*)::int from ${reviewIssues}
        where ${reviewIssues.reviewSessionId} = ${reviewSessions.id}
      )`,
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
    .limit(REVIEW_LIST_LIMIT);
}
