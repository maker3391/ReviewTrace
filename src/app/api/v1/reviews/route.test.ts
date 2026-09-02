import { beforeEach, describe, expect, it, vi } from "vitest";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";

const authenticateAgent = vi.fn();
const requireAgentCapability = vi.fn();
const resolveAgentReviewWorkspace = vi.fn();
const ingestReview = vi.fn();
const findReviewKnowledgePreflight = vi.fn();

vi.mock("next/server", () => ({ after: vi.fn() }));

vi.mock("@/lib/api/api-key-auth", () => ({
  authenticateAgent: (...args: unknown[]) => authenticateAgent(...args),
  requireAgentCapability: (...args: unknown[]) =>
    requireAgentCapability(...args),
}));

vi.mock("@/features/reviews/server/agent-review-context", () => ({
  resolveAgentReviewWorkspace: (...args: unknown[]) =>
    resolveAgentReviewWorkspace(...args),
}));

vi.mock("@/features/reviews/server/review-ingest-service", () => ({
  ingestReview: (...args: unknown[]) => ingestReview(...args),
}));

vi.mock("@/features/knowledge/server/review-knowledge-preflight", () => ({
  findReviewKnowledgePreflight: (...args: unknown[]) =>
    findReviewKnowledgePreflight(...args),
  unavailableKnowledgePreflight: () => ({
    available: false,
    changedFiles: { total: 0, considered: 0, truncated: false },
    frequentPatterns: [],
    relevantPastIssues: [],
    unresolvedIssues: [],
    guidance: ["retry"],
  }),
}));

vi.mock("@/features/issues/server/code-evidence-service", () => ({
  verifyCodeEvidence: vi.fn(),
}));

const { POST } = await import("@/app/api/v1/reviews/route");

beforeEach(() => {
  vi.clearAllMocks();

  authenticateAgent.mockResolvedValue({
    model: "PRINCIPAL",
    credentialId: "44444444-4444-4444-8444-444444444444",
    principalId: "55555555-5555-4555-8555-555555555555",
    principalType: "USER_AGENT",
    actorName: "codex-ci",
    capabilities: ["READ", "WRITE"],
    authorizedWorkspaceIds: [WORKSPACE],
  });
  resolveAgentReviewWorkspace.mockResolvedValue(WORKSPACE);
  ingestReview.mockResolvedValue({
    repositoryId: "22222222-2222-4222-8222-222222222222",
    reviewSessionId: "33333333-3333-4333-8333-333333333333",
    issues: [],
    evidenceIds: [],
    idempotentReplay: false,
  });
  findReviewKnowledgePreflight.mockResolvedValue({
    available: true,
    changedFiles: { total: 0, considered: 0, truncated: false },
    frequentPatterns: [],
    relevantPastIssues: [],
    unresolvedIssues: [],
    guidance: ["get_issue"],
  });
});

/** 인증은 mock 이라 값 자체는 쓰이지 않는다 — Log 에 새는지 보기 위한 미끼다. */
const TOKEN = "ci_agent_never-a-real-credential";

function postRequest(reviewer: {
  type: string;
  name: string;
  version: string;
}) {
  return new Request("https://example.test/api/v1/reviews", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      repository: {
        provider: "GITHUB",
        owner: "maker3391",
        name: "ReviewTrace",
        fullName: "maker3391/ReviewTrace",
        defaultBranch: "main",
        htmlUrl: "https://github.com/maker3391/ReviewTrace",
      },
      target: { type: "COMMIT", commitSha: "a7dcaed" },
      reviewer,
      issues: [],
    }),
  });
}

describe("POST /api/v1/reviews", () => {
  it("🔴 Payload 의 HUMAN reviewer 를 무시하고 API Key Agent 를 기록한다", async () => {
    const response = await POST(
      postRequest({ type: "HUMAN", name: "admin", version: "1.2.3" }),
    );

    expect(response.status).toBe(201);

    const [input] = ingestReview.mock.calls[0] as [
      {
        workspaceId: string;
        payload: {
          reviewer: { type: string; name: string; version: string | null };
        };
      },
    ];

    expect(input.workspaceId).toBe(WORKSPACE);
    expect(input.payload.reviewer).toEqual({
      type: "AGENT",
      name: "codex-ci",
      version: "1.2.3",
    });
    expect(requireAgentCapability).toHaveBeenCalledWith(
      expect.objectContaining({ actorName: "codex-ci" }),
      "WRITE",
    );
    expect(resolveAgentReviewWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization: expect.objectContaining({
          authorizedWorkspaceIds: [WORKSPACE],
        }),
      }),
    );
  });

  it("Review 저장 뒤 compact Knowledge preflight를 additive하게 반환한다", async () => {
    const response = await POST(
      postRequest({ type: "AGENT", name: "codex", version: "1.2.3" }),
    );
    const body = await response.json();

    expect(findReviewKnowledgePreflight).toHaveBeenCalledWith({
      workspaceId: WORKSPACE,
      repositoryId: "22222222-2222-4222-8222-222222222222",
      changedFiles: [],
    });
    expect(body.knowledgePreflight).toMatchObject({ available: true });
  });

  it("Knowledge 조회 실패가 성공한 Review 응답을 rollback하거나 5xx로 바꾸지 않는다", async () => {
    findReviewKnowledgePreflight.mockRejectedValueOnce(new Error("read failed"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      postRequest({ type: "AGENT", name: "codex", version: "1.2.3" }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.reviewSessionId).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(body.knowledgePreflight).toMatchObject({ available: false });

    /**
     * 🔴 **삼키되 조용히 삼키지는 않는다.** 응답만 보고는 preflight 가 며칠째 깨져 있는지
     * 알 수 없다 — 운영자가 좇을 한 줄은 서버 Log 에 남아야 한다.
     */
    expect(logged).toHaveBeenCalledWith(
      "[knowledge] Review preflight를 읽지 못했다:",
      expect.stringContaining("read failed"),
    );
    logged.mockRestore();
  });

  /**
   * 🔴 인증 실패·오류 응답 어디에도 credential 이 실리지 않는 것과 같은 기준을 Log 에도 건다.
   */
  it("preflight 실패 로그에 Bearer token을 싣지 않는다", async () => {
    findReviewKnowledgePreflight.mockRejectedValueOnce(
      new Error("connection lost"),
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await POST(postRequest({ type: "AGENT", name: "codex", version: "1.2.3" }));

    const printed = logged.mock.calls.flat().join(" ");
    expect(printed).not.toContain("ci_");
    expect(printed).not.toContain(TOKEN);
    logged.mockRestore();
  });
});
