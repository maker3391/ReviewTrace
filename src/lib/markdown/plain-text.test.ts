import { describe, expect, it } from "vitest";

import { markdownToPlainText } from "@/lib/markdown/plain-text";

/**
 * compact preview 의 평문 변환.
 *
 * 🔴 **판정은 「Markdown 표기가 결과에 남지 않는가」다.** 문구가 살아 있는지도 함께 본다 —
 * 표기를 지우려고 내용을 지우면 목록이 읽을 것을 잃는다.
 */

/** 표기만 골라 본다. 본문 글자와 섞이지 않게 실제 marker 모양으로 찾는다. */
function hasMarkdownMarker(value: string): boolean {
  return (
    /(^|\s)#{1,6}\s/.test(value) ||
    value.includes("**") ||
    value.includes("`") ||
    /(^|\s)>\s/.test(value) ||
    /(^|\s)[-*+]\s/.test(value) ||
    /(^|\s)\d+\.\s/.test(value) ||
    value.includes("|")
  );
}

describe("markdownToPlainText", () => {
  it("heading 의 `##` 을 걷어내고 문구를 남긴다", () => {
    const result = markdownToPlainText(
      "## 직접 원인\n\n외부 호출이 transaction 안에 있었다.\n\n### 영향 범위\n\n결제만 해당한다.",
    );

    expect(result).toBe(
      "직접 원인 외부 호출이 transaction 안에 있었다. 영향 범위 결제만 해당한다.",
    );
    expect(hasMarkdownMarker(result)).toBe(false);
  });

  it("bold 의 `**` 을 걷어내고 문구를 남긴다", () => {
    const result = markdownToPlainText("transaction 경계를 **밖으로** 옮겼다.");

    expect(result).toBe("transaction 경계를 밖으로 옮겼다.");
    expect(hasMarkdownMarker(result)).toBe(false);
  });

  it("inline code 의 백틱을 걷어내고 식별자를 남긴다", () => {
    const result = markdownToPlainText(
      "`OrderService.pay` 에서 `RestClient` 호출을 뺐다.",
    );

    expect(result).toBe("OrderService.pay 에서 RestClient 호출을 뺐다.");
    expect(hasMarkdownMarker(result)).toBe(false);
  });

  it("ordered list 의 번호 표기를 걷어낸다", () => {
    const result = markdownToPlainText(
      "1. 경계를 좁힌다\n2. 외부 호출을 뒤로 뺀다\n3. 회귀 시험을 더한다",
    );

    expect(result).toBe(
      "경계를 좁힌다 외부 호출을 뒤로 뺀다 회귀 시험을 더한다",
    );
    expect(hasMarkdownMarker(result)).toBe(false);
  });

  it("unordered list 의 `-` 를 걷어내고 중첩까지 편다", () => {
    const result = markdownToPlainText(
      "- 확인됨\n- 재현 실패\n  - 순차 실행만 돌렸다",
    );

    expect(result).toBe("확인됨 재현 실패 순차 실행만 돌렸다");
    expect(hasMarkdownMarker(result)).toBe(false);
  });

  it("blockquote 의 `>` 를 걷어낸다", () => {
    const result = markdownToPlainText("> 재현하지 못한 것은 결함이 아니다.");

    expect(result).toBe("재현하지 못한 것은 결함이 아니다.");
    expect(hasMarkdownMarker(result)).toBe(false);
  });

  it("fenced code block 은 통째로 버리고 설명만 남긴다", () => {
    const result = markdownToPlainText(
      "경계를 옮겼다.\n\n```sql\nBEGIN; SELECT * FROM orders; COMMIT;\n```\n\n회귀 시험을 더했다.",
    );

    expect(result).toBe("경계를 옮겼다. 회귀 시험을 더했다.");
    expect(result).not.toContain("BEGIN");
    expect(hasMarkdownMarker(result)).toBe(false);
  });

  it("table 은 통째로 버리고 설명만 남긴다", () => {
    const result = markdownToPlainText(
      "되돌림을 확인했다.\n\n| 되돌린 것 | 결과 |\n| --- | --- |\n| 잠금 순서 | deadlock |\n",
    );

    expect(result).toBe("되돌림을 확인했다.");
    expect(hasMarkdownMarker(result)).toBe(false);
  });

  /**
   * 🔴 **08-28~09-01 에 저장된 12행이 이 모양이다** — 개행도 문법도 없는 평문.
   * 변환이 그것을 건드리면 지금 화면에 잘 나오던 값이 망가진다.
   */
  it("문법도 개행도 없는 기존 평문은 사실상 그대로 남는다", () => {
    const stored =
      "DB transaction 범위를 축소하고 외부 API 호출을 transaction 밖으로 이동";

    expect(markdownToPlainText(stored)).toBe(stored);
  });

  it("code block 이나 table 뿐인 문서에서도 미리보기가 비지 않는다", () => {
    expect(markdownToPlainText("```ts\nconst limit = 100;\n```")).toBe(
      "const limit = 100;",
    );
    expect(
      markdownToPlainText("| 항목 | 값 |\n| --- | --- |\n| 상한 | 100 |\n"),
    ).toBe("항목 값 상한 100");
  });

  it("빈 값과 공백만 있는 값은 빈 문자열이다", () => {
    expect(markdownToPlainText("")).toBe("");
    expect(markdownToPlainText("   \n\n  ")).toBe("");
  });

  it("link 는 문구만 남기고 URL 을 버린다", () => {
    expect(
      markdownToPlainText(
        "[운영 복구 절차](https://example.com/runbook)를 따랐다.",
      ),
    ).toBe("운영 복구 절차를 따랐다.");
  });
});
