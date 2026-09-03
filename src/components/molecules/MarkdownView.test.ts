import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  MarkdownView,
  keepsInlineExpressionTogether,
} from "@/components/molecules/MarkdownView";
import { renderMarkdownViewMarkup } from "@/components/molecules/markdown-view-testing";

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

    /*
 🔴 **`break-words` 로 쓰면 tailwind-merge 가 `break-keep` 과 같은 그룹으로 묶어 지운다.**
 둘은 서로 다른 속성(`overflow-wrap` · `word-break`)인데 한쪽만 남아, 빈칸 없는 긴
 identifier 가 문단을 밀어 `<main>` 이 가로로 스크롤했다 — 그래서 arbitrary property 다.
    */
    expect(markup).toContain("[overflow-wrap:break-word]");
    expect(markup).toContain("break-keep");
    expect(markup).not.toContain("<script>");
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

    /*
 🔴 **`uppercase` 에 기대지 않는다.** 이 화면의 heading 은 한국어라 대문자 변환이 아무 일도
 하지 않는다 — 갈리는 것은 그 안의 Latin identifier 뿐이었다. 층은 크기·굵기·색이 만든다.
    */
    expect(markup).not.toContain("uppercase");

    // 🔴 heading 은 본문 bold(700)에 지지 않아야 한다 — 깊이 1~3 이 `font-bold` 다.
    expect(markup).toContain("font-bold");

    // 층을 만드는 것은 위 여백이다 — heading 마다 `mt-*` 가 붙는다.
    expect(markup).toContain("mt-10");
    expect(markup).toContain("mt-9");
    expect(markup).toContain("mt-8");
  });

  /**
   * 🔴 **heading 은 이전 것과 «떨어지고» 자기 아래 것과 «묶여야» 한다.**
   *
   * 예전에는 컨테이너의 `gap-4` 가 모든 형제 사이에 16px 을 똑같이 넣어, heading 아래
   * 간격이 문단 사이 간격과 «같았다»(실측 1440px: 위 48px / 아래 16px / 문단 사이 16px).
   * 「묶인다」는 신호가 0 이었다. 지금은 인접 형제 규칙이 그 자리를 좁힌다.
   */
  it("heading 아래는 문단 사이보다 «좁게» 묶인다", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        content: "## 소제목\n\n본문 문단.\n\n다음 문단.",
        emptyLabel: "Empty",
        baseHeadingLevel: 1,
      }),
    );

    // 🔴 균일 gap 이 남아 있으면 아래를 좁힐 방법이 없다.
    expect(markup).not.toContain("gap-4");
    // heading 바로 다음 형제만 «좁은» 위 여백을 받는다.
    expect(markup).toContain(
      "[&amp;&gt;:where(h1,h2,h3,h4,h5,h6)+*]:mt-[calc(var(--md-gap)*0.4)]",
    );
    // 문단은 기본 리듬을 소유한다.
    expect(markup).toContain("mt-[var(--md-gap)]");
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
    expect(markup).toContain("[&amp;&gt;*:first-child]:mt-0");
    expect(markup).toContain("첫 줄부터 heading");
  });

  /**
   * 🔴 **`text-sm` 재선언이 `leading-relaxed` 를 죽이고 있었다.**
   *
   * 컨테이너가 `text-sm leading-relaxed`(14px / 1.625 = 22.75px)를 주는데 `p`·`ul`·`ol`·
   * `blockquote` 가 각자 `text-sm` 을 다시 선언해 line-height 가 **20px 로 덮였다**(실측).
   * 장문이 1.43 행간으로 그려져 줄이 붙었다.
   */
  it("prose 가 컨테이너의 행간을 덮지 않는다", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        content: "본문 문단.\n\n- 항목\n\n> 인용",
        emptyLabel: "Empty",
        baseHeadingLevel: 1,
      }),
    );

    expect(markup).toContain("leading-relaxed");
    // 🔴 `p`·`ul`·`blockquote` 어디에도 `text-sm` 이 다시 붙지 않는다.
    expect(markup.match(/text-sm/g)).toHaveLength(1);
  });

  /**
   * 🔴 **읽기 폭은 prose 에만 건다.** 표와 코드블록은 넓은 자리가 필요하다 —
   * 그것들까지 묶으면 비교할 열이 잘리거나 가로 스크롤이 일찍 생긴다.
   */
  it("읽기 폭 상한이 표·코드블록에는 걸리지 않는다", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        content: "본문.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```",
        emptyLabel: "Empty",
        baseHeadingLevel: 1,
      }),
    );

    const proseCapped = markup.match(/max-w-\[48rem\]/g) ?? [];
    expect(proseCapped).toHaveLength(1); // 문단 하나뿐

    // 표 wrapper 와 pre 는 상한 없이 제 폭을 쓴다.
    expect(markup).toContain('<div class="mt-[calc(var(--md-gap)*1.35)] overflow-x-auto"');
    expect(markup).not.toMatch(/<pre[^>]*max-w-\[48rem\]/);
  });

  /**
   * 🔴 **글쓴이가 단계를 건너뛰어도 DOM 은 건너뛰지 않는다.**
   *
   * `##` 다음에 곧바로 `####` 가 오면 고정 대응은 `<h3>` 뒤에 `<h5>` 를 낸다 —
   * axe 의 `heading-order` 위반이고 낭독기가 「빠진 층」으로 읽는다. 저장된 원문은
   * 그대로 두고 그리는 쪽에서 층을 메운다.
   */
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

