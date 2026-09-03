import "server-only";

import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { repositories, reviewIssues } from "@/db/schema";
import {
  FILTER_ALL,
  type IssueFilter,
} from "@/features/issues/schemas/issue-filter";
import { escapeLikePattern } from "@/features/issues/server/issue-agent-query";
import type { IssueListPage } from "@/features/issues/types/issue-list";
import { AppError } from "@/lib/errors";
import { paginate } from "@/lib/pagination";

/**
 * Issue 목록 조회.
 *
 * 🔴 `workspaceId`·`projectId` 는 **호출자가 인증으로 확인한 값**이어야 한다.
 * Client 가 보낸 값을 그대로 넣지 않는다 — 이 함수는 받은 값을 믿고
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

/**
 * 목록 조회의 `where` 를 만든다.
 *
 * 🔴 **질의를 돌리지 않고도 「무엇으로 좁히는가」를 확인할 수 있게** 따로 뽑았다.
 * 검색어 처리 같은 조용한 결함은 결과를 봐서는 알 수 없다 — 그럴듯한 목록이 나오기
 * 때문이다. 실제로 바인딩되는 값을 시험이 직접 본다(`issue-query.test.ts`).
 */
export function buildIssueListConditions(
  scope: IssueQueryScope,
  filter: IssueFilter,
): SQL[] {
  const conditions: SQL[] = [
    eq(reviewIssues.workspaceId, scope.workspaceId),
    eq(repositories.projectId, scope.projectId),
  ];

  /*
 저장소 Filter.

 🔴 **이 조건 하나가 인가의 근거가 되지 않는다.** 주소창의 값이라 남의 Project·Workspace 의
 Repository UUID 가 그대로 들어올 수 있다 — 위의 `workspace_id`·`project_id` 두 조건과
 **겹쳐서** 걸리기 때문에 범위 밖의 값은 목록도 건수도 0 으로 끝난다(스펙 10·11).
 그래서 여기서 「선택지에 있는 값인가」를 다시 조회해 확인하지 않는다. 조건이 겹쳐 있으면
 확인 질의 한 번을 더 던지는 것과 결과가 같고, 잊어버릴 자리가 하나 줄어든다.

 `review_issues.repository_id` 로 건다 — Join 이 `repositories.id` 와 같음을 이미
 보장하므로 값은 같고, Issue 표의 Index 를 그대로 탄다.
 */
  if (filter.repositoryId !== FILTER_ALL) {
    conditions.push(eq(reviewIssues.repositoryId, filter.repositoryId));
  }
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
    /*
 Drizzle 이 값을 파라미터로 바인딩한다. 문자열을 이어 붙여 쿼리를 만들지 않는다.

 🔴 **바인딩은 SQL Injection 을 막을 뿐 `LIKE` 의 wildcard 를 막지 않는다.**
 `%`·`_` 는 파라미터 «값 안에서» 여전히 wildcard 라, `?q=%` 는 `%%%` 가 되어
 **Project 의 Issue 를 전부 반환한다.** 오류도 경고도 없이 그럴듯한 목록이 나오므로
 검색이 고장 난 것을 알아챌 방법이 없다. Agent 조회는 같은 결함을 이미 고쳤는데
 (`issue-agent-query.ts`) 화면 조회만 그 helper 를 지나지 않고 있었다.
 */
    const keyword = `%${escapeLikePattern(filter.q)}%`;
    const keywordMatch = or(
      ilike(reviewIssues.title, keyword),
      ilike(reviewIssues.filePath, keyword),
      ilike(reviewIssues.patternKey, keyword),
    );
    if (keywordMatch !== undefined) {
      conditions.push(keywordMatch);
    }
  }

  return conditions;
}

export async function findIssues(
  scope: IssueQueryScope,
  filter: IssueFilter,
  executor: DbExecutor = db(),
): Promise<IssueListPage> {
  const where = and(...buildIssueListConditions(scope, filter));

  try {
    /*
 🔴 **세고 → 쪽을 바로잡고 → 그 쪽만 읽는다**(`lib/pagination.ts`). 마지막 쪽의
 Issue 가 해결돼 사라지면 `?page=5` 가 범위를 넘어 «빈 표»가 나오는데, 그것은
 「결과 없음」과 구분되지 않는다 — 그럴 때는 마지막 쪽으로 끌어당겨 그린다.
 */
    return await paginate(filter, {
      count: async () => {
        /**
         * 🔴 세는 질의에도 **같은 Join 과 같은 조건**을 건다. Join 을 빠뜨리면 `project_id`
         * 조건을 걸 수 없어 전체 건수가 Workspace 전체로 부풀고, 목록과 숫자가 어긋난다.
         */
        const rows = await executor
          .select({ value: count() })
          .from(reviewIssues)
          .innerJoin(
            repositories,
            eq(repositories.id, reviewIssues.repositoryId),
          )
          .where(where);

        return rows[0]?.value ?? 0;
      },
      // 화면이 그리는 Column 만 고른다. `select *` 로 불필요한 본문까지 끌어오지 않는다.
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
            repositoryFullName: repositories.fullName,
            firstDetectedAt: reviewIssues.firstDetectedAt,
          })
          .from(reviewIssues)
          .innerJoin(
            repositories,
            eq(repositories.id, reviewIssues.repositoryId),
          )
          .where(where)
          // 같은 시각의 행이 페이지마다 뒤바뀌지 않게 id 로 한 번 더 고정한다.
          .orderBy(desc(reviewIssues.firstDetectedAt), desc(reviewIssues.id))
          .limit(limit)
          .offset(offset),
    });
  } catch (cause) {
    // Driver 오류 message 에는 접속 문자열·쿼리가 실려 온다. 밖으로 흘리지 않는다.
    throw new AppError("UNEXPECTED", { cause });
  }
}
