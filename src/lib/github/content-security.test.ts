import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const github = vi.hoisted(() => ({
  env: {
    GITHUB_API_URL: "https://github.example/api/v3",
    GITHUB_API_TOKEN: "test-token",
  } as { GITHUB_API_URL: string; GITHUB_API_TOKEN?: string },
}));

vi.mock("@/lib/env", () => ({ githubEnv: () => github.env }));

import { githubApiUrl, isPublicRepository } from "@/lib/github/content";

describe("GitHub credential-bearing request", () => {
  beforeEach(() => {
    github.env = {
      GITHUB_API_URL: "https://github.example/api/v3",
      GITHUB_API_TOKEN: "test-token",
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GitHub Enterprise base path를 보존한다", () => {
    const url = githubApiUrl(
      "https://github.example/api/v3",
      "repos/acme/reviewtrace",
      { ref: "abc123" },
    );

    expect(url.toString()).toBe(
      "https://github.example/api/v3/repos/acme/reviewtrace?ref=abc123",
    );
  });

  it("Token은 검증된 HTTPS origin에만 붙고 redirect를 따르지 않는다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ private: false }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(isPublicRepository("acme", "reviewtrace")).resolves.toBe(true);

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (call === undefined) {
      throw new Error("GitHub fetch가 호출되지 않았다");
    }
    const [url, init] = call;
    expect(url.toString()).toBe(
      "https://github.example/api/v3/repos/acme/reviewtrace",
    );
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(init.redirect).toBe("error");
  });
});