/**
 * 🔴 **inline code 가 제 안의 빈칸에서 갈렸다.**
 *
 * 제 규칙이 없어 본문의 `white-space: normal` 을 상속했고, 그래서
 * `baseHeadingLevel + 1` 이 «baseHeadingLevel + / 1» 로 나뉘어 한 expression 이
 * 두 줄에 걸쳤다. 판정 규칙만 떼어 시험한다 — 화면 없이 확인할 수 있어야 한다.
 */
describe("inline code 를 한 덩어리로 붙드는 판정", () => {
  it("짧은 expression 은 붙든다", () => {
    for (const expression of [
      "baseHeadingLevel + 1",
      "Math.min(2, 1 + 1)",
      "previous + 1",
    ]) {
      expect(keepsInlineExpressionTogether(expression)).toBe(true);
    }
  });

  it("빈칸 없는 identifier 는 손대지 않는다 — 끊길 자리가 애초에 없다", () => {
    expect(keepsInlineExpressionTogether("baseHeadingLevel")).toBe(false);
    expect(
      keepsInlineExpressionTogether("rotateRefreshTokenFamilyAtomically"),
    ).toBe(false);
  });

  /*
 🔴 붙들면 넘칠 수 있는 길이는 붙들지 않는다. 그 자리는 상속된
 `overflow-wrap: break-word` 가 그대로 받는다.
  */
  it("좁은 본문에 들어가지 못할 길이는 붙들지 않는다", () => {
    expect(keepsInlineExpressionTogether("a".repeat(23) + " b")).toBe(false);
    expect(
      keepsInlineExpressionTogether("Math.min(baseHeadingLevel + depth, 6)"),
    ).toBe(false);
  });

  it("🔴 줄바꿈이 있으면 fenced block 이므로 붙들지 않는다", () => {
    expect(keepsInlineExpressionTogether("const a = 1\nconst b = 2")).toBe(
      false,
    );
    expect(keepsInlineExpressionTogether("h2 이력\n")).toBe(false);
  });

  it("🔴 fenced code block 에는 whitespace-nowrap 이 붙지 않는다", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        content: "```\nconst a = 1\n```\n\n본문 `a + 1` 끝",
        emptyLabel: "Empty",
        baseHeadingLevel: 1,
      }),
    );

    const pre = markup.slice(markup.indexOf("<pre"), markup.indexOf("</pre>"));
    expect(pre).not.toContain("whitespace-nowrap");
    // 같은 문서의 inline expression 에는 붙는다.
    expect(markup).toContain("whitespace-nowrap");
  });
});

/**
 * 🔴 **타입이 닿지 않는 자리에서 조용히 `<h6>` 로 무너졌다.**
 *
 * `baseHeadingLevel` 은 TypeScript 에서 필수인데, `.mjs` 처럼 `tsc` 가 보지 않는 자리에서
 * 빠뜨리면 `undefined + depth` 가 `NaN` 이 되고 `HEADING_TAGS[NaN] ?? "h6"` 가 그것을
 * **최하위 heading** 으로 번역했다 — 문서의 모든 heading 이 `<h6>` 로 나갔다.
 * CI 의 `DB_INTEGRATION` 시험이 그것을 잡았다(run 33732041214).
 */
