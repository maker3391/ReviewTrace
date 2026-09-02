import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { en } from "@/config/messages/en";
import { ko } from "@/config/messages/ko";
import { MANUAL_ACTIVITY_TYPES } from "@/features/issues/schemas/issue-form";

vi.mock("@/features/issues/actions/issue-actions", () => ({
  addIssueActivityAction: vi.fn(),
}));

const { IssueActivityForm } = await import(
  "@/features/issues/components/IssueActivityForm"
);

const labels = {
  activity: "Activity",
  activityType: "Activity type",
  commit: "Commit",
  commitSha: "Commit SHA",
  optional: "(optional)",
  description: "Details",
  recordActions: {
    COMMENT: "Add comment",
    FIX_ATTEMPTED: "Add fix attempt",
    REVIEWED_AGAIN: "Add re-review",
  },
  typeOptions: {
    DETECTED: "Detected",
    FIX_ATTEMPTED: "Fix attempted",
    REVIEWED_AGAIN: "Reviewed again",
    RESOLVED: "Resolved",
    REOPENED: "Reopened",
    IGNORED: "Ignored",
    COMMENT: "Comment",
  },
} as const;

/**
 * 되돌림 확인(2026-09-02): 실행 버튼을 다시 «한 낱말»로 되돌리면
 * (`labels.recordActions[type]` → 고정 문자열) 아래 첫 시험이 실제로 실패한다.
 * 낱말 사전 셋을 같은 문자열로 되돌리면 두 번째 시험이 실패한다. 직접 돌려 봤다.
 */
describe("IssueActivityForm 의 실행 버튼", () => {
  it("🔴 고른 Activity Type 을 그대로 말한다 — 기본값은 「메모」다", () => {
    const markup = renderToStaticMarkup(
      createElement(IssueActivityForm, {
        workspaceSlug: "workspace",
        projectSlug: "project",
        issueId: "issue-1",
        labels,
      }),
    );

    // 기본 선택이 COMMENT 이므로 버튼도 COMMENT 의 낱말이어야 한다.
    expect(markup).toContain(labels.recordActions.COMMENT);
    // 🔴 다른 Type 의 낱말이 함께 그려지면 무엇이 남는지 다시 모호해진다.
    expect(markup).not.toContain(labels.recordActions.FIX_ATTEMPTED);
    expect(markup).not.toContain(labels.recordActions.REVIEWED_AGAIN);
  });
});

describe("recordActions 낱말 사전", () => {
  it("🔴 고를 수 있는 Type 을 빠짐없이 덮는다", () => {
    for (const locale of [ko.issueDetail, en.issueDetail]) {
      expect(Object.keys(locale.recordActions).sort()).toEqual(
        [...MANUAL_ACTIVITY_TYPES].sort(),
      );
    }
  });

  it("🔴 Type 마다 다른 낱말이다 — 같으면 버튼이 다시 모호해진다", () => {
    for (const locale of [ko.issueDetail, en.issueDetail]) {
      const words = Object.values(locale.recordActions);
      expect(new Set(words).size).toBe(words.length);
    }
  });
});
