export const NARRATIVE_MARKDOWN_GUIDANCE =
  "Markdown으로 작성한다. 의미가 달라지면 빈 줄로 문단을 나누고, 여러 항목은 목록으로 쓰며, 코드 식별자는 inline code로 표시한다. 여러 의미를 한 문단에 이어 붙이지 않는다.";

export function narrativeDescription(purpose: string): string {
  return `${purpose} ${NARRATIVE_MARKDOWN_GUIDANCE}`;
}
