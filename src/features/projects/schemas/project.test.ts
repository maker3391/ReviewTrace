import { describe, expect, it } from "vitest";

import {
  createProjectSchema,
  resolveProjectInput,
} from "@/features/projects/schemas/project";

/**
 * Project 입력 계약.
 *
 * 지키는 것은 **화면과 서버가 같은 판정을 한다**는 것이다 — 두 곳이 다른 Schema 를 보면
 * 브라우저는 통과시키는데 서버는 거절하는 값이 생긴다(CLAUDE.md 9).
 */
describe("createProjectSchema", () => {
  it("이름은 필수다", () => {
    expect(createProjectSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("slug·설명은 없어도 된다 — 없으면 빈 문자열로 나온다", () => {
    const parsed = createProjectSchema.parse({ name: "SMIL" });

    expect(parsed.slug).toBe("");
    expect(parsed.description).toBe("");
  });

  it("앞뒤 공백을 정리한다 — 「 SMIL 」과 「SMIL」이 다른 Project 가 되지 않게", () => {
    expect(createProjectSchema.parse({ name: "  SMIL  " }).name).toBe("SMIL");
  });
});

describe("resolveProjectInput", () => {
  it("slug 를 비우면 이름에서 만든다", () => {
    const resolved = resolveProjectInput({
      name: "Code Intelligence",
      slug: "",
      description: "",
    });

    expect(resolved.ok).toBe(true);
    expect(resolved.ok && resolved.value.slug).toBe("code-intelligence");
  });

  it("slug 를 적으면 그것을 정규화해서 쓴다", () => {
    const resolved = resolveProjectInput({
      name: "Code Intelligence",
      slug: "  CI Core  ",
      description: "",
    });

    expect(resolved.ok && resolved.value.slug).toBe("ci-core");
  });

  it("빈 설명은 null 이다 — 빈 문자열과 「없음」을 두 값으로 두지 않는다", () => {
    const resolved = resolveProjectInput({ name: "A", slug: "", description: "" });

    expect(resolved.ok && resolved.value.description).toBeNull();
  });

  it("🔴 화면 주소로 쓰이는 이름은 slug 가 될 수 없다 — 주소가 갈린다", () => {
    for (const reserved of ["reviews", "issues", "knowledge", "repositories", "new"]) {
      const resolved = resolveProjectInput({
        name: reserved,
        slug: "",
        description: "",
      });

      expect(resolved.ok).toBe(false);
    }
  });

  it("한글만 있는 이름도 주소를 만든다 — 가입이 막히지 않게", () => {
    const resolved = resolveProjectInput({
      name: "정산 시스템",
      slug: "",
      description: "",
    });

    // 🔴 ASCII 가 아닌 글자는 버려지고 마지막 대비값이 남는다(`normalizeSlug`).
    expect(resolved.ok).toBe(true);
    expect(resolved.ok && resolved.value.slug).toBe("workspace");
  });
});
