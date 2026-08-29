import "server-only";

import { and, eq, type SQL } from "drizzle-orm";

import { reviewIssues } from "@/db/schema";

/**
 * 「이 Issue 를 ID 로 다룬다」의 유일한 조건.
 *
 * 🔴 **`WHERE id = ?` 만으로 끝내지 않는다.** 그 Issue 가 **이 요청이 인가된 Workspace 의
 * 것인지** 함께 확인한다. Agent API 는 URL 의 slug 를 쓰지 않고 **API Key 가 Workspace 를
 * 정하므로**(CLAUDE.md 13), ID 하나로 남의 Tenant 를 건드릴 수 있느냐가 여기서 갈린다.
 *
 * ## 왜 한 곳으로 모았는가
 *
 * 같은 두 줄이 세 자리에 흩어져 있었다 — Issue 단건 조회(`issue-agent-query.ts`) ·
 * 상태 전이 UPDATE(`issue-status-service.ts`) · Activity 추가 전 확인
 * (`issue-activity-service.ts`). 셋 다 **ID 를 밖에서 받는 쓰기·읽기 경로**이고,
 * 셋 중 하나에서 Workspace 조건이 빠지면 그 경로만 조용히 뚫린다.
 *
 * 흩어져 있으면 「하나만 고치고 나머지를 잊는」 일이 생기고, 무엇보다 **시험이 걸 자리가
 * 없었다.** 한 곳으로 모으면 이 조건 하나에 시험을 걸어 세 경로를 함께 지킬 수 있다
 * (`issue-scope.test.ts`).
 *
 * 🔴 **`workspaceId` 는 반드시 «인가로 확인된» 값이어야 한다.** 요청 본문이나 Query 에서
 * 온 값을 그대로 넣지 않는다 — Agent 경로에서는 `authenticateAgent` 가 돌려준 값이다.
 */
export function issueInWorkspace(issueId: string, workspaceId: string): SQL {
  const condition = and(
    eq(reviewIssues.id, issueId),
    eq(reviewIssues.workspaceId, workspaceId),
  );

  /**
   * `and()` 는 인자가 모두 `undefined` 일 때만 `undefined` 를 돌려준다. 여기서는 둘 다
   * 항상 있으므로 일어나지 않지만, 타입을 좁히려 `!` 를 쓰지 않고 명시적으로 막는다 —
   * 조건이 사라진 채 질의가 나가는 것이 이 파일이 막으려는 바로 그 사고다.
   */
  if (condition === undefined) {
    throw new Error("issueInWorkspace: 조건이 만들어지지 않았다");
  }

  return condition;
}
