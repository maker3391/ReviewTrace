import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CodeEvidenceBlock,
  EvidenceList,
  detectEvidenceLanguage,
  formatEvidenceSnapshot,
} from "@/features/issues/components/CodeEvidence";
import type { IssueEvidenceEntry } from "@/features/issues/server/issue-detail-query";

const labels = {
  before: "Before fix",
  after: "After fix",
  viewCode: "View on GitHub",
  noSnapshot: "No snapshot",
  deletedLines: "Deleted lines",
  addedLines: "Added lines",
  checkedAt: "Checked",
  showAllLines: (count: number) => `Show all ${count} lines`,
  verification: {
    UNVERIFIED: "Commit source not checked",
    VERIFIED: "Matches commit source",
    MISMATCH: "Differs from commit source",
    UNAVAILABLE: "Commit source unavailable",
  },
  verificationHint: {
    UNVERIFIED: "Not compared with the commit source yet.",
    VERIFIED: "Matched the commit source.",
    MISMATCH: "Differed from the commit source.",
    UNAVAILABLE: "The commit source could not be read.",
  },
  workingTree: "Not committed yet",
  workingTreeHint: "No commit source to compare against.",
  viewBaseCommit: "View base commit",
} as const;

function evidence(
  overrides: Partial<IssueEvidenceEntry> = {},
): IssueEvidenceEntry {
  return {
    id: "evidence-1",
    kind: "AFTER",
    commitSha: "abcdef1234567890",
    sourceState: "COMMITTED",
    filePath: "src/example.tsx",
    startLine: 12,
    endLine: 14,
    snapshot: "export function Example() {\n  return <Button>Save</Button>;\n}",
    verification: "VERIFIED",
    verifiedAt: new Date("2026-09-01T10:23:41.000Z"),
    ...overrides,
  };
}

describe("Code Evidence language detection", () => {
  it.each([
    ["file.ts", "TS"],
    ["file.TSX", "TSX"],
    ["file.js", "JS"],
    ["file.jsx", "JSX"],
    ["Service.java", "Java"],
    ["query.sql", "SQL"],
    ["data.json", "JSON"],
    ["config.yaml", "YAML"],
    ["config.yml", "YAML"],
    ["script.bash", "Shell"],
    ["script.sh", "Shell"],
    ["styles.css", "CSS"],
    ["index.html", "HTML"],
    ["README.md", "Markdown"],
  ])("%s -> %s", (filePath, language) => {
    expect(detectEvidenceLanguage(filePath)?.label).toBe(language);
  });

  it.each(["README.unknown", "Dockerfile"])(
    "%s는 모르는 언어로 추측하지 않는다",
    (filePath) => {
      expect(detectEvidenceLanguage(filePath)).toBeNull();
    },
  );
});

