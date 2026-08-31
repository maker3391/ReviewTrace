import "server-only";

import { eq, sql, type SQL } from "drizzle-orm";

import { repositories, reviewIssues } from "@/db/schema";
import type { ProjectScope, WorkspaceScope } from "@/types/tenant";

/**
 * 「이 Issue 가 이 범위 안에 있는가」를 **한 곳**에서 적는다.
 *
 * ## 왜 범위가 둘인가
 *
 * Issue 를 다루는 경로는 두 갈래이고, **각자 아는 것이 다르다**.
 *
 * ```
 * Browser Session -> Workspace 소속 -> URL 의 Project -> Issue ProjectScope
 * Agent API Key -> Workspace -> Issue WorkspaceScope
 * ```
 *
 * 🔴 **Agent 요청에는 Project 가 없다.** API Key 가 Workspace 를 정하고 Payload 에도
 * Query 에도 Project 자리가 없다 — 그쪽까지 Project 로 좁히면 계약이 깨진다.
 * 그래서 범위를 **강제로 하나로 만들지 않고** 둘을 타입으로 갈라 둔다.
 *
 * ## 왜 `review_issues` 에는 `project_id` 가 없는가
 *
 * 소유는 Repository 가 한다. Repository 는 Project 사이를 옮겨 다니고
 * (`moveRepositoryToProject`), 그때 아래의 Review Knowledge 가 **행 하나 건드리지 않고**
 * 함께 따라가는 것이 그 설계의 값이다. 하위 표에 `project_id` 를 복사해 두면 그 이동이
 * 표 네 개를 갱신하는 일이 되고, 하나라도 빠뜨리면 화면마다 다른 Project 를 말한다.
 *
 * 그러니 Project 로 좁히는 자리는 **언제나 Repository 를 거친다.** 조회는 이미 `repositories`
 * 를 Join 하고 있어 `eq(repositories.projectId, …)` 한 줄이면 되지만, `UPDATE` 에는 그
 * Join 이 없다 — 같은 판정을 `exists` 로 적는다. 모양이 다를 뿐 묻는 것은 같다:
 * **이 Issue 의 Repository 가 그 Workspace 의 그 Project 것인가.**
 *
 * 🔴 **조건을 겹쳐서 건다.** `workspace_id` 는 `review_issues` 에서 한 번, `repositories`
 * 에서 또 한 번 본다. 어느 한쪽을 잘못 얻은 경로가 있어도 결과가 비어서 돌아온다
 *.
 *
 * 🔴 **범위 밖은 `FORBIDDEN` 이 아니라 `NOT_FOUND`** 다 — 부르는 쪽이 그렇게 끝낸다.
 * 「없다」와 「남의 것이다」를 구분해 주면 그것만으로 그 ID 가 존재한다는 사실이 새어 나간다.
 *
 * ## 🔴 ID 로 Issue 를 다루는 경로는 «전부» 여기를 지난다
 *
 * | 경로 | 무엇을 하는가 | 범위 |
 * |---|---|---|
 * | `findAgentIssue` (`GET /api/v1/issues/{id}`) | 본문·근본원인·History 를 읽는다 | Workspace |
 * | `updateIssueStatus` (`PATCH /api/v1/issues/{id}` · 화면) | 상태와 해결 요약을 **쓴다** | 둘 다 |
 * | `findIssueInScope` (`POST /api/v1/issues/{id}/activities` · 화면) | Activity 를 **쓴다** | 둘 다 |
 *
 * 셋이 각자 `and(eq(id), eq(workspaceId))` 두 줄을 따로 갖고 있었다 — **하나만 빠져도 그
 * 경로만 조용히 뚫리고, 시험이 걸 자리가 없었다.** 한 곳으로 모아야 이 조건 하나에 시험을
 * 걸어 세 경로를 함께 지킬 수 있다(`issue-scope.test.ts` · `issue-status-service.test.ts`).
 *
 * 🔴 **`workspaceId`·`projectId` 는 반드시 «인가로 확인된» 값이어야 한다.** 요청 본문이나
 * Query 에서 온 값을 그대로 넣지 않는다 — Agent 경로에서는 `authenticateAgent` 가,
 * 화면에서는 `requireWorkspace`·`requireProject` 가 돌려준 값이다.
 */
export type IssueScope = WorkspaceScope | ProjectScope;

export function issueInScope(scope: IssueScope): SQL {
 const inWorkspace = eq(reviewIssues.workspaceId, scope.workspaceId);

 if (!("projectId" in scope)) {
 return inWorkspace;
 }

 return sql`${inWorkspace} and exists (select 1 from ${repositories} where ${repositories.id} = ${reviewIssues.repositoryId} and ${repositories.workspaceId} = ${scope.workspaceId} and ${repositories.projectId} = ${scope.projectId})`;
}
