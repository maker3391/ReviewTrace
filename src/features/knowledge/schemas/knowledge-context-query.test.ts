import { describe, expect, it } from "vitest";

import {
  KNOWLEDGE_LIMIT_DEFAULT,
  KNOWLEDGE_LIMIT_MAX,
  knowledgeContextQuerySchema,
  readKnowledgeContextQuery,
} from "@/features/knowledge/schemas/knowledge-context-query";

/**
 * 되돌림 확인(2026-08-28): `limit` 의 `.max(KNOWLEDGE_LIMIT_MAX)` 를 떼면
 * 「상한을 넘는 limit 을 거절한다」가 실패한다. 직접 확인했다.
 */
describe("knowledgeContextQuerySchema", () => {
  it("Filter 없이도 통과한다", () => {
    const result = knowledgeContextQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    expect(result.data?.limit).toBe(KNOWLEDGE_LIMIT_DEFAULT);
    expect(result.data?.repositoryId).toBeNull();
    expect(result.data?.category).toBeNull();
    expect(result.data?.severity).toBeNull();
    expect(result.data?.pattern).toBeNull();
  });

  it("문자열 limit 을 숫자로 읽는다", () => {
    expect(knowledgeContextQuerySchema.parse({ limit: "5" }).limit).toBe(5);
  });

  it("상한을 넘는 limit 을 거절한다", () => {
    expect(
      knowledgeContextQuerySchema.safeParse({
        limit: String(KNOWLEDGE_LIMIT_MAX + 1),
      }).success,
    ).toBe(false);
    expect(knowledgeContextQuerySchema.safeParse({ limit: "0" }).success).toBe(
      false,
    );
    expect(
      knowledgeContextQuerySchema.safeParse({ limit: "many" }).success,
    ).toBe(false);
  });

  it("UUID 가 아닌 repositoryId 를 거절한다 — Driver 가 던지기 전에 막는다", () => {
    expect(
      knowledgeContextQuerySchema.safeParse({ repositoryId: "1; drop table" })
        .success,
    ).toBe(false);
  });

  it("알 수 없는 category·severity 를 거절한다", () => {
    expect(
      knowledgeContextQuerySchema.safeParse({ category: "STYLE" }).success,
    ).toBe(false);
    expect(
      knowledgeContextQuerySchema.safeParse({ severity: "URGENT" }).success,
    ).toBe(false);
  });
});

describe("readKnowledgeContextQuery", () => {
  it("빈 값은 빠뜨린다 — 「Filter 를 안 걸었다」가 「잘못된 요청」이 되지 않게", () => {
    const params = new URLSearchParams(
      "repositoryId=&category=SECURITY&limit=7",
    );

    expect(readKnowledgeContextQuery(params)).toEqual({
      category: "SECURITY",
      limit: "7",
    });
  });

  it("모르는 Query 는 읽지 않는다", () => {
    const params = new URLSearchParams("workspaceId=x&limit=3");

    expect(readKnowledgeContextQuery(params)).toEqual({ limit: "3" });
  });
});
