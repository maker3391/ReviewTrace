import { describe, expect, it } from "vitest";

import { escapeLikePattern } from "@/features/issues/server/issue-agent-query";

/**
 * 🔴 이 시험이 지키는 것은 **「검색어는 패턴이 아니다」** 이다.
 *
 * 되돌림 확인(2026-08-28): `escapeLikePattern` 을 항등 함수로 되돌리면 아래 세 시험이
 * 실패한다. 직접 확인했다.
 *
 * 이 결함은 실제로 있었다 — `?q=%` 를 보내면 패턴이 `%%%` 가 되어 **Workspace 의 Issue
 * 전체**가 돌아왔다. SQL Injection 은 아니지만(값은 파라미터로 바인딩된다) 보낸 사람이
 * 뜻하지 않은 결과를 받는다. 계약상 `q` 는 「제목·경로·Pattern 을 훑는 낱말」이다.
 */
describe("escapeLikePattern", () => {
  it("🔴 `%` 하나가 전부와 일치하는 패턴이 되지 않는다", () => {
    // 감싸고 난 최종 패턴이 `%\%%` — 가운데 `%` 는 글자 그대로다.
    expect(`%${escapeLikePattern("%")}%`).toBe("%\\%%");
  });

  it("`_` 도 글자 그대로 다룬다 — LIKE 에서 그것은 아무 글자 하나다", () => {
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
  });

  it("백슬래시 자신을 먼저 두 배로 만든다 — 안 그러면 다음 글자를 삼킨다", () => {
    expect(escapeLikePattern("a\\%b")).toBe("a\\\\\\%b");
  });

  it("평범한 낱말은 건드리지 않는다", () => {
    expect(escapeLikePattern("RefreshToken")).toBe("RefreshToken");
    expect(escapeLikePattern("src/OrderService.java")).toBe(
      "src/OrderService.java",
    );
  });
});
