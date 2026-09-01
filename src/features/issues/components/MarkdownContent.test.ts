import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownContent } from "@/features/issues/components/MarkdownContent";

describe("MarkdownContent", () => {
 it("기존 한 줄 Knowledge를 heuristic으로 변경하지 않는다", () => {
 const legacy =
 "첫 번째 문장은 증상을 설명하며 충분한 길이를 갖는다. 두 번째 문장은 근본 원인이 왜 생겼는지 설명하며 다음 판단에 필요한 맥락을 제공한다. 세 번째 문장은 실제 실패 경로와 사람이 확인해야 할 결과를 구체적으로 설명한다.";
 const markup = renderToStaticMarkup(
 createElement(MarkdownContent, { content: legacy, emptyLabel: "Empty" }),
 );

 expect(markup).toContain(legacy);
 expect(markup.match(/<p/g)).toHaveLength(1);
 });

 it("저장된 Markdown과 newline을 그대로 렌더러에 전달한다", () => {
 const markdown = "첫 문단\n\n- 검증 A\n- 검증 B\n\n`inline.code()`";
 const markup = renderToStaticMarkup(
 createElement(MarkdownContent, { content: markdown, emptyLabel: "Empty" }),
 );

 expect(markup).toContain("<ul");
 expect(markup).toContain("inline.code()");
 });
});
