import { EditorSelection } from "@codemirror/state";
import type { EditorState, TransactionSpec } from "@codemirror/state";

import {
  applyMarkdownCommand,
  type MarkdownCommand,
} from "@/components/molecules/markdown-commands";

/**
 * Toolbar 명령을 CodeMirror Transaction 으로 옮기는 **얇은 adapter**.
 *
 * ```text
 * EditorState(문서 + 선택)
 *        -> applyMarkdownCommand   ← Markdown 규칙. CodeMirror 를 모른다
 *        -> { value, selection }
 *        -> TransactionSpec        ← 이 파일이 하는 일 전부
 * ```
 *
 * 🔴 **Markdown 문법 규칙을 CodeMirror 안으로 녹이지 않는다.** 규칙은
 * `markdown-commands.ts` 의 순수 함수 그대로다 — 그래야 editor 를 또 바꿔도 규칙과 그
 * 시험이 살아남는다. 여기 있는 것은 「문자열 in / 문자열 out」을 Transaction 으로 번역하는
 * 일뿐이다.
 */

/** 문서 한 곳을 바꾸는 최소 범위. */
export interface MinimalChange {
  from: number;
  to: number;
  insert: string;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * 바뀐 «구간만» 골라낸다.
 *
 * 🔴 문서 전체를 갈아 끼우지 않는다. 통째로 replace 하면 긴 문서에서 바뀌지 않은 줄까지
 * 다시 만들어지고, 되돌리기 이력도 「문서 전체가 바뀌었다」로 뭉개진다.
 *
 * 앞뒤로 같은 부분을 걷어내고 남는 한 구간만 돌려준다. 같으면 `null` 이다.
 */
export function minimalChange(
  before: string,
  after: string,
): MinimalChange | null {
  if (before === after) {
    return null;
  }

  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (
    start < shortest &&
    before.charCodeAt(start) === after.charCodeAt(start)
  ) {
    start += 1;
  }

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > start &&
    afterEnd > start &&
    before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  // 🔴 이모지 같은 대리 쌍(surrogate pair)의 «가운데»에서 자르지 않는다.
  if (start > 0 && isLowSurrogate(after.charCodeAt(start))) {
    start -= 1;
  }
  if (
    beforeEnd < before.length &&
    isLowSurrogate(before.charCodeAt(beforeEnd))
  ) {
    beforeEnd += 1;
    afterEnd += 1;
  }

  return { from: start, to: beforeEnd, insert: after.slice(start, afterEnd) };
}

/**
 * 현재 상태에 명령 하나를 적용한 Transaction.
 *
 * 선택 범위는 **바뀐 뒤의 문서 기준**이다 — `TransactionSpec` 의 `selection` 은 `changes`
 * 가 적용된 다음 문서에서 해석되므로, 순수 함수가 돌려준 좌표를 그대로 쓸 수 있다.
 */
export function markdownCommandTransaction(
  state: EditorState,
  command: MarkdownCommand,
): TransactionSpec {
  const value = state.doc.toString();
  const range = state.selection.main;

  const next = applyMarkdownCommand(command, {
    value,
    selectionStart: range.from,
    selectionEnd: range.to,
  });

  const change = minimalChange(value, next.value);

  return {
    ...(change === null ? {} : { changes: change }),
    selection: EditorSelection.single(next.selectionStart, next.selectionEnd),
    scrollIntoView: true,
    // 버튼 한 번이 되돌리기 한 단계다 — 이어지는 타이핑과 뭉치지 않게 따로 표시한다.
    userEvent: "input.markdown",
  };
}
