import { describe, expect, it } from "vitest";

import {
  FILTER_ALL,
  issueFilterFormSchema,
  issueFilterToQueryString,
  parseIssueFilter,
} from "@/features/issues/schemas/issue-filter";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { parseOptions } from "@/lib/validation/zod-error-map";

/** 실제 `repositories.id` 와 같은 모양의 값. 형식만 맞으면 조회까지 내려간다. */
const REPOSITORY_ID = "6f9b2c1e-6a5f-4b3d-9c21-0b7a4e5d8c31";

describe("parseIssueFilter", () => {
  it("비어 있으면 전체 조회로 떨어진다", () => {
    expect(parseIssueFilter({})).toEqual({
      q: "",
      repositoryId: FILTER_ALL,
      severity: FILTER_ALL,
      category: FILTER_ALL,
      status: FILTER_ALL,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it("Search Params 를 그대로 읽는다", () => {
    expect(
      parseIssueFilter({
        q: " race condition ",
        repositoryId: REPOSITORY_ID,
        severity: "HIGH",
        category: "CONCURRENCY",
        status: "OPEN",
        page: "3",
        pageSize: "50",
      }),
    ).toEqual({
      q: "race condition",
      repositoryId: REPOSITORY_ID,
      severity: "HIGH",
      category: "CONCURRENCY",
      status: "OPEN",
      page: 3,
      pageSize: 50,
    });
  });

  it("🔴 주소창에 아무 값이나 들어와도 화면을 깨뜨리지 않고 기본값으로 떨어진다", () => {
    expect(
      parseIssueFilter({
        severity: "SUPER_URGENT",
        category: "42",
        status: "",
        /*
 🔴 **UUID 가 아닌 값은 조회로 내려보내지 않는다.** `repositories.id` 는 `uuid`
 Column 이라 그대로 나가면 Postgres 가 `22P02` 로 거절하고 화면이 500 이 된다.
 */
        repositoryId: "'; drop table review_issues; --",
        page: "-7",
        // 🔴 고를 수 있는 값이 아닌 쪽 크기는 그대로 쓰지 않는다 — 상한이 뚫린다.
        pageSize: "100000",
      }),
    ).toEqual({
      q: "",
      repositoryId: FILTER_ALL,
      severity: FILTER_ALL,
      category: FILTER_ALL,
      status: FILTER_ALL,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it("같은 키가 여러 번 오면 첫 값만 쓴다", () => {
    const filter = parseIssueFilter({ severity: ["HIGH", "LOW"] });

    expect(filter.severity).toBe("HIGH");
  });

  /**
   * 🔴 **범위 밖의 저장소를 「전체」로 되돌리지 않는다.**
   *
   * 형식이 맞는 UUID 는 그대로 통과시켜 조회까지 내려보낸다 — 그 값이 이 Project 의
   * 것인지는 조회가 `workspace_id`·`project_id` 와 **겹쳐서** 판정한다(스펙 11).
   * 여기서 조용히 `ALL` 로 되돌리면 남의 저장소를 물었는데 **이 Project 의 Issue 전부**가
   * 돌아온다 — 묻지 않은 것에 답하는 쪽이 아무것도 못 찾는 쪽보다 나쁘다(스펙 13).
   */
  it("🔴 형식이 맞는 저장소 값은 그대로 조회로 내려간다", () => {
    expect(parseIssueFilter({ repositoryId: REPOSITORY_ID }).repositoryId).toBe(
      REPOSITORY_ID,
    );
  });
});

describe("issueFilterToQueryString", () => {
  it("기본값은 URL 에 적지 않는다", () => {
    expect(
      issueFilterToQueryString({
        q: "",
        repositoryId: FILTER_ALL,
        severity: FILTER_ALL,
        category: FILTER_ALL,
        status: FILTER_ALL,
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
      }),
    ).toBe("");
  });

  it("지정된 조건만 담고 왕복해도 같은 값이 나온다", () => {
    const filter = {
      q: "n+1",
      repositoryId: REPOSITORY_ID,
      severity: "HIGH",
      category: FILTER_ALL,
      status: "OPEN",
      page: 2,
      pageSize: 100,
    } as const;

    const queryString = issueFilterToQueryString(filter);
    const roundTrip = parseIssueFilter(
      Object.fromEntries(new URLSearchParams(queryString)),
    );

    expect(roundTrip).toEqual(filter);
  });
});

describe("issueFilterFormSchema", () => {
  it("🔴 Form 은 URL 과 달리 잘못된 입력을 조용히 넘기지 않는다", () => {
    const result = issueFilterFormSchema.safeParse({
      q: "x".repeat(201),
      repositoryId: FILTER_ALL,
      severity: FILTER_ALL,
      category: FILTER_ALL,
      status: FILTER_ALL,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe("too_big");
  });

  /**
   * 🔴 **Schema 는 규칙만 갖고 문구는 갖지 않는다.**
   *
   * 같은 Schema·같은 규칙에 error map 만 갈아 끼우면 두 언어가 나온다. 그리고 **상한
   * 200 이 두 문구에 모두 남아 있다** — 「너무 깁니다」로 뭉개지 않는다.
   */
  it.each([
    ["ko" as const, "200자"],
    ["en" as const, "200 characters"],
  ])(
    "%s 로 parse 하면 그 언어로 적히고 상한이 문구에 남는다",
    (locale, part) => {
      const result = issueFilterFormSchema.safeParse(
        {
          q: "x".repeat(201),
          repositoryId: FILTER_ALL,
          severity: FILTER_ALL,
          category: FILTER_ALL,
          status: FILTER_ALL,
        },
        parseOptions(locale),
      );

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain(part);
    },
  );
});
