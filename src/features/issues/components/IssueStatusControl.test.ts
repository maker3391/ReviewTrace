import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/issues/actions/issue-actions", () => ({
 updateIssueStatusAction: vi.fn(),
}));

const { IssueStatusControl } = await import(
 "@/features/issues/components/IssueStatusControl"
);

const labels = {
 status: "Status",
 changeStatus: "Change status",
 changing: "Saving",
 resolutionSummary: "Resolution summary",
 editResolutionSummary: "Edit summary",
 cancelResolutionSummary: "Cancel editing",
 saveResolutionSummary: "Save summary",
 emptyResolutionSummary: "No resolution summary.",
 statusOptions: {
 OPEN: "Open",
 IN_PROGRESS: "In progress",
 RESOLVED: "Resolved",
 IGNORED: "Ignored",
 FALSE_POSITIVE: "False positive",
 REOPENED: "Reopened",
 },
} as const;

describe("IssueStatusControl resolution summary", () => {
 it("조회 상태에서는 Markdown view를 그리고 textarea를 만들지 않는다", () => {
 const markup = renderToStaticMarkup(
 createElement(IssueStatusControl, {
 workspaceSlug: "workspace",
 projectSlug: "project",
 issueId: "issue-1",
 currentStatus: "RESOLVED",
 currentResolutionSummary:
 "The fix keeps the write atomic.\n\n- verifies rollback\n- records `history`",
 labels,
 }),
 );

 expect(markup).toContain("Edit summary");
 expect(markup).toContain("<ul");
 expect(markup).toContain("<code");
 expect(markup).not.toContain("<textarea");
 });
});
