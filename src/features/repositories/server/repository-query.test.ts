import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { DbExecutor } from "@/db";
import { moveRepositoryToProject } from "@/features/repositories/server/repository-query";
import { isAppError } from "@/lib/errors";

/**
 * Repository 이동의 **범위**.
 *
 * ## 🔴 이 시험이 왜 필요했는가
 *
 * 목적지는 소속을 확인한 Workspace 안에서 다시 찾는데, **출발지는 확인하지 않았다.**
 * 화면이 Repository 를 «읽을» 때 쓴 범위는 `{workspaceId, projectId}` 인데
 * (`findRepositoryDetail`) 옮길 때는 `workspaceId` 만 걸었다 — Project A 화면에서
 * 다른 Project 의 Repository ID 를 적어 보내는 것만으로 그것이 옮겨졌다.
 *
 * ## 🔴 이 시험이 지키지 «못하는» 것
 *
 * DB 를 쓰지 않으므로 **조건이 문장에 실렸는가**까지만 본다. PostgreSQL 이 그 조건으로
 * 행을 실제로 걸러 내는지는 통합 시험의 몫이다.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const SOURCE_PROJECT = "22222222-2222-4222-8222-222222222222";
const TARGET_PROJECT = "33333333-3333-4333-8333-333333333333";
const REPOSITORY = "44444444-4444-4444-8444-444444444444";

/**
 * 목적지 조회와 이동 UPDATE 만 흉내 내는 최소 Fake.
 *
 * 🔴 **조건절을 «평가»하지 않는다.** 붙잡아 두었다가 어떤 문장이 만들어졌는지만 본다.
 */
function fakeExecutor(options: {
 destinationRows: readonly unknown[];
 movedRows: readonly unknown[];
}) {
 const captured: { where?: SQL } = {};

 const executor = {
 select: () => ({
 from: () => ({
 where: () => ({
 limit: () => Promise.resolve(options.destinationRows),
 }),
 }),
 }),
 update: () => ({
 set: () => ({
 where: (condition: SQL) => {
 captured.where = condition;
 return { returning: () => Promise.resolve(options.movedRows) };
 },
 }),
 }),
 } as unknown as DbExecutor;

 return { executor, captured };
}

function rendered(condition: SQL | undefined) {
 if (condition === undefined) {
 throw new Error("조건절이 붙지 않았다");
 }
 return new PgDialect().sqlToQuery(condition);
}

const FOUND_DESTINATION = [{ id: TARGET_PROJECT }];

describe("moveRepositoryToProject — 출발지도 조건이다", () => {
 it("🔴 화면에서 온 요청은 출발 Project 까지 겹쳐서 건다", async () => {
 const { executor, captured } = fakeExecutor({
 destinationRows: FOUND_DESTINATION,
 movedRows: [{ id: REPOSITORY }],
 });

 await moveRepositoryToProject(
 {
 workspaceId: WORKSPACE,
 repositoryId: REPOSITORY,
 sourceProjectId: SOURCE_PROJECT,
 targetProjectId: TARGET_PROJECT,
 },
 executor,
);

 const query = rendered(captured.where);

 expect(query.sql).toContain("project_id");
 expect(query.params).toEqual([REPOSITORY, WORKSPACE, SOURCE_PROJECT]);
 // 🔴 목적지가 조건으로 새어 들어가면 안 된다 — 그것은 `set` 의 값이다.
 expect(query.params).not.toContain(TARGET_PROJECT);
 });

 it("출발 Project 를 모르는 자리는 Workspace 까지만 좁힌다", async () => {
 const { executor, captured } = fakeExecutor({
 destinationRows: FOUND_DESTINATION,
 movedRows: [{ id: REPOSITORY }],
 });

 await moveRepositoryToProject(
 {
 workspaceId: WORKSPACE,
 repositoryId: REPOSITORY,
 targetProjectId: TARGET_PROJECT,
 },
 executor,
);

 expect(rendered(captured.where).params).toEqual([REPOSITORY, WORKSPACE]);
 });

 it("범위 밖이면 NOT_FOUND 다 — 남의 것과 없는 것을 구분해 주지 않는다", async () => {
 // 출발 Project 가 달라 한 행도 잡히지 않은 상태를 그대로 흉내 낸다.
 const { executor } = fakeExecutor({
 destinationRows: FOUND_DESTINATION,
 movedRows: [],
 });

 const error = await moveRepositoryToProject(
 {
 workspaceId: WORKSPACE,
 repositoryId: REPOSITORY,
 sourceProjectId: SOURCE_PROJECT,
 targetProjectId: TARGET_PROJECT,
 },
 executor,
).catch((thrown: unknown) => thrown);

 expect(isAppError(error) && error.code).toBe("NOT_FOUND");
 });

 it("목적지가 같은 Workspace 에 없으면 옮기지 않는다", async () => {
 const { executor, captured } = fakeExecutor({
 destinationRows: [],
 movedRows: [{ id: REPOSITORY }],
 });

 const error = await moveRepositoryToProject(
 {
 workspaceId: WORKSPACE,
 repositoryId: REPOSITORY,
 sourceProjectId: SOURCE_PROJECT,
 targetProjectId: TARGET_PROJECT,
 },
 executor,
).catch((thrown: unknown) => thrown);

 expect(isAppError(error) && error.code).toBe("NOT_FOUND");
 // 🔴 UPDATE 자체가 돌지 않았다.
 expect(captured.where).toBeUndefined();
 });
});
