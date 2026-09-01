/**
 * Toolbar 버튼이 하는 일 — **Markdown 원문에 문법을 끼워 넣는 것**뿐이다.
 *
 * 🔴 **Rich-text Document Model 을 만들지 않는다**. 저장되는 것도 화면이
 * 다루는 것도 Markdown 문자열 하나다 — 버튼은 그 문자열을 바꾸고 커서를 어디에 둘지만
 * 정한다. Block 구조·Node Tree·Command Stack 이 없으므로 되돌리기는 브라우저의 기본
 * `undo` 가 그대로 맡는다.
 *
 * 🔴 **DOM 을 모른다.** `HTMLTextAreaElement` 를 받지 않고 「글 · 선택 범위」만 받아
 * 「글 · 선택 범위」를 돌려주는 순수 함수라, Component 없이 시험할 수 있다.
 *
 * 같은 버튼을 두 번 누르면 원래대로 돌아온다(toggle) — 실수로 누른 것을 되돌리려고
 * 문법을 손으로 지우게 만들지 않는다.
 */

export type MarkdownCommand =
  | "heading"
  | "bold"
  | "italic"
  | "inlineCode"
  | "codeBlock"
  | "link"
  | "bulletList"
  | "numberedList";

/** 편집 중인 글과 그 안의 선택 범위. `HTMLTextAreaElement` 에서 그대로 읽어 낼 수 있는 값이다. */
export interface EditorText {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

const FENCE = "```";

/** 줄머리 표식 — 목록끼리 바꿀 때 이전 표식을 먼저 걷어내려고 셋을 한 번에 본다. */
const ANY_LINE_PREFIX = /^(?:#{1,6} |[-*] |\d+\.)/;
const HEADING_PREFIX = /^#{1,6} /;
const BULLET_PREFIX = /^[-*] /;
const NUMBER_PREFIX = /^\d+\. /;

function replaceRange(
  text: EditorText,
  from: number,
  to: number,
  next: string,
  selectionStart: number,
  selectionEnd: number,
): EditorText {
  return {
    value: text.value.slice(0, from) + next + text.value.slice(to),
    selectionStart,
    selectionEnd,
  };
}

/**
 * `**` · `_` · `` ` `` 처럼 앞뒤를 감싸는 문법.
 *
 * 선택이 없으면 표식만 넣고 그 사이에 커서를 둔다 — 누르자마자 바로 타이핑할 수 있어야 한다.
 */
function toggleWrap(text: EditorText, marker: string): EditorText {
  const { value, selectionStart: start, selectionEnd: end } = text;
  const selected = value.slice(start, end);
  const width = marker.length;

  // 선택 «안쪽»이 이미 감싸져 있다.
  if (
    selected.length >= width * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(width, selected.length - width);
    return replaceRange(text, start, end, inner, start, start + inner.length);
  }

  // 선택 «바깥»이 감싸져 있다 — 표식을 뺀 채 글자만 고른 경우다.
  if (
    start >= width &&
    value.slice(start - width, start) === marker &&
    value.slice(end, end + width) === marker
  ) {
    return replaceRange(
      text,
      start - width,
      end + width,
      selected,
      start - width,
      start - width + selected.length,
    );
  }

  const wrapped = `${marker}${selected}${marker}`;
  const caret = start + width;
  return replaceRange(
    text,
    start,
    end,
    wrapped,
    caret,
    caret + selected.length,
  );
}

/**
 * 선택이 걸친 줄 전체의 범위.
 *
 * 🔴 **줄 단위 문법은 선택한 «글자»가 아니라 «줄»에 붙는다.** 한 줄의 가운데를 골라
 * 놓고 목록 버튼을 눌러도 그 줄이 통째로 항목이 되어야 한다.
 */
function selectedLineRange(
  value: string,
  start: number,
  end: number,
): { lineStart: number; lineEnd: number } {
  const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;

  // 줄바꿈 «직후»에서 선택이 끝났으면 그 다음 줄까지 끌어들이지 않는다.
  const searchFrom = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const found = value.indexOf("\n", searchFrom);

  return { lineStart, lineEnd: found === -1 ? value.length : found };
}

function togglePrefix(
  text: EditorText,
  kind: "heading" | "bulletList" | "numberedList",
): EditorText {
  const { value } = text;
  const { lineStart, lineEnd } = selectedLineRange(
    value,
    text.selectionStart,
    text.selectionEnd,
  );
  const lines = value.slice(lineStart, lineEnd).split("\n");

  const pattern =
    kind === "heading"
      ? HEADING_PREFIX
      : kind === "bulletList"
        ? BULLET_PREFIX
        : NUMBER_PREFIX;
  const alreadyApplied = lines.every((line) => pattern.test(line));

  const next = lines
    .map((line, index) => {
      const bare = line.replace(ANY_LINE_PREFIX, "");
      if (alreadyApplied) {
        return bare;
      }
      if (kind === "heading") {
        return `## ${bare}`;
      }
      if (kind === "bulletList") {
        return `- ${bare}`;
      }
      return `${index + 1}. ${bare}`;
    })
    .join("\n");

  return replaceRange(
    text,
    lineStart,
    lineEnd,
    next,
    lineStart,
    lineStart + next.length,
  );
}

/**
 * Fenced Code Block.
 *
 * 개발자 문서에서 가장 자주 쓰는 서식이라 버튼을 따로 둔다 — 인라인 코드와 달리
 * 울타리가 **제 줄에 홀로** 있어야 해서, 손으로 치면 줄바꿈을 자주 틀린다.
 */
function toggleCodeBlock(text: EditorText): EditorText {
  const { value } = text;
  const { lineStart, lineEnd } = selectedLineRange(
    value,
    text.selectionStart,
    text.selectionEnd,
  );
  const selected = value.slice(lineStart, lineEnd);
  const lines = selected.split("\n");

  const first = lines[0] ?? "";
  const last = lines[lines.length - 1] ?? "";

  if (lines.length >= 2 && first.startsWith(FENCE) && last.trim() === FENCE) {
    const inner = lines.slice(1, -1).join("\n");
    return replaceRange(
      text,
      lineStart,
      lineEnd,
      inner,
      lineStart,
      lineStart + inner.length,
    );
  }

  const block = `${FENCE}\n${selected}\n${FENCE}`;
  const caret = lineStart + FENCE.length + 1;
  return replaceRange(
    text,
    lineStart,
    lineEnd,
    block,
    caret,
    caret + selected.length,
  );
}

/**
 * 링크.
 *
 * 고른 것이 이미 주소면 주소 자리에 넣고 글자 자리에 커서를 둔다 — 붙여넣은 URL 을
 * 다시 잘라 옮기지 않게 한다.
 */
function insertLink(text: EditorText): EditorText {
  const { value, selectionStart: start, selectionEnd: end } = text;
  const selected = value.slice(start, end);

  if (selected === "") {
    return replaceRange(text, start, end, "[]()", start + 1, start + 1);
  }

  const looksLikeUrl = /^(?:https?:\/\/|mailto:|\/)/.test(selected);
  const next = looksLikeUrl ? `[](${selected})` : `[${selected}]()`;
  const caret = looksLikeUrl ? start + 1 : start + selected.length + 3;

  return replaceRange(text, start, end, next, caret, caret);
}

export function applyMarkdownCommand(
  command: MarkdownCommand,
  text: EditorText,
): EditorText {
  switch (command) {
    case "bold":
      return toggleWrap(text, "**");
    case "italic":
      return toggleWrap(text, "_");
    case "inlineCode":
      return toggleWrap(text, "`");
    case "heading":
    case "bulletList":
    case "numberedList":
      return togglePrefix(text, command);
    case "codeBlock":
      return toggleCodeBlock(text);
    case "link":
      return insertLink(text);
  }
}
