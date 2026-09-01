import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateAgent = vi.fn();
const requireAgentCapability = vi.fn();
const resolveAuthorizedRepositoryContext = vi.fn();
const resolveAuthorizedWorkspace = vi.fn();
const searchAgentIssues = vi.fn();

vi.mock("@/lib/api/api-key-auth", () => ({
  authenticateAgent: (...args: unknown[]) => authenticateAgent(...args),
  requireAgentCapability: (...args: unknown[]) =>
    requireAgentCapability(...args),
}));
vi.mock(
  "@/features/repositories/server/authorized-repository-context-service",
  () => ({
    resolveAuthorizedRepositoryContext: (...args: unknown[]) =>
      resolveAuthorizedRepositoryContext(...args),
    resolveAuthorizedWorkspace: (...args: unknown[]) =>
      resolveAuthorizedWorkspace(...args),
  }),
);
vi.mock("@/features/issues/server/issue-agent-query", () => ({
  searchAgentIssues: (...args: unknown[]) => searchAgentIssues(...args),
}));

const { GET } = await import("@/app/api/v1/issues/route");

const authorization = {
  model: "PRINCIPAL",
  credentialId: "11111111-1111-4111-8111-111111111111",
  principalId: "22222222-2222-4222-8222-222222222222",
  principalType: "USER_AGENT",
  actorName: "Codex",
  capabilities: ["READ", "WRITE"],
  authorizedWorkspaceIds: ["33333333-3333-4333-8333-333333333333"],
};

beforeEach(() => {
  vi.clearAllMocks();
  authenticateAgent.mockResolvedValue(authorization);
  resolveAuthorizedRepositoryContext.mockResolvedValue({
    workspace: {
      id: "33333333-3333-4333-8333-333333333333",
      slug: "workspace-a",
    },
  });
  searchAgentIssues.mockResolvedValue([]);
});

describe("GET /api/v1/issues", () => {
  it("resolves a Repository inside the credential's authorized set before searching", async () => {
    const response = await GET(
      new Request(
        "https://example.test/api/v1/issues?repository=acme%2Fapp&workspaceSlug=workspace-a",
      ),
    );

    expect(response.status).toBe(200);
    expect(requireAgentCapability).toHaveBeenCalledWith(authorization, "READ");
    expect(resolveAuthorizedRepositoryContext).toHaveBeenCalledWith({
      authorization,
      identity: { provider: "GITHUB", fullName: "acme/app" },
      workspaceHint: "workspace-a",
    });
    expect(searchAgentIssues).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      expect.objectContaining({ repository: "acme/app" }),
    );
    expect(resolveAuthorizedWorkspace).not.toHaveBeenCalled();
  });
});
