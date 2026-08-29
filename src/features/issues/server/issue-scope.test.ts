import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { buildAgentIssueSearchConditions } from "@/features/issues/server/issue-agent-query";
import { issueInWorkspace } from "@/features/issues/server/issue-scope";
import type { IssueSearchQuery } from "@/features/issues/schemas/issue-search-query";

/**
 * Agent API 의 Tenant 경계.
 *
 * 🔴 **Agent 경로에는 주소가 없다.** 사람은 `/w/{slug}` 로 들어와 소속이 확인되지만,
 * Agent 는 **API Key 가 Workspace 를 정하고** Issue 를 **ID 로** 지목한다. 그래서
 * `WHERE id = ?` 에 Workspace 조건이 함께 걸리느냐 하나로 격리가 갈린다 — 빠지면 아무
 * API Key 하나로 남의 Tenant 의 Issue 를 읽고, 상태를 바꾸고, History 를 남길 수 있다.
 *
 * 그 조건을 지나는 경로가 셋이다.
 *
 * | 경로 | 무엇을 하는가 |
 * |---|---|
 * | `findAgentIssue` (`GET /api/v1/issues/{id}`) | 본문·근본원인·History 를 읽는다 |
 * | `updateIssueStatus` (`PATCH /api/v1/issues/{id}`) | 상태와 해결 요약을 **쓴다** |
 * | `findIssueInWorkspace` (`POST /api/v1/issues/{id}/activities`) | Activity 를 **쓴다** |
 *
 * 셋이 각자 같은 두 줄을 갖고 있어 **하나만 빠져도 그 경로만 조용히 뚫렸고, 시험이 걸
 * 자리가 없었다.** 한 곳(`issue-scope.ts`)으로 모아 여기서 못 박는다.
 *
 * Database 에 붙지 않는다 — `PgDialect` 로 실제 바인딩되는 값만 뽑는다.
 *
 * ## 되돌림 확인
 *
 * `issue-scope.ts` 에서 `eq(reviewIssues.workspaceId, workspaceId)` 를 빼면
 * 「Workspace 조건이 함께 걸린다」가, `issue-agent-query.ts` 의 조건 배열에서 첫 줄을 빼면
 * 「Filter 를 하나도 안 줘도 Workspace 로 좁힌다」와 나머지 조합 시험이 **실패한다.**
 */

const dialect = new PgDialect();

function paramsOf(condition: Parameters<PgDialect["sqlToQuery"]>[0]): unknown[] {
  return dialect.sqlToQuery(condition).params;
}

function searchParams(query: IssueSearchQuery): unknown[] {
  const where = and(...buildAgentIssueSearchConditions("ws-1", query));
  if (where === undefined) {
    throw new Error("조건이 하나도 만들어지지 않았다");
  }
  return paramsOf(where);
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

describe("issueInWorkspace — ID 로 Issue 를 다루는 세 경로가 함께 쓴다", () => {
  it("🔴 Issue ID 와 Workspace 조건이 함께 걸린다", () => {
    const params = paramsOf(issueInWorkspace("issue-1", "ws-1"));

    // 되돌리면 여기서 "ws-1" 이 사라진다 — ID 만으로 남의 Issue 에 닿는다.
    expect(params).toContain("issue-1");
    expect(params).toContain("ws-1");
  });

  it("두 값이 뒤바뀌지 않는다", () => {
    const sql = dialect.sqlToQuery(issueInWorkspace("issue-1", "ws-1")).sql;

    // id 조건이 먼저, workspace 조건이 뒤 — 자리표시자 순서와 params 순서가 맞는다.
    expect(paramsOf(issueInWorkspace("issue-1", "ws-1"))).toEqual([
      "issue-1",
      "ws-1",
    ]);
    expect(sql).toContain("and");
  });
});

describe("buildAgentIssueSearchConditions — 목록의 Tenant 경계", () => {
  it("🔴 Filter 를 하나도 안 줘도 Workspace 로 좁힌다", () => {
    // 되돌리면 조건이 비어 Workspace 전체가 아니라 «모든 Tenant» 가 돌아온다.
    expect(searchParams(emptyQuery())).toEqual(["ws-1"]);
  });

  it("🔴 어떤 Filter 조합에서도 Workspace 조건이 빠지지 않는다", () => {
    const combos: IssueSearchQuery[] = [
      { ...emptyQuery(), status: "OPEN" },
      { ...emptyQuery(), severity: "HIGH" },
      { ...emptyQuery(), category: "SECURITY" },
      { ...emptyQuery(), patternKey: "n-plus-one" },
      { ...emptyQuery(), repository: "acme/app" },
      { ...emptyQuery(), q: "RefreshToken" },
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
    expect(searchParams({ ...emptyQuery(), q: "%" })).toContain("%\\%%");
    expect(searchParams({ ...emptyQuery(), q: "%" })).not.toContain("%%%");
  });

  it("Filter 를 준 만큼만 조건이 는다", () => {
    expect(searchParams({ ...emptyQuery(), status: "OPEN" })).toEqual([
      "ws-1",
      "OPEN",
    ]);
  });
});
