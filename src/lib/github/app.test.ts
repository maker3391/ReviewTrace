import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ env: {} as Record<string, string> }));
vi.mock("@/lib/env", () => ({ githubAppEnv: () => state.env }));

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
state.env = {
  GITHUB_APP_ID: "123",
  GITHUB_APP_CLIENT_ID: "Iv1.test",
  GITHUB_APP_CLIENT_SECRET: "secret",
  GITHUB_APP_PRIVATE_KEY: privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
  GITHUB_APP_SLUG: "reviewtrace-test",
  GITHUB_WEB_URL: "https://github.com",
  GITHUB_API_URL: "https://api.github.com",
};

const { createGithubAppJwt, getInstallationRepository } =
  await import("@/lib/github/app");

afterEach(() => vi.unstubAllGlobals());

describe("GitHub App authentication", () => {
  it("RS256 JWT의 iat/exp/iss를 GitHub 계약 범위로 만든다", () => {
    const now = new Date("2026-09-01T00:00:00Z");
    const token = createGithubAppJwt(now);
    const [header, payload, signature] = token.split(".");
    expect(
      JSON.parse(Buffer.from(header!, "base64url").toString()),
    ).toMatchObject({ alg: "RS256" });
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toEqual({
      iat: Math.floor(now.getTime() / 1000) - 60,
      exp: Math.floor(now.getTime() / 1000) + 540,
      iss: "123",
    });
    expect(signature).not.toBe("");
  });

  it("installation token이 401이면 새 token을 발급해 한 번 재시도한다", async () => {
    const repository = {
      id: 100,
      name: "private-app",
      full_name: "acme/private-app",
      default_branch: "main",
      html_url: "https://github.com/acme/private-app",
      private: true,
      owner: { login: "acme" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ token: "expired", expires_at: "2026-09-01T01:00:00Z" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({ token: "fresh", expires_at: "2026-09-01T01:00:00Z" }),
      )
      .mockResolvedValueOnce(Response.json(repository));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getInstallationRepository("9", "100")).resolves.toMatchObject({
      externalRepositoryId: "100",
      fullName: "acme/private-app",
      private: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer expired",
    });
    expect((fetchMock.mock.calls[3]![1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer fresh",
    });
  });
});
