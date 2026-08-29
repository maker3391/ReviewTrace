import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  FILTER_ALL,
  type IssueFilter,
} from "@/features/issues/schemas/issue-filter";
import { buildIssueListConditions } from "@/features/issues/server/issue-query";

/**
 * 화면 Issue 목록의 검색어가 실제로 **무엇으로 바인딩되는가**.
 *
 * 🔴 **결과를 봐서는 알 수 없는 결함이라 파라미터를 직접 본다.** `?q=%` 가 `%%%` 로
 * 나가면 Project 의 Issue 가 «전부» 돌아오는데, 응답은 200 이고 목록도 그럴듯해서
 * 검색이 고장 난 줄 모른다. 실제로 Agent 조회는 이 결함을 고쳤는데
 * (`issue-agent-query.ts`) 화면 조회만 그 helper 를 지나지 않고 있었다.
 *
 * Database 에 붙지 않는다 — `PgDialect` 로 SQL 문자열과 파라미터만 뽑는다.
 *
 * ## 되돌림 확인
 *
 * `issue-query.ts` 의 `escapeLikePattern(filter.q)` 를 `filter.q` 로 되돌리면
 * 아래 「wildcard 를 글자로 바꾼다」와 「전부 일치하는 패턴을 만들지 않는다」가 **실패한다.**
 *
 * 🔴 **이 시험이 잡지 못하는 것**: `findIssues` 가 `buildIssueListConditions` 를 아예
 * 부르지 않도록 바꾸면 이 시험은 초록으로 남는다. 그 자리를 실제 질의로 막으려면
 * Database 가 필요하고, 기본 `pnpm test` 는 Database 에 붙지 않는다.
 */

const dialect = new PgDialect();

function boundParams(filter: IssueFilter): unknown[] {
  const where = and(
    ...buildIssueListConditions(
      { workspaceId: "ws-1", projectId: "p-1" },
      filter,
    ),
  );
  if (where === undefined) {
    throw new Error("조건이 하나도 만들어지지 않았다");
  }
  return dialect.sqlToQuery(where).params;
}

function filterWith(q: string): IssueFilter {
  return {
    q,
    severity: FILTER_ALL,
    category: FILTER_ALL,
    status: FILTER_ALL,
    page: 1,
  };
}

describe("findIssues 의 검색어 바인딩", () => {
  it("wildcard 를 글자로 바꾼다", () => {
    expect(boundParams(filterWith("%"))).toContain("%\\%%");
  });

  it("밑줄도 글자로 바꾼다 — 아무 한 글자와 맞지 않는다", () => {
    expect(boundParams(filterWith("a_b"))).toContain("%a\\_b%");
  });

  it("전부 일치하는 패턴을 만들지 않는다", () => {
    // 되돌리면 여기에 `%%%` 가 들어간다 — Project 의 Issue 가 전부 돌아온다.
    expect(boundParams(filterWith("%"))).not.toContain("%%%");
  });

  it("보통 낱말은 그대로 감싼다", () => {
    expect(boundParams(filterWith("RefreshToken"))).toContain("%RefreshToken%");
  });

  it("검색어가 비면 keyword 조건 자체를 만들지 않는다", () => {
    const params = boundParams(filterWith(""));
    expect(params).toEqual(["ws-1", "p-1"]);
  });

  it("Tenant 조건은 검색어와 무관하게 늘 들어간다", () => {
    const params = boundParams(filterWith("RefreshToken"));
    expect(params).toContain("ws-1");
    expect(params).toContain("p-1");
  });
});
