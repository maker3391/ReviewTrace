import { readFileSync } from "node:fs";
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

    expect(markup).toContain("bg-diff-deletion");
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
    expect(markup).toContain("bg-diff-deletion");
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
    expect(paired).toContain("bg-diff-deletion text-diff-deletion-foreground");
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
    expect(standalone).not.toContain("bg-diff-deletion text-diff-deletion-foreground");
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

/**
 * 🔴 **삭제와 추가는 «같은 지위»의 두 상태다.**
 *
 * 한때 추가만 전용 토큰(`--diff-addition`)을 갖고 삭제는 `destructive` 를 **8% 알파**로
 * 빌려 썼다. 실측(브라우저 computed style)에서 추가 띠는 불투명한 배경인데 삭제 띠는
 * `alpha 0.08` 이라, 「수정 전 줄이 빨갛게 보이지 않는다」가 됐다.
 *
 * 더 나쁜 것은 **뜻이 섞인 것**이다 — 그 색은 `MISMATCH`(검증 실패)와 같은 토큰이라,
 * 「diff 색은 검증 결과가 아니다」라는 이 화면의 계약이 색에서는 지켜지지 않았다.
 *
 * 🔴 **이 시험은 «색이 예쁜가»를 보지 않는다.** 세 가지만 본다 —
 * ① 삭제가 diff 전용 토큰을 쓰는가 ② 그것이 검증 색과 다른 토큰인가
 * ③ 기계가 읽는 표식(`data-change-kind` · `−`/`+`)이 색과 «함께» 붙는가.
 */
