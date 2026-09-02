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
export function MarkdownView({
  content,
  emptyLabel,
  className,
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
    <div
      className={cn(
        "flex flex-col gap-3 text-sm leading-relaxed break-words",
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
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: ({ children }) => (
            <h2 className="mt-4 border-b border-border pb-1 text-base font-semibold tracking-tight">
              {children}
            </h2>
          ),
          /*
 🔴 **heading 이 문단 속 bold 보다 «약해» 보이면 안 된다.**

 실측한 적이 있다 — `###` 은 `14px/500` 인데 문단 안 `**bold**` 는 `14px/700` 이었다.
 크기도 색도 같아서 **구조를 가르는 heading 이 문장 속 강조보다 덜 두드러졌고**,
 읽는 사람은 그것을 「bold 로 쓴 소제목」으로 읽었다. 정보 계층이 뒤집힌 것이다.

 🔴 **글자를 키우거나 새 장치를 만들어 풀지 않는다.** 이 앱에는 「본문 안의 하위 라벨」이
 이미 있고 전부 **`11px/600`·선 없음**이다 — `판단 기록`·`해결책`·`코드 근거`. field 제목은
 `13px/600` 이다. 그러니 Markdown 의 subheading 이 설 자리는 **그 둘 사이가 아니라 그
 하위 라벨과 같은 칸**이다. 옛 `14px/500` 은 **부모인 field 제목보다 커서** 계층이 뒤집혀
 있었고, 굵기는 문단 속 bold(`700`)보다 낮아 강조보다도 약했다.

 🔴 **가로선을 새로 들이지 않는다.** 잠시 넣어 봤지만 이 앱의 본문 안 라벨은 선을 쓰지
 않는다 — 없던 장치를 하나 더 만드는 것이라 되돌렸다. 구조는 **크기·굵기·위 여백**이 말한다.

 계단: 페이지 제목 `20/600` > field 제목 `13/600` > **subheading `11/600`** > 본문 `14/400`.
 (`components/molecules/MarkdownView.tsx` 가 Markdown 을 아는 유일한 자리다 — CLAUDE.md 6)
 */
          h2: ({ children }) => (
            <h3 className="mt-5 text-[13px] font-semibold tracking-tight">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-4 text-[11px] font-semibold tracking-tight">
              {children}
            </h4>
          ),
          /*
 Markdown 의 빈 줄은 paragraph 로 나뉘고, paragraph 안의 단일 newline 은 Text node 로
 남는다. `whitespace-pre-wrap` 으로 그 newline 도 화면에서 보존한다. remark-breaks 로
 의미를 `<br>` 로 바꾸지 않으므로 저장된 Markdown 구조는 그대로다.
 */
          p: ({ children }) => (
            <p className="whitespace-pre-wrap text-sm">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5 text-sm">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5 text-sm">{children}</ol>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 text-sm text-muted-foreground">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">
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
                "overflow-x-auto rounded-sm border border-border bg-muted/40 p-3 text-accent-foreground",
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
            <div className="overflow-x-auto">
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
          hr: () => <hr className="border-border" />,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
