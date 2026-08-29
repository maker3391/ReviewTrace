import { describe, expect, it } from "vitest";

import { sliceLines } from "@/lib/github/content";

/**
 * 🔴 이 시험이 지키는 것은 **「파일 밖을 가리키는 근거를 확인했다고 적지 않는다」** 이다.
 *
 * `readGithubLines` 는 잘라 낸 결과가 빈 문자열이면 `OUT_OF_RANGE` 로 실패 처리한다.
 * 그 판단이 성립하려면 **범위 밖이 정말 빈 문자열이어야** 한다 — 여기서 그것을 못 박는다.
 *
 * 되돌림 확인(2026-08-28): `readGithubLines` 의 `text === ""` 검사를 떼면 10줄짜리 파일에
 * `startLine: 100` 을 보낸 근거가 `VERIFIED` 로 저장된다. 직접 확인했다.
 */
describe("sliceLines", () => {
  const file = "l1\nl2\nl3\nl4\nl5";

  it("줄 범위를 1-based 로 자른다", () => {
    expect(sliceLines(file, 2, 4)).toBe("l2\nl3\nl4");
  });

  it("endLine 이 없으면 그 한 줄이다", () => {
    expect(sliceLines(file, 3, null)).toBe("l3");
  });

  it("🔴 파일 밖을 가리키면 빈 문자열이다 — 부르는 쪽이 이것으로 실패를 가른다", () => {
    expect(sliceLines(file, 100, 100)).toBe("");
    expect(sliceLines(file, 6, 9)).toBe("");
  });

  it("끝을 넘어가면 있는 만큼만 준다 — 없는 줄을 지어내지 않는다", () => {
    expect(sliceLines(file, 4, 99)).toBe("l4\nl5");
  });

  it("startLine 이 없으면 자르지 않는다 — 그 경우의 판정은 부르는 쪽이 따로 한다", () => {
    expect(sliceLines(file, null, null)).toBe(file);
  });
});
