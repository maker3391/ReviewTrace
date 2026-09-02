import { describe, expect, it } from "vitest";

import {
  buildEvidencePreview,
  diffEvidenceLines,
  pairEvidenceByFile,
} from "@/features/issues/components/code-evidence-diff";

describe("pairEvidenceByFile", () => {
  it("같은 목록과 정확히 같은 filePath의 BEFORE/AFTER만 1:1로 묶는다", () => {
    expect(
      pairEvidenceByFile([
        { kind: "BEFORE", filePath: "src/a.ts" },
        { kind: "BEFORE", filePath: "src/only-before.ts" },
        { kind: "AFTER", filePath: "src/a.ts" },
        { kind: "AFTER", filePath: "other/a.ts" },
      ]),
    ).toEqual([
      { type: "pair", beforeIndex: 0, afterIndex: 2 },
      { type: "single", index: 1 },
      { type: "single", index: 3 },
    ]);
  });

  /**
   * 🔴 **목록 안의 순서가 diff 표시 여부를 정하면 안 된다.**
   *
   * 화면 목록은 `(createdAt, id)` 로 정렬되는데 한 Transaction 에서 들어온 근거들은
   * `createdAt` 이 전부 같다 — 그래서 실제로 **무작위 UUID 가 순서를 정했고**, 같은
   * Activity 의 같은 파일인데도 어떤 Activity 에는 red/green 이 나오고 어떤 Activity 에는
   * 나오지 않았다. 실제 화면에서 그렇게 보였다.
   */
  it("🔴 AFTER 가 BEFORE 보다 앞서 있어도 같은 파일이면 짝을 짓는다", () => {
    expect(
      pairEvidenceByFile([
        { kind: "AFTER", filePath: "src/a.ts" },
        { kind: "BEFORE", filePath: "src/a.ts" },
      ]),
    ).toEqual([{ type: "pair", beforeIndex: 1, afterIndex: 0 }]);
  });

  it("짝은 둘 중 먼저 나오는 자리에 선다 — 화면 순서를 흔들지 않는다", () => {
    expect(
      pairEvidenceByFile([
        { kind: "AFTER", filePath: "src/a.ts" },
        { kind: "BEFORE", filePath: "src/only-before.ts" },
        { kind: "BEFORE", filePath: "src/a.ts" },
      ]),
    ).toEqual([
      { type: "pair", beforeIndex: 2, afterIndex: 0 },
      { type: "single", index: 1 },
    ]);
  });

  it("짝이 없는 AFTER 는 그대로 홀로 남는다 — 없는 비교를 만들지 않는다", () => {
    expect(
      pairEvidenceByFile([
        { kind: "AFTER", filePath: "src/a.ts" },
        { kind: "BEFORE", filePath: "src/b.ts" },
      ]),
    ).toEqual([
      { type: "single", index: 0 },
      { type: "single", index: 1 },
    ]);
  });
});

describe("diffEvidenceLines", () => {
  it("LCS로 삭제·추가 line을 정확히 구분한다", () => {
    const diff = diffEvidenceLines(
      ["function value() {", "  return 'old';", "}"].join("\n"),
      [
        "function value() {",
        "  const next = 'new';",
        "  return next;",
        "}",
      ].join("\n"),
    );

    expect([...diff!.beforeChanged]).toEqual([1]);
    expect([...diff!.afterChanged]).toEqual([1, 2]);
  });
});

describe("buildEvidencePreview", () => {
  const source = Array.from(
    { length: 80 },
    (_, index) => `line ${index + 1}`,
  ).join("\n");

  it("긴 paired Evidence는 changed line 주변 context만 먼저 보인다", () => {
    const preview = buildEvidencePreview(source, new Set([39]), 2);
    expect(preview.truncated).toBe(true);
    expect(preview.lines.map((line) => line.sourceIndex)).toEqual([
      null,
      37,
      38,
      39,
      40,
      41,
      null,
    ]);
    expect(preview.lines.find((line) => line.sourceIndex === 39)?.changed).toBe(
      true,
    );
  });

  it("변경 정보를 모르는 긴 기존 Evidence는 앞부분 preview만 제공한다", () => {
    const preview = buildEvidencePreview(source);
    expect(preview.truncated).toBe(true);
    expect(preview.lines[0]?.sourceIndex).toBe(0);
    expect(preview.lines[23]?.sourceIndex).toBe(23);
    expect(preview.lines.at(-1)?.sourceIndex).toBeNull();
  });
});
