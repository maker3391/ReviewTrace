import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, createClient } from "./client.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Agent context errors", () => {
  it("preserves authorized ambiguity candidates and explains the repo-local hint", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "CONFLICT",
            message: "Repository context is ambiguous",
            resolutionStatus: "REPOSITORY_CONTEXT_AMBIGUOUS",
            candidates: [
              {
                workspace: { id: "workspace-a-id", slug: "workspace-a" },
                project: { slug: "project-a" },
                repository: {
                  fullName: "acme/app",
                  externalRepositoryId: "77",
                },
              },
            ],
          },
        },
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const client = createClient({
      apiUrl: "https://reviewtrace.example",
      apiKey: "secret-not-logged",
    });

    const error = await client
      .knowledgeContext({ repository: "acme/app" })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.resolutionStatus).toBe("REPOSITORY_CONTEXT_AMBIGUOUS");
    expect(error.candidates).toHaveLength(1);
    expect(error.message).toContain("workspace-a");
    expect(error.message).toContain("git config --local reviewtrace.workspace");
    expect(error.message).not.toContain("secret-not-logged");
  });

  it("sends a repository-local Workspace hint as a non-authoritative query", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ wiki: [] }));
    vi.stubGlobal("fetch", fetch);
    const client = createClient({
      apiUrl: "https://reviewtrace.example",
      apiKey: "secret-not-logged",
    });

    await client.knowledgeContext({
      repository: "acme/app",
      workspaceSlug: "workspace-a",
    });

    const requestUrl = new URL(fetch.mock.calls[0][0]);
    expect(requestUrl.searchParams.get("workspaceSlug")).toBe("workspace-a");
  });
});
