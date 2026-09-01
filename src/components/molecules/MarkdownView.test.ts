import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownView } from "@/components/molecules/MarkdownView";

describe("MarkdownView knowledge content", () => {
  it("paragraph, blank line, bullet list, inline code와 single newline을 보존한다", () => {
    const content = [
      "Root cause first line",
      "continues on the next stored line",
      "",
      "Second paragraph explains the failure path.",
      "",
      "- validate the **recipient**",
      "- compare `account.email` atomically",
    ].join("\n");
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, { content, emptyLabel: "Empty" }),
    );

    expect(markup).toContain(
      "Root cause first line\ncontinues on the next stored line",
    );
    expect(markup).toContain("Second paragraph explains the failure path.");
    expect(markup).toContain("<ul");
    expect(markup).toContain("<strong>recipient</strong>");
    expect(markup).toContain("<code");
    expect(markup).toContain("account.email");
  });

  it("ordered list, fenced code, bold, link를 문서 구조로 렌더링한다", () => {
    const content = [
      "1. Read the **request**.",
      "2. Validate `actor.id`.",
      "",
      "```tsx",
      "const result = verify(actor);",
      "```",
      "",
      "[Review source](https://example.com/review)",
    ].join("\n");
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, { content, emptyLabel: "Empty" }),
    );

    expect(markup).toContain("<ol");
    expect(markup).toContain("<strong>request</strong>");
    expect(markup).toContain("<pre");
    expect(markup).toContain("hljs-");
    expect(markup).toContain('href="https://example.com/review"');
    expect(markup).toContain('rel="noreferrer noopener"');
  });

  it("언어가 없는 fenced code block에서 inline code 장식을 제거한다", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        content: "```\nplain fenced block\n```",
        emptyLabel: "Empty",
      }),
    );

    expect(markup).toContain("<pre");
    expect(markup).toContain("[&amp;_code]:bg-transparent");
    expect(markup).toContain("[&amp;_code]:p-0");
    expect(markup).toContain("plain fenced block");
  });

  it("긴 description과 raw HTML을 안전하게 text로 렌더링한다", () => {
    const longToken = "rotateRefreshTokenFamilyAtomically".repeat(20);
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        content: `${longToken}\n\n<script>alert(1)</script>`,
        emptyLabel: "Empty",
      }),
    );

    expect(markup).toContain("break-words");
    expect(markup).not.toContain("<script>");
  });

  it("raw HTML과 javascript link를 실행 가능한 node로 만들지 않는다", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        content:
          '<img src=x onerror="alert(1)">\n\n[unsafe](javascript:alert(1))',
        emptyLabel: "Empty",
      }),
    );

    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img");
    expect(markup).not.toContain("javascript:alert");
  });
});
