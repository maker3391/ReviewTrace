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

  /**
   * 🔴 **heading 이 본문보다 작아지면 안 된다.**
   *
   * 예전에는 `##` 가 `13px`, `###` 가 `11px` 이었다. 그런데 저장된 데이터는 `###` 만
   * 쓰므로 **모든 구조 신호가 본문(14px)보다 작은 한 칸에 몰렸고**, 문단 속
   * `**bold**`(14px/700) 가 소제목보다 크고 굵어 계층이 뒤집혔다.
   *
   * 이 시험은 그 뒤집힘이 돌아오지 않게 못 박는다 — **크기 class 를 직접 확인한다.**
   */
  it("heading이 본문보다 작아지지 않는다 — 네 층이 각자 다른 칸을 쓴다", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        content: [
          "# 문서 제목",
          "",
          "## 큰 topic",
          "",
          "### 그 아래 세부",
          "",
          "#### 네 번째 층",
          "",
          "본문 문단이다.",
        ].join("\n"),
        emptyLabel: "Empty",
      }),
    );

    // `#` -> h2(16px) · `##` -> h3(15px) · `###` -> h4(14px) · `####` -> h5(12px·대문자)
    expect(markup).toContain("<h2");
    expect(markup).toContain("text-base");
    expect(markup).toContain("<h3");
    expect(markup).toContain("text-[0.9375rem]");
    expect(markup).toContain("<h4");

    // 🔴 `###` 은 본문과 «같은» 14px 이어야 한다 — 더 작아지면 heading 으로 읽히지 않는다.
    expect(markup).not.toContain("text-[11px]");
    expect(markup).not.toContain("text-[13px]");

    // 🔴 `####` override 가 없으면 브라우저 기본 h4 가 나와 계단 밖으로 튄다.
    expect(markup).toContain("<h5");
    expect(markup).toContain("uppercase");

    // 층을 만드는 것은 위 여백이다 — heading 마다 `mt-*` 가 붙는다.
    expect(markup).toContain("first:mt-0");
  });

  it("문서가 heading으로 시작하면 위 여백을 죽이지 않는다", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        content: "### 첫 줄부터 heading\n\n본문.",
        emptyLabel: "Empty",
      }),
    );

    // `first:mt-0` 이 없으면 카드 위쪽에 죽은 자리가 남는다.
    expect(markup).toContain("first:mt-0");
    expect(markup).toContain("첫 줄부터 heading");
  });
});
