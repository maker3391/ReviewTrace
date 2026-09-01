import { describe, expect, it } from "vitest";

import {
  knowledgePageSchema,
  resolveKnowledgePageInput,
} from "@/features/knowledge/schemas/knowledge-page";

describe("knowledgePageSchema", () => {
  it("제목은 필수다", () => {
    expect(knowledgePageSchema.safeParse({ title: "" }).success).toBe(false);
  });

  it("본문은 비어 있어도 된다 — 제목만 먼저 만들어 둘 수 있어야 한다", () => {
    const parsed = knowledgePageSchema.parse({ title: "Transaction 규칙" });

    expect(parsed.content).toBe("");
    expect(parsed.slug).toBe("");
  });

  it("🔴 본문의 앞뒤 공백을 지우지 않는다 — Markdown 의 들여쓰기가 뜻을 갖는다", () => {
    const parsed = knowledgePageSchema.parse({
      title: "T",
      content: "  들여쓴 줄\n",
    });

    expect(parsed.content).toBe("  들여쓴 줄\n");
  });
});

describe("resolveKnowledgePageInput", () => {
  it("slug 를 비우면 제목에서 만든다", () => {
    const resolved = resolveKnowledgePageInput({
      title: "Git PR Rules",
      slug: "",
      content: "",
    });

    expect(resolved.ok && resolved.value.slug).toBe("git-pr-rules");
  });

  it("🔴 `new`·`edit` 는 화면 주소라 slug 가 될 수 없다", () => {
    for (const reserved of ["new", "edit"]) {
      expect(
        resolveKnowledgePageInput({ title: reserved, slug: "", content: "" })
          .ok,
      ).toBe(false);
    }
  });
});
