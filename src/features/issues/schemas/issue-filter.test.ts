import { describe, expect, it } from "vitest";

import {
  FILTER_ALL,
  issueFilterFormSchema,
  issueFilterToQueryString,
  parseIssueFilter,
} from "@/features/issues/schemas/issue-filter";
import { parseOptions } from "@/lib/validation/zod-error-map";

describe("parseIssueFilter", () => {
  it("비어 있으면 전체 조회로 떨어진다", () => {
    expect(parseIssueFilter({})).toEqual({
      q: "",
      severity: FILTER_ALL,
      category: FILTER_ALL,
      status: FILTER_ALL,
      page: 1,
    });
  });

  it("Search Params 를 그대로 읽는다", () => {
    expect(
      parseIssueFilter({
        q: " race condition ",
        severity: "HIGH",
        category: "CONCURRENCY",
        status: "OPEN",
        page: "3",
      }),
    ).toEqual({
      q: "race condition",
      severity: "HIGH",
      category: "CONCURRENCY",
      status: "OPEN",
      page: 3,
    });
  });

  it("🔴 주소창에 아무 값이나 들어와도 화면을 깨뜨리지 않고 기본값으로 떨어진다", () => {
    expect(
      parseIssueFilter({
        severity: "SUPER_URGENT",
        category: "42",
        status: "",
        page: "-7",
      }),
    ).toEqual({
      q: "",
      severity: FILTER_ALL,
      category: FILTER_ALL,
      status: FILTER_ALL,
      page: 1,
    });
  });

  it("같은 키가 여러 번 오면 첫 값만 쓴다", () => {
    const filter = parseIssueFilter({ severity: ["HIGH", "LOW"] });

    expect(filter.severity).toBe("HIGH");
  });
});

describe("issueFilterToQueryString", () => {
  it("기본값은 URL 에 적지 않는다", () => {
    expect(
      issueFilterToQueryString({
        q: "",
        severity: FILTER_ALL,
        category: FILTER_ALL,
        status: FILTER_ALL,
        page: 1,
      }),
    ).toBe("");
  });

  it("지정된 조건만 담고 왕복해도 같은 값이 나온다", () => {
    const filter = {
      q: "n+1",
      severity: "HIGH",
      category: FILTER_ALL,
      status: "OPEN",
      page: 2,
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
  ])("%s 로 parse 하면 그 언어로 적히고 상한이 문구에 남는다", (locale, part) => {
    const result = issueFilterFormSchema.safeParse(
      {
        q: "x".repeat(201),
        severity: FILTER_ALL,
        category: FILTER_ALL,
        status: FILTER_ALL,
      },
      parseOptions(locale),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(part);
  });
});
