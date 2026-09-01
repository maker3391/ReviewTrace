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
});

describe("diffEvidenceLines", () => {
 it("LCS로 삭제·추가 line을 정확히 구분한다", () => {
 const diff = diffEvidenceLines(
 ["function value() {", "  return 'old';", "}"].join("\n"),
 ["function value() {", "  const next = 'new';", "  return next;", "}"].join(
 "\n",
 ),
 );

 expect([...diff!.beforeChanged]).toEqual([1]);
 expect([...diff!.afterChanged]).toEqual([1, 2]);
 });
});

describe("buildEvidencePreview", () => {
 const source = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join(
 "\n",
 );

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
 expect(preview.lines.find((line) => line.sourceIndex === 39)?.changed).toBe(true);
 });

 it("변경 정보를 모르는 긴 기존 Evidence는 앞부분 preview만 제공한다", () => {
 const preview = buildEvidencePreview(source);
 expect(preview.truncated).toBe(true);
 expect(preview.lines[0]?.sourceIndex).toBe(0);
 expect(preview.lines[23]?.sourceIndex).toBe(23);
 expect(preview.lines.at(-1)?.sourceIndex).toBeNull();
 });
});
