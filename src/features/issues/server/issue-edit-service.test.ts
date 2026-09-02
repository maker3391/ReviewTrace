import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { DbExecutor } from "@/db";
import { updateIssueContent } from "@/features/issues/server/issue-edit-service";
import { isAppError } from "@/lib/errors";

/**
 * 서술 수정이 **어느 범위 안에서, 어느 Column 만** 움직이는가.
 *
 * `issue-status-service.test.ts` 와 같은 결이다 — Database 를 쓰지 않고, 만들어진
 * `UPDATE` 문장을 붙잡아 들여다본다. 🔴 확인할 수 있는 것은 「그 조건과 그 Column 이
 * 실제로 문장에 실려 나갔는가」까지이고, PostgreSQL 이 그 조건으로 행을 걸러 내는지는
 * 통합 시험(`issue-edit.integration.test.ts`)의 몫이다.
 *
 * 대신 이 시험은 **매번 돈다.** 범위 판정처럼 잊기 쉬운 규칙이 `DB_INTEGRATION=true`
 * 를 붙였을 때만 검사되면, 정작 매일 도는 실행에서는 아무도 지키지 않는다.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ISSUE = "33333333-3333-4333-8333-333333333333";

const EDIT = {
  title: "고친 제목",
  description: "고친 설명",
  rootCause: null,
  failurePath: null,
  suggestion: null,
};

const UPDATED_ROW = {
  id: ISSUE,
  title: EDIT.title,
  description: EDIT.description,
  rootCause: null,
  failurePath: null,
  suggestion: null,
  updatedAt: new Date("2026-09-02T00:00:00.000Z"),
};

/**
 * `update … set … where … returning` 만 흉내 내는 최소 Fake.
 *
 * 🔴 **조건절을 «평가»하지 않는다.** 그것은 PostgreSQL 의 일이다. 여기서는 조건절과
 * `set` 에 실린 Column 을 그대로 붙잡아 두었다가 밖에서 들여다본다.
 */
function fakeExecutor(updatedRows: readonly unknown[]) {
  const captured: { where?: SQL; set?: Record<string, unknown> } = {};

  const executor = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        captured.set = values;
        return {
          where: (condition: SQL) => {
            captured.where = condition;
            return { returning: () => Promise.resolve(updatedRows) };
          },
        };
      },
    }),
  } as unknown as DbExecutor;

  return { executor, captured };
}

/** 만들어진 조건절을 실제 SQL 과 Parameter 로 펼친다. */
function rendered(condition: SQL | undefined) {
  if (condition === undefined) {
    throw new Error("조건절이 붙지 않았다");
  }
  return new PgDialect().sqlToQuery(condition);
}

describe("updateIssueContent — 어느 범위 안에서 고치는가", () => {
  it("🔴 화면에서 온 요청은 Workspace 와 Project 를 겹쳐서 건다", async () => {
    const { executor, captured } = fakeExecutor([UPDATED_ROW]);

    await updateIssueContent(
      {
        scope: { workspaceId: WORKSPACE, projectId: PROJECT },
        issueId: ISSUE,
        update: EDIT,
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

  it("범위 안에서 찾지 못하면 `RESOURCE_NOT_FOUND` 다 — 「남의 것」과 구분하지 않는다", async () => {
    const { executor } = fakeExecutor([]);

    const failure = await updateIssueContent(
      {
        scope: { workspaceId: WORKSPACE, projectId: PROJECT },
        issueId: ISSUE,
        update: EDIT,
      },
      executor,
    ).catch((error: unknown) => error);

    expect(isAppError(failure)).toBe(true);
    if (isAppError(failure)) {
      expect(failure.reason).toBe("RESOURCE_NOT_FOUND");
      expect(failure.code).toBe("NOT_FOUND");
    }
  });
});

describe("updateIssueContent — 무엇을 쓰는가", () => {
  it("서술 다섯 칸과 `updatedAt` 만 문장에 실린다", async () => {
    const { executor, captured } = fakeExecutor([UPDATED_ROW]);

    await updateIssueContent(
      {
        scope: { workspaceId: WORKSPACE, projectId: PROJECT },
        issueId: ISSUE,
        update: EDIT,
      },
      executor,
    );

    expect(Object.keys(captured.set ?? {}).sort()).toEqual([
      "description",
      "failurePath",
      "rootCause",
      "suggestion",
      "title",
      "updatedAt",
    ]);
  });

  /**
   * 🔴 **이 시험이 이 기능의 안전장치다.**
   *
   * 서술 수정이 상태 칸을 건드리는 순간 「REOPENED 인데 해결 요약이 적혀 있는」 행이
   * 만들어지고, 집계 축(`severity`·`category`)이나 신원(`source`·`externalId`)을 건드리면
   * Pattern 통계와 재보고 dedup 이 함께 무너진다.
   */
  it("🔴 상태·집계 축·신원·provenance 는 이름조차 나오지 않는다", async () => {
    const { executor, captured } = fakeExecutor([UPDATED_ROW]);

    await updateIssueContent(
      {
        scope: { workspaceId: WORKSPACE, projectId: PROJECT },
        issueId: ISSUE,
        // 🔴 Service 계약 밖의 값을 억지로 실어 보내도 문장에 나가지 않아야 한다.
        update: {
          ...EDIT,
          ...({
            status: "RESOLVED",
            resolvedAt: new Date(0),
            resolutionSummary: "몰래 적어 넣은 해결 요약",
            severity: "LOW",
            category: "CLEAN_CODE",
            patternKey: "SOMETHING_ELSE",
            source: "other-agent",
            externalId: "other-1",
            repositoryId: "x",
            reviewSessionId: "y",
            workspaceId: "z",
            firstDetectedAt: new Date(0),
          } as Record<string, unknown>),
        },
      },
      executor,
    );

    for (const forbidden of [
      "status",
      "resolvedAt",
      "resolutionSummary",
      "severity",
      "category",
      "patternKey",
      "filePath",
      "startLine",
      "endLine",
      "source",
      "externalId",
      "repositoryId",
      "reviewSessionId",
      "workspaceId",
      "firstDetectedAt",
    ]) {
      expect(captured.set).not.toHaveProperty(forbidden);
    }
  });
});
