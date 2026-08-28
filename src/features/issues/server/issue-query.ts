import "server-only";

import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";

import { db } from "@/db";
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
 * 🔴 `workspaceId` 는 **호출자가 인증으로 확인한 값**이어야 한다. Client 가 보낸 값을 그대로
 * 넣지 않는다(CLAUDE.md 11) — 이 함수는 받은 값을 믿고 그것으로만 좁힌다.
 */
export async function findIssues(
  workspaceId: string,
  filter: IssueFilter,
): Promise<IssueListPage> {
  const conditions: SQL[] = [eq(reviewIssues.workspaceId, workspaceId)];

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
  const database = db();

  try {
    // 화면이 그리는 Column 만 고른다. `select *` 로 불필요한 본문까지 끌어오지 않는다.
    const rows = await database
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

    const totalRows = await database
      .select({ value: count() })
      .from(reviewIssues)
      .where(where);

    return {
      items: rows,
      total: totalRows[0]?.value ?? 0,
      page: filter.page,
      pageSize: ISSUE_PAGE_SIZE,
    };
  } catch (cause) {
    // Driver 오류 message 에는 접속 문자열·쿼리가 실려 온다. 밖으로 흘리지 않는다.
    throw new AppError("INTERNAL_ERROR", "Issue 목록을 불러오지 못했습니다.", {
      cause,
    });
  }
}