describe("Code Evidence diff semantics", () => {
  const pair = async (before: string, after: string) =>
    renderToStaticMarkup(
      await EvidenceList({
        evidence: [
          evidence({
            id: "d-before",
            kind: "BEFORE",
            filePath: "src/Diff.ts",
            snapshot: before,
          }),
          evidence({
            id: "d-after",
            kind: "AFTER",
            filePath: "src/Diff.ts",
            snapshot: after,
          }),
        ],
        repositoryFullName: "acme/reviewtrace",
        labels,
      }),
    );

  /** 그 줄이 실제로 어떤 표식·색을 받았는지 한 줄씩 읽는다. */
  function gutterRows(markup: string) {
    return [
      ...markup.matchAll(
        /<li class="([^"]*)" data-change-kind="([^"]*)">(.*?)<\/li>/gu,
      ),
    ].map((match) => {
      const cls = match[1] ?? "";
      const body = match[3] ?? "";
      return {
        kind: match[2] ?? "",
        mark: /<span>(.*?)<\/span>/u.exec(body)?.[1] ?? "",
        deletion: cls.includes("bg-diff-deletion"),
        addition: cls.includes("bg-diff-addition"),
      };
    });
  }

  it("🔴 한 줄 수정 — 수정 전은 삭제, 수정 후는 추가로 표시된다", async () => {
    const markup = await pair(
      "const value = oldValue;",
      "const value = newValue;",
    );
    const rows = gutterRows(markup);

    const deletions = rows.filter((r) => r.kind === "deletion");
    const additions = rows.filter((r) => r.kind === "addition");
    expect(deletions).toHaveLength(1);
    expect(additions).toHaveLength(1);

    // 색·표식·의미가 «함께» 붙는다 — 셋 중 하나만 있으면 반쪽이다.
    expect(deletions[0]?.deletion).toBe(true);
    expect(deletions[0]?.addition).toBe(false);
    expect(deletions[0]?.mark).toBe("−");
    expect(additions[0]?.addition).toBe(true);
    expect(additions[0]?.deletion).toBe(false);
    expect(additions[0]?.mark).toBe("+");
  });

  /**
   * 🔴 **색을 내는 자리가 «셋»이다 — 하나만 살아 있어도 markup 전체 검색은 통과한다.**
   *
   * 역할 알약 · 줄번호 gutter · 코드 위의 띠. 어느 하나가 색을 잃으면 화면에서 반쪽만
   * 칠해지는데, `markup.toContain("bg-diff-deletion")` 은 나머지 둘이 공급해 초록이다.
   * 그래서 **각각을 따로 골라** 확인한다.
   */
  it("🔴 알약·gutter·코드 띠 세 자리가 «각각» 삭제 색을 갖는다", async () => {
    const markup = await pair(
      "const value = oldValue;",
      "const value = newValue;",
    );

    // 알약 — 역할(Before fix)을 담은 조각.
    const badge = markup.slice(0, markup.indexOf("Before fix"));
    expect(badge).toContain("bg-diff-deletion text-diff-deletion-foreground");

    // gutter — `data-change-kind="deletion"` 을 단 `<li>` 자신의 class.
    const gutter = /<li class="([^"]*)" data-change-kind="deletion">/u.exec(markup);
    expect(gutter).not.toBeNull();
    expect(gutter?.[1]).toContain("bg-diff-deletion");

    /*
 코드 띠 — `pre` 안에 절대 배치로 깔리는 `span`. 🔴 이것이 없으면 코드 줄 자체는
 색이 없고 왼쪽 번호만 빨개진다.
    */
    const stripes = [
      ...markup.matchAll(
        /<span aria-hidden="true" class="(pointer-events-none absolute[^"]*)"/gu,
      ),
    ].map((match) => match[1] ?? "");
    expect(stripes.some((cls) => cls.includes("bg-diff-deletion"))).toBe(true);
    expect(stripes.some((cls) => cls.includes("bg-diff-addition"))).toBe(true);
  });

  it("🔴 삭제 색이 검증(MISMATCH) 색과 같은 토큰이 아니다", async () => {
    const markup = await pair(
      "const value = oldValue;",
      "const value = newValue;",
    );

    // diff 는 자기 토큰을 쓴다.
    expect(markup).toContain("bg-diff-deletion");
    expect(markup).toContain("bg-diff-addition");
    /*
 🔴 `destructive` 는 이 화면에서 **검증 실패**의 색이다. diff 가 그것을 빌려 쓰면
 「빨간 줄」이 「원본과 다르다」로 읽힌다 — 둘은 애초에 다른 질문에 대한 답이다.
    */
    expect(markup).not.toContain("bg-destructive");
  });

  it("순수 삭제와 순수 추가를 각각 그 방향으로만 표시한다", async () => {
    const removed = gutterRows(await pair("keep();\ngone();", "keep();"));
    expect(removed.filter((r) => r.kind === "deletion")).toHaveLength(1);
    expect(removed.filter((r) => r.kind === "addition")).toHaveLength(0);

    const added = gutterRows(await pair("keep();", "keep();\nfresh();"));
    expect(added.filter((r) => r.kind === "addition")).toHaveLength(1);
    expect(added.filter((r) => r.kind === "deletion")).toHaveLength(0);
  });

  it("여러 줄 수정에서도 바뀌지 않은 줄은 중립으로 남는다", async () => {
    const rows = gutterRows(
      await pair(
        "head();\nconst a = 1;\nconst b = 2;\ntail();",
        "head();\nconst a = 9;\nconst b = 8;\ntail();",
      ),
    );

    expect(rows.filter((r) => r.kind === "deletion")).toHaveLength(2);
    expect(rows.filter((r) => r.kind === "addition")).toHaveLength(2);
    // 🔴 앞뒤 문맥은 색을 얻지 않는다 — 안 바뀐 것을 바뀐 것처럼 그리지 않는다.
    const unchanged = rows.filter((r) => r.kind === "unchanged");
    expect(unchanged.length).toBeGreaterThanOrEqual(4);
    expect(unchanged.every((r) => !r.deletion && !r.addition)).toBe(true);
    expect(unchanged.every((r) => r.mark === "")).toBe(true);
  });

  it("🔴 짝이 없는 근거에는 삭제 색을 만들어 내지 않는다", async () => {
    const markup = renderToStaticMarkup(
      await EvidenceList({
        evidence: [
          evidence({
            id: "lonely",
            kind: "BEFORE",
            filePath: "src/Lonely.ts",
            snapshot: "const value = oldValue;",
          }),
        ],
        repositoryFullName: "acme/reviewtrace",
        labels,
      }),
    );

    expect(markup).not.toContain("bg-diff-deletion");
    expect(markup).not.toContain('data-change-kind="deletion"');
  });

  it("TSX 도 syntax highlighting 과 삭제 색을 함께 갖는다", async () => {
    const markup = renderToStaticMarkup(
      await EvidenceList({
        evidence: [
          evidence({
            id: "tsx-before",
            kind: "BEFORE",
            filePath: "src/Widget.tsx",
            snapshot: "const label = <Button>Old</Button>;",
          }),
          evidence({
            id: "tsx-after",
            kind: "AFTER",
            filePath: "src/Widget.tsx",
            snapshot: "const label = <Button>New</Button>;",
          }),
        ],
        repositoryFullName: "acme/reviewtrace",
        labels,
      }),
    );

    // 🔴 강조 class 가 diff 색을 덮지 않는다 — 둘은 다른 요소에 붙는다.
    expect(markup).toContain("hljs-");
    expect(markup).toContain("bg-diff-deletion");
    expect(markup).toContain('data-change-kind="deletion"');
  });
});

