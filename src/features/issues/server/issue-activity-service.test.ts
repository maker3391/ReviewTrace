import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { DbExecutor } from "@/db";
import { addIssueActivity } from "@/features/issues/server/issue-activity-service";
import { isAppError } from "@/lib/errors";

/**
 * History 한 줄이 **어느 범위 안에서만** 남는가.
 *
 * ## 🔴 이 시험이 왜 필요했는가
 *
 * 상태 전이(`updateIssueStatus`)를 Project 로 좁히면서 **여기만 빠져 있었다.**
 * 조회는 `{workspaceId, projectId}` 로 좁히는데(`findIssueDetail`) 이쪽은
 * `workspaceId` 로만 좁혀, **Project A 화면에서 주소의 Issue ID 만 Project B 의 것으로
 * 바꾸면 남의 Project 의 History 에 한 줄이 남았다.** Tenant 는 뚫리지 않는다 —
 * 어긋나는 것은 읽기와 쓰기의 «범위»다.
 *
 * 형제 두 자리(상태 전이 · Repository 이동)만 고치고 이 자리를 남겨 두면, 다음 사람이
 * 「쓰기는 Project 로 좁힌다」를 사실로 읽는다. 셋 중 하나에서 그것이 거짓이다.
 *
 * ## 🔴 이 시험이 지키지 «못하는» 것
 *
 * DB 를 쓰지 않는다. 확인할 수 있는 것은 **「그 조건이 실제로 문장에 실려 나갔는가」**
 * 까지다. PostgreSQL 이 그 조건으로 실제 행을 걸러 내는지는 여기서 증명되지 않는다 —
 * 그것은 실제 Database 를 쓰는 통합 시험의 몫이다.
 *
 * 대신 이 시험은 **매번 돈다.** 범위 판정처럼 잊기 쉬운 규칙이 `DB_INTEGRATION=true` 를
 * 붙였을 때만 검사되면, 정작 매일 도는 실행에서는 아무도 지키지 않는다.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ISSUE = "33333333-3333-4333-8333-333333333333";

const ACTIVITY = {
  type: "FIX_ATTEMPTED" as const,
  actor: { type: "HUMAN" as const, name: "사장님" },
  description: "Transaction 밖으로 옮겼다",
  commitSha: null,
  decision: null,
  evidence: [],
};

/**
 * `select … where … for … limit` 과 `insert … returning` 만 흉내 내는 최소 Fake.
 *
 * 🔴 **조건절을 «평가»하지 않는다.** 그것은 PostgreSQL 의 일이다. 여기서는 조건절을
 * 그대로 붙잡아 두었다가, 어떤 문장이 만들어졌는지 밖에서 들여다본다.
 *
 * 🔴 **`select` 가 두 번 온다.** 첫 번째가 Issue 를 잠그며 찾고, 두 번째가 그 Issue 의
 * 마지막 순번을 센다(`issue-activity-ordinal.ts`). 조건절을 붙잡는 것은 **첫 번째**뿐이다.
 */
function fakeExecutor(
  foundRows: readonly unknown[],
  highestOrdinal: number | null = null,
) {
  const captured: { where?: SQL } = {};
  const inserted: Record<string, unknown>[] = [];
  let selects = 0;

  const tx = {
    select: () => {
      selects += 1;
      const nth = selects;
      return {
        from: () => ({
          where: (condition: SQL) => {
            if (nth === 1) {
              captured.where = condition;
            }
            const settled = Promise.resolve(
              nth === 1 ? foundRows : [{ highest: highestOrdinal }],
            );
            const node = {
              /** 잠금은 Fake 가 흉내 낼 수 없다 — 붙었다는 사실만 통과시킨다. */
              for: () => node,
              limit: () => settled,
              then: settled.then.bind(settled),
            };
            return node;
          },
        }),
      };
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserted.push(values);
        return {
          returning: () =>
            Promise.resolve([
              {
                id: "55555555-5555-4555-8555-555555555555",
                reviewIssueId: ISSUE,
                type: ACTIVITY.type,
                actorType: ACTIVITY.actor.type,
                actorName: ACTIVITY.actor.name,
                description: ACTIVITY.description,
                commitSha: null,
                createdAt: new Date("2026-08-29T00:00:00.000Z"),
              },
            ]),
        };
      },
    }),
  };

  const executor = {
    transaction: (run: (tx: unknown) => unknown) => run(tx),
  } as unknown as DbExecutor;

  return { executor, captured, inserted };
}

