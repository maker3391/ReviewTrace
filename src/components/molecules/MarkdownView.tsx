import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
 * Wiki 본문은 사람이 넣는 값이라 곧 저장형 XSS 가 된다(CLAUDE.md 19).
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
 */
export function MarkdownView({ content }: { content: string }) {
  if (content.trim() === "") {
    return <p className="text-xs text-muted-foreground">본문이 비어 있습니다.</p>;
  }

  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h2 className="mt-4 border-b border-border pb-1 text-base font-semibold tracking-tight">
              {children}
            </h2>
          ),
          h2: ({ children }) => (
            <h3 className="mt-4 text-sm font-semibold tracking-tight">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-3 text-sm font-medium">{children}</h4>
          ),
          p: ({ children }) => <p className="text-sm">{children}</p>,
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
          code: ({ children, className }) => {
            // 코드 블록은 `language-*` Class 를 달고 온다. 인라인 코드와 다르게 그린다.
            const isBlock = typeof className === "string" && className !== "";
            if (isBlock) {
              return <code className="font-mono text-xs">{children}</code>;
            }
            return (
              <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            // 🔴 긴 줄은 가로로 스크롤한다. 페이지 전체가 옆으로 늘어나지 않게 한다.
            <pre className="overflow-x-auto rounded-sm border border-border bg-muted/40 p-3">
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
              <table className="w-full border-collapse text-xs">{children}</table>
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
