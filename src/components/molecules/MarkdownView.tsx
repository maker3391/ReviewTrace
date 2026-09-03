import type { ReactNode } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Markdown 원문을 화면으로 그린다.
 *
 * ## 🔴 Sanitize — 「거르는」 것이 아니라 「만들지 않는」 것이다
 *
 * `react-markdown` 은 **기본적으로 raw HTML 을 렌더하지 않는다.** 본문에 `<script>` 나
 * `<img onerror=…>` 가 들어 있어도 **글자 그대로** 나온다 — 위험한 노드를 만든 뒤 지우는
 * 것이 아니라 처음부터 만들지 않는다.
 *
 * 그래서 `dangerouslySetInnerHTML` 도, DOMPurify 같은 사후 정화 Library 도 쓰지 않는다.
 * 🔴 **`rehype-raw` 를 넣지 마라.** 그것을 켜는 순간 위 보증이 통째로 사라진다 —
 * Wiki 본문은 사람이 넣는 값이라 곧 저장형 XSS 가 된다.
 *
 * 링크의 `href` 도 기본 정책이 `javascript:` 같은 Scheme 을 막는다. 그 위에
 * `rel="noreferrer noopener"` 를 덧붙여 새 창이 원래 문서를 건드리지 못하게 한다.
 *
 * ## 왜 이 파일 하나인가
 *
 * 🔴 **Markdown Library 를 아는 자리는 여기뿐이다.** 화면들은 `MarkdownView` 만 안다 —
 * 렌더러를 바꾸거나 아예 걷어내고 `<pre>` 로 되돌리는 일이 **이 파일 하나 수정**으로 끝난다.
 * Feature 마다 `react-markdown` 을 직접 부르면 그때 고칠 자리가 흩어진다.
 *
 * 서식은 Tailwind Class 로 직접 준다 — 이것 하나 때문에 typography Plugin 을 더 넣지 않는다.
 *
 * ## 코드블록 강조 — class 만 받고 색은 우리가 준다
 *
 * `rehype-highlight` 는 토큰에 `hljs-*` **class 만** 붙인다. 🔴 **그것이 들고 다니는
 * theme CSS 는 가져오지 않는다** — 그 CSS 는 배경·글꼴·padding 까지 자기 것으로 덮어써
 * 코드블록 하나만 다른 제품에서 떼어 온 것처럼 보이게 만든다. 우리는 아래 `pre` 에서
 * **필요한 class 몇 개에만** 우리 CSS 변수를 준다.
 *
 * 🔴 **편집기와 같은 세 변수를 쓴다**(`components/molecules/MarkdownEditor.tsx`) —
 * keyword `--primary` · 문자열/숫자 `--foreground` · 주석 `--muted-foreground`,
 * 나머지(식별자·타입·함수 이름·괄호)는 **일부러 손대지 않는다.** 같은 문서를 쓸 때와
 * 읽을 때 같은 것이 같은 강도로 보여야 한다.
 *
 * 🔴 **이것은 `rehype-raw` 와 다르다.** 붙는 것은 `<span class="hljs-…">` 뿐이고 본문의
 * raw HTML 은 여전히 «만들어지지 않는다» — 위 보증은 그대로다.
 */
/**
 * 렌더된 heading 이 «단계를 건너뛰지» 않게 맞춘다.
 *
 * ## 🔴 왜 필요한가
 *
 * 이 파일은 Markdown 깊이를 DOM 단계에 **고정 대응**시킨다 — `#`~`####` 가
 * `<h2>`~`<h5>` 다. 그런데 글쓴이가 단계를 건너뛰면(`##` 다음에 곧바로 `####`)
 * DOM 도 그대로 건너뛴다: `<h3>` 뒤에 `<h5>` 가 온다. 그것은 axe 의
 * `heading-order` 위반이고, 화면 낭독기가 「빠진 층이 있다」로 읽는다.
 *
 * 🔴 **글쓴이를 탓해 고칠 문제가 아니다.** 저장된 원문은 그대로 두고(그것이 정본이다)
 * 그리는 쪽에서 층만 메운다.
 *
 * ## 무엇을 하는가
 *
 * 문서 순서대로 훑으며 각 heading 을 **직전 단계보다 한 칸 넘게 내려가지 않도록**
 * 끌어올린다. `min(원래 단계, 직전 + 1)` 하나가 규칙의 전부다.
 *
 * ```
 * ##  ####      ->  h3  h4      (h3 h5 였다)
 * ##  ###  ##   ->  h3  h4  h3  (건너뛰지 않으므로 그대로다)
 * ```
 *
 * 🔴 **여기서 세는 것은 «Markdown 깊이»이지 DOM 단계가 아니다.** 그래서 시작값이 1 로
 * 고정이고 `baseHeadingLevel` 과 무관하다 — 문서가 어디에 놓이든 그 안의 층 간격은
 * 같아야 하고, 어느 단계에서 시작하는지는 `headingTag` 가 «뒤에» 한꺼번에 더한다.
 *
 * 🔴 **새 의존성을 들이지 않았다.** hast 는 `children` 을 가진 평범한 객체라
 * 재귀 한 번이면 된다 — `unist-util-visit` 을 direct 로 올릴 이유가 없다.
 */
