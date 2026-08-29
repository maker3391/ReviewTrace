import "server-only";

import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { repositories, reviewIssues } from "@/db/schema";
import {
  FILTER_ALL,
  ISSUE_PAGE_SIZE,
  type IssueFilter,
} from "@/features/issues/schemas/issue-filter";
import type { IssueListPage } from "@/features/issues/types/issue-list";
import { AppError } from "@/lib/errors";

/**
 * Issue 목록 조회.
 *
 * 🔴 `workspaceId`·`projectId` 는 **호출자가 인증으로 확인한 값**이어야 한다.
 * Client 가 보낸 값을 그대로 넣지 않는다(CLAUDE.md 11) — 이 함수는 받은 값을 믿고
 * 그것으로만 좁힌다.
 *
 * 🔴 **두 조건을 겹쳐서 건다.** `projectId` 하나만으로 좁히면 그 값을 잘못 얻은 경로 하나가
 * 곧바로 다른 Tenant 의 Issue 를 읽는다. 겹쳐 두면 어느 한쪽을 틀려도 결과가 비어서 돌아온다.
 *
 * Repository Join 은 원래 `repositoryFullName` 을 그리기 위한 것이었고, 이제 Project 로
 * 좁히는 축까지 겸한다 — `review_issues` 에 `project_id` 를 복사해 두지 않았기 때문이다
 * (소유는 Repository 가 갖는다).
 */
export interface IssueQueryScope {
  workspaceId: string;
  projectId: string;
}

export async function findIssues(
  scope: IssueQueryScope,
  filter: IssueFilter,
  executor: DbExecutor = db(),
): Promise<IssueListPage> {
  const conditions: SQL[] = [
    eq(reviewIssues.workspaceId, scope.workspaceId),
    eq(repositories.projectId, scope.projectId),
  ];

  if (filter.severity !== FILTER_ALL) {
    conditions.push(eq(reviewIssues.severity, filter.severity));
  }
  if (filter.category !== FILTER_ALL) {
    conditions.push(eq(reviewIssues.category, filter.category));
  }
  if (filter.status !== FILTER_ALL) {
    conditions.push(eq(reviewIssues.status, filter.status));
  }
  if (filter.q !== "") {
    // Drizzle 이 값을 파라미터로 바인딩한다. 문자열을 이어 붙여 쿼리를 만들지 않는다.
    const keyword = `%${filter.q}%`;
    const keywordMatch = or(
      ilike(reviewIssues.title, keyword),
      ilike(reviewIssues.filePath, keyword),
      ilike(reviewIssues.patternKey, keyword),
    );
    if (keywordMatch !== undefined) {
      conditions.push(keywordMatch);
    }
  }

  const where = and(...conditions);
  const offset = (filter.page - 1) * ISSUE_PAGE_SIZE;

  try {
    // 화면이 그리는 Column 만 고른다. `select *` 로 불필요한 본문까지 끌어오지 않는다.
    const rows = await executor
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
        repositoryFullName: repositories.fullName,
        firstDetectedAt: reviewIssues.firstDetectedAt,
      })
      .from(reviewIssues)
      .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
      .where(where)
      // 같은 시각의 행이 페이지마다 뒤바뀌지 않게 id 로 한 번 더 고정한다.
      .orderBy(desc(reviewIssues.firstDetectedAt), desc(reviewIssues.id))
      .limit(ISSUE_PAGE_SIZE)
      .offset(offset);

    /**
     * 🔴 세는 질의에도 **같은 Join 과 같은 조건**을 건다. Join 을 빠뜨리면 `project_id`
     * 조건을 걸 수 없어 전체 건수가 Workspace 전체로 부풀고, 목록과 숫자가 어긋난다.
     */
    const totalRows = await executor
      .select({ value: count() })
      .from(reviewIssues)
      .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
      .where(where);

    return {
      items: rows,
      total: totalRows[0]?.value ?? 0,
      page: filter.page,
      pageSize: ISSUE_PAGE_SIZE,
    };
  } catch (cause) {
    // Driver 오류 message 에는 접속 문자열·쿼리가 실려 온다. 밖으로 흘리지 않는다.
    throw new AppError("UNEXPECTED", { cause });
  }
}
