import { describe, expect, it } from "vitest";

import { assignActivityOrdinals } from "@/features/issues/server/issue-activity-ordinal";

/**
 * 순번을 «문장 안에서» 나누는 규칙.
 *
 * 🔴 **한 문장 안에서는 서로의 INSERT 가 보이지 않는다.** 같은 Issue 가 목록에 두 번 있으면
 * 행마다 계산한 「지금 최대값 + 1」이 같은 값이 되어 `23505` 다 — 실제 PostgreSQL 로 그
 * 실패를 재현했다. 그것을 막는 것이 이 함수다.
 *
 * 🔴 **이 시험이 재는 것은 «가상 조건»이다.** 지금 제품 경로에서는 그 반복이 일어나지 않는다 —
 * `review-ingest-service` 가 넘기는 목록은 `prepareIssues` 가 `source + externalId` 로 이미
 * 접어 둔 것이라 Issue 마다 한 번뿐이고, 실제 payload 로 확인했다
 * (`issue-activity-ordinal.integration.test.ts`). 여기서 고정하는 것은 「그 dedup 이
 * 사라졌을 때 이 계산이 조용히 깨지지 않는다」이지 「지금 그렇게 돈다」가 아니다.
 *
 * ## 되돌림 확인
 *
 * `assignActivityOrdinals` 를 「Issue 마다 `next` 를 그대로 준다」로 되돌리면
 * 「같은 Issue 가 두 번 실리면 순번이 갈라진다」와 그 아래 두 건이 **실패한다.**
 */
describe("assignActivityOrdinals — 한 문장 안의 순번", () => {
  it("Activity 가 없던 Issue 는 1 부터 센다", () => {
    expect(assignActivityOrdinals(["a"], new Map())).toEqual([1]);
  });

  it("이미 쌓여 있으면 그 다음부터다", () => {
    expect(assignActivityOrdinals(["a"], new Map([["a", 4]]))).toEqual([4]);
  });

  it("🔴 같은 Issue 가 두 번 실리면 순번이 갈라진다", () => {
    expect(
      assignActivityOrdinals(["a", "a", "a"], new Map([["a", 2]])),
    ).toEqual([2, 3, 4]);
  });

  it("🔴 Issue 마다 «따로» 센다 — 서로의 순번에 끼어들지 않는다", () => {
    const next = new Map([
      ["a", 3],
      ["b", 1],
    ]);
    expect(assignActivityOrdinals(["a", "b", "a", "b"], next)).toEqual([
      3, 1, 4, 2,
    ]);
  });

  it("입력 순서가 곧 순번 순서다", () => {
    const ordinals = assignActivityOrdinals(["x", "x"], new Map([["x", 10]]));
    expect(ordinals[0]).toBeLessThan(ordinals[1] ?? 0);
  });

  it("빈 입력은 빈 결과다", () => {
    expect(assignActivityOrdinals([], new Map())).toEqual([]);
  });
});
