import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const authenticateAgent = vi.fn();
const requireAgentCapability = vi.fn();
const resolveAuthorizedRepositoryContext = vi.fn();
const resolveAuthorizedWorkspace = vi.fn();
const findKnowledgeContext = vi.fn();

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

vi.mock("@/features/knowledge/server/knowledge-context-query", () => ({
  findKnowledgeContext: (...args: unknown[]) => findKnowledgeContext(...args),
}));

const { GET } = await import("@/app/api/v1/knowledge/context/route");

const authorization = {
  model: "PRINCIPAL",
  credentialId: "11111111-1111-4111-8111-111111111111",
  principalId: "22222222-2222-4222-8222-222222222222",
  principalType: "USER_AGENT",
  actorName: "Codex",
  capabilities: ["READ", "WRITE"],
  authorizedWorkspaceIds: ["33333333-3333-4333-8333-333333333333"],
};

const repositoryContext = {
  workspace: {
    id: "33333333-3333-4333-8333-333333333333",
    slug: "workspace-a",
  },
  project: {
    id: "44444444-4444-4444-8444-444444444444",
    slug: "project-a",
    name: "Project A",
  },
  repository: {
    id: "55555555-5555-4555-8555-555555555555",
    provider: "GITHUB",
    externalRepositoryId: "77",
    owner: "acme",
    name: "app",
    fullName: "acme/app",
    defaultBranch: "main",
    htmlUrl: "https://github.com/acme/app",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  authenticateAgent.mockResolvedValue(authorization);
  resolveAuthorizedRepositoryContext.mockResolvedValue(repositoryContext);
  findKnowledgeContext.mockResolvedValue({
    scope: { resolutionStatus: "RESOLVED" },
    wiki: [],
  });
});

describe("GET /api/v1/knowledge/context authorized Repository resolution", () => {
  it("passes one resolved Repository/Project/Workspace context to Knowledge", async () => {
    const response = await GET(
      new Request(
        "https://example.test/api/v1/knowledge/context?repository=acme%2Fapp",
      ),
    );

    expect(response.status).toBe(200);
    expect(requireAgentCapability).toHaveBeenCalledWith(authorization, "READ");
    expect(resolveAuthorizedRepositoryContext).toHaveBeenCalledWith({
      authorization,
      identity: {
        provider: "GITHUB",
        repositoryId: null,
        fullName: "acme/app",
      },
      workspaceHint: null,
    });
    expect(findKnowledgeContext).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: repositoryContext.workspace.id,
        workspace: repositoryContext.workspace,
        authorizedRepositoryContext: repositoryContext,
      }),
    );
    expect(resolveAuthorizedWorkspace).not.toHaveBeenCalled();
  });

  it("does not widen an unknown Repository to Workspace Knowledge", async () => {
    resolveAuthorizedRepositoryContext.mockRejectedValue(
      new AppError("NOT_CONNECTED_OR_NOT_AUTHORIZED"),
    );

    const response = await GET(
      new Request(
        "https://example.test/api/v1/knowledge/context?repository=acme%2Funknown",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.resolutionStatus).toBe(
      "NOT_CONNECTED_OR_NOT_AUTHORIZED",
    );
    expect(findKnowledgeContext).not.toHaveBeenCalled();
    expect(resolveAuthorizedWorkspace).not.toHaveBeenCalled();
  });
});