describe("CodeEvidenceBlock", () => {
  it("깨진 TSX snapshot을 Prettier로 display formatting하고 원본은 바꾸지 않는다", async () => {
    const snapshot =
      'const Test=()=>{const value={foo:"bar",count:1};return <div>{value.foo}</div>}';
    const formatted = await formatEvidenceSnapshot(snapshot, "src/Test.tsx");

    expect(formatted).toEqual({
      formatted: true,
      lineStructureChanged: true,
      code: [
        "const Test = () => {",
        "  const value = {",
        '    foo: "bar",',
        "    count: 1,",
        "  };",
        "  return <div>{value.foo}</div>;",
        "};",
      ].join("\n"),
    });
    expect(snapshot).toBe(
      'const Test=()=>{const value={foo:"bar",count:1};return <div>{value.foo}</div>}',
    );

    const markup = renderToStaticMarkup(
      createElement(CodeEvidenceBlock, {
        evidence: evidence({ filePath: "src/Test.tsx", snapshot }),
        displaySnapshot: formatted.code,
        displayLineStructureChanged: formatted.lineStructureChanged,
        repositoryFullName: "acme/reviewtrace",
        labels,
      }),
    );
    expect(markup).toContain("hljs-");
    expect(markup).toContain("<span>1</span>");
    expect(markup).toContain("<span>7</span>");
    expect(markup).toContain('data-line-number-kind="relative"');
    expect(markup).not.toContain("Display format");
    expect(markup).not.toContain("relative lines");
    expect(markup).toContain("src/Test.tsx:12-14");
    expect(markup).not.toContain("<span>15</span>");
    expect(markup).toContain("\n  <span");
  });

  it("지원하지 않는 formatter 언어와 parse할 수 없는 조각은 원문으로 fallback한다", async () => {
    await expect(
      formatEvidenceSnapshot("public class Test{int value=1;}", "Test.java"),
    ).resolves.toEqual({
      code: "public class Test{int value=1;}",
      formatted: false,
      lineStructureChanged: false,
    });
    await expect(
      formatEvidenceSnapshot("return <div>;", "partial.tsx"),
    ).resolves.toEqual({
      code: "return <div>;",
      formatted: false,
      lineStructureChanged: false,
    });
  });

  it("formatting 후에도 10줄이면 실제 source line number를 유지한다", async () => {
    const snapshot = [
      "const value = { foo: 'bar' };",
      "",
      "function read() {",
      "  const result = value.foo;",
      "  if (result) {",
      "    return result;",
      "  }",
      "  return 'none';",
      "}",
      "export { read };",
    ].join("\n");
    const formatted = await formatEvidenceSnapshot(snapshot, "src/read.ts");

    expect(formatted.formatted).toBe(true);
    expect(formatted.lineStructureChanged).toBe(false);
    expect(formatted.code.split("\n")).toHaveLength(10);

    const markup = renderToStaticMarkup(
      createElement(CodeEvidenceBlock, {
        evidence: evidence({
          filePath: "src/read.ts",
          startLine: 103,
          endLine: 112,
          snapshot,
        }),
        displaySnapshot: formatted.code,
        displayLineStructureChanged: formatted.lineStructureChanged,
        repositoryFullName: "acme/reviewtrace",
        labels,
      }),
    );

    expect(markup).toContain('data-line-number-kind="source"');
    expect(markup).toContain("<span>103</span>");
    expect(markup).toContain("<span>112</span>");
    expect(markup).not.toContain("Display format");
    expect(markup).not.toContain("relative lines");
  });

  it.each([
    ["src/example.tsx", "const View = () => <main>OK</main>;"],
    [
      "src/Service.java",
      "public final class Service { private int count = 1; }",
    ],
    ["db/query.sql", "SELECT id FROM review_issue WHERE status = 'OPEN';"],
  ])("%s snapshot을 syntax highlight한다", (filePath, snapshot) => {
    const markup = renderToStaticMarkup(
      createElement(CodeEvidenceBlock, {
        evidence: evidence({ filePath, snapshot }),
        repositoryFullName: "acme/reviewtrace",
        labels,
      }),
    );

    expect(markup).toContain("hljs-");
  });

  it("unknown extension은 원문 whitespace를 보존하고 안전한 plain text로 fallback한다", () => {
    const snapshot =
      "first line\n  indented <script>alert(1)</script>\nlast line";
    const markup = renderToStaticMarkup(
      createElement(CodeEvidenceBlock, {
        evidence: evidence({
          filePath: "fixtures/evidence.unknown",
          snapshot,
          startLine: null,
          endLine: null,
        }),
        repositoryFullName: "acme/reviewtrace",
        labels,
      }),
    );

    expect(markup).not.toContain('<span class="hljs-');
    expect(markup).toContain("first line\n  indented");
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
  });

  it("line range와 BEFORE/AFTER metadata, commit, GitHub link를 유지한다", async () => {
    const tree = await EvidenceList({
      evidence: [
        evidence({ id: "before", kind: "BEFORE" }),
        evidence({ id: "after", kind: "AFTER", startLine: 20, endLine: 22 }),
      ],
      repositoryFullName: "acme/reviewtrace",
      labels,
    });
    const markup = renderToStaticMarkup(tree);

    expect(markup).toContain("Before");
    expect(markup).toContain("After");
    expect(markup).toContain("src/example.tsx:12-14");
    expect(markup).toContain("src/example.tsx:20-22");
    expect(markup).toContain("abcdef1");
    /**
     * 🔴 **화면 문자열에는 시간대 이름을 붙이지 않는다.** 사람은 자기 시계와 같은 값을
     * 볼 뿐이라 `UTC` 는 알려 주는 것이 없다. SSR 은 보는 사람의 시간대를 모르므로
     * UTC 로 «그리기만» 하고, 브라우저가 hydration 뒤 지역 시각으로 바꾼다(`Timestamp`).
     * 기계가 읽는 정확한 instant 는 `dateTime` 속성에 그대로 남는다.
     */
    expect(markup).toContain("2026-09-01 10:23:41");
    expect(markup).not.toContain("10:23:41 UTC");
    expect(markup).toContain('dateTime="2026-09-01T10:23:41');
    expect(markup).toContain("#L20-L22");
    expect(markup).toContain("TSX");
    expect(markup).toContain("<span>12</span>");
    expect(markup).toContain("<span>14</span>");
    expect(markup).toContain("<span>20</span>");
    expect(markup).toContain("<span>22</span>");
  });

  it("같은 filePath의 BEFORE/AFTER changed line을 삭제·추가로 강조한다", async () => {
    const before = [
      "export function label() {",
      '  const value = "old";',
      "  return value;",
      "}",
    ].join("\n");
    const after = [
      "export function label() {",
      '  const value = "new";',
      "  return value;",
      "}",
    ].join("\n");
    const tree = await EvidenceList({
      evidence: [
        evidence({ id: "before-diff", kind: "BEFORE", snapshot: before }),
        evidence({ id: "after-diff", kind: "AFTER", snapshot: after }),
      ],
      repositoryFullName: "acme/reviewtrace",
      labels,
    });
    const markup = renderToStaticMarkup(tree);

    expect(markup).toContain("bg-destructive/[0.08]");
    expect(markup).toContain("bg-diff-addition");
    expect(markup).toContain("−");
    expect(markup).toContain("+");
    expect(markup).toContain('data-change-kind="deletion"');
    expect(markup).toContain('data-change-kind="addition"');
    expect(markup).toContain('data-change-kind="unchanged"');
    expect(markup).toContain("Deleted lines");
    expect(markup).toContain("Added lines");
  });

  it("formatted BEFORE/AFTER diff는 상대 줄만 표시하고 source line을 합성하지 않는다", async () => {
    const tree = await EvidenceList({
      evidence: [
        evidence({
          id: "formatted-before",
          kind: "BEFORE",
          filePath: "src/FormattedDiff.tsx",
          startLine: 103,
          endLine: 103,
          snapshot:
            'const View=()=>{const value={status:"before",count:1};return <div>{value.status}</div>}',
        }),
        evidence({
          id: "formatted-after",
          kind: "AFTER",
          filePath: "src/FormattedDiff.tsx",
          startLine: 103,
          endLine: 103,
          snapshot:
            'const View=()=>{const value={status:"after",count:2};return <strong>{value.status}</strong>}',
        }),
      ],
      repositoryFullName: "acme/reviewtrace",
      labels,
    });
    const markup = renderToStaticMarkup(tree);

    expect(markup.match(/data-line-number-kind="relative"/gu)).toHaveLength(2);
    expect(markup).toContain("src/FormattedDiff.tsx:103");
    expect(markup).toContain("#L103");
    expect(markup).not.toContain("<span>104</span>");
    expect(markup).toContain("bg-destructive/[0.08]");
    expect(markup).toContain("bg-diff-addition");
  });

  it("MISMATCH verification과 green addition diff를 독립적으로 표시한다", async () => {
    const tree = await EvidenceList({
      evidence: [
        evidence({ id: "before-mismatch", kind: "BEFORE", snapshot: "old" }),
        evidence({
          id: "after-mismatch",
          kind: "AFTER",
          snapshot: "new",
          verification: "MISMATCH",
        }),
      ],
      repositoryFullName: "acme/reviewtrace",
      labels,
    });
    const markup = renderToStaticMarkup(tree);

    expect(markup).toContain("Differs from commit source");
    expect(markup).toContain("bg-diff-addition");
    expect(markup).toContain('data-change-kind="addition"');
  });

  it("검증 결과는 commit SHA 옆의 낱말이고 역할 알약과 다른 자리·다른 모양이다", () => {
    const markup = renderToStaticMarkup(
      createElement(CodeEvidenceBlock, {
        evidence: evidence({ verification: "MISMATCH" }),
        repositoryFullName: "acme/reviewtrace",
        labels,
      }),
    );

    // 🔴 옛 모양 — 역할 알약과 나란히 선 «두 번째 알약» 은 없어야 한다.
    expect(markup).not.toContain(
      'class="rounded-full border px-2 py-0.5 text-[10px] font-medium',
    );
    expect(markup).toContain('data-verification="MISMATCH"');
    // 검증 낱말이 commit SHA 뒤에 온다 — 무엇과 맞대 본 것인지가 자리로 드러난다.
    expect(markup.indexOf("abcdef1")).toBeLessThan(
      markup.indexOf("Differs from commit source"),
    );
    expect(markup).toContain("After fix");
  });

  it.each([
    ["VERIFIED", "Matches commit source", "Matched the commit source."],
    [
      "MISMATCH",
      "Differs from commit source",
      "Differed from the commit source.",
    ],
    [
      "UNVERIFIED",
      "Commit source not checked",
      "Not compared with the commit source yet.",
    ],
    [
      "UNAVAILABLE",
      "Commit source unavailable",
      "The commit source could not be read.",
    ],
  ] as const)(
    "%s 는 커밋 원본을 주어로 말하고 설명은 title 로만 붙는다",
    (verification, word, hint) => {
      const markup = renderToStaticMarkup(
        createElement(CodeEvidenceBlock, {
          evidence: evidence({ verification }),
          repositoryFullName: "acme/reviewtrace",
          labels,
        }),
      );

      expect(markup).toContain(word);
      // 🔴 설명은 상시 노출이 아니다 — `title` 속성 안에만 있고 본문 text 로 나오지 않는다.
      expect(markup).toContain(`title="${hint}"`);
      expect(markup).not.toContain(`>${hint}`);
    },
  );

  it("짝이 있으면 알약이 −/+ 와 diff 색을 얻고, 짝이 없으면 둘 다 없다", async () => {
    const paired = renderToStaticMarkup(
      await EvidenceList({
        evidence: [
          evidence({ id: "p-before", kind: "BEFORE", snapshot: "old" }),
          evidence({ id: "p-after", kind: "AFTER", snapshot: "new" }),
        ],
        repositoryFullName: "acme/reviewtrace",
        labels,
      }),
    );
    // 알약 자체가 −/+ 를 갖는다 — 색이 아니라 글자가 뜻을 나른다.
    expect(paired).toContain(
      '<span aria-hidden="true" class="font-mono">−</span>Before fix',
    );
    expect(paired).toContain(
      '<span aria-hidden="true" class="font-mono">+</span>After fix',
    );
    expect(paired).toContain("bg-destructive/10 text-destructive");
    expect(paired).toContain("bg-diff-addition text-diff-addition-foreground");

    const standalone = renderToStaticMarkup(
      await EvidenceList({
        evidence: [
          evidence({
            id: "s-before",
            kind: "BEFORE",
            filePath: "src/only-before.ts",
            snapshot: "old",
          }),
        ],
        repositoryFullName: "acme/reviewtrace",
        labels,
      }),
    );
    // 🔴 없는 비교 결과를 만들어 내지 않는다.
    expect(standalone).toContain("Before fix");
    expect(standalone).not.toContain('class="font-mono">−');
    expect(standalone).not.toContain("bg-destructive/10 text-destructive");
    expect(standalone).not.toContain('data-change-kind="deletion"');
    expect(standalone).toContain("bg-primary/10 text-primary");
  });

  /*
 🔴 아래 두 시험은 **두 축이 섞이지 않는지**를 본다.
 - 역할·변경 비교: 「수정 전/수정 후」 알약 · −/+ · diff 색
 - 원본 검증: commit SHA 옆의 낱말 · 점

 초록이 `VERIFIED` 로, 빨강이 `MISMATCH` 로 읽히면 이 시험들이 빨개져야 한다.
 */

  it("긴 기존 Evidence는 preview와 native 전체 보기를 제공한다", () => {
    const snapshot = Array.from(
      { length: 80 },
      (_, index) => `const value${index + 1} = ${index + 1};`,
    ).join("\n");
    const markup = renderToStaticMarkup(
      createElement(CodeEvidenceBlock, {
        evidence: evidence({ filePath: "fixture.unknown", snapshot }),
        repositoryFullName: "acme/reviewtrace",
        labels,
      }),
    );

    expect(markup).toContain("<details");
    expect(markup).toContain("Show all 80 lines");
    expect(markup).toContain("value1");
    expect(markup).toContain("value80");
  });
});
