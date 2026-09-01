import { describe, expect, it } from "vitest";

import {
  codeEvidenceSchema,
  optionalDecisionRecordSchema,
} from "@/features/issues/schemas/decision-record";

const base = { kind: "BEFORE" as const, commitSha: "a81f3c2", filePath: "src/a.ts" };

/**
 * 🔴 이 시험이 지키는 것은 **「가리킨 곳과 확인한 곳이 같아야 한다」** 이다.
 *
 * 되돌림 확인: `endLine` 만 보낸 것을 거절하는 `refine` 을 떼면
 * 「startLine 없이 endLine 만 보내는 것을 거절한다」가 실패한다. 직접 확인했다.
 */
describe("codeEvidenceSchema", () => {
  it("commitSha 없이 거절한다 — 없으면 이 코드가 언제의 것인지 알 수 없다", () => {
    expect(codeEvidenceSchema.safeParse({ ...base, commitSha: "" }).success).toBe(
      false,
    );
  });

  it("endLine 이 startLine 보다 작으면 거절한다", () => {
    expect(
      codeEvidenceSchema.safeParse({ ...base, startLine: 10, endLine: 3 }).success,
    ).toBe(false);
  });

  it("🔴 startLine 없이 endLine 만 보내는 것을 거절한다", () => {
    /**
     * 시작 줄이 없으면 확인 쪽은 「줄 범위가 없다」로 읽어 **파일 전체에서 조각을 찾는다.**
     * 즉 `endLine: 10` 을 보내고 100번째 줄의 코드를 snapshot 으로 넣으면 그것이
     * `VERIFIED` 로 찍힌다 — 보낸 사람이 가리킨 곳과 전혀 다른 자리가 확인된다.
     */
    const result = codeEvidenceSchema.safeParse({
      ...base,
      endLine: 10,
      snapshot: "아주 아래쪽 어딘가의 코드",
    });

    expect(result.success).toBe(false);
  });

  it("줄 번호를 아예 안 보내는 것은 정상이다 — 파일만 가리키는 근거도 근거다", () => {
    const result = codeEvidenceSchema.safeParse(base);

    expect(result.success).toBe(true);
    expect(result.data?.startLine).toBeNull();
    expect(result.data?.endLine).toBeNull();
  });
});

describe("optionalDecisionRecordSchema", () => {
  it("Decision Record의 Markdown source를 임의로 재작성하지 않는다", () => {
    const narrative =
      "첫 번째 문장은 적용한 해결책과 변경된 경계를 다음 리뷰가 이해할 수 있도록 충분히 자세하게 설명한다. 두 번째 문장은 이 방법을 선택한 이유와 함께 검토한 대안을 구체적으로 설명한다. 세 번째 문장은 검증 결과와 아직 남아 있는 위험을 구체적으로 설명한다.";
    const result = optionalDecisionRecordSchema.parse({
      solution: narrative,
      decisionReason: narrative,
      alternativesConsidered: narrative,
      tradeOff: narrative,
      verification: narrative,
      regressionTest: narrative,
      residualRisk: narrative,
    });

    for (const value of Object.values(result ?? {})) expect(value).toBe(narrative);
  });

  it("빈 칸 일곱 개는 없는 것과 같다 — 빈 판단을 남기지 않는다", () => {
    expect(optionalDecisionRecordSchema.parse({ solution: "" })).toBeNull();
    expect(optionalDecisionRecordSchema.parse(undefined)).toBeNull();
  });

  it("하나라도 적혔으면 남긴다", () => {
    expect(
      optionalDecisionRecordSchema.parse({ tradeOff: "주문이 잠깐 PENDING 이다" }),
    ).toMatchObject({ tradeOff: "주문이 잠깐 PENDING 이다", solution: null });
  });
});

describe("codeEvidenceSchema — 빈 조각", () => {
  const base = { kind: "BEFORE" as const, commitSha: "a81f3c2", filePath: "src/a.ts" };

  /**
   * 🔴 되돌림 확인(2026-08-28): `snapshot` 의 `v.trim() === ""` 를 `v === ""` 로 되돌리면
   * 아래 시험이 실패한다. 직접 확인했다.
   *
   * 이 결함은 실제로 있었다 — 줄 범위 없이 `snapshot: "   "` 를 보내면 확인 쪽이
   * 「파일 안에 이것이 들어 있는가」를 묻는데, **모든 글자열은 빈 글자열을 품는다.**
   * 즉 아무 코드도 안 보내고 `VERIFIED` 를 받아 낼 수 있었다.
   */
  it("🔴 공백뿐인 snapshot 은 없는 것과 같다", () => {
    expect(codeEvidenceSchema.parse({ ...base, snapshot: "   " }).snapshot).toBeNull();
    expect(codeEvidenceSchema.parse({ ...base, snapshot: "\n\t " }).snapshot).toBeNull();
    expect(codeEvidenceSchema.parse({ ...base, snapshot: "" }).snapshot).toBeNull();
  });

  it("진짜 코드는 그대로 둔다 — 들여쓰기는 의미다", () => {
    expect(codeEvidenceSchema.parse({ ...base, snapshot: "  const a = 1;" }).snapshot).toBe(
      "  const a = 1;",
    );
  });
});