/**
 * 🔴 **class 이름이 맞아도 «그 이름이 가리키는 색»이 되돌아갈 수 있다.**
 *
 * 이 결함의 실제 원인은 삭제가 `destructive` 를 **알파 8%** 로 빌려 쓴 것이었다.
 * component 시험은 class 문자열만 보므로, 토큰 정의가 다시 낮은 알파나 `destructive`
 * alias 로 바뀌어도 전부 초록이다 — 그래서 **정의 자체**를 여기서 붙든다.
 *
 * 🔴 **이것은 「보이는가」를 재지 못한다.** jsdom 은 CSS 변수를 계산하지 않는다 —
 * 실제 대비는 브라우저 computed style 로 잰다(light·dark 양쪽).
 */
describe("diff 색 토큰의 정의", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  it("삭제와 추가가 각각 «자기» 토큰을 갖는다", () => {
    for (const token of [
      "--color-diff-deletion:",
      "--color-diff-deletion-foreground:",
      "--color-diff-addition:",
      "--color-diff-addition-foreground:",
    ]) {
      expect(css, token).toContain(token);
    }
  });

  it("🔴 light·dark 양쪽에 정의되고 알파를 쓰지 않는다", () => {
    const values = [...css.matchAll(/--diff-(deletion|addition)(-foreground)?:\s*([^;]+);/gu)];
    // light 4개 + dark 4개.
    expect(values).toHaveLength(8);

    for (const match of values) {
      const value = (match[3] ?? "").trim();
      // 🔴 `oklch(L C H)` 형태다 — 슬래시가 있으면 알파를 섞은 것이고, 그때 한쪽이 묻힌다.
      expect(value, value).toMatch(/^oklch\(/u);
      expect(value, value).not.toContain("/");
      // 🔴 다른 토큰을 가리키지 않는다 — `destructive` 를 빌려 쓰던 것이 이 결함이었다.
      expect(value, value).not.toContain("var(");
    }
  });

  it("🔴 삭제와 추가의 밝기가 서로 가깝다", () => {
    /** `--diff-<name>: oklch(L …)` 의 L 만 모은다. light·dark 두 개가 나온다. */
    const lightness = (name: string) =>
      css
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith(`--diff-${name}: oklch(`))
        .map((line) => Number(line.split("oklch(")[1]?.split(" ")[0]));

    const deletion = lightness("deletion");
    const addition = lightness("addition");
    expect(deletion).toHaveLength(2);
    expect(addition).toHaveLength(2);

    // 같은 지위의 두 상태다 — 한쪽만 어두우면 그쪽이 먼저 눈에서 사라진다.
    deletion.forEach((value, index) => {
      expect(Math.abs(value - (addition[index] ?? 0))).toBeLessThanOrEqual(0.05);
    });
  });
});
