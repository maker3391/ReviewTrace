import { describe, expect, it } from "vitest";

import {
  MAX_ISSUES_PER_REVIEW,
  reviewIngestSchema,
} from "@/features/reviews/schemas/review-ingest";

/**
 * 되돌림 확인(2026-08-28): `reviewIngestSchema` 에서 `issues` 의 `.max()` 를 떼면
 * 「상한을 넘는 Issue 를 거절한다」가 실패한다. `externalRepositoryId` 를 `.optional()` 로
 * 되돌리면 「Provider 식별자 없이 거절한다」가 실패한다. 둘 다 직접 확인했다.
 */

const validPayload = {
  repository: {
    provider: "GITHUB",
    externalRepositoryId: "123456789",
    owner: "owner",
    name: "repository",
    fullName: "owner/repository",
    defaultBranch: "main",
    htmlUrl: "https://github.com/owner/repository",
  },
  target: { type: "COMMIT", branch: "develop", commitSha: "a81f3c2" },
  reviewer: { type: "AGENT", name: "codex", version: null },
  summary: "Review summary",
  issues: [
    {
      severity: "HIGH",
      category: "CONCURRENCY",
      patternKey: "REFRESH_TOKEN_RACE_CONDITION",
      title: "Refresh token rotation race condition",
      description: "Concurrent requests can rotate the same token family.",
      filePath: "src/RefreshTokenService.java",
      startLine: 82,
      endLine: 101,
      suggestion: "Make family rotation atomic.",
      tags: ["refresh-token", "race-condition"],
    },
  ],
};

describe("reviewIngestSchema", () => {
  it("스펙 29 의 Payload 를 그대로 받는다", () => {
    const result = reviewIngestSchema.safeParse(validPayload);

    expect(result.success).toBe(true);
    expect(result.data?.issues[0]?.severity).toBe("HIGH");
    expect(result.data?.issues[0]?.tags).toEqual([
      "refresh-token",
      "race-condition",
    ]);
  });

  it("🔴 Payload 로 Workspace 를 지정할 수 없다", () => {
    const result = reviewIngestSchema.safeParse({
      ...validPayload,
      workspaceId: "11111111-1111-1111-1111-111111111111",
    });

    // Zod 는 모르는 Key 를 버린다 — 통과하되 값이 넘어가지 않는 것이 요점이다.
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("workspaceId");
  });

  it("Provider 식별자 없이 거절한다", () => {
    const repository: Record<string, unknown> = { ...validPayload.repository };
    delete repository.externalRepositoryId;

    const result = reviewIngestSchema.safeParse({ ...validPayload, repository });

    expect(result.success).toBe(false);
  });

  it("알 수 없는 severity·category 를 거절한다", () => {
    expect(
      reviewIngestSchema.safeParse({
        ...validPayload,
        issues: [{ ...validPayload.issues[0], severity: "URGENT" }],
      }).success,
    ).toBe(false);

    expect(
      reviewIngestSchema.safeParse({
        ...validPayload,
        issues: [{ ...validPayload.issues[0], category: "STYLE" }],
      }).success,
    ).toBe(false);
  });

  it("endLine 이 startLine 보다 앞서면 거절한다", () => {
    const result = reviewIngestSchema.safeParse({
      ...validPayload,
      issues: [{ ...validPayload.issues[0], startLine: 101, endLine: 82 }],
    });

    expect(result.success).toBe(false);
  });

  it("문제를 찾지 못한 Review 도 받는다 — 「깨끗했다」도 Knowledge 다", () => {
    const result = reviewIngestSchema.safeParse({ ...validPayload, issues: [] });

    expect(result.success).toBe(true);
    expect(result.data?.issues).toEqual([]);
  });

  it("Issue 상한을 넘으면 거절한다", () => {
    const result = reviewIngestSchema.safeParse({
      ...validPayload,
      issues: Array.from({ length: MAX_ISSUES_PER_REVIEW + 1 }, () => ({
        ...validPayload.issues[0],
      })),
    });

    expect(result.success).toBe(false);
  });

  it("없는 값은 undefined 가 아니라 null 로 모인다", () => {
    const result = reviewIngestSchema.parse({
      repository: {
        provider: "GITHUB",
        externalRepositoryId: "1",
        owner: "o",
        name: "n",
        fullName: "o/n",
      },
      target: { type: "MANUAL" },
      reviewer: { type: "HUMAN", name: "사장님" },
      issues: [],
    });

    expect(result.summary).toBeNull();
    expect(result.target.branch).toBeNull();
    expect(result.target.commitSha).toBeNull();
    expect(result.target.pullRequestNumber).toBeNull();
    expect(result.reviewer.version).toBeNull();
    expect(result.startedAt).toBeNull();
    // defaultBranch 는 기본값이 있다 — Repository 는 언제나 기준 Branch 를 갖는다.
    expect(result.repository.defaultBranch).toBe("main");
  });

  it("ISO-8601 시각을 Date 로 바꾼다", () => {
    const result = reviewIngestSchema.parse({
      ...validPayload,
      startedAt: "2026-08-28T01:02:03.000Z",
      completedAt: "2026-08-28T01:05:00.000Z",
    });

    expect(result.startedAt?.toISOString()).toBe("2026-08-28T01:02:03.000Z");
    expect(result.completedAt?.toISOString()).toBe("2026-08-28T01:05:00.000Z");
  });

  /**
   * 🔴 `htmlUrl` 은 화면이 `<a href>` 로 그리는 유일한 «Agent 가 준» 주소다.
   *
   * 되돌림 확인(2026-08-28): `z.httpUrl()` 을 `z.url()` 로 되돌리면 아래 세 건이 전부
   * 통과해 버린다 — Zod 의 `url()` 은 Scheme 을 보지 않는다. 직접 돌려 봤다.
   */
  describe("htmlUrl 의 Scheme", () => {
    const withUrl = (htmlUrl: string) => ({
      ...validPayload,
      repository: { ...validPayload.repository, htmlUrl },
    });

    it("http·https 만 받는다", () => {
      expect(
        reviewIngestSchema.safeParse(withUrl("https://github.com/a/b")).success,
      ).toBe(true);
      expect(
        reviewIngestSchema.safeParse(withUrl("http://git.internal/a/b")).success,
      ).toBe(true);
    });

    it("스크립트가 되는 Scheme 을 거절한다", () => {
      expect(
        reviewIngestSchema.safeParse(withUrl("javascript:alert(1)")).success,
      ).toBe(false);
      expect(
        reviewIngestSchema.safeParse(withUrl("data:text/html,<script>x</script>"))
          .success,
      ).toBe(false);
      expect(
        reviewIngestSchema.safeParse(withUrl("vbscript:msgbox(1)")).success,
      ).toBe(false);
    });
  });
});