describe("baseHeadingLevel 의 런타임 경계", () => {
  /** `tsc` 를 지나 런타임에 도달하는 호출을 흉내낸다. */
  const renderWith = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(
        MarkdownView,
        { content: "## 소제목\n\n본문", emptyLabel: "—", ...props } as never,
      ),
    );

  const headingOf = (markup: string) =>
    (markup.match(/<(h[1-6])[ >]/) ?? [])[1] ?? "(없음)";

  it("🔴 값을 빠뜨린 런타임 호출이 h6 로 무너지지 않는다", () => {
    /*
 🔴 **「`h6` 이 아니다」로는 계약이 지켜지지 않는다.** 그것은 고쳐진 증상 하나를 배제할 뿐이라
 fallback 을 `2` 로 바꾼 판(`<h4>`)도 통과한다. 계약은 「범위 밖이면 `1`」이므로 `##`(Markdown
 깊이 2)은 **정확히 `<h3>`** 이어야 한다 — 값을 그대로 못 박는다.
    */
    expect(headingOf(renderWith({}))).toBe("h3");
    for (const bad of [undefined, null, 0, 9, 1.5, "2", NaN, -1, "", true]) {
      expect(headingOf(renderWith({ baseHeadingLevel: bad }))).toBe("h3");
    }
    // 그리고 그 값은 «명시적으로 1 을 준 것»과 같아야 한다.
    expect(headingOf(renderWith({}))).toBe(
      headingOf(renderWith({ baseHeadingLevel: 1 })),
    );
  });

  it("유효한 값은 기존 계산을 그대로 따른다", () => {
    // `##` 은 Markdown 깊이 2 다 — tag 는 base + 2 다.
    expect(headingOf(renderWith({ baseHeadingLevel: 1 }))).toBe("h3");
    expect(headingOf(renderWith({ baseHeadingLevel: 2 }))).toBe("h4");
    expect(headingOf(renderWith({ baseHeadingLevel: 3 }))).toBe("h5");
    expect(headingOf(renderWith({ baseHeadingLevel: 4 }))).toBe("h6");
  });

  it("🔴 fallback 이 생겨도 TypeScript 계약은 required 그대로다", () => {
    const markup = renderToStaticMarkup(
      /*
 🔴 아래 지시자가 이 시험의 전부다. `baseHeadingLevel` 을 선택 prop 으로 되돌리면
 이 자리에 오류가 없어져 지시자가 «쓰이지 않게» 되고, `tsc` 가 그것을 실패로 알린다.
      */
      // @ts-expect-error baseHeadingLevel 을 빠뜨리면 tsc 가 잡아야 한다.
      createElement(MarkdownView, { content: "본문", emptyLabel: "—" }),
    );
    expect(markup).toContain("본문");
  });
});

/**
 * 🔴 **`.mjs` 시험의 required prop 은 이제 «타입 경계»가 지킨다.**
 *
 * 예전에는 이 자리에 `.mjs` 원문을 TypeScript compiler API 로 파싱하는 검사가 있었다.
 * 그런데 라운드마다 우회가 하나씩 나왔다 — 문자열·주석, `React.createElement` 형태,
 * spread 와 computed key 의 덮어쓰기, accessor·method·shorthand 의 무효화,
 * `const MV = MarkdownView` 로 갈아타기. 막을 때마다 다음 것이 나왔고, JS 가
 * 이름을 갈아탈 수 있는 표면은 그런 식으로 닫히지 않는다.
 *
 * 그래서 **시험 안에 정적 분석기를 두는 대신 경계를 옮겼다** —
 * `markdown-view-testing.ts` 의 `renderMarkdownViewMarkup()` 하나만 `.mjs` 가 부르고,
 * required prop 은 그 `.ts` 파일에서 `tsc` 가 본다. 아래 시험은 그 경계가
 * **실제로 그 자리에 남아 있는지**만 확인한다.
 */
describe("integration 시험이 지나는 타입 경계", () => {
  it("🔴 .mjs 는 MarkdownView 를 직접 만들지 않고 타입 검사되는 helper 를 부른다", () => {
    const source = readFileSync(
      "mcp/markdown-authoring.integration.test.mjs",
      "utf8",
    );

    expect(source).toContain("renderMarkdownViewMarkup");
    // 직접 만들면 `tsc` 가 보지 않는 자리가 다시 생긴다.
    expect(source).not.toContain("createElement");
  });

  it("helper 가 렌더링 문맥을 밝힌 채로 그린다", () => {
    // `baseHeadingLevel: 1` — 페이지 제목 `<h1>` 바로 아래. `##` 은 `<h3>` 이다.
    expect(renderMarkdownViewMarkup("## 제목\n\n본문")).toMatch(/<h3[ >]/);
    expect(renderMarkdownViewMarkup("## 제목\n\n본문")).not.toMatch(/<h2[ >]/);
  });
});

/**
 * 🔴 **중첩된 첫 문단이 최상위 리듬의 여백을 그대로 이고 있었다.**
 *
 * `p` override 는 모든 문단에 위 여백을 붙이는데 초기화는 컨테이너의 «직계 자식»만
 * 대상이었다. 그래서 인용문 안쪽이 실측(1440px)에서 **위 28px / 아래 8px** 이 됐다 —
 * padding 은 `8px / 8px` 로 대칭인데 첫 문단의 20px 가 얹힌 것이다.
 */
describe("중첩 블록 안의 첫 문단", () => {
  it("🔴 인용문과 목록 항목의 첫 문단은 위 여백을 되돌린다", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownView, {
        content: "> 인용 첫 문단\n>\n> 인용 둘째 문단\n\n- 느슨한 항목\n\n- 다음 항목",
        emptyLabel: "—",
        baseHeadingLevel: 1,
      }),
    );

    // 되돌리는 규칙이 실제로 실려 나간다 — 명시도가 높아 선언 순서와 무관하다.
    expect(markup).toContain("[&amp;_blockquote&gt;*:first-child]:mt-0");
    expect(markup).toContain("[&amp;_li&gt;*:first-child]:mt-0");

    // 그리고 중첩 문단은 여전히 «최상위와 같은» class 를 갖는다 — 되돌림은 CSS 가 한다.
    const nested = markup.slice(markup.indexOf("<blockquote"));
    expect(nested).toContain("<p class=\"mt-[var(--md-gap)]");
  });
});
