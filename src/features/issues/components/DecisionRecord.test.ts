import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DecisionRecord } from "@/features/issues/components/DecisionRecord";
import type { IssueActivityEntry } from "@/features/issues/server/issue-detail-query";

const labels = {
  decision: "Decision record",
  solution: "Applied solution",
  decisionReason: "Decision reason",
  alternatives: "Alternatives considered",
  tradeOff: "Trade-off",
  verification: "Verification",
  regressionTest: "Regression test",
  residualRisk: "Residual risk",
};

const activity: IssueActivityEntry = {
  id: "activity-1",
  type: "RESOLVED",
  actorType: "HUMAN",
  actorName: "Reviewer",
  description: null,
  commitSha: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  solution: "Use a **transaction**.",
  decisionReason: "Keeps status and history atomic.",
  verification: "- unit tests\n- integration tests",
  alternativesConsidered: "Two independent updates.",
  tradeOff: "The transaction holds a lock longer.",
  regressionTest: "Reopen and resolve the same issue.",
  residualRisk: "External verification can still be unavailable.",
  evidence: [],
};

describe("DecisionRecord", () => {
  it("primary와 secondary hierarchy를 유지하면서 Markdown을 렌더링한다", () => {
    const markup = renderToStaticMarkup(
      createElement(DecisionRecord, { activity, labels }),
    );

    expect(markup).toContain('aria-label="Decision record"');
    expect(markup).toContain("<strong>transaction</strong>");
    expect(markup).toContain("<ul");
    expect(markup.indexOf("Applied solution")).toBeLessThan(
      markup.indexOf("Alternatives considered"),
    );
    expect(markup.indexOf("Decision reason")).toBeLessThan(
      markup.indexOf("Trade-off"),
    );
    expect(markup.indexOf("Verification")).toBeLessThan(
      markup.indexOf("Regression test"),
    );
  });
});
