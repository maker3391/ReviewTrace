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
      createElement(MarkdownView, { content, emptyLabel: "Empty", baseHeadingLevel: 1 }),
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
      createElement(MarkdownView, { content, emptyLabel: "Empty", baseHeadingLevel: 1 }),
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
        baseHeadingLevel: 1,
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
        baseHeadingLevel: 1,
      }),
    );

    expect(markup).toContain("break-words");
  });

  it("raw HTML과 javascript link를 실행 가능한 node로 만들지 않는다", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        content:
          '<img src=x onerror="alert(1)">\n\n[unsafe](javascript:alert(1))',
        emptyLabel: "Empty",
        baseHeadingLevel: 1,
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
        baseHeadingLevel: 1,
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

    // 층을 만드는 것은 위 여백이다 — heading 마다  가 붙는다.
    expect(markup).toContain("first:mt-0");
  });

  it("문서가 heading으로 시작하면 위 여백을 죽이지 않는다", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        content: "### 첫 줄부터 heading\n\n본문.",
        emptyLabel: "Empty",
        baseHeadingLevel: 1,
      }),
    );

    // 첫 요소의 위 여백을 죽이지 않으면 카드 위쪽에 죽은 자리가 남는다.
    expect(markup).toContain("first:mt-0");
    expect(markup).toContain("첫 줄부터 heading");
  });

  it("heading이 단계를 건너뛰어도 DOM heading level은 이어진다", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        content: "## 큰 topic\n\n본문.\n\n#### 건너뛴 층\n\n본문.",
        emptyLabel: "Empty",
        baseHeadingLevel: 1,
      }),
    );

    expect(markup).toContain("<h3");
    // 🔴 `<h5>` 가 나오면 h3 -> h5 로 한 층을 건너뛴 것이다.
    expect(markup).not.toContain("<h5");
    expect(markup).toContain("<h4");
    expect(markup).toContain("건너뛴 층");
  });

  it("단계를 건너뛰지 않는 문서는 그대로 그린다", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        content: "## 큰 topic\n\n### 세부\n\n#### 더 세부\n\n본문.",
        emptyLabel: "Empty",
        baseHeadingLevel: 1,
      }),
    );

    expect(markup).toContain("<h3");
    expect(markup).toContain("<h4");
    expect(markup).toContain("<h5");
  });

  /**
   * 🔴 **같은 문서가 두 자리에 놓인다.**
   *
   * Wiki 상세는 페이지 제목 `<h1>` 바로 아래이고, Issue·Review 상세는 `Section`
   * 제목 `<h2>` 안이다. 고정 대응이면 뒤쪽에서 문서의 첫 heading 이 자기를 담은
   * section 제목과 **같은 단계**가 된다 — 화면에는 층이 보이는데 낭독기에는 형제다.
   */
  it("baseHeadingLevel을 주면 그 아래에서 heading이 시작한다", () => {
    const content = "# 문서 제목\n\n본문.\n\n## 세부\n\n본문.";

    const page = renderToStaticMarkup(
      createElement(MarkdownView, { content, emptyLabel: "Empty", baseHeadingLevel: 1 }),
    );
    const section = renderToStaticMarkup(
      createElement(MarkdownView, {
        content,
        emptyLabel: "Empty",
        baseHeadingLevel: 2,
      }),
    );

    // 페이지 바로 아래(기본값)는 지금까지와 같다.
    expect(page).toContain("<h2");
    expect(page).toContain("<h3");
    // 🔴 `Section` 안에서 `<h2>` 가 나오면 section 제목과 형제가 된다.
    expect(section).not.toContain("<h2");
    expect(section).toContain("<h3");
    expect(section).toContain("<h4");
  });

  /**
   * 🔴 **생김새는 Markdown 깊이가, 단계는 놓인 자리가 정한다.** 같은 `#` 은 어디에
   * 놓이든 같은 크기여야 한다 — 문서 안의 층 간격은 그 문서의 것이다.
   */
  it("baseHeadingLevel이 달라도 같은 깊이의 서식은 같다", () => {
    const content = "# 문서 제목";
    const page = renderToStaticMarkup(
      createElement(MarkdownView, { content, emptyLabel: "Empty", baseHeadingLevel: 1 }),
    );
    const section = renderToStaticMarkup(
      createElement(MarkdownView, {
        content,
        emptyLabel: "Empty",
        baseHeadingLevel: 2,
      }),
    );

    // 🔴 감싼 `div` 가 아니라 heading 자신의 class 다.
    const headingClassOf = (markup: string) =>
      /<h[1-6] class="([^"]+)"/.exec(markup)?.[1] ?? null;

    expect(headingClassOf(page)).toContain("border-b");
    expect(headingClassOf(section)).toBe(headingClassOf(page));
  });

  /**
   * 🔴 **`<h6>` 아래가 없다.** 겹쳐서 멈추면 층이 하나 줄 뿐 «건너뛰기»가 되지
   * 않는다 — 깊어지는 쪽이 위험하고 얕아지는 쪽은 안전하다.
   */
  it("깊은 문서를 깊은 자리에 놓아도 h6을 넘지 않는다", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        content: "# 하나\n\n## 둘\n\n### 셋\n\n#### 넷",
        emptyLabel: "Empty",
        baseHeadingLevel: 4,
      }),
    );

    expect(markup).toContain("<h5");
    expect(markup).toContain("<h6");
    expect(markup).not.toContain("<h7");
  });
});