function rehypeNoHeadingSkip() {
  return (tree: unknown) => {
    let previous = 1;

    const walk = (node: unknown): void => {
      if (typeof node !== "object" || node === null) return;
      const element = node as {
        type?: string;
        tagName?: string;
        children?: unknown[];
      };

      if (element.type === "element" && element.tagName !== undefined) {
        const match = /^h([1-6])$/.exec(element.tagName);
        if (match?.[1] !== undefined) {
          const level = Math.min(Number(match[1]), previous + 1);
          element.tagName = `h${level}`;
          previous = level;
        }
      }

      for (const child of element.children ?? []) walk(child);
    };

    walk(tree);
  };
}

/**
 * 이 문서의 heading 이 «어느 DOM 단계에서 시작하는가».
 *
 * ## 🔴 왜 고정 대응이면 안 되는가
 *
 * 같은 `MarkdownView` 가 두 자리에 놓인다.
 *
 * | 부르는 곳 | 바로 위 heading | `#` 이 되어야 하는 것 |
 * |---|---|---|
 * | `KnowledgePageView` | 페이지 제목 `<h1>` | `<h2>` |
 * | `Section` 안(Issue·Review 상세) | section 제목 `<h2>` | `<h3>` |
 *
 * 고정 대응(`#` -> 언제나 `<h2>`)이면 뒤쪽에서 **문서의 첫 heading 이 자기를 담은
 * section 제목과 «같은 단계»**가 된다. 화면은 층이 있는 것처럼 보이는데 낭독기에는
 * 형제로 읽힌다 — 눈에 보이지 않아 더 오래 남는 종류의 결함이다.
 *
 * ## 무엇을 받는가
 *
 * **자기를 감싼 가장 가까운 heading 의 DOM 단계**다. 문서가 낼 첫 단계가 아니다 —
 * 부르는 쪽은 「내 위에 무엇이 있는가」만 알면 되고, 그 아래를 어떻게 쓸지는 이 파일이 정한다.
 *
 * 🔴 **선택이 아니라 «필수»다.** 한때 기본값 `1` 을 두었는데, 그 값은 「모른다」가 아니라
 * 「페이지 제목 바로 아래다」라는 구체적인 주장이라서, 빠뜨린 호출이 침묵하는 대신 **틀린
 * 문맥을 선언한 호출**이 됐다. 그리고 그 어긋남은 화면에 드러나지 않는다 — 크기와 여백은
 * 아래 `HEADING_CLASS` 가 정하므로 틀린 단계도 정상으로 보인다.
 *
 * 실제로 `IssueStatusControl` 의 해결 요약이 `Section`(제목이 `<h2>`) 안에서 값을 넘기지
 * 않아 기본값 `1` 로 그려지고 있었다. 필수로 바꾸자 `tsc` 가 그 자리를 짚었다.
 */
const HEADING_TAGS = ["h2", "h3", "h4", "h5", "h6"] as const;

type HeadingTag = (typeof HEADING_TAGS)[number];

/**
 * `baseHeadingLevel` 아래로 `depth` 만큼 내려간 tag.
 *
 * 🔴 **`<h6>` 에서 멈춘다.** HTML 에 그 아래가 없다. 겹쳐서 멈추는 것은 층이 하나
 * 줄어드는 것뿐이라 **건너뛰기가 되지 않는다** — 깊이가 얕아지는 쪽은 안전하다.
 */
