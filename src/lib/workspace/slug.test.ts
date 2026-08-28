import { describe, expect, it } from "vitest";

import { normalizeSlug, slugCandidate } from "@/lib/workspace/slug";

describe("normalizeSlug", () => {
  it("GitHub 아이디는 그대로 통과한다 — 이미 URL 에 안전하다", () => {
    expect(normalizeSlug("maker3391")).toBe("maker3391");
    expect(normalizeSlug("some-user")).toBe("some-user");
  });

  it("대문자를 소문자로 맞춘다 — 주소가 대소문자로 갈리지 않게", () => {
    expect(normalizeSlug("MakerName")).toBe("makername");
  });

  it("주소에서 인코딩될 글자를 하이픈으로 접는다", () => {
    expect(normalizeSlug("my workspace")).toBe("my-workspace");
    expect(normalizeSlug("a/b?c=d")).toBe("a-b-c-d");
    expect(normalizeSlug("a...b")).toBe("a-b");
  });

  it("앞뒤 하이픈을 남기지 않는다", () => {
    expect(normalizeSlug("  hello  ")).toBe("hello");
    expect(normalizeSlug("--hello--")).toBe("hello");
  });

  it("남는 글자가 없으면 기본값으로 떨어진다 — 빈 slug 를 만들지 않는다", () => {
    expect(normalizeSlug("한글이름")).toBe("workspace");
    expect(normalizeSlug("!!!")).toBe("workspace");
    expect(normalizeSlug("")).toBe("workspace");
  });

  it("길이를 자른 뒤에도 하이픈으로 끝나지 않는다", () => {
    const value = `${"a".repeat(39)}-bbbb`;
    const slug = normalizeSlug(value);

    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("slugCandidate", () => {
  it("첫 후보는 다듬은 이름 그대로다", () => {
    expect(slugCandidate("acme", 0)).toBe("acme");
  });

  it("겹치면 번호를 붙여 다음 후보를 낸다", () => {
    expect(slugCandidate("acme", 1)).toBe("acme-2");
    expect(slugCandidate("acme", 2)).toBe("acme-3");
  });

  it("번호를 붙여도 길이 상한을 넘지 않는다", () => {
    const long = "a".repeat(60);

    for (const attempt of [0, 1, 5]) {
      expect(slugCandidate(long, attempt).length).toBeLessThanOrEqual(40);
    }
  });

  it("후보끼리 겹치지 않는다 — 같은 slug 를 반복 시도하면 영원히 실패한다", () => {
    const candidates = [0, 1, 2, 3, 4].map((attempt) =>
      slugCandidate("acme", attempt),
    );

    expect(new Set(candidates).size).toBe(candidates.length);
  });
});
