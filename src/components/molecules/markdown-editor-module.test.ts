import { describe, expect, it } from "vitest";

/**
 * 🔴 **Editor Library 를 들였다고 서버 렌더가 깨지지 않는다.**
 *
 * `MarkdownEditor` 는 `"use client"` 지만 첫 응답은 **서버에서** 그려진다. 브라우저 전용
 * Library 가 모듈을 불러오는 것만으로 `document` 를 만지면 그 순간 화면이 500 이 된다 —
 * 그것도 로그인해야 닿는 화면이라 늦게 발견된다.
 *
 * 이 시험이 지키는 것은 하나뿐이다: **DOM 이 없는 곳에서 모듈이 열린다.**
 * (vitest 의 환경은 `node` 다 — `document` 가 아예 없다.)
 */
describe("MarkdownEditor 모듈", () => {
  /**
   * 🔴 **timeout 을 이 시험에만 늘린 이유** — 여기서 재는 것은 «속도»가 아니라 «DOM 없이 열리는가»다.
   *
   * 이 한 줄의 `import` 가 CodeMirror 여섯 패키지와 그 의존을 처음으로 컴파일한다. 혼자 돌면
   * 2초 안팎이지만 다른 시험·dev 서버·build 와 CPU 를 나눠 쓰면 7초를 넘는다 — 실제로 그렇게
   * 여러 번 빨개졌고, 그때마다 «제품이 아니라 그날의 부하»가 원인이었다.
   *
   * 🔴 **전역 `testTimeout` 을 올리지 않았다.** 그러면 진짜로 느려진 다른 시험까지 함께 가려진다.
   * 늦는 이유가 분명한 이 한 건에만 여유를 준다.
   */
  it("DOM 이 없는 곳에서도 불러올 수 있다", { timeout: 30_000 }, async () => {
    expect(globalThis.document).toBeUndefined();

    const loaded = await import("@/components/molecules/MarkdownEditor");

    expect(typeof loaded.MarkdownEditor).toBe("function");
  });
});