function headingTag(baseHeadingLevel: number, depth: number): HeadingTag {
  const level = Math.min(baseHeadingLevel + depth, 6);
  return HEADING_TAGS[level - 2] ?? "h6";
}

/**
 * heading 의 «생김새»는 Markdown 깊이가 정하고, «단계»는 놓인 자리가 정한다.
 *
 * 🔴 **둘을 섞지 않는다.** 같은 `###` 은 어디에 놓이든 같은 크기여야 하고
 * (한 문서 안의 층 간격은 그 문서의 것이다), DOM 단계만 바깥 문맥을 따라 내려간다.
 */
type MarkdownDepth = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * heading 안의 inline code 를 «누른다».
 *
 * ## 🔴 pill 이 제목보다 먼저 눈에 들어왔다
 *
 * 본문에서 `code` 는 배경 pill 로 identifier 를 갈라 주는 옳은 장치다. 그런데 heading
 * 안에서는 그 배경이 **문장 위계를 이긴다** — 실측(1440px)에서 15px heading 안의 code 가
 * `0.9em` 이라 13.5px 로 «작아지면서» 배경과 패딩은 그대로였다. heading 을 더 작아 보이게
 * 만들면서 동시에 제 배경으로 시선을 먼저 가져갔다.
 *
 * 배경과 패딩만 걷는다. **`font-mono` 는 남는다** — identifier 라는 뜻은 글꼴이 이미
 * 말하고 있고, 굵기는 heading 에서 상속되므로 제목의 일부로 읽힌다.
 */
const HEADING_CODE = "[&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[0.95em]";

/**
 * ## 🔴 heading 이 본문 bold 에 지고 있었다
 *
 * 실측(1440px): Section 제목 `16px/600` · `##` **`15px/600`** · 본문 `14px/400` ·
 * 문단 안 `**bold**` **`14px/700`**. 크기 차이가 1px 이고 굵기는 heading(600)이 본문
 * bold(700)보다 **약했다** — 훑는 눈에 문단 속 강조가 소제목처럼 보였다.
 *
 * 그래서 깊이 1~3 을 **`font-bold`(700)** 로 올린다. 이제 heading 은 본문 bold 와 같은
 * 굵기이면서 크기가 더 크고, 아래 여백 규칙까지 더해져 층이 선다.
 *
 * 🔴 **`uppercase` 에 기대지 않는다.** 이 화면의 heading 은 한국어라 대문자 변환이
 * **아무 일도 하지 않는다** — 예전 4~6 층이 그 축에 기대고 있었는데, 실제로 갈린 것은
 * 그 안의 Latin identifier 뿐이었다. 남은 축은 **크기·굵기·색**이다.
 *
 * 🔴 **Section 제목(16px)을 넘지 않는다.** 이 문서는 그 제목 «아래»에 있다.
 */
const HEADING_CLASS: Record<MarkdownDepth, string> = {
  1: `mt-10 border-b border-border pb-1.5 text-base font-bold tracking-tight ${HEADING_CODE}`,
  2: `mt-9 text-[0.9375rem] font-bold tracking-tight ${HEADING_CODE}`,
  3: `mt-8 text-sm font-bold tracking-tight ${HEADING_CODE}`,
  4: `mt-7 text-sm font-semibold tracking-tight text-muted-foreground ${HEADING_CODE}`,
  /*
 🔴 **다섯째·여섯째 층만 본문보다 작아진다.** 크기 축이 바닥나서다. 작성 계약이 `##` 부터
 쓰라고 지시하므로 이 깊이는 실제로 거의 오지 않지만, 열쇠를 비워 두면 override 를 만나지
 못해 `baseHeadingLevel` offset 도 class 도 받지 못하고 **더 깊은 Markdown 이 더 얕은 DOM
 단계로 나가는 역전**이 생긴다(저장 단계가 깊이 5 를 막지 않는다).
  */
  5: `mt-6 text-xs font-semibold tracking-wide text-muted-foreground ${HEADING_CODE}`,
  6: `mt-5 text-xs font-medium tracking-wide text-muted-foreground ${HEADING_CODE}`,
};

