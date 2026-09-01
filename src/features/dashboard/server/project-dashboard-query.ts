import "server-only";

import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { asDate } from "@/db/raw-value";
import {
  knowledgePages,
  repositories,
  reviewIssues,
  reviewSessions,
} from "@/db/schema";
import {
  findFrequentPatterns,
  type PatternCount,
} from "@/features/issues/server/pattern-query";
import {
  listRepositoryStatuses,
  type RepositoryStatus,
} from "@/features/repositories/server/repository-query";
import {
  listProjectReviews,
  type ReviewListItem,
} from "@/features/reviews/server/review-query";
import {
  OPEN_ISSUE_STATUSES,
  type IssueCategory,
  type IssueSeverity,
} from "@/types/review";
import type { ProjectScope } from "@/types/tenant";

/**
 * Project Dashboard 의 조회(스펙 6).
 *
 * 답해야 하는 질문 — **「이 Project 에서 지금 무슨 문제가 나고 있고 무엇이 반복되는가?」**
 *
 * ## 이 파일은 «조립»한다
 *
 * 🔴 **Repository·Review·Pattern 질의를 여기서 다시 적지 않는다.** 각 표의 주인 Feature 가
 * 갖고 있고(`repositories/server` · `reviews/server` · `issues/server`), Dashboard 는 그것을
 * 불러 한 화면으로 모을 뿐이다. 같은 질의를 두 곳에 적으면 한쪽만 고쳐 **두 화면이 같은
 * Project 를 다른 숫자로 그린다.**
 *
 * 의존 방향은 **Dashboard -> Feature 한쪽뿐**이다. Feature 는 Dashboard 를 알지 못하므로
 * 이 파일을 통째로 지워도 나머지는 그대로 선다.
 *
 * ## Tenant
 *
 * 🔴 **Tenant 판정을 여기서 하지 않는다.** 받는 `ProjectScope` 는 `requireProject` 가 이미
 * 「이 사용자가 이 Workspace 의 멤버이고, 그 Project 가 그 Workspace 것이다」를 확인한 값이다.
 * 그럼에도 **모든 질의가 `workspaceId` 와 `projectId` 를 겹쳐서** 건다 — 어느 한쪽을 틀려도
 * 결과가 비어서 돌아온다.
 */

const RECENT_WINDOW = sql`now() - interval '30 days'`;

/** 한 묶음의 행 수. Dashboard 는 훑어보는 화면이지 목록 화면이 아니다. */
const SECTION_LIMIT = 8;

/** Knowledge 조각은 더 짧게. 진입점이지 목록이 아니다. */
const KNOWLEDGE_LIMIT = 5;

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
  recentReviews: ReviewListItem[];
  repositories: RepositoryStatus[];
  knowledgePages: KnowledgeEntry[];
  recentResolutions: RecentResolution[];
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

    findFrequentPatterns({ scope, limit: SECTION_LIMIT }, executor),

    listProjectReviews(scope, executor, SECTION_LIMIT),

    listRepositoryStatuses(scope, executor),

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
      .limit(KNOWLEDGE_LIMIT),

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
      .limit(KNOWLEDGE_LIMIT),
  ]);

  return {
    kpi,
    openIssues,
    frequentPatterns,
    recentReviews,
    repositories: repositoryRows,
    knowledgePages: knowledgeRows,
    /*
 🔴 원시 SQL 조각의 타입 단언을 실제 값으로 맞춘다(`db/raw-value.ts`).

 `sql<Date>` 는 Drizzle 의 Column 변환 경로 «밖»이라 Driver 가 준 문자열이 그대로
 온다. `pnpm build` 도 `typecheck` 도 잡지 못했다 — 잡은 것은 해결된 Issue 를 넣고
 화면을 연 것이다(`TypeError: value.getUTCFullYear is not a function`).
 해결 기록이 하나도 없는 Project 에서는 이 배열이 비어 있어 드러나지 않았다.
 */
    recentResolutions: recentResolutions.map((resolution) => ({
      ...resolution,
      resolvedAt: asDate(resolution.resolvedAt),
    })),
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
