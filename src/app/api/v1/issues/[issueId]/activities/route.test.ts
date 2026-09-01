import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 🔴 **Agent API 는 Project 로 좁히지 «않는다» — 그 사실을 못 박는 회귀 시험.**
 *
 * 화면 쪽 쓰기 경로(상태 전이 · History · Repository 이동)를 주소의 Project 까지
 * 좁히면서, 다음 사람이 「그럼 Agent 도 좁혀야지」라고 읽을 여지가 생겼다.
 * **그것은 계약 위반이다**:
 *
 * ```
 * API Key -> Workspace 결정. Payload 에도 Query 에도 Project 자리가 없다.
 * ```
 *
 * Agent 는 화면이 없어 Project 를 미리 만들 수도, 고를 수도 없다. 여기에 Project 를
 * 요구하는 순간 이미 돌고 있는 Agent 의 History 기록이 전부 `404` 가 된다.
 *
 * 🔴 **`PATCH /issues/{id}` 쪽에는 같은 시험이 있는데 이쪽에는 없었다.** 형제 중 하나만
 * 지키면, 다음 사람은 지켜지지 않는 쪽을 고쳐 놓고 시험이 초록인 것을 보고 끝낸다.
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
const addIssueActivity = vi.fn();

vi.mock("next/server", () => ({ after: vi.fn() }));

vi.mock("@/lib/api/api-key-auth", () => ({
  authenticateAgent: (...args: unknown[]) => authenticateAgent(...args),
}));

vi.mock("@/features/issues/server/issue-activity-service", () => ({
  addIssueActivity: (...args: unknown[]) => addIssueActivity(...args),
}));

vi.mock("@/features/issues/server/code-evidence-service", () => ({
  verifyCodeEvidence: vi.fn(),
}));

const { POST } = await import("@/app/api/v1/issues/[issueId]/activities/route");

beforeEach(() => {
  vi.clearAllMocks();

  authenticateAgent.mockResolvedValue({
    workspaceId: WORKSPACE,
    apiKeyName: "codex-ci",
  });
  addIssueActivity.mockResolvedValue({
    id: "55555555-5555-4555-8555-555555555555",
    reviewIssueId: ISSUE,
    type: "FIX_ATTEMPTED",
    actorType: "AGENT",
    actorName: "claude",
    description: "Transaction 밖으로 옮겼다",
    commitSha: null,
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
    evidenceIds: [],
  });
});

function postRequest(body: unknown) {
  return new Request(`https://example.test/api/v1/issues/${ISSUE}/activities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = {
  params: Promise.resolve({ issueId: ISSUE }),
} as Parameters<typeof POST>[1];

const ACTIVITY = {
  type: "FIX_ATTEMPTED",
  actor: { type: "AGENT", name: "claude" },
  description: "Transaction 밖으로 옮겼다",
};

describe("POST /api/v1/issues/{issueId}/activities", () => {
  it("🔴 Project 없이 통과한다 — 범위는 Workspace 하나뿐이다", async () => {
    const response = await POST(postRequest(ACTIVITY), context);

    expect(response.status).toBe(201);

    const [input] = addIssueActivity.mock.calls[0] as [
      { scope: Record<string, unknown>; issueId: string },
    ];

    // 🔴 여기에 projectId 가 생기면 이미 돌고 있는 Agent 가 전부 404 를 받는다.
    expect(input.scope).toEqual({ workspaceId: WORKSPACE });
    expect(input.issueId).toBe(ISSUE);
  });

  it("Payload 로 Workspace 를 지정할 수 없다 — 범위는 API Key 가 정한다", async () => {
    await POST(
      postRequest({
        ...ACTIVITY,
        workspaceId: "99999999-9999-4999-8999-999999999999",
      }),
      context,
    );

    const [input] = addIssueActivity.mock.calls[0] as [
      { scope: Record<string, unknown> },
    ];

    expect(input.scope).toEqual({ workspaceId: WORKSPACE });
  });

  it("🔴 Payload 의 HUMAN 행위자를 무시하고 API Key Agent 를 기록한다", async () => {
    await POST(
      postRequest({ ...ACTIVITY, actor: { type: "HUMAN", name: "admin" } }),
      context,
    );

    const [input] = addIssueActivity.mock.calls[0] as [
      { activity: { actor: { type: string; name: string } } },
    ];

    expect(input.activity.actor).toEqual({ type: "AGENT", name: "codex-ci" });
  });

  it("형식이 아닌 issueId 는 Service 를 부르지 않는다", async () => {
    const response = await POST(postRequest(ACTIVITY), {
      params: Promise.resolve({ issueId: "not-a-uuid" }),
    } as Parameters<typeof POST>[1]);

    expect(response.status).toBe(400);
    expect(addIssueActivity).not.toHaveBeenCalled();
  });
});
