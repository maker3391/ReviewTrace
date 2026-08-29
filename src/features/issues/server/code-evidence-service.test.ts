import { describe, expect, it } from "vitest";

import { decideVerification } from "@/features/issues/server/code-evidence-service";

/**
 * 🔴 이 시험이 지키는 것은 **「확인하지 못한 것을 확인했다고 적지 않는다」** 와,
 * 그 반대인 **「맞는데 틀렸다고 적지 않는다」** 둘 다이다.
 *
 * 되돌림 확인(2026-08-28): `read.whole` 일 때의 `includes` 를 `===` 로 되돌리면
 * 「줄 범위가 없으면 파일 안에 들어 있는지로 본다」가 실패한다. 직접 확인했다.
 *
 * 이 결함은 실제로 있었다 — 줄 범위 없이 보낸 근거가 파일 전체와 맞대어져
 * **언제나 `MISMATCH`** 로 찍혔다. 화면은 그것을 「Agent 가 거짓말했다」로 그린다.
 */
describe("decideVerification", () => {
  const file = "line1\nline2\nline3\n";

  it("GitHub 에서 못 읽었으면 UNAVAILABLE 이다 — 모르는 것을 안다고 적지 않는다", () => {
    expect(
      decideVerification({ ok: false, reason: "NOT_FOUND" }, "무엇이든"),
    ).toEqual({ verification: "UNAVAILABLE" });
  });

  it("줄 범위가 있으면 그 줄과 같은지로 본다", () => {
    expect(
      decideVerification({ ok: true, text: "line2", whole: false }, "line2"),
    ).toEqual({ verification: "VERIFIED" });

    expect(
      decideVerification({ ok: true, text: "line2", whole: false }, "line9"),
    ).toEqual({ verification: "MISMATCH" });
  });

  it("🔴 줄 범위가 없으면 파일 안에 들어 있는지로 본다", () => {
    expect(decideVerification({ ok: true, text: file, whole: true }, "line2")).toEqual(
      { verification: "VERIFIED" },
    );

    expect(
      decideVerification({ ok: true, text: file, whole: true }, "없는 줄"),
    ).toEqual({ verification: "MISMATCH" });
  });

  it("🔴 줄 범위 없이 코드도 안 보냈으면 파일 전체를 저장하지 않는다", () => {
    const result = decideVerification({ ok: true, text: file, whole: true }, null);

    expect(result.verification).toBe("VERIFIED");
    // 저장 대상은 Review Knowledge 이지 Source Code 사본이 아니다(CLAUDE.md 15).
    expect(result.snapshot).toBeUndefined();
  });

  it("줄 범위가 있는데 코드를 안 보냈으면 GitHub 것으로 채운다", () => {
    expect(
      decideVerification({ ok: true, text: "line2", whole: false }, null),
    ).toEqual({ verification: "VERIFIED", snapshot: "line2" });
  });

  it("줄 끝 공백과 줄바꿈 차이로 다르다고 하지 않는다 — 들여쓰기는 건드리지 않는다", () => {
    expect(
      decideVerification(
        { ok: true, text: "  const a = 1;  \r\n", whole: false },
        "  const a = 1;\n",
      ),
    ).toEqual({ verification: "VERIFIED" });

    // 🔴 들여쓰기는 코드에서 의미다. 다듬어 같다고 하지 않는다.
    expect(
      decideVerification(
        { ok: true, text: "  const a = 1;", whole: false },
        "const a = 1;",
      ),
    ).toEqual({ verification: "MISMATCH" });
  });
});