function heading(baseHeadingLevel: number, depth: MarkdownDepth) {
  const Tag = headingTag(baseHeadingLevel, depth);
  return function MarkdownHeading({ children }: { children?: ReactNode }) {
    return <Tag className={HEADING_CLASS[depth]}>{children}</Tag>;
  };
}

/**
 * 이 inline code 를 «한 덩어리»로 붙들어야 하는가.
 *
 * 순수 함수로 떼어 둔다 — 판정 규칙을 화면 없이 시험할 수 있어야 한다.
 * 조건은 부르는 자리(`code` override)의 주석에 있다.
 */
const INLINE_CODE_NOWRAP_MAX = 24;

export function keepsInlineExpressionTogether(children: ReactNode): boolean {
  const text =
    typeof children === "string"
      ? children
      : Array.isArray(children) && children.every((c) => typeof c === "string")
        ? children.join("")
        : null;
  if (text === null) return false;
  if (text.includes("\n")) return false;
  if (!text.includes(" ")) return false;
  return text.length <= INLINE_CODE_NOWRAP_MAX;
}

export function MarkdownView({
  content,
  emptyLabel,
  className,
  baseHeadingLevel,
}: {
  content: string;
  /**
   * 본문이 비었을 때의 한 줄.
   *
   * 🔴 **이 Component 는 사전을 읽지 않는다.** Server(문서 상세)와 Client(편집기 미리
   * 보기) 양쪽에서 쓰이므로 `readMessages()` 를 부를 수 없다 — 문구는 화면 언어를 아는
   * 쪽이 넘긴다(`ConfirmDialog` 와 같은 판단).
   */
  emptyLabel: string;
  className?: string;
  /**
   * 이 문서를 감싼 «가장 가까운 heading» 의 DOM 단계.
   *
   * 페이지 제목 바로 아래면 `1`, `Section`(제목이 `<h2>`) 안이면 `2` 다.
   * 문서의 heading 은 그 아래에서 시작한다 — 위 `headingTag` 참고.
   *
   * 🔴 **선택 prop 이 아니다.** 빠뜨림을 붙드는 것이 `tsc` 하나뿐이라 그렇다 — 위 참고.
   */
  baseHeadingLevel: 1 | 2 | 3 | 4;
}) {
  if (content.trim() === "") {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    /*
 🔴 **`break-words` 는 장식이 아니다 — 페이지가 좌우로 넘치는 것을 막는다.**

 본문에는 띄어쓰기가 없는 긴 덩어리가 들어온다: URL 한 줄, 긴 식별자, 경로.
 기본값(`overflow-wrap: normal`)에서는 그런 낱말이 **줄 안에서 끊기지 않아** 문단이
 제 폭보다 넓어지고, 그 폭이 그대로 위로 올라가 **`<main>` 전체가 가로로 스크롤**한다.
 390·768·1024 세 폭에서 실제로 그랬다(1024 에서도 main 이 753 → 1165 로 늘었다).

 `overflow-wrap` 은 **상속**되므로 문단·목록·인용·표 셀까지 한 번에 걸린다. 🔴 그런데
 `pre` 는 `white-space: pre` 라 애초에 줄바꿈 자리가 없어 **영향을 받지 않는다** —
 코드블록은 지금처럼 제 컨테이너 안에서 가로로 스크롤한다.
 */
    /*
 🔴 **균일한 `gap` 을 쓰지 않는다 — proximity 를 만들 수 없다.**

 예전에는 `gap-4` 가 «모든» 형제 사이에 16px 을 똑같이 넣었다. flex gap 은 위아래를
 구분하지 못하므로 heading 아래를 좁힐 방법이 아예 없었고, 실측(1440px)에서 이렇게 나왔다 —

 ```
 heading 위 48px   (mt-8 + gap-4)
 heading 아래 16px  <- 문단과 문단 사이 16px 과 «똑같다»
 ```

 「이전 것과 떨어진다」는 신호는 있는데 **「자기 아래 것과 묶인다」는 신호가 0** 이었다.

 지금은 **블록마다 자기 위 여백을 소유**하고, 아래 두 줄이 관계를 정한다. margin 은 flex
 안에서 상쇄되지 않으므로 «다음 형제의 `mt`» 하나가 곧 그 사이의 간격이다 — 그래서
 `mb` 를 쓰지 않는다.

 🔴 **`--md-gap` 은 부르는 쪽이 밀도를 조절하는 손잡이다.** 예전에 호출부가 넘기던
 `gap-2`·`gap-1.5` 가 하던 일을 그대로 받는다(Decision Record 처럼 좁은 카드 안의 리듬).
 값을 안 주면 문단 사이 20px 이다.
    */
    <div
      className={cn(
        /*
 🔴 **`break-keep` — 한국어는 «어절»에서 끊는다.** 기본값은 음절 사이 어디서나 끊어
 「정규화하고」가 «정 / 규화하고» 로 갈렸다(실측 1440px).

 🔴 **`break-words` 와 나란히 쓸 수 없다.** 둘은 서로 다른 CSS 속성인데
 (`overflow-wrap` · `word-break`) tailwind-merge 는 **같은 그룹으로 묶어 뒤엣것만 남긴다** —
 실제로 `break-words` 가 조용히 사라져 긴 identifier 의 넘침 방지가 풀렸다. 그래서
 `overflow-wrap` 은 arbitrary property 로 못 박는다.
        */
        "[--md-gap:1.25rem] flex flex-col text-sm leading-relaxed break-keep [overflow-wrap:break-word]",
        "[&>*:first-child]:mt-0",
        /* heading 은 자기 아래 것과 «묶인다» — 위 여백의 1/5 남짓만 둔다. */
        "[&>:where(h1,h2,h3,h4,h5,h6)+*]:mt-[calc(var(--md-gap)*0.4)]",
        /* 표·코드블록·인용은 덩어리다 — 들어갈 때처럼 «나올 때»도 문단 사이보다 넓다. */
        "[&>:where(pre,blockquote,div,hr)+*]:mt-[calc(var(--md-gap)*1.35)]",
        className,
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        /*
 🔴 **언어를 «추측»하지 않는다**(`detect` 는 기본값 false 그대로). ```text 처럼
 언어를 적지 않은 블록은 강조하지 않는다 — 로그·표·의사코드를 아무 언어로
 칠하면 없는 문법이 있는 것처럼 읽힌다.
 */
        /* 🔴 순서가 뜻을 갖는다 — 층을 메운 «뒤»에 코드 강조를 얹는다. */
        rehypePlugins={[rehypeNoHeadingSkip, rehypeHighlight]}
        components={{
          /*
 🔴 **heading 이 본문보다 «작으면» 안 된다 — 그것이 이 화면의 실제 결함이었다.**

 ## 무엇이 틀렸었나

 앞선 판단은 이랬다 — 이 Markdown 은 field 카드 «안»에 있으므로, subheading 은 부모인
 field 제목(`13px/600`)보다 작아야 계층이 뒤집히지 않는다. 그래서 `##` 를 `13px`,
 `###` 를 `11px` 로 두었다.

 그 판단은 **`##` 와 `###` 를 «둘 다» 쓴다는 전제**에 기대고 있었다. 실제 데이터는
 그렇지 않다 — 저장된 38행을 전수 조회한 결과 **`##` 는 모든 field·모든 행에서 0건**이고
 쓰인 heading 은 `###` 하나뿐이다. 그래서 `13px` 칸은 영원히 비고 **모든 구조 신호가 가장
 작은 `11px` 한 칸에 몰렸다.**

 결과가 뒤집혀 있었다:

 ```
 본문 p            14px / 400
 문단 안 **bold**  14px / 700   <- 가장 크고 가장 굵다
 subheading        11px / 600   <- 구조를 가르는 것이 제일 작다
 ```

 **자기 본문보다 작은 heading 은 heading 으로 읽히지 않는다.** 훑는 눈에 층이 생기지
 않고, 문단 속 강조가 소제목처럼 보인다.

 ## 무엇으로 바꿨나 — 크기가 아니라 «위 여백»이 주인공이다

 heading 을 본문 위로 올리되 최소한만 올린다. 층을 만드는 것은 **위·아래 여백의 비**다.

 | | 크기 | 위 여백(gap 포함) | 아래 여백 |
 |---|---|---|---|
 | `#` | `text-base` 16px | 32 + 16 = 48px | 16px |
 | `##` | `0.9375rem` 15px | 32 + 16 = 48px | 16px |
 | `###` | `text-sm` 14px | 24 + 16 = 40px | 16px |
 | `####` | `text-xs` 12px · uppercase | 20 + 16 = 36px | 16px |

 `###` 은 본문과 같은 14px 이지만 **위가 40px 이고 아래가 16px** 이라 아래 문단을
 「거느린」 것으로 읽힌다. 문단 속 bold 는 줄 한가운데 있어 40px 을 가진 적이 없다 —
 그래서 굵기가 같아도 둘이 섞이지 않는다.

 🔴 **`####` override 를 새로 만들었다.** 없으면 브라우저 기본 `<h4>` 가 나와 계단
 밖으로 튄다(기본 margin 이 이 flex 리듬을 깬다).

 🔴 **`first:mt-0` 을 붙인다.** field 가 heading 으로 시작하면 카드 위쪽에 40px 이
 죽은 자리로 남는다.

 🔴 **가로선을 늘리지 않는다.** `#` 하나만 밑줄을 갖고 나머지는 여백과 굵기로 말한다 —
 heading 마다 선을 그으면 카드 안에 칸막이가 늘어선다.

 🔴 **`strong` 은 손대지 않는다.** 시험이 `<strong>…</strong>` 를 class 없이 확인한다
 (`MarkdownView.test.ts`·`DecisionRecord.test.ts`) — class 를 붙이면 그 assertion 이 깨진다.
 bold 를 누르는 대신 heading 을 올려 푼 이유가 이것이기도 하다.
 */
          /*
 🔴 **tag 는 놓인 자리가, 생김새는 Markdown 깊이가 정한다**(위 `heading`).
 여기 열쇠(`h1`~`h4`)는 **Markdown 깊이**다 — `rehypeNoHeadingSkip` 이 층을 메운 뒤의
 값이고, 실제로 나가는 tag 는 거기에 `baseHeadingLevel` 을 더한 것이다.
 */
          h1: heading(baseHeadingLevel, 1),
          h2: heading(baseHeadingLevel, 2),
          h3: heading(baseHeadingLevel, 3),
          h4: heading(baseHeadingLevel, 4),
          h5: heading(baseHeadingLevel, 5),
          h6: heading(baseHeadingLevel, 6),
          /*
 🔴 **`whitespace-pre-wrap` 을 걷었다 — 원문의 줄바꿈이 화면의 줄바꿈이 아니다.**

 그것을 두면 문단 «안»의 single newline 이 강제 줄바꿈이 돼, 글쓴이가 편집기 폭에 맞춰
 접은 자리가 화면에서 문장을 끊는다. 두 가지가 그 선택을 뒤집었다 —

 - **hard break 는 진짜 `<br/>` 다.** 뒤 공백 두 칸은 remark 가 노드로 만들므로
   `pre-wrap` 없이도 그대로 남는다. 그것을 지키려고 필요한 값이 아니었다
 - **`<li>` 는 이미 접고 있었다.** `pre-wrap` 은 `p` 에만 있어, 같은 원문의 같은 줄바꿈이
   문단에서는 줄바꿈이고 목록에서는 공백이었다

 저장된 원문은 그대로다 — 바뀐 것은 그리는 방식뿐이다.
 */
          /*
 🔴 **`text-sm` 을 다시 선언하지 않는다 — 그것이 행간을 죽이고 있었다.**

 위 컨테이너가 `text-sm leading-relaxed`(14px / 1.625 = 22.75px)를 주는데, 이 override 들이
 각자 `text-sm` 을 «다시» 선언하고 있었다. Tailwind 의 `text-sm` 은 font-size 와
 **line-height 를 함께** 설정하므로 22.75px 가 **20px 로 덮였다**(실측). 그래서 14px
 한국어 장문이 1.43 행간으로 그려져 줄이 서로 붙었다.

 증거는 `pre` 였다 — 그것만 `text-sm` 을 쓰지 않아 **혼자 22.75px** 로 측정됐다.

 크기는 컨테이너에서 상속하고, 호출부가 `[&_p]:text-xs` 로 줄이면 `leading-relaxed` 가
 «비율»이라 행간도 함께 줄어든다.

 🔴 **읽기 폭은 prose 에만 건다.** 1920px 에서 본문이 994px 로 퍼져 줄당 103자였다 —
 다음 줄 첫머리를 찾는 데 눈이 되돌아간다. `48rem` 은 1440px(723px)에서는 걸리지 않고
 1024px 이하에서는 애초에 닿지 않으므로 **좁은 화면의 본문 폭을 한 픽셀도 뺏지 않는다.**
 표와 코드블록은 이 상한을 받지 않는다 — 그것들은 넓은 자리가 필요하다.
          */
          p: ({ children }) => (
            <p className="mt-[var(--md-gap)] max-w-[48rem]">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="mt-[var(--md-gap)] max-w-[48rem] list-disc space-y-1.5 pl-5 marker:text-muted-foreground">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mt-[var(--md-gap)] max-w-[48rem] list-decimal space-y-1.5 pl-5 marker:text-muted-foreground">
              {children}
            </ol>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mt-[calc(var(--md-gap)*1.35)] max-w-[48rem] border-l-2 border-border bg-surface-muted/50 py-2 pr-3 pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          /*
 🔴 **짧은 expression 은 한 덩어리로 둔다.** inline code 는 제 규칙이 없어 본문의
 `white-space: normal` 을 상속했고, 그래서 `baseHeadingLevel + 1` 이 제 안의 빈칸에서
 «baseHeadingLevel + / 1» 로 갈렸다.

 조건 셋을 모두 만족할 때만 붙인다 — 나머지는 **오늘 동작 그대로**다.

 - **빈칸이 있다** = expression 이다. 빈칸 없는 identifier 는 애초에 끊길 자리가 없고,
   `nowrap` 을 붙이면 긴 것이 넘칠 길만 열린다
 - **줄바꿈이 없다** = fenced block 이 아니다. `pre` 안의 code 는 이 자리를 지나가되
   본문이 여러 줄이라 걸리지 않는다
 - **24자 이하** — Geist Mono 12.6px 에서 자당 7.56px 이라 181px + 패딩 8px 이다.
   가장 좁은 본문(390px 에서 237px)에 들어간다. 그보다 길면 `nowrap` 을 붙이지 않아
   상속된 `overflow-wrap: break-word` 가 그대로 안전망이 된다
          */
          code: ({ children }) => (
            <code
              className={cn(
                "rounded-sm bg-muted/70 px-1 py-0.5 font-mono text-[0.9em]",
                keepsInlineExpressionTogether(children) && "whitespace-nowrap",
              )}
            >
              {children}
            </code>
          ),
          pre: ({ children }) => (
            /*
 🔴 긴 줄은 가로로 스크롤한다. 페이지 전체가 옆으로 늘어나지 않게 한다.

 색은 여기 한 곳에서 준다 — 코드 본문은 편집기의 코드블록과 같은
 `--accent-foreground` 이고, 그 위에 세 갈래만 갈라 놓는다.
 */
            <pre
              className={cn(
                "mt-[calc(var(--md-gap)*1.35)] overflow-x-auto rounded-sm border border-border bg-muted/40 p-3 text-accent-foreground",
                /* 언어가 없는 fenced block도 `<pre><code>`다. inline 장식은 parent에서 확실히 걷는다. */
                "[&_code]:rounded-none [&_code]:bg-transparent [&_code]:p-0",
                "[&_.hljs-comment]:text-muted-foreground [&_.hljs-comment]:italic",
                "[&_.hljs-quote]:text-muted-foreground [&_.hljs-quote]:italic",
                "[&_.hljs-keyword]:text-primary [&_.hljs-literal]:text-primary",
                "[&_.hljs-string]:text-foreground [&_.hljs-number]:text-foreground",
                "[&_.hljs-regexp]:text-foreground",
              )}
            >
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            /* 🔴 표는 prose 상한을 받지 않는다 — 비교할 열이 들어갈 폭이 필요하다. */
            <div className="mt-[calc(var(--md-gap)*1.35)] overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border px-2 py-1 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border px-2 py-1 align-top">
              {children}
            </td>
          ),
          hr: () => (
            <hr className="mt-[calc(var(--md-gap)*1.35)] border-border" />
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
