import "server-only";

import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  issueActivities,
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
} from "@/db/schema";
import {
  findFrequentPatterns,
  type PatternCount,
} from "@/features/issues/server/pattern-query";
import { listProjectSummaries } from "@/features/projects/server/project-service";
import type { ProjectSummary } from "@/features/projects/types/project";
import {
  OPEN_ISSUE_STATUSES,
  type IssueCategory,
  type IssueSeverity,
} from "@/types/review";

/**
 * Workspace Dashboard 의 조회(스펙 5).
 *
 * 답해야 하는 질문은 하나다 — **「이 Workspace 전체에서 지금 어디를 봐야 하는가?」**
 * 그래서 Repository·개별 Review 의 상세는 여기 없다. 그것은 한 층 아래가 답한다(스펙 7).
 *
 * 🔴 **집계를 JavaScript 에서 하지 않는다**(스펙 12). Workspace -> Projects -> Repositories
 * -> ReviewSessions -> ReviewIssues 를 Entity 로 읽어 접으면, Issue 가 만 건이 되는 순간
 * Dashboard 한 번이 표를 통째로 읽는다. 세는 일은 전부 PostgreSQL 이 한다.
 *
 * 🔴 **모든 질의의 첫 조건이 `workspaceId` 다.** 그 값은 소속 확인을 통과한 것이고
 * (`require-workspace.ts`) Client 가 보낸 값이 아니다.
 *
 * 다섯 묶음은 서로 독립이라 함께 던진다.
 */

/** KPI 의 관찰 구간. 「최근 30일」의 정의를 한 곳에 둔다. */
const RECENT_WINDOW = sql`now() - interval '30 days'`;

/** 목록 한 묶음의 행 수. Dashboard 는 훑어보는 화면이지 목록 화면이 아니다. */
const SECTION_LIMIT = 8;

export interface DashboardKpi {
  /** 최근 30일에 들어온 Review 실행 수. */
  recentReviews: number;
  /** 최근 30일에 처음 발견된 Issue 수. */
  recentIssuesFound: number;
  /** 최근 30일에 해결된 Issue 수. */
  recentResolvedIssues: number;
  /**
   * 🔴 지금 열려 있는 Issue 수 — **구간이 아니라 현재 상태다.**
   * 30일로 자르면 오래 방치된 미해결이 화면에서 사라진다. 그것이야말로 봐야 할 숫자다.
   */
  openIssues: number;
}

/** 「먼저 봐야 할 Issue」 한 줄. 어느 Project 의 것인지가 함께 와야 이동할 수 있다. */
export interface AttentionIssue {
  id: string;
  title: string;
  severity: IssueSeverity;
  category: IssueCategory;
  projectSlug: string;
  projectName: string;
  repositoryFullName: string;
  firstDetectedAt: Date;
}

/**
 * Activity Feed 한 줄.
 *
 * 🔴 **Agent 내부 이벤트를 그대로 흘리지 않는다**(스펙 5). Review 하나가 Issue 500건을
 * 담으면 `DETECTED` Activity 도 500건이 생긴다 — 그것을 그대로 그리면 Feed 가 Review 하나로
 * 뒤덮인다. 그래서 **Review 는 실행 단위로 한 줄**, 그리고 **해결된 Issue** 만 남긴다.
 */
export type ActivityEntry =
  | {
      kind: "REVIEW";
      id: string;
      at: Date;
      projectSlug: string;
      projectName: string;
      repositoryFullName: string;
      reviewerName: string;
      issueCount: number;
    }
  | {
      kind: "RESOLUTION";
      id: string;
      /**
       * 🔴 **`id` 는 Activity 행의 것이라 Issue 상세로 갈 수 없다.** 그 줄이 가리키는
       * Issue 자신의 id 를 함께 들고 온다 — 화면이 제목에 상세 링크를 걸 때 쓴다.
       */
      issueId: string;
      at: Date;
      projectSlug: string;
      projectName: string;
      repositoryFullName: string;
      title: string;
      severity: IssueSeverity;
    };

export interface WorkspaceDashboard {
  kpi: DashboardKpi;
  projects: ProjectSummary[];
  needsAttention: AttentionIssue[];
  frequentPatterns: PatternCount[];
  recentActivity: ActivityEntry[];
}

export async function findWorkspaceDashboard(
  workspaceId: string,
  executor: DbExecutor = db(),
): Promise<WorkspaceDashboard> {
  const openIssue = inArray(reviewIssues.status, OPEN_ISSUE_STATUSES);

  const [kpi, projectRows, needsAttention, frequentPatterns, recentActivity] =
    await Promise.all([
      findKpi(workspaceId, executor),
      listProjectSummaries(workspaceId, executor),

      /**
       * 먼저 볼 Issue.
       *
       * `severity` 는 PostgreSQL enum 이고 enum 의 정렬은 **선언 순서**를 따른다.
       * 선언 순서가 CRITICAL · HIGH · MEDIUM · LOW · INFO(`src/types/review.ts`)라
       * 오름차순이 곧 「급한 것부터」다 — 정렬용 CASE 문을 따로 두지 않는다.
       *
       * 같은 등급 안에서는 **오래된 것부터**다. 오래 열려 있다는 것 자체가 신호다.
       */
      executor
        .select({
          id: reviewIssues.id,
          title: reviewIssues.title,
          severity: reviewIssues.severity,
          category: reviewIssues.category,
          projectSlug: projects.slug,
          projectName: projects.name,
          repositoryFullName: repositories.fullName,
          firstDetectedAt: reviewIssues.firstDetectedAt,
        })
        .from(reviewIssues)
        .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
        .innerJoin(projects, eq(projects.id, repositories.projectId))
        .where(and(eq(reviewIssues.workspaceId, workspaceId), openIssue))
        .orderBy(asc(reviewIssues.severity), asc(reviewIssues.firstDetectedAt))
        .limit(SECTION_LIMIT),

      findFrequentPatterns(
        { scope: { workspaceId }, limit: SECTION_LIMIT },
        executor,
      ),

      findRecentActivity(workspaceId, executor),
    ]);

  return {
    kpi,
    projects: projectRows,
    needsAttention,
    frequentPatterns,
    recentActivity,
  };
}

