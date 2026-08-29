import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 🔴 **Agent API 는 Project 로 좁히지 «않는다» — 그 사실을 못 박는 회귀 시험.**
 *
 * 화면 쪽 쓰기 경로를 주소의 Project 까지 좁히면서, 다음 사람이 「그럼 Agent 도 좁혀야지」
 * 라고 읽을 여지가 생겼다. **그것은 계약 위반이다**(CLAUDE.md 13):
 *
 * ```
 * API Key -> Workspace 결정.  Payload 에도 Query 에도 Project 자리가 없다.
 * ```
 *
 * Agent 는 화면이 없어 Project 를 미리 만들 수도, 고를 수도 없다. 여기에 Project 를
 * 요구하는 순간 이미 돌고 있는 Agent 의 상태 전이가 전부 `404` 가 된다.
 *
 * ## 🔴 이 시험이 지키지 «못하는» 것
 *
 * 인증과 Application Service 를 갈아 끼운다. 「폐기된 Key 가 막히는가」는
 * `api-key-auth.test.ts` 의 몫이고, 여기서 보는 것은 **Route 가 Service 에 무엇을
 * 넘기는가** 하나다.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const ISSUE = "33333333-3333-4333-8333-333333333333";

const authenticateAgent = vi.fn();
const updateIssueStatus = vi.fn();

vi.mock("next/server", () => ({ after: vi.fn() }));

vi.mock("@/lib/api/api-key-auth", () => ({
  authenticateAgent: (...args: unknown[]) => authenticateAgent(...args),
}));

vi.mock("@/features/issues/server/issue-status-service", () => ({
  updateIssueStatus: (...args: unknown[]) => updateIssueStatus(...args),
}));

vi.mock("@/features/issues/server/code-evidence-service", () => ({
  verifyCodeEvidence: vi.fn(),
}));

vi.mock("@/features/issues/server/issue-agent-query", () => ({
  findAgentIssue: vi.fn(),
}));

const { PATCH } = await import("@/app/api/v1/issues/[issueId]/route");

beforeEach(() => {
  vi.clearAllMocks();

  authenticateAgent.mockResolvedValue({
    workspaceId: WORKSPACE,
    apiKeyName: "codex-ci",
  });
  updateIssueStatus.mockResolvedValue({
    id: ISSUE,
    status: "RESOLVED",
    resolutionSummary: "고쳤다",
    resolvedAt: new Date("2026-08-28T00:00:00.000Z"),
    updatedAt: new Date("2026-08-28T00:00:00.000Z"),
    evidenceIds: [],
  });
});

function patchRequest(body: unknown) {
  return new Request(`https://example.test/api/v1/issues/${ISSUE}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = {
  params: Promise.resolve({ issueId: ISSUE }),
} as Parameters<typeof PATCH>[1];

describe("PATCH /api/v1/issues/{issueId}", () => {
  it("🔴 Project 없이 통과한다 — 범위는 Workspace 하나뿐이다", async () => {
    const response = await PATCH(
      patchRequest({ status: "RESOLVED", resolutionSummary: "고쳤다" }),
      context,
    );

    expect(response.status).toBe(200);

    const [input] = updateIssueStatus.mock.calls[0] as [
      { scope: Record<string, unknown>; issueId: string },
    ];

    // 🔴 여기에 projectId 가 생기면 이미 돌고 있는 Agent 가 전부 404 를 받는다.
    expect(input.scope).toEqual({ workspaceId: WORKSPACE });
    expect(input.issueId).toBe(ISSUE);
  });

  it("actor 를 안 보내면 API Key 이름이 대신 남는다", async () => {
    await PATCH(
      patchRequest({ status: "RESOLVED", resolutionSummary: "고쳤다" }),
      context,
    );

    const [input] = updateIssueStatus.mock.calls[0] as [
      { fallbackActorName: string },
    ];

    expect(input.fallbackActorName).toBe("codex-ci");
  });

  it("RESOLVED 인데 해결 요약이 없으면 Service 를 부르지 않는다", async () => {
    const response = await PATCH(
      patchRequest({ status: "RESOLVED" }),
      context,
    );

    expect(response.status).toBe(400);
    expect(updateIssueStatus).not.toHaveBeenCalled();
  });
});
