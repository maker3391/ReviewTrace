import { and, eq, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { DbExecutor } from "@/db";
import { reviewIssues } from "@/db/schema";
import { issueInScope } from "@/features/issues/server/issue-scope";
import { updateIssueStatus } from "@/features/issues/server/issue-status-service";
import { isAppError } from "@/lib/errors";

/**
 * 상태 전이가 **어느 범위 안에서만** 일어나는가.
 *
 * ## 🔴 이 시험이 왜 필요했는가
 *
 * 조회는 `{workspaceId, projectId}` 로 좁히는데(`findIssueDetail`) 쓰기는 `workspaceId`
 * 로만 좁혔다. Tenant 는 뚫리지 않지만 **읽기와 쓰기의 범위가 어긋났다** — Project A 화면에서
 * 주소의 Issue ID 만 Project B 의 것으로 바꾸면 그것이 움직였다.
 *
 * ## 🔴 이 시험이 지키지 «못하는» 것
 *
 * DB 를 쓰지 않는다. 그러니 확인할 수 있는 것은 **「그 조건이 실제로 문장에 실려 나갔는가」**
 * 까지다. PostgreSQL 이 그 조건으로 실제 행을 걸러 내는지는 여기서 증명되지 않는다 —
 * 그것은 실제 Database 를 쓰는 통합 시험의 몫이다.
 *
 * 대신 이 시험은 **매번 돈다.** 범위 판정처럼 잊기 쉬운 규칙이 `DB_INTEGRATION=true` 를
 * 붙였을 때만 검사되면, 정작 매일 도는 실행에서는 아무도 지키지 않는다.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const OTHER_PROJECT = "44444444-4444-4444-8444-444444444444";
const ISSUE = "33333333-3333-4333-8333-333333333333";
const ACTIVITY = "55555555-5555-4555-8555-555555555555";

const UPDATED_ROW = {
 id: ISSUE,
 status: "RESOLVED" as const,
 resolutionSummary: "Transaction 밖으로 옮겼다",
 resolvedAt: new Date("2026-08-28T00:00:00.000Z"),
 updatedAt: new Date("2026-08-28T00:00:00.000Z"),
};

const RESOLVE = {
 status: "RESOLVED" as const,
 resolutionSummary: "Transaction 밖으로 옮겼다",
 commitSha: null,
 actor: null,
 decision: null,
 evidence: [],
};

/**
 * `update … where` 와 `insert … returning` 만 흉내 내는 최소 Fake.
 *
 * 🔴 **조건절을 «평가»하지 않는다.** 그것은 PostgreSQL 의 일이다. 여기서는 조건절을
 * 그대로 붙잡아 두었다가, 어떤 문장이 만들어졌는지 밖에서 들여다본다.
 */
function fakeExecutor(updatedRows: readonly unknown[]) {
 const captured: { where?: SQL } = {};
 const insertedActivities: Record<string, unknown>[] = [];

 const tx = {
 update: () => ({
 set: () => ({
 where: (condition: SQL) => {
 captured.where = condition;
 return { returning: () => Promise.resolve(updatedRows) };
 },
 }),
 }),
 insert: () => ({
 values: (values: Record<string, unknown>) => {
 insertedActivities.push(values);
 return { returning: () => Promise.resolve([{ id: ACTIVITY }]) };
 },
 }),
 };

 const executor = {
 transaction: (run: (tx: unknown) => unknown) => run(tx),
 } as unknown as DbExecutor;

 return { executor, captured, insertedActivities };
}

/** 만들어진 조건절을 실제 SQL 과 Parameter 로 펼친다. */
function rendered(condition: SQL | undefined) {
 if (condition === undefined) {
 throw new Error("조건절이 붙지 않았다");
 }
 return new PgDialect().sqlToQuery(condition);
}

describe("updateIssueStatus — 어느 범위 안에서 움직이는가", () => {
 it("🔴 화면에서 온 요청은 Workspace 와 Project 를 겹쳐서 건다", async () => {
 const { executor, captured } = fakeExecutor([UPDATED_ROW]);

 await updateIssueStatus(
 {
 scope: { workspaceId: WORKSPACE, projectId: PROJECT },
 issueId: ISSUE,
 update: RESOLVE,
 fallbackActorName: "codex",
 },
 executor,
);

 const query = rendered(captured.where);

 // Project 는 Repository 를 거쳐서만 알 수 있다 — `review_issues` 에는 없다.
 expect(query.sql).toContain("project_id");
 expect(query.params).toContain(PROJECT);
 expect(query.params).toContain(ISSUE);

 // 🔴 겹쳐서 건다: `review_issues` 에서 한 번, `repositories` 에서 또 한 번.
 expect(query.params.filter((value) => value === WORKSPACE)).toHaveLength(2);
 });

 it("🔴 Agent 요청은 Project 로 좁히지 «않는다» — 그러면 계약이 깨진다", async () => {
 const { executor, captured } = fakeExecutor([UPDATED_ROW]);

 await updateIssueStatus(
 {
 // API Key 가 Workspace 를 정한다. Payload 에도 Query 에도 Project 자리가 없다.
 scope: { workspaceId: WORKSPACE },
 issueId: ISSUE,
 update: RESOLVE,
 fallbackActorName: "codex",
 },
 executor,
);

 const query = rendered(captured.where);

 expect(query.sql).not.toContain("project_id");
 expect(query.params).toEqual([ISSUE, WORKSPACE]);
 });

 it("범위 밖이면 NOT_FOUND 다 — 남의 것과 없는 것을 구분해 주지 않는다", async () => {
 // 조건에 걸려 한 행도 갱신되지 않은 상태를 그대로 흉내 낸다.
 const { executor, insertedActivities } = fakeExecutor([]);

 const error = await updateIssueStatus(
 {
 scope: { workspaceId: WORKSPACE, projectId: PROJECT },
 issueId: ISSUE,
 update: RESOLVE,
 fallbackActorName: "codex",
 },
 executor,
).catch((thrown: unknown) => thrown);

 expect(isAppError(error) && error.code).toBe("NOT_FOUND");
 // 🔴 상태가 안 바뀌었으면 History 도 남지 않는다 — 반쪽 기록을 만들지 않는다.
 expect(insertedActivities).toHaveLength(0);
 });
});

/**
 * 조건 자체가 무엇을 묻는지.
 *
 * 위 시험이 「호출 자리가 helper 를 지나는가」를 지키고, 이 묶음이 「helper 가 무엇을
 * 적는가」를 지킨다. 둘 중 하나만 있으면 다른 쪽이 조용히 무너진다.
 */
describe("issueInScope", () => {
 it("Project 가 없으면 Workspace 조건 하나뿐이다", () => {
 const query = rendered(issueInScope({ workspaceId: WORKSPACE }));

 expect(query.params).toEqual([WORKSPACE]);
 expect(query.sql).not.toContain("exists");
 });

 it("🔴 Project 는 Repository 를 거쳐 확인한다 — 같은 Workspace 안에서", () => {
 const query = rendered(
 issueInScope({ workspaceId: WORKSPACE, projectId: PROJECT }),
);

 expect(query.sql).toContain("exists");
 expect(query.sql).toContain("repositories");
 // Repository 쪽에도 Workspace 조건이 함께 든다.
 expect(query.params).toEqual([WORKSPACE, WORKSPACE, PROJECT]);
 });

 it("🔴 다른 Project 를 주면 다른 문장이 나온다 — 값이 실려 나가는지 확인한다", () => {
 const query = rendered(
 issueInScope({ workspaceId: WORKSPACE, projectId: OTHER_PROJECT }),
);

 expect(query.params).toContain(OTHER_PROJECT);
 expect(query.params).not.toContain(PROJECT);
 });

 it("다른 조건과 함께 걸어도 조건이 사라지지 않는다", () => {
 const query = rendered(
 and(eq(reviewIssues.id, ISSUE), issueInScope({ workspaceId: WORKSPACE })),
);

 expect(query.params).toEqual([ISSUE, WORKSPACE]);
 });
});