const FOUND = [{ id: ISSUE, workspaceId: WORKSPACE, status: "OPEN" }];

/** 만들어진 조건절을 실제 SQL 과 Parameter 로 펼친다. */
function rendered(condition: SQL | undefined) {
  if (condition === undefined) {
    throw new Error("조건절이 붙지 않았다");
  }
  return new PgDialect().sqlToQuery(condition);
}

describe("addIssueActivity — 어느 범위 안에서 남는가", () => {
  /**
   * 🔴 되돌림 확인(2026-08-29): `issue-activity-service.ts` 의 `issueInScope(scope)` 를
   * `eq(reviewIssues.workspaceId, scope.workspaceId)` 로 되돌리면 이 시험이 실패한다.
   * 직접 되돌려 보고 원복했다.
   */
  it("🔴 화면에서 온 요청은 Project 까지 좁힌다", async () => {
    const { executor, captured } = fakeExecutor(FOUND);

    await addIssueActivity(
      {
        scope: { workspaceId: WORKSPACE, projectId: PROJECT },
        issueId: ISSUE,
        activity: ACTIVITY,
      },
      executor,
    );

    const { sql, params } = rendered(captured.where);
    // Repository 를 거쳐서만 Project 를 안다 — `review_issues` 에는 `project_id` 가 없다.
    expect(sql).toContain("exists");
    expect(sql).toContain("project_id");
    expect(params).toContain(PROJECT);
    // 🔴 조건이 겹친다 — `workspace_id` 를 양쪽 표에서 각각 한 번씩 본다.
    expect(params.filter((value) => value === WORKSPACE)).toHaveLength(2);
  });

  /**
   * 🔴 **회귀 방지.** Agent 요청에는 Project 가 «없다» — API Key 가 Workspace 를 정하고
   * Payload 에도 Query 에도 Project 자리가 없다. 이 시험이 없으면
   * 다음 사람이 「쓰기는 다 Project 로 좁힌다」를 여기까지 밀어붙여 돌고 있는 Agent 를 끊는다.
   */
  it("🔴 Agent 요청은 Workspace 까지만 좁힌다 — Project 를 요구하지 않는다", async () => {
    const { executor, captured } = fakeExecutor(FOUND);

    await addIssueActivity(
      {
        scope: { workspaceId: WORKSPACE },
        issueId: ISSUE,
        activity: ACTIVITY,
      },
      executor,
    );

    const { sql, params } = rendered(captured.where);
    expect(sql).not.toContain("exists");
    expect(sql).not.toContain("project_id");
    expect(params).toEqual([ISSUE, WORKSPACE]);
  });

  it("🔴 범위 밖이면 NOT_FOUND 이고 History 도 남지 않는다", async () => {
    const { executor, inserted } = fakeExecutor([]);

    let thrown: unknown = null;
    try {
      await addIssueActivity(
        {
          scope: { workspaceId: WORKSPACE, projectId: PROJECT },
          issueId: ISSUE,
          activity: ACTIVITY,
        },
        executor,
      );
    } catch (error) {
      thrown = error;
    }

    // 없는 Issue 와 남의 Project 의 Issue 를 구분해 알려주지 않는다 — 둘 다 NOT_FOUND 다.
    expect(isAppError(thrown) && thrown.code).toBe("NOT_FOUND");
    // 🔴 반쪽 History 를 만들지 않는다.
    expect(inserted).toHaveLength(0);
  });

  it("요청이 보낸 workspaceId 가 아니라 «조회로 확인한» 값을 저장한다", async () => {
    const { executor, inserted } = fakeExecutor(FOUND);

    await addIssueActivity(
      {
        scope: { workspaceId: WORKSPACE, projectId: PROJECT },
        issueId: ISSUE,
        activity: ACTIVITY,
      },
      executor,
    );

    expect(inserted[0]?.workspaceId).toBe(WORKSPACE);
    expect(inserted[0]?.reviewIssueId).toBe(ISSUE);
  });
});
