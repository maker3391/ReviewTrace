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
  it("DOM 이 없는 곳에서도 불러올 수 있다", async () => {
    expect(globalThis.document).toBeUndefined();

    const loaded = await import("@/components/molecules/MarkdownEditor");

    expect(typeof loaded.MarkdownEditor).toBe("function");
  });
});
