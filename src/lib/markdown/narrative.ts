/**
 * REST 경계(Server Action · Agent API)의 서술 field 에 붙는 작성 지침.
 *
 * 🔴 **MCP 쪽 계약(`mcp/tools.mjs` 의 `NARRATIVE_MARKDOWN`)과 «같은 것»을 말해야 한다.**
 * 예전에는 이쪽이 훨씬 약해서 heading 을 한 번도 언급하지 않았다 — 그래서 같은 제품에
 * 두 개의 서로 다른 작성 계약이 있었다. 통로가 달라도 남는 문서는 하나다.
 *
 * 🔴 **전문을 여기에 복사하지 않는다.** 길이가 다른 것은 괜찮다 — 어긋나면 안 되는 것은
 * «무엇을 쓰라고 하는가»이지 문장 수가 아니다.
 */
export const NARRATIVE_MARKDOWN_GUIDANCE =
  "Markdown으로 작성한다. 논점이 갈리면 `##` heading으로 나누고 그 아래 세부만 `###`로 내려간다 — `#`은 쓰지 않는다(화면이 그리는 field 제목이 그 자리다). 의미가 달라지면 빈 줄로 문단을 나누고, 병렬 항목은 bullet, 순서가 있는 과정은 ordered list로 쓴다. 코드 식별자는 inline code로 표시하고, 실제 source snippet이 근거일 때만 fenced code block을 쓴다. bold를 heading 대신 쓰지 않는다. 여러 의미를 한 문단에 이어 붙이지 않는다.";

export function narrativeDescription(purpose: string): string {
  return `${purpose} ${NARRATIVE_MARKDOWN_GUIDANCE}`;
}
