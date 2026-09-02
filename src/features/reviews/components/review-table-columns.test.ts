import { describe, expect, it } from "vitest";

import { describeTarget } from "@/features/reviews/components/review-table-columns";

/**
 * 「대상」 칸이 무엇을 그리는가.
 *
 * 🔴 **화면이 아니라 «규칙»을 시험한다.** 이 함수가 Review 목록과 Project Overview 두
 * 화면의 정본이라, 여기서 갈리면 두 화면이 같은 Review 를 다르게 보여 준다.
 *
 * 되돌림 확인(2026-09-02): `detail` 을 예전처럼 `종류 · SHA` 로 되돌리면 **3건**이 실제로
 * 실패한다(`expected '커밋 · 0123456' to be '0123456'`). 직접 돌려 보고 되돌렸다.
 */
describe("describeTarget", () => {
  it("branch 가 있으면 branch 가 알아보는 값이고 짧은 SHA 가 그 옆에 붙는다", () => {
    expect(
      describeTarget(
        { branch: "feature/auth-refactor", commitSha: "a81f3c2d9e4b5a6c7d8e" },
        "커밋",
      ),
    ).toEqual({
      primary: "feature/auth-refactor",
      detail: "a81f3c2",
      full: "feature/auth-refactor",
    });
  });

  /**
   * 🔴 한 Project 의 Review 는 대개 종류가 같다 — 모든 행에 같은 낱말을 되풀이하면
   * 행마다 한 줄이 늘 뿐 고르는 데는 도움이 되지 않는다. 종류는 Review 상세에 남는다.
   */
  it("branch 가 있으면 종류를 되풀이하지 않는다", () => {
    const target = describeTarget(
      { branch: "develop", commitSha: null },
      "Pull Request",
    );

    expect(target.primary).toBe("develop");
    expect(target.detail).toBeNull();
  });

  it("branch 가 없으면 짧은 SHA 가 알아보는 값이고 전문은 title 로 남는다", () => {
    expect(
      describeTarget({ branch: null, commitSha: "a81f3c2d9e4b5a6c7d8e" }, "커밋"),
    ).toEqual({
      primary: "a81f3c2",
      detail: null,
      full: "a81f3c2d9e4b5a6c7d8e",
    });
  });

  /**
   * 🔴 여기서는 종류가 «유일하게 남은 값»이라 **앞자리**로 올라온다.
   * 보조 자리(`detail`)는 좁은 화면에서 접히므로, 거기 두면 390px 에서 이 행이 빈다.
   */
  it("branch 도 SHA 도 없으면 종류가 알아보는 값이 된다", () => {
    expect(describeTarget({ branch: null, commitSha: null }, "수동")).toEqual({
      primary: "수동",
      detail: null,
      full: undefined,
    });
  });

  /** 🔴 `detail` 은 «언제나» 짧은 SHA 다 — 접혀도 되는 값만 그 자리에 둔다. */
  it("detail 자리에는 SHA 말고 아무것도 들어가지 않는다", () => {
    const cases = [
      describeTarget({ branch: "main", commitSha: null }, "브랜치"),
      describeTarget({ branch: null, commitSha: "abc1234def" }, "커밋"),
      describeTarget({ branch: null, commitSha: null }, "저장소"),
    ];

    for (const target of cases) {
      expect(target.detail).toBeNull();
    }
  });

  /**
   * 🔴 **40자 SHA 를 목록에 그대로 두지 않는다.** 끊을 자리가 없어 어떤 폭에서도
   * 칸을 밀어낸다 — 실제로 그래서 대상 칸이 어느 폭에서나 770px 로 굳은 적이 있다.
   */
  it("SHA 는 언제나 7자로 줄여 그린다", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";

    expect(describeTarget({ branch: "main", commitSha: sha }, "커밋").detail)
      .toBe("0123456");
    expect(describeTarget({ branch: null, commitSha: sha }, "커밋").primary)
      .toBe("0123456");
  });
});
