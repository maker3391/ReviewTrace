import { beforeEach, describe, expect, it, vi } from "vitest";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const REVIEW = "22222222-2222-4222-8222-222222222222";

const authenticateAgent = vi.fn();
const requireAgentCapability = vi.fn();
const requireAuthorizedReviewWorkspace = vi.fn();
const appendReviewIssues = vi.fn();

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/api/api-key-auth", () => ({
  authenticateAgent: (...args: unknown[]) => authenticateAgent(...args),
  requireAgentCapability: (...args: unknown[]) =>
    requireAgentCapability(...args),
}));
vi.mock("@/lib/api/agent-resource-authorization", () => ({
  requireAuthorizedReviewWorkspace: (...args: unknown[]) =>
    requireAuthorizedReviewWorkspace(...args),
}));
vi.mock("@/features/reviews/server/review-ingest-service", () => ({
  appendReviewIssues: (...args: unknown[]) => appendReviewIssues(...args),
}));
vi.mock("@/features/issues/server/code-evidence-service", () => ({
  verifyCodeEvidence: vi.fn(),
}));

const { POST } = await import(
  "@/app/api/v1/reviews/[reviewId]/issues/route"
);

const authorization = {
  model: "PRINCIPAL",
  credentialId: "33333333-3333-4333-8333-333333333333",
  principalId: "44444444-4444-4444-8444-444444444444",
  principalType: "USER_AGENT",
  actorName: "Codex",
  capabilities: ["READ", "WRITE"],
  authorizedWorkspaceIds: [WORKSPACE],
};

beforeEach(() => {
  vi.clearAllMocks();
  authenticateAgent.mockResolvedValue(authorization);
  requireAuthorizedReviewWorkspace.mockResolvedValue(WORKSPACE);
  appendReviewIssues.mockResolvedValue({
    issues: [{ id: "55555555-5555-4555-8555-555555555555" }],
    evidenceIds: [],
  });
});

describe("POST /api/v1/reviews/{reviewId}/issues", () => {
  it("authorizes the Review UUID before appending an Issue", async () => {
    const response = await POST(
      new Request(`https://example.test/api/v1/reviews/${REVIEW}/issues`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          issues: [
            {
              severity: "HIGH",
              category: "SECURITY",
              title: "Tenant boundary",
            },
          ],
        }),
      }),
      { params: Promise.resolve({ reviewId: REVIEW }) },
    );

    expect(response.status).toBe(201);
    expect(requireAgentCapability).toHaveBeenCalledWith(
      authorization,
      "WRITE",
    );
    expect(requireAuthorizedReviewWorkspace).toHaveBeenCalledWith(
      authorization,
      REVIEW,
    );
    expect(appendReviewIssues).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE,
        reviewSessionId: REVIEW,
      }),
    );
  });
});
