import { beforeEach, describe, expect, it, vi } from "vitest";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";

const authenticateAgent = vi.fn();
const ingestReview = vi.fn();

vi.mock("next/server", () => ({ after: vi.fn() }));

vi.mock("@/lib/api/api-key-auth", () => ({
  authenticateAgent: (...args: unknown[]) => authenticateAgent(...args),
}));

vi.mock("@/features/reviews/server/review-ingest-service", () => ({
  ingestReview: (...args: unknown[]) => ingestReview(...args),
}));

vi.mock("@/features/issues/server/code-evidence-service", () => ({
  verifyCodeEvidence: vi.fn(),
}));

const { POST } = await import("@/app/api/v1/reviews/route");

beforeEach(() => {
  vi.clearAllMocks();

  authenticateAgent.mockResolvedValue({
    workspaceId: WORKSPACE,
    apiKeyName: "codex-ci",
  });
  ingestReview.mockResolvedValue({
    repositoryId: "22222222-2222-4222-8222-222222222222",
    reviewSessionId: "33333333-3333-4333-8333-333333333333",
    issues: [],
    evidenceIds: [],
    idempotentReplay: false,
  });
});

function postRequest(reviewer: {
  type: string;
  name: string;
  version: string;
}) {
  return new Request("https://example.test/api/v1/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
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
  });
});
