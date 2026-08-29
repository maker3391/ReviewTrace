import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import {
  markdownCommandTransaction,
  minimalChange,
} from "@/components/molecules/markdown-command-transaction";
import type { MarkdownCommand } from "@/components/molecules/markdown-commands";

/**
 * Toolbar ↔ CodeMirror 의 «이음매»만 본다.
 *
 * 🔴 **CodeMirror 자체를 시험하지 않는다.** 문법 규칙은 `markdown-commands.test.ts` 가
 * 이미 지키고 있고, 여기서 확인하는 것은 셋뿐이다 —
 * 「선택 범위를 제대로 읽어 왔는가」·「바뀐 구간만 고쳤는가」·「커서가 새 문서 기준으로 남는가」.
 *
 * `EditorState` 는 DOM 없이 만들어진다 — 그래서 이 시험은 브라우저 없이 돈다.
 */

function stateOf(doc: string, anchor: number, head = anchor): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
  });
}

function run(
  doc: string,
  anchor: number,
  head: number,
  command: MarkdownCommand,
): { doc: string; selected: string; changed: [number, number, string][] } {
  const state = stateOf(doc, anchor, head);
  const transaction = state.update(markdownCommandTransaction(state, command));

  const changed: [number, number, string][] = [];
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changed.push([fromA, toA, inserted.toString()]);
  });

  const next = transaction.state;
  return {
    doc: next.doc.toString(),
    selected: next.sliceDoc(next.selection.main.from, next.selection.main.to),
    changed,
  };
}

describe("minimalChange", () => {
  it("같은 글이면 아무것도 바꾸지 않는다", () => {
    expect(minimalChange("same", "same")).toBeNull();
  });

  it("앞뒤로 같은 부분을 빼고 바뀐 구간만 돌려준다", () => {
    expect(minimalChange("hello world", "hello **world**")).toEqual({
      from: 6,
      to: 11,
      insert: "**world**",
    });
  });

  it("대리 쌍 가운데를 자르지 않는다", () => {
    const change = minimalChange("a😀b", "a😃b");

    expect(change).not.toBeNull();
    expect("a😀b".slice(0, change!.from) + change!.insert + "a😀b".slice(change!.to)).toBe(
      "a😃b",
    );
    // 🔴 대리 쌍 전체가 통째로 바뀌어야 한다 — 반쪽만 바꾸면 깨진 글자가 남는다.
    expect(change!.insert).toBe("😃");
  });
});

describe("markdownCommandTransaction", () => {
  it("EditorState 의 선택 범위를 읽어 감싸고, 그 글자를 다시 고른 채로 둔다", () => {
    const result = run("hello world", 6, 11, "bold");

    expect(result.doc).toBe("hello **world**");
    expect(result.selected).toBe("world");
  });

  it("선택이 없으면 표식만 넣고 그 사이에 커서를 둔다", () => {
    const state = stateOf("", 0);
    const next = state.update(markdownCommandTransaction(state, "inlineCode")).state;

    expect(next.doc.toString()).toBe("``");
    expect(next.selection.main.empty).toBe(true);
    expect(next.selection.main.head).toBe(1);
  });

  it("🔴 긴 문서에서도 바뀐 구간 «하나»만 고친다", () => {
    const before = `${"# 지난 기록\n\n본문 한 줄\n".repeat(200)}Transaction 경계`;
    const target = before.length - "Transaction 경계".length;
    const result = run(before, target, before.length, "bold");

    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]?.[0]).toBe(target);
    expect(result.doc.startsWith("# 지난 기록\n\n본문 한 줄\n")).toBe(true);
    expect(result.doc.endsWith("**Transaction 경계**")).toBe(true);
  });

  it("줄 문법은 선택한 글자가 아니라 그 줄에 붙는다", () => {
    const result = run("intro\nTransaction 경계\ntail", 9, 9, "heading");

    expect(result.doc).toBe("intro\n## Transaction 경계\ntail");
  });

  it("여러 줄을 골라 번호를 매긴다", () => {
    const result = run("first\nsecond\nthird", 0, 18, "numberedList");

    expect(result.doc).toBe("1. first\n2. second\n3. third");
  });

  it("코드 블록 울타리를 제 줄에 두고 안쪽을 고른 채로 둔다", () => {
    const result = run("const a = 1;", 0, 12, "codeBlock");

    expect(result.doc).toBe("```\nconst a = 1;\n```");
    expect(result.selected).toBe("const a = 1;");
  });

  it("기존 Markdown 문서를 열어 한 곳만 고쳐도 나머지가 그대로다", () => {
    const original = [
      "# 제목",
      "",
      "- 첫째",
      "- 둘째",
      "",
      "```sql",
      "select 1;",
      "```",
      "",
      "본문 끝",
    ].join("\n");

    const from = original.indexOf("둘째");
    const result = run(original, from, from + 2, "italic");

    expect(result.doc).toBe(original.replace("둘째", "_둘째_"));
    expect(result.selected).toBe("둘째");
  });
});
