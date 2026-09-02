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

describe("DecisionRecord secondary section index", () => {
  it("네 칸이 모두 있으면 고정된 읽기 순서로 01~04 를 붙인다", () => {
    const markup = renderToStaticMarkup(
      createElement(DecisionRecord, { activity, labels }),
    );

    const order = ["01", "02", "03", "04"].map((n) => markup.indexOf(`>${n}<`));
    expect(order.every((position) => position !== -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    expect(markup.indexOf(">01<")).toBeLessThan(
      markup.indexOf("Alternatives considered"),
    );
    expect(markup.indexOf("Alternatives considered")).toBeLessThan(
      markup.indexOf(">02<"),
    );
    expect(markup.indexOf(">02<")).toBeLessThan(markup.indexOf("Trade-off"));
    expect(markup.indexOf("Trade-off")).toBeLessThan(markup.indexOf(">03<"));
    expect(markup.indexOf(">03<")).toBeLessThan(
      markup.indexOf("Regression test"),
    );
    expect(markup.indexOf("Regression test")).toBeLessThan(
      markup.indexOf(">04<"),
    );
    expect(markup.indexOf(">04<")).toBeLessThan(markup.indexOf("Residual risk"));
  });

  it("가운데 field 가 비어도 번호를 건너뛰지 않는다", () => {
    const markup = renderToStaticMarkup(
      createElement(DecisionRecord, {
        activity: { ...activity, regressionTest: null },
        labels,
      }),
    );

    expect(markup).toContain(">01<");
    expect(markup).toContain(">02<");
    expect(markup).toContain(">03<");
    expect(markup).not.toContain(">04<");
    expect(markup).not.toContain("Regression test");
    expect(markup.indexOf(">03<")).toBeLessThan(
      markup.indexOf("Residual risk"),
    );
  });

  it("번호를 aria-hidden 으로 감춰 heading 이 그대로 읽히게 한다", () => {
    const markup = renderToStaticMarkup(
      createElement(DecisionRecord, { activity, labels }),
    );

    expect(markup).toContain('<span aria-hidden="true"');
    expect(markup).toMatch(/<span aria-hidden="true"[^>]*>01<\/span>/);
  });

  it("primary 항목에는 번호를 붙이지 않는다", () => {
    const markup = renderToStaticMarkup(
      createElement(DecisionRecord, {
        activity: {
          ...activity,
          alternativesConsidered: null,
          tradeOff: null,
          regressionTest: null,
          residualRisk: null,
        },
        labels,
      }),
    );

    expect(markup).toContain("Applied solution");
    expect(markup).not.toContain(">01<");
  });
});