/**
 * KPI 네 값.
 *
 * 🔴 **Issue 를 네 번 세지 않는다.** `FILTER` 로 한 문장에 담으면 표를 한 번만 훑는다.
 * Review 수만 다른 표라 어쩔 수 없이 한 번 더 던진다.
 */
async function findKpi(
  workspaceId: string,
  executor: DbExecutor,
): Promise<DashboardKpi> {
  const openIssue = inArray(reviewIssues.status, OPEN_ISSUE_STATUSES);

  const [issueRows, reviewRows] = await Promise.all([
    executor
      .select({
        recentIssuesFound: sql<number>`count(*) filter (where ${reviewIssues.firstDetectedAt} >= ${RECENT_WINDOW})::int`,
        recentResolvedIssues: sql<number>`count(*) filter (where ${reviewIssues.resolvedAt} >= ${RECENT_WINDOW})::int`,
        openIssues: sql<number>`count(*) filter (where ${openIssue})::int`,
      })
      .from(reviewIssues)
      .where(eq(reviewIssues.workspaceId, workspaceId)),

    executor
      .select({ recentReviews: sql<number>`count(*)::int` })
      .from(reviewSessions)
      .where(
        and(
          eq(reviewSessions.workspaceId, workspaceId),
          gte(reviewSessions.createdAt, RECENT_WINDOW),
        ),
      ),
  ]);

  return {
    recentReviews: reviewRows[0]?.recentReviews ?? 0,
    recentIssuesFound: issueRows[0]?.recentIssuesFound ?? 0,
    recentResolvedIssues: issueRows[0]?.recentResolvedIssues ?? 0,
    openIssues: issueRows[0]?.openIssues ?? 0,
  };
}

/**
 * 최근 활동.
 *
 * 두 종류를 각각 상한까지 읽어 시각순으로 합친다. **각 묶음이 이미 잘려 있어 합치는 대상은
 * 최대 16행이다** — 「전체를 읽어 JS 에서 정렬」이 아니다.
 *
 * SQL `UNION ALL` 하나로 만들지 않은 이유는 두 줄의 칸이 다르기 때문이다. 억지로 맞추면
 * 쓰이지 않는 칸이 절반씩 NULL 로 채워진 표가 나오고, 읽는 쪽이 그것을 다시 갈라야 한다.
 */
async function findRecentActivity(
  workspaceId: string,
  executor: DbExecutor,
): Promise<ActivityEntry[]> {
  const [reviews, resolutions] = await Promise.all([
    executor
      .select({
        id: reviewSessions.id,
        at: reviewSessions.createdAt,
        projectSlug: projects.slug,
        projectName: projects.name,
        repositoryFullName: repositories.fullName,
        reviewerName: reviewSessions.reviewerName,
        /*
 🔴 안쪽 Subquery 에도 Workspace 를 건다. 바깥 `where` 가 Session 을 좁혀도
 안쪽은 `review_session_id` 하나로만 세고 있어, 두 표의 `workspace_id` 가 갈리는
 순간 남의 Issue 를 세게 된다 — Database 는 그것을 막지 못한다(단일 Column FK).
 같은 이유로 `features/reviews/server/review-query.ts` 도 함께 건다.
 */
        issueCount: sql<number>`(
 select count(*)::int from ${reviewIssues}
 where ${reviewIssues.reviewSessionId} = ${reviewSessions.id}
 and ${reviewIssues.workspaceId} = ${reviewSessions.workspaceId}
)`,
      })
      .from(reviewSessions)
      .innerJoin(repositories, eq(repositories.id, reviewSessions.repositoryId))
      .innerJoin(projects, eq(projects.id, repositories.projectId))
      .where(eq(reviewSessions.workspaceId, workspaceId))
      .orderBy(desc(reviewSessions.createdAt))
      .limit(SECTION_LIMIT),

    executor
      .select({
        id: issueActivities.id,
        issueId: reviewIssues.id,
        at: issueActivities.createdAt,
        projectSlug: projects.slug,
        projectName: projects.name,
        repositoryFullName: repositories.fullName,
        title: reviewIssues.title,
        severity: reviewIssues.severity,
      })
      .from(issueActivities)
      .innerJoin(
        reviewIssues,
        eq(reviewIssues.id, issueActivities.reviewIssueId),
      )
      .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
      .innerJoin(projects, eq(projects.id, repositories.projectId))
      .where(
        and(
          eq(issueActivities.workspaceId, workspaceId),
          eq(issueActivities.type, "RESOLVED"),
        ),
      )
      .orderBy(desc(issueActivities.createdAt))
      .limit(SECTION_LIMIT),
  ]);

  const entries: ActivityEntry[] = [
    ...reviews.map((row) => ({ kind: "REVIEW" as const, ...row })),
    ...resolutions.map((row) => ({ kind: "RESOLUTION" as const, ...row })),
  ];

  return entries
    .sort((left, right) => right.at.getTime() - left.at.getTime())
    .slice(0, SECTION_LIMIT);
}
