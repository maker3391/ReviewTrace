import { describe, expect, it } from "vitest";

import { hasUnstorableText, isStorableText } from "@/lib/validation/db-text";

/**
 * 이 시험이 지키는 것은 하나다 — **PostgreSQL 이 못 받는 문자를 Zod 가 통과시키지 않는다.**
 *
 * 통과시키면 Driver 가 던져 `500 INTERNAL_ERROR` 가 되고, 5xx 를 재시도하도록 만들어진
 * Agent 가 성공할 수 없는 요청을 영원히 다시 보낸다(`db-text.ts`).
 *
 * 🔴 **정상 입력을 막지 않는다는 것이 절반이다.** 한글·이모지·결합 문자·RTL 은 Review
 * Knowledge 에 평범하게 들어오는 값이라, 여기서 걸리면 그것이 곧 장애다.
 */

/** 소스에 리터럴 NUL 을 적지 않는다 — 파일이 binary 로 취급된다. */
const NUL = String.fromCharCode(0);

describe("isStorableText", () => {
  it("PostgreSQL 이 받는 문자는 통과시킨다", () => {
    expect(isStorableText("plain ascii")).toBe(true);
    expect(isStorableText("한글 제목")).toBe(true);
    // 짝 지어진 Surrogate 다. 쪼개서 보면 안 된다.
    expect(isStorableText("emoji \u{1F600}")).toBe(true);
    expect(isStorableText("combining á")).toBe(true);
    // RTL override 는 표시가 이상해질 뿐 저장은 된다 — 저장 계층의 판단은 여기까지다.
    expect(isStorableText("rtl ‮ override")).toBe(true);
    expect(isStorableText("")).toBe(true);
  });

  it("NUL 을 거절한다", () => {
    expect(isStorableText(`a${NUL}b`)).toBe(false);
    expect(isStorableText(NUL)).toBe(false);
  });

  it("짝 없는 Surrogate 를 거절한다", () => {
    expect(isStorableText("lone high \uD800")).toBe(false);
    expect(isStorableText("lone low \uDC00")).toBe(false);
    // 앞뒤가 뒤집힌 짝도 유효한 UTF-8 이 되지 않는다.
    expect(isStorableText("\uDC00\uD800")).toBe(false);
  });
});

describe("hasUnstorableText", () => {
  it("중첩된 Object·배열 안까지 찾아낸다", () => {
    expect(hasUnstorableText({ issues: [{ title: `x${NUL}` }] })).toBe(true);
    expect(hasUnstorableText(["ok", "bad \uD800"])).toBe(true);
  });

  it("Key 도 본다 — rawPayload 로 그대로 저장되는 자리가 있다", () => {
    expect(hasUnstorableText({ [`key${NUL}`]: 1 })).toBe(true);
  });

  it("정상 Payload 는 통과시킨다", () => {
    expect(
      hasUnstorableText({
        summary: "한글 요약 \u{1F600}",
        issues: [{ title: "제목", tags: ["race-condition"], startLine: 1 }],
        nothing: null,
        flag: true,
      }),
    ).toBe(false);
  });

  it("문자열이 아닌 값에 걸려 넘어지지 않는다", () => {
    expect(hasUnstorableText(null)).toBe(false);
    expect(hasUnstorableText(undefined)).toBe(false);
    expect(hasUnstorableText(42)).toBe(false);
  });
});
