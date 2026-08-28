import { describe, expect, it } from "vitest";

import {
  normalizeTagList,
  normalizeTagName,
} from "@/features/reviews/utils/tag-name";

/**
 * 되돌림 확인(2026-08-28): `normalizeTagList` 의 중복 제거를 떼면 「같은 뜻의 Tag 를 한 번만
 * 남긴다」가 실패한다. 직접 확인했다.
 */
describe("normalizeTagName", () => {
  it("표기가 달라도 같은 값이 된다", () => {
    expect(normalizeTagName("Race Condition")).toBe("race-condition");
    expect(normalizeTagName("race_condition")).toBe("race-condition");
    expect(normalizeTagName("  RACE-CONDITION  ")).toBe("race-condition");
    expect(normalizeTagName("race--condition")).toBe("race-condition");
  });

  it("한글 Tag 를 지우지 않는다", () => {
    expect(normalizeTagName("동시성 문제")).toBe("동시성-문제");
  });

  it("구분자만 있는 값은 빈 문자열이 된다", () => {
    expect(normalizeTagName("---")).toBe("");
    expect(normalizeTagName("   ")).toBe("");
  });
});

describe("normalizeTagList", () => {
  it("같은 뜻의 Tag 를 한 번만 남긴다", () => {
    const result = normalizeTagList([
      "Race Condition",
      "race_condition",
      "transaction",
    ]);

    expect(result.map((tag) => tag.normalizedName)).toEqual([
      "race-condition",
      "transaction",
    ]);
  });

  it("먼저 온 표기를 표시용 이름으로 남긴다", () => {
    const result = normalizeTagList(["Race Condition", "race-condition"]);

    expect(result[0]?.name).toBe("Race Condition");
    expect(result[0]?.normalizedName).toBe("race-condition");
  });

  it("정규화하면 비는 값은 버린다", () => {
    expect(normalizeTagList(["---", "  ", "n+1"])).toEqual([
      { name: "n+1", normalizedName: "n+1" },
    ]);
  });
});
