import { describe, expect, it } from "vitest";

import { issueActivitySchema } from "@/features/issues/schemas/issue-activity";
import {
  ACTIVITY_TYPE_BY_STATUS,
  issueStatusUpdateSchema,
} from "@/features/issues/schemas/issue-status-update";
import { ISSUE_STATUSES, OPEN_ISSUE_STATUSES } from "@/types/review";

/**
 * 되돌림 확인(2026-08-28): `issueStatusUpdateSchema` 의 마지막 `.refine` 을 떼면
 * 「RESOLVED 는 해결 요약 없이 통과하지 못한다」가 실패한다. 직접 확인했다.
 */
describe("issueStatusUpdateSchema", () => {
  it("resolutionSummary의 Markdown source를 임의로 재작성하지 않는다", () => {
    const narrative =
      "첫 번째 문장은 실제로 적용한 해결책과 바뀐 경계를 다음 리뷰가 이해하도록 충분히 자세하게 설명한다. 두 번째 문장은 확인한 동작과 실행한 검증 절차를 구체적으로 설명한다. 세 번째 문장은 아직 남아 있는 위험과 후속 확인 조건을 구체적으로 설명한다.";
    const result = issueStatusUpdateSchema.parse({
      status: "RESOLVED",
      resolutionSummary: narrative,
    });

    expect(result.resolutionSummary).toBe(narrative);
  });

  it("RESOLVED 는 해결 요약 없이 통과하지 못한다", () => {
    expect(
      issueStatusUpdateSchema.safeParse({ status: "RESOLVED" }).success,
    ).toBe(false);
    expect(
      issueStatusUpdateSchema.safeParse({
        status: "RESOLVED",
        resolutionSummary: "   ",
      }).success,
    ).toBe(false);
  });

  it("RESOLVED 는 해결 요약과 함께 통과한다", () => {
    const result = issueStatusUpdateSchema.safeParse({
      status: "RESOLVED",
      resolutionSummary: "Transaction 밖으로 외부 호출을 옮겼다",
    });

    expect(result.success).toBe(true);
    expect(result.data?.resolutionSummary).toBe(
      "Transaction 밖으로 외부 호출을 옮겼다",
    );
  });

  it("REOPENED 는 요약 없이 통과한다", () => {
    const result = issueStatusUpdateSchema.safeParse({ status: "REOPENED" });

    expect(result.success).toBe(true);
    expect(result.data?.resolutionSummary).toBeNull();
    expect(result.data?.actor).toBeNull();
  });

  it("알 수 없는 상태를 거절한다", () => {
    expect(issueStatusUpdateSchema.safeParse({ status: "DONE" }).success).toBe(
      false,
    );
  });
});

describe("ACTIVITY_TYPE_BY_STATUS", () => {
  it("🔴 모든 상태 전이가 History 를 남긴다", () => {
    for (const status of ISSUE_STATUSES) {
      expect(ACTIVITY_TYPE_BY_STATUS[status]).toBeDefined();
    }
  });

  it("RESOLVED 와 REOPENED 는 스펙 33 의 Activity 를 남긴다", () => {
    expect(ACTIVITY_TYPE_BY_STATUS.RESOLVED).toBe("RESOLVED");
    expect(ACTIVITY_TYPE_BY_STATUS.REOPENED).toBe("REOPENED");
  });

  /**
   * 🔴 **이 Issue 를 지우는 길은 만들지 않았다.** `review_issues` 한 행을 지우면
   * `issue_activities`·`issue_code_evidences`·`issue_tags` 가 `ON DELETE CASCADE` 로
   * 함께 사라진다 — 이 제품이 지키려는 것이 바로 그 History 다(스펙 1·2).
   *
   * 대신 「더 이상 활성으로 보지 않는다」는 **상태 전이** 둘이 맡는다. 그것이 성립하려면
   * 두 가지가 동시에 참이어야 한다 — 목록·Dashboard 의 「열린 Issue」에서 **빠지고**,
   * 무엇을 왜 접었는지가 History 에 **남는다**.
   */
  it("🔴 IGNORED·FALSE_POSITIVE 는 접히면서도 History 를 남긴다", () => {
    for (const status of ["IGNORED", "FALSE_POSITIVE"] as const) {
      // 접힌다 — 「지금 봐야 할 수」에서 빠진다.
      expect(OPEN_ISSUE_STATUSES).not.toContain(status);
      // 남는다 — 삭제와 다른 점이다.
      expect(ACTIVITY_TYPE_BY_STATUS[status]).toBe("IGNORED");
    }
  });
});

describe("issueActivitySchema", () => {
  it("스펙 32 의 Payload 를 그대로 받는다", () => {
    const result = issueActivitySchema.safeParse({
      type: "FIX_ATTEMPTED",
      actor: { type: "AGENT", name: "claude" },
      description: "Moved external API call outside transaction.",
      commitSha: "def1234",
    });

    expect(result.success).toBe(true);
    expect(result.data?.commitSha).toBe("def1234");
  });

  it("행위자 없이 거절한다 — 「누가」 없는 History 는 History 가 아니다", () => {
    expect(
      issueActivitySchema.safeParse({ type: "COMMENT", description: "hi" })
        .success,
    ).toBe(false);
  });

  it("알 수 없는 Activity Type 을 거절한다", () => {
    expect(
      issueActivitySchema.safeParse({
        type: "MERGED",
        actor: { type: "AGENT", name: "claude" },
      }).success,
    ).toBe(false);
  });
});
