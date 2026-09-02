import { describe, expect, it } from "vitest";

import { issueEditSchema } from "@/features/issues/schemas/issue-edit";

/**
 * 서술 수정 폼이 **무엇을 받고 무엇을 버리는가**.
 *
 * 🔴 이 시험의 핵심은 「고칠 수 있는 칸」이 아니라 **「고칠 수 «없는» 칸」**이다.
 * Schema 가 열려 있으면 화면을 거치지 않고 Server Action 을 직접 부르는 요청 하나가
 * 곧바로 상태·집계 축을 덮어쓴다.
 */

const MINIMAL = { title: "Transaction 밖으로 외부 호출을 옮겨야 한다" };

describe("issueEditSchema — 무엇을 고칠 수 있는가", () => {
  it("제목만 있으면 통과하고, 나머지 서술은 `null` 로 모인다", () => {
    const parsed = issueEditSchema.parse(MINIMAL);

    expect(parsed).toEqual({
      title: MINIMAL.title,
      description: null,
      rootCause: null,
      failurePath: null,
      suggestion: null,
    });
  });

  it("🔴 빈 칸은 「지운다」로 읽는다 — `undefined` 로 남지 않는다", () => {
    const parsed = issueEditSchema.parse({
      ...MINIMAL,
      description: "",
      rootCause: "   ",
      failurePath: null,
      suggestion: undefined,
    });

    expect(parsed.description).toBeNull();
    expect(parsed.rootCause).toBeNull();
    expect(parsed.failurePath).toBeNull();
    expect(parsed.suggestion).toBeNull();
  });

  it("제목은 비울 수 없다", () => {
    expect(issueEditSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(issueEditSchema.safeParse({ title: undefined }).success).toBe(false);
  });

  it("상한을 넘는 제목·서술을 거절한다", () => {
    expect(
      issueEditSchema.safeParse({ title: "a".repeat(501) }).success,
    ).toBe(false);
    expect(
      issueEditSchema.safeParse({
        ...MINIMAL,
        description: "a".repeat(20_001),
      }).success,
    ).toBe(false);
    expect(
      issueEditSchema.safeParse({
        ...MINIMAL,
        description: "a".repeat(20_000),
      }).success,
    ).toBe(true);
  });
});

describe("issueEditSchema — 고칠 수 «없는» 칸", () => {
  /**
   * 🔴 **이 목록이 이 기능의 경계다.**
   *
   * | 칸 | 왜 버리는가 |
   * |---|---|
   * | `status` · `resolvedAt` · `resolutionSummary` | 상태 전이가 넷을 함께 움직인다 |
   * | `severity` · `category` · `patternKey` | 집계·Index 의 축이다 |
   * | `filePath` · `startLine` · `endLine` | 같은 문제를 다시 짚는 좌표다 |
   * | `source` · `externalId` | 같은 문제를 한 행으로 유지하는 신원이다 |
   * | `reviewSessionId` · `repositoryId` · `firstDetectedAt` | provenance 다 |
   */
  const FORBIDDEN = {
    status: "RESOLVED",
    resolvedAt: new Date(0),
    resolutionSummary: "몰래 적어 넣은 해결 요약",
    severity: "LOW",
    category: "CLEAN_CODE",
    patternKey: "SOMETHING_ELSE",
    filePath: "src/other.ts",
    startLine: 1,
    endLine: 2,
    source: "other-agent",
    externalId: "other-1",
    reviewSessionId: "00000000-0000-4000-8000-000000000000",
    repositoryId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
    firstDetectedAt: new Date(0),
  } as const;

  it("🔴 폼 밖의 칸을 실어 보내도 하나도 통과하지 않는다", () => {
    const parsed = issueEditSchema.parse({ ...MINIMAL, ...FORBIDDEN });

    for (const key of Object.keys(FORBIDDEN)) {
      expect(parsed).not.toHaveProperty(key);
    }

    expect(Object.keys(parsed).sort()).toEqual([
      "description",
      "failurePath",
      "rootCause",
      "suggestion",
      "title",
    ]);
  });
});

describe("issueEditSchema — Markdown 원문", () => {
  /**
   * 🔴 **원문이 정본이다.** 화면은 렌더된 결과를 보여 주지만 저장되는 것은 이 문자열
   * 그대로다 — Agent 가 다시 읽어 갈 Knowledge 이기도 하다.
   */
  const SOURCE = [
    "`RefreshTokenService.java` 의 rotation 이 경쟁한다.",
    "",
    "1. 두 요청이 같은 token 을 읽는다",
    "2. 둘 다 새 token 을 쓴다",
    "",
    "```java",
    "  if (token.isUsed()) {",
    "      throw new IllegalStateException();",
    "  }",
    "```",
    "",
    "| 조건 | 결과 |",
    "|---|---|",
    "| 순차 | 정상 |",
    "| 동시 | 유실 |",
  ].join("\n");

  it("🔴 문단·목록·코드블록·표가 문자 단위로 그대로 남는다", () => {
    const parsed = issueEditSchema.parse({ ...MINIMAL, failurePath: SOURCE });

    expect(parsed.failurePath).toBe(SOURCE);
  });

  it("앞뒤 공백만 다듬고 «안쪽» 들여쓰기·빈 줄은 건드리지 않는다", () => {
    const parsed = issueEditSchema.parse({
      ...MINIMAL,
      rootCause: `\n\n${SOURCE}\n\n`,
    });

    expect(parsed.rootCause).toBe(SOURCE);
    // 코드블록 안의 들여쓰기가 살아 있어야 한다 — 죽으면 Markdown 의 뜻이 바뀐다.
    expect(parsed.rootCause).toContain("  if (token.isUsed()) {");
  });
});
