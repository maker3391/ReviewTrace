import { describe, expect, it } from "vitest";

import { fakeExecutor, selects } from "@/db/testing/fake-executor";
import { findIssueDetail } from "@/features/issues/server/issue-detail-query";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ISSUE = "33333333-3333-4333-8333-333333333333";
const ACTIVITY = "44444444-4444-4444-8444-444444444444";

describe("findIssueDetail — 사람이 읽는 Knowledge", () => {
  it("🔴 Decision Record 와 Code Evidence 를 History 행에 함께 붙인다", async () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    const fake = fakeExecutor([
      selects([
        {
          id: ISSUE,
          title: "초대 수신자 검증 누락",
          description: "Token 소유자라면 누구나 수락할 수 있다.",
          rootCause: "초대 이메일과 로그인 계정 이메일을 맞대지 않았다.",
          failurePath: "공격자가 유출된 Token을 자기 계정으로 수락한다.",
          severity: "HIGH",
          category: "SECURITY",
          status: "RESOLVED",
          patternKey: "INVITATION_RECIPIENT_NOT_BOUND",
          filePath: "src/invitation.ts",
          startLine: 10,
          endLine: 20,
          suggestion: "이메일을 원자적으로 비교한다.",
          source: "codex",
          externalId: "SEC-1",
          resolutionSummary: "계정 이메일을 초대에 바인딩했다.",
          firstDetectedAt: now,
          resolvedAt: now,
          updatedAt: now,
          repositoryId: "55555555-5555-4555-8555-555555555555",
          repositoryFullName: "acme/app",
          reviewSessionId: "66666666-6666-4666-8666-666666666666",
          reviewerName: "codex",
          reviewBranch: "develop",
          reviewCommitSha: "abc123",
        },
      ]),
      selects([
        {
          id: ACTIVITY,
          type: "FIX_ATTEMPTED",
          actorType: "AGENT",
          actorName: "codex-ci",
          description: "수신자 바인딩을 추가했다.",
          commitSha: "abc123",
          createdAt: now,
          solution: "claim UPDATE에 이메일 조건을 넣었다.",
          decisionReason: "판정과 쓰기를 한 문장으로 유지한다.",
          alternativesConsidered: "사후 비교는 쓰기 후 검증이라 제외했다.",
          tradeOff: "이메일 변경 시 재초대가 필요하다.",
          verification: "PostgreSQL 통합 테스트를 통과했다.",
          regressionTest: "공격자 수락을 거절한다.",
          residualRisk: "인증 공급자의 이메일 검증에 의존한다.",
        },
      ]),
      selects([{ name: "security" }]),
      selects([
        {
          id: "77777777-7777-4777-8777-777777777777",
          issueActivityId: ACTIVITY,
          kind: "AFTER",
          commitSha: "abc123",
          filePath: "src/invitation.ts",
          startLine: 12,
          endLine: 14,
          snapshot: "eq(invitation.email, accountEmail)",
          verification: "VERIFIED",
          verifiedAt: now,
        },
        {
          id: "88888888-8888-4888-8888-888888888888",
          issueActivityId: null,
          kind: "BEFORE",
          commitSha: "before123",
          filePath: "src/invitation.ts",
          startLine: 10,
          endLine: 11,
          snapshot: "eq(invitation.tokenHash, tokenHash)",
          verification: "VERIFIED",
          verifiedAt: now,
        },
      ]),
    ]);

    const issue = await findIssueDetail(
      { workspaceId: WORKSPACE, projectId: PROJECT },
      ISSUE,
      fake.executor,
    );

    expect(issue?.rootCause).toContain("이메일");
    expect(issue?.failurePath).toContain("공격자");
    expect(issue).toMatchObject({
      repositoryFullName: "acme/app",
      reviewBranch: "develop",
      reviewCommitSha: "abc123",
    });
    expect(issue?.activities[0]).toMatchObject({
      solution: "claim UPDATE에 이메일 조건을 넣었다.",
      decisionReason: "판정과 쓰기를 한 문장으로 유지한다.",
      evidence: [
        {
          kind: "AFTER",
          snapshot: "eq(invitation.email, accountEmail)",
          verification: "VERIFIED",
        },
      ],
    });
    // Activity 없는 Evidence 도 잃지 않고 Issue 수준에 남긴다.
    expect(issue?.evidence).toEqual([
      expect.objectContaining({ kind: "BEFORE", commitSha: "before123" }),
    ]);
    expect(fake.remaining()).toBe(0);
  });

  it("범위 안 Issue가 없으면 History와 Evidence를 조회하지 않는다", async () => {
    const fake = fakeExecutor([selects([])]);

    await expect(
      findIssueDetail(
        { workspaceId: WORKSPACE, projectId: PROJECT },
        ISSUE,
        fake.executor,
      ),
    ).resolves.toBeNull();
    expect(fake.remaining()).toBe(0);
  });
});
