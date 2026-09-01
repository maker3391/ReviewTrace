import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakeExecutor,
  inserts,
  selects,
  updates,
} from "@/db/testing/fake-executor";
import {
  beginGithubInstallation,
  completeGithubInstallation,
  findWorkspaceRepositoryToken,
} from "@/features/repositories/server/github-installation-service";
import {
  createInstallationToken,
  exchangeGithubAppCode,
  getInstallationRepository,
  getGithubInstallation,
  githubAppInstallationUrl,
  userCanManageInstallation,
} from "@/lib/github/app";

vi.mock("@/lib/github/app", () => ({
  exchangeGithubAppCode: vi.fn(),
  userCanManageInstallation: vi.fn(),
  getGithubInstallation: vi.fn(),
  githubAppInstallationUrl: vi.fn(
    (state: string) => `https://github.test/install?state=${state}`,
  ),
  listInstallationRepositories: vi.fn(),
  createInstallationToken: vi.fn(),
  getInstallationRepository: vi.fn(),
}));

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exchangeGithubAppCode).mockResolvedValue("one-time-user-token");
  vi.mocked(userCanManageInstallation).mockResolvedValue(true);
  vi.mocked(getGithubInstallation).mockResolvedValue({
    installationId: "9",
    accountId: "10",
    accountLogin: "acme",
    accountType: "Organization",
    repositorySelection: "selected",
  });
});

describe("GitHub installation ↔ Workspace", () => {
  it("private source token은 resolved Workspace의 installation에서만 발급한다", async () => {
    const fake = fakeExecutor([
      selects([
        {
          id: "workspace-installation",
          installationId: "9",
          accountLogin: "acme",
          accountType: "Organization",
        },
      ]),
    ]);
    vi.mocked(getInstallationRepository).mockResolvedValue({
      externalRepositoryId: "77",
      owner: "acme",
      name: "private",
      fullName: "acme/private",
      private: true,
      defaultBranch: "main",
      htmlUrl: "https://github.com/acme/private",
    });
    vi.mocked(createInstallationToken).mockResolvedValue({
      token: "short-lived-token",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      findWorkspaceRepositoryToken(WORKSPACE, "77", fake.executor),
    ).resolves.toBe("short-lived-token");
    expect(fake.calls[0]?.kind).toBe("select");
    expect(getInstallationRepository).toHaveBeenCalledWith("9", "77");
    expect(createInstallationToken).toHaveBeenCalledWith("9");
  });

  it("시작 state 원문을 DB에 저장하지 않고 사용자·Workspace·Project에 묶는다", async () => {
    const fake = fakeExecutor([selects([{ id: PROJECT }]), inserts([])]);
    const url = await beginGithubInstallation(
      { workspaceId: WORKSPACE, projectId: PROJECT, userId: USER },
      fake.executor,
    );
    const state = new URL(url).searchParams.get("state");
    expect(state).toHaveLength(43);
    expect(fake.calls[1]?.values).toMatchObject({
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      userId: USER,
    });
    expect(fake.calls[1]?.values?.stateHash).not.toBe(state);
    expect(githubAppInstallationUrl).toHaveBeenCalledWith(state);
  });

  it("callback user가 관리하는 installation만 현재 Workspace에 연결한다", async () => {
    const fake = fakeExecutor([
      selects([
        {
          id: "request",
          workspaceId: WORKSPACE,
          projectId: PROJECT,
          projectSlug: "app",
        },
      ]),
      updates([{ id: "request" }]),
      selects([]),
      inserts([]),
      selects([{ slug: "acme" }]),
    ]);
    await expect(
      completeGithubInstallation(
        {
          userId: USER,
          state: "s".repeat(43),
          code: "code",
          installationId: "9",
        },
        fake.executor,
      ),
    ).resolves.toEqual({ workspaceSlug: "acme", projectSlug: "app" });
    expect(userCanManageInstallation).toHaveBeenCalledWith(
      "one-time-user-token",
      "9",
    );
    expect(fake.calls[3]?.values).toMatchObject({
      workspaceId: WORKSPACE,
      installationId: "9",
      accountLogin: "acme",
    });
  });

  it("이미 다른 Workspace에 연결된 installation은 공유하지 않는다", async () => {
    const fake = fakeExecutor([
      selects([
        {
          id: "request",
          workspaceId: WORKSPACE,
          projectId: PROJECT,
          projectSlug: "app",
        },
      ]),
      updates([{ id: "request" }]),
      selects([{ workspaceId: "99999999-9999-4999-8999-999999999999" }]),
    ]);
    await expect(
      completeGithubInstallation(
        {
          userId: USER,
          state: "s".repeat(43),
          code: "code",
          installationId: "9",
        },
        fake.executor,
      ),
    ).rejects.toThrow("GITHUB_INSTALLATION_CONFLICT");
    expect(fake.calls.some((call) => call.kind === "insert")).toBe(false);
  });

  it("만료·소진·다른 사용자의 state는 GitHub에 보내기 전에 거절한다", async () => {
    const fake = fakeExecutor([selects([])]);
    await expect(
      completeGithubInstallation(
        {
          userId: USER,
          state: "s".repeat(43),
          code: "code",
          installationId: "9",
        },
        fake.executor,
      ),
    ).rejects.toThrow("GITHUB_CALLBACK_INVALID");
    expect(exchangeGithubAppCode).not.toHaveBeenCalled();
  });
});
