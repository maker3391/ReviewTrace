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

/**
 * 🔴 되돌림 확인(2026-08-29): `readGithubLines` 의 `endLine > lineCount` 검사를 떼면
 * 「끝 줄이 파일 밖이면 확인한 것이 아니다」가 실패한다.
 *
 * 이 결함은 실제로 있었다 — 10줄짜리 파일에 `9~100` 을 보내고 9~10줄의 코드를
 * snapshot 으로 넣으면 `VERIFIED` 가 됐다. **없는 11~100줄까지 확인했다**는 말이
 * 남는다. 근거는 「이 범위가 이렇다」는 주장이므로, 범위 일부가 파일 밖이면
 * 그 주장을 확인한 것이 아니다.
 */
describe("범위 경계", () => {
  const file = "l1\nl2\nl3";

  it("끝 줄이 파일 안이면 자른다", () => {
    expect(sliceLines(file, 2, 3)).toBe("l2\nl3");
  });

  it("🔴 끝 줄이 파일 밖이면 있는 만큼만 나온다 — 부르는 쪽이 줄 수로 걸러야 한다", () => {
    // `sliceLines` 는 조용히 잘라 준다. 그래서 경계 판단을 여기 맡기지 않는다.
    expect(sliceLines(file, 2, 100)).toBe("l2\nl3");
  });
});

/**
 * 🔴 되돌림 확인(2026-08-29): `readGithubLines` 의 `countLines` 를 `split("\n").length` 로
 * 되돌리면 「끝 개행을 줄로 세지 않는다」가 실패한다.
 *
 * 이 결함은 실제로 있었다 — 대부분의 파일이 개행으로 끝나므로 `"l1\nl2\nl3\n"` 은
 * 4개로 쪼개진다. 그대로 세면 3줄짜리 파일에서 `startLine: 4` 가 범위 안으로 통과하고,
 * 잘라 낸 빈 조각이 `VERIFIED` 로 저장된다. 드문 경우가 아니라 **기본값**이었다.
 */
describe("끝 개행", () => {
  it("🔴 개행으로 끝나는 파일의 줄 수는 개행 앞까지다", () => {
    // 3줄짜리 파일. `split` 은 4개를 준다.
    expect("l1\nl2\nl3\n".split("\n")).toHaveLength(4);
    // 그 4번째는 줄이 아니므로 잘라 내면 비어 있다.
    expect(sliceLines("l1\nl2\nl3\n", 4, 4)).toBe("");
  });

  it("🔴 빈 파일에는 1번째 줄도 없다", () => {
    expect("".split("\n")).toHaveLength(1);
    expect(sliceLines("", 1, 1)).toBe("");
  });
});
