import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { IssueSearchQuery } from "@/features/issues/schemas/issue-search-query";
import {
 buildAgentIssueSearchConditions,
 escapeLikePattern,
} from "@/features/issues/server/issue-agent-query";

/**
 * 🔴 이 시험이 지키는 것은 **「검색어는 패턴이 아니다」** 이다.
 *
 * 되돌림 확인(2026-08-28): `escapeLikePattern` 을 항등 함수로 되돌리면 아래 세 시험이
 * 실패한다. 직접 확인했다.
 *
 * 이 결함은 실제로 있었다 — `?q=%` 를 보내면 패턴이 `%%%` 가 되어 **Workspace 의 Issue
 * 전체**가 돌아왔다. SQL Injection 은 아니지만(값은 파라미터로 바인딩된다) 보낸 사람이
 * 뜻하지 않은 결과를 받는다. 계약상 `q` 는 「제목·경로·Pattern 을 훑는 낱말」이다.
 */
describe("escapeLikePattern", () => {
 it("🔴 `%` 하나가 전부와 일치하는 패턴이 되지 않는다", () => {
 // 감싸고 난 최종 패턴이 `%\%%` — 가운데 `%` 는 글자 그대로다.
 expect(`%${escapeLikePattern("%")}%`).toBe("%\\%%");
 });

 it("`_` 도 글자 그대로 다룬다 — LIKE 에서 그것은 아무 글자 하나다", () => {
 expect(escapeLikePattern("a_b")).toBe("a\\_b");
 });

 it("백슬래시 자신을 먼저 두 배로 만든다 — 안 그러면 다음 글자를 삼킨다", () => {
 expect(escapeLikePattern("a\\%b")).toBe("a\\\\\\%b");
 });

 it("평범한 낱말은 건드리지 않는다", () => {
 expect(escapeLikePattern("RefreshToken")).toBe("RefreshToken");
 expect(escapeLikePattern("src/OrderService.java")).toBe(
 "src/OrderService.java",
);
 });
});

/**
 * Agent **목록** 조회의 Tenant 경계.
 *
 * 🔴 **Agent 경로에는 주소가 없다.** 사람은 `/w/{slug}` 로 들어와 소속이 확인되지만,
 * Agent 는 **API Key 가 Workspace 를 정한다**. 목록은 ID 로 한 건을 집는
 * 것이 아니라 Filter 조합으로 훑는 자리라, **어떤 조합에서도 Workspace 조건이 빠지지 않는
 * 것**이 격리의 전부다 — 빠지는 순간 아무 API Key 하나로 «모든 Tenant» 의 Issue 가 돌아온다.
 *
 * 질의를 돌리지 않고도 「무엇으로 좁히는가」를 볼 수 있게 조건 배열을 따로 뽑아 두었다.
 * Database 에 붙지 않는다 — `PgDialect` 로 실제 바인딩되는 값만 읽는다.
 *
 * 🔴 **ID 로 한 건을 다루는 경로**(`findAgentIssue`·`updateIssueStatus`·`findIssueInScope`)는
 * 여기가 아니라 `issue-scope.ts` 의 `issueInScope` 를 지나고, 그 조건의 시험은
 * `issue-status-service.test.ts` 에 있다 — 같은 것을 두 곳에 적지 않는다.
 *
 * ## 되돌림 확인
 *
 * `buildAgentIssueSearchConditions` 의 조건 배열에서 첫 줄
 * (`eq(reviewIssues.workspaceId, workspaceId)`)을 빼면 아래 「Filter 를 하나도 안 줘도
 * Workspace 로 좁힌다」와 조합 시험이 **실패한다.**
 */
describe("buildAgentIssueSearchConditions — 목록의 Tenant 경계", () => {
 const dialect = new PgDialect();

 function searchParams(query: IssueSearchQuery): unknown[] {
 const where = and(...buildAgentIssueSearchConditions("ws-1", query));
 if (where === undefined) {
 throw new Error("조건이 하나도 만들어지지 않았다");
 }
 return dialect.sqlToQuery(where).params;
 }

 function emptyQuery(): IssueSearchQuery {
 return {
 repository: null,
 status: null,
 severity: null,
 category: null,
 patternKey: null,
 q: null,
 limit: 20,
 };
 }

 it("🔴 Filter 를 하나도 안 줘도 Workspace 로 좁힌다", () => {
 // 되돌리면 조건이 비어 Workspace 전체가 아니라 «모든 Tenant» 가 돌아온다.
 expect(searchParams(emptyQuery())).toEqual(["ws-1"]);
 });

 it("🔴 어떤 Filter 조합에서도 Workspace 조건이 빠지지 않는다", () => {
 const combos: IssueSearchQuery[] = [
 {...emptyQuery(), status: "OPEN" },
 {...emptyQuery(), severity: "HIGH" },
 {...emptyQuery(), category: "SECURITY" },
 {...emptyQuery(), patternKey: "n-plus-one" },
 {...emptyQuery(), repository: "acme/app" },
 {...emptyQuery(), q: "RefreshToken" },
 {
 repository: "acme/app",
 status: "OPEN",
 severity: "HIGH",
 category: "SECURITY",
 patternKey: "n-plus-one",
 q: "RefreshToken",
 limit: 5,
 },
 ];

 for (const query of combos) {
 expect(searchParams(query)).toContain("ws-1");
 }
 });

 it("검색어의 LIKE wildcard 를 글자로 바꾼다", () => {
 // Agent 목록도 화면과 같은 보호를 받는다 — `?q=%` 로 전부 긁어가지 못한다.
 expect(searchParams({...emptyQuery(), q: "%" })).toContain("%\\%%");
 expect(searchParams({...emptyQuery(), q: "%" })).not.toContain("%%%");
 });

 it("Filter 를 준 만큼만 조건이 는다", () => {
 expect(searchParams({...emptyQuery(), status: "OPEN" })).toEqual([
 "ws-1",
 "OPEN",
 ]);
 });
});
