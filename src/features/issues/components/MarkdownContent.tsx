import { MarkdownView } from "@/components/molecules/MarkdownView";

export function MarkdownContent({
  content,
  emptyLabel,
  className,
  baseHeadingLevel,
}: {
  content: string;
  emptyLabel: string;
  className?: string;
  /**
   * 이 문서를 감싼 «가장 가까운 heading» 의 DOM 단계.
   *
   * 🔴 **그대로 넘기기만 한다**(`MarkdownView` 가 계약의 정본이다). Issue 상세의
   * 서술은 전부 `Section`(제목이 `<h2>`) 안에 있어 부르는 쪽이 `2` 를 준다 —
   * 여기서 기본값을 `2` 로 바꾸지 않는다. 그러면 같은 prop 이 두 파일에서 다른
   * 뜻을 갖게 되고, 문맥이 바뀐 자리를 조용히 틀리게 그린다.
   *
   * 🔴 **`MarkdownView` 와 «같이» 필수다.** 여기만 선택으로 두면 이 wrapper 를 지나는
   * 호출에서 누락이 다시 조용해진다 — 그 우회로를 남기지 않는다.
   */
  baseHeadingLevel: 1 | 2 | 3 | 4;
}) {
  return (
    <MarkdownView
      content={content}
      emptyLabel={emptyLabel}
      className={className}
      baseHeadingLevel={baseHeadingLevel}
    />
  );
}
