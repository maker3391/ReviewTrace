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
 before: "Before",
 after: "After",
 viewCode: "View on GitHub",
 noSnapshot: "No snapshot",
 displayFormatted: "Display format",
 relativeLines: "relative lines",
 showAllLines: (count: number) => `Show all ${count} lines`,
 verification: {
 UNVERIFIED: "Unverified",
 VERIFIED: "Verified",
 MISMATCH: "Mismatch",
 UNAVAILABLE: "Unavailable",
 },
} as const;

function evidence(
 overrides: Partial<IssueEvidenceEntry> = {},
): IssueEvidenceEntry {
 return {
 id: "evidence-1",
 kind: "AFTER",
 commitSha: "abcdef1234567890",
 filePath: "src/example.tsx",
 startLine: 12,
 endLine: 14,
 snapshot: "export function Example() {\n  return <Button>Save</Button>;\n}",
 verification: "VERIFIED",
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
 displayFormatted: formatted.formatted,
 displayLineStructureChanged: formatted.lineStructureChanged,
 repositoryFullName: "acme/reviewtrace",
 labels,
 }),
 );
 expect(markup).toContain("hljs-");
 expect(markup).toContain("<span>1</span>");
 expect(markup).toContain("<span>7</span>");
 expect(markup).toContain('data-line-number-kind="relative"');
 expect(markup).toContain("Display format · relative lines");
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
 displayFormatted: formatted.formatted,
 displayLineStructureChanged: formatted.lineStructureChanged,
 repositoryFullName: "acme/reviewtrace",
 labels,
 }),
 );

 expect(markup).toContain('data-line-number-kind="source"');
 expect(markup).toContain("<span>103</span>");
 expect(markup).toContain("<span>112</span>");
 expect(markup).toContain("Display format");
 expect(markup).not.toContain("relative lines");
 });

 it.each([
 ["src/example.tsx", "const View = () => <main>OK</main>;"],
 ["src/Service.java", "public final class Service { private int count = 1; }"],
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
 const snapshot = "first line\n  indented <script>alert(1)</script>\nlast line";
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
 const markup = renderToStaticMarkup(
 tree,
 );

 expect(markup).toContain("Before");
 expect(markup).toContain("After");
 expect(markup).toContain("src/example.tsx:12-14");
 expect(markup).toContain("src/example.tsx:20-22");
 expect(markup).toContain("abcdef1");
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
 expect(markup).toContain("bg-primary/[0.08]");
 expect(markup).toContain("−");
 expect(markup).toContain("+");
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
 expect(markup).toContain("bg-primary/[0.08]");
 });

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
