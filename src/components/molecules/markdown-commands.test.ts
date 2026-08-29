import { describe, expect, it } from "vitest";

import {
  applyMarkdownCommand,
  type EditorText,
} from "@/components/molecules/markdown-commands";

/**
 * Toolbar 가 실제로 무엇을 넣는지 고정한다.
 *
 * 🔴 **커서 위치까지 함께 본다.** 문법만 맞고 커서가 엉뚱한 자리에 남으면 「버튼을 누르고
 * 바로 이어 쓴다」가 되지 않아, 결국 손으로 치는 것과 같아진다.
 */

function at(value: string, selectionStart: number, selectionEnd = selectionStart): EditorText {
  return { value, selectionStart, selectionEnd };
}

describe("applyMarkdownCommand", () => {
  it("선택한 글자를 굵게 감싸고 그 글자를 다시 고른 채로 둔다", () => {
    const result = applyMarkdownCommand("bold", at("hello world", 6, 11));

    expect(result.value).toBe("hello **world**");
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe(
      "world",
    );
  });

  it("이미 굵은 글자를 다시 누르면 표식을 걷어낸다", () => {
    // 표식 «바깥»이 감싸진 경우 — 글자만 골라 놓고 누른다.
    const result = applyMarkdownCommand("bold", at("**world**", 2, 7));

    expect(result.value).toBe("world");
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe(
      "world",
    );
  });

  it("선택이 없으면 표식 사이에 커서를 둔다", () => {
    const result = applyMarkdownCommand("inlineCode", at("", 0));

    expect(result.value).toBe("``");
    expect(result.selectionStart).toBe(1);
    expect(result.selectionEnd).toBe(1);
  });

  it("커서가 놓인 줄 전체에 제목 표식을 붙인다", () => {
    const result = applyMarkdownCommand("heading", at("intro\nTransaction 경계\ntail", 9));

    expect(result.value).toBe("intro\n## Transaction 경계\ntail");
  });

  it("제목을 다시 누르면 표식이 사라진다", () => {
    const result = applyMarkdownCommand("heading", at("## Transaction", 4));

    expect(result.value).toBe("Transaction");
  });

  it("여러 줄에 번호를 이어서 매긴다", () => {
    const result = applyMarkdownCommand("numberedList", at("first\nsecond\nthird", 0, 18));

    expect(result.value).toBe("1. first\n2. second\n3. third");
  });

  it("글머리 목록을 번호 목록으로 바꿔도 표식이 겹치지 않는다", () => {
    const result = applyMarkdownCommand("numberedList", at("- first\n- second", 0, 16));

    expect(result.value).toBe("1. first\n2. second");
  });

  it("코드 블록은 울타리를 제 줄에 두고 안쪽을 고른 채로 둔다", () => {
    const result = applyMarkdownCommand("codeBlock", at("const a = 1;", 0, 12));

    expect(result.value).toBe("```\nconst a = 1;\n```");
    expect(result.value.slice(result.selectionStart, result.selectionEnd)).toBe(
      "const a = 1;",
    );
  });

  it("코드 블록을 다시 누르면 울타리를 걷어낸다", () => {
    const result = applyMarkdownCommand(
      "codeBlock",
      at("```\nconst a = 1;\n```", 0, 20),
    );

    expect(result.value).toBe("const a = 1;");
  });

  it("고른 것이 주소면 주소 자리에 넣고 글자 자리에 커서를 둔다", () => {
    const result = applyMarkdownCommand("link", at("https://example.com", 0, 19));

    expect(result.value).toBe("[](https://example.com)");
    expect(result.selectionStart).toBe(1);
  });

  it("고른 것이 글자면 주소 자리에 커서를 둔다", () => {
    const result = applyMarkdownCommand("link", at("ReviewTrace", 0, 11));

    expect(result.value).toBe("[ReviewTrace]()");
    expect(result.selectionStart).toBe(14);
  });

  it("빈 글의 맨 앞에서도 줄 범위를 잘못 잡지 않는다", () => {
    const result = applyMarkdownCommand("bulletList", at("", 0));

    expect(result.value).toBe("- ");
  });
});
