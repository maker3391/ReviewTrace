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

  it("serializes Korean Review Knowledge as UTF-8 JSON without replacement", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({ issues: [{ id: "issue-1", alreadyKnown: false }] }),
    );
    vi.stubGlobal("fetch", fetch);
    const client = createClient({
      apiUrl: "https://reviewtrace.example",
      apiKey: "secret-not-logged",
    });
    const description =
      "저장소 자동 인식 검증 — 개발 브랜치에서 생성한 리뷰\n\n- `workspaceId` 유지";

    await client.appendIssues("review-1", [{ description }]);

    const request = fetch.mock.calls[0][1];
    expect(request.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(request.body)).toEqual({ issues: [{ description }] });
    expect(Buffer.from(request.body, "utf8").toString("utf8")).toContain(
      "저장소 자동 인식 검증 — 개발 브랜치",
    );
    expect(request.body).not.toContain("?");
  });
});
