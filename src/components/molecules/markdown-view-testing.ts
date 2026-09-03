import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownView } from "./MarkdownView";

/**
 * 🔴 **`.mjs` 시험은 `tsc` 가 보지 않는다.** 그래서 그쪽에서 `baseHeadingLevel` 을
 * 빠뜨리면 아무도 알려 주지 않고, 런타임 fallback 뒤에 조용히 숨는다.
 *
 * 그 호출을 **타입 검사되는 경계 하나로 모은다.** `.mjs` 는 이 함수만 부르므로
 * required prop 을 지키는 자리가 여기 하나뿐이고, `tsc` 가 그 하나를 본다.
 *
 * 🔴 **시험 안에서 정적 분석기를 다시 만들지 않는다.** 예전에는 `.mjs` 원문을
 * TypeScript compiler API 로 파싱해 `createElement(MarkdownView, …)` 의 최상위
 * property 를 검사했는데, callee 형태·spread·accessor·alias 를 라운드마다 하나씩
 * 더 막아야 했고 그러고도 JS 의 갈아타기 표면을 닫지 못했다 —
 * 경계를 옮기는 쪽이 작고 정확하다.
 *
 * `baseHeadingLevel: 1` 은 **페이지 제목 `<h1>` 바로 아래**라는 렌더링 문맥이다.
 */
export function renderMarkdownViewMarkup(content: string): string {
  return renderToStaticMarkup(
    createElement(MarkdownView, {
      content,
      emptyLabel: "Empty",
      baseHeadingLevel: 1,
    }),
  );
}
