import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  executes,
  fakeExecutor,
  inserts,
  selects,
  updates,
} from "@/db/testing/fake-executor";
import { connectGithubRepository } from "@/features/repositories/server/repository-connect-service";
import { getInstallationRepository } from "@/lib/github/app";

vi.mock("@/lib/github/app", () => ({ getInstallationRepository: vi.fn() }));

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const OTHER_PROJECT = "33333333-3333-4333-8333-333333333333";
const REPOSITORY = "44444444-4444-4444-8444-444444444444";

const metadata = {
  externalRepositoryId: "100",
  owner: "acme",
  name: "app",
  fullName: "acme/app",
  defaultBranch: "main",
  htmlUrl: "https://github.com/acme/app",
  private: true,
};

function context(
  projectId = PROJECT,
  fullName = "acme/app",
  externalRepositoryId = "100",
) {
  return {
    workspaceId: WORKSPACE,
    workspaceSlug: "acme",
    projectId,
    projectSlug: projectId === PROJECT ? "app" : "other",
    projectName: "App",
    repositoryId: REPOSITORY,
    provider: "GITHUB",
    externalRepositoryId,
    owner: "acme",
    name: fullName.split("/")[1],
    fullName,
    defaultBranch: "main",
    htmlUrl: null,
  };
}

beforeEach(() =>
  vi.mocked(getInstallationRepository).mockResolvedValue(metadata),
);

describe("Repository connect policy", () => {
  it("다른 Workspace installation은 GitHub API를 호출하기 전에 막는다", async () => {
    const fake = fakeExecutor([selects([])]);
    await expect(
      connectGithubRepository(
        {
          workspaceId: WORKSPACE,
          projectId: PROJECT,
          installationId: "9",
          externalRepositoryId: "100",
        },
        fake.executor,
      ),
    ).rejects.toThrow("GITHUB_INSTALLATION_NOT_FOUND");
    expect(getInstallationRepository).not.toHaveBeenCalled();
  });

  it("동일 external id + 동일 Project는 같은 행을 갱신하고 idempotent success다", async () => {
    const fake = fakeExecutor([
      selects([{ id: "installation" }]),
      selects([{ id: PROJECT }]),
      selects([context()]),
      selects([context()]),
      executes([]),
      selects([{ id: REPOSITORY }]),
      updates([]),
    ]);
    const result = await connectGithubRepository(
      {
        workspaceId: WORKSPACE,
        projectId: PROJECT,
        installationId: "9",
        externalRepositoryId: "100",
      },
      fake.executor,
    );
    expect(result).toMatchObject({
      repositoryId: REPOSITORY,
      idempotent: true,
    });
    expect(fake.calls.at(-1)?.values).toMatchObject({
      fullName: "acme/app",
      defaultBranch: "main",
    });
  });

  it("동일 external id가 다른 Project에 있으면 새 행이나 암묵 이동을 만들지 않는다", async () => {
    const fake = fakeExecutor([
      selects([{ id: "installation" }]),
      selects([{ id: PROJECT }]),
      selects([context(OTHER_PROJECT)]),
    ]);
    await expect(
      connectGithubRepository(
        {
          workspaceId: WORKSPACE,
          projectId: PROJECT,
          installationId: "9",
          externalRepositoryId: "100",
        },
        fake.executor,
      ),
    ).rejects.toThrow("REPOSITORY_PROJECT_MISMATCH");
    expect(fake.calls.every((call) => call.kind === "select")).toBe(true);
  });

  it("같은 fullname에 다른 numeric id가 있으면 자동 병합하지 않는다", async () => {
    const fake = fakeExecutor([
      selects([{ id: "installation" }]),
      selects([{ id: PROJECT }]),
      selects([]),
      selects([context(PROJECT, "acme/app", "200")]),
    ]);
    await expect(
      connectGithubRepository(
        {
          workspaceId: WORKSPACE,
          projectId: PROJECT,
          installationId: "9",
          externalRepositoryId: "100",
        },
        fake.executor,
      ),
    ).rejects.toThrow("REPOSITORY_IDENTITY_CONFLICT");
  });

  it("numeric id가 같고 이름이 바뀌면 기존 행 metadata만 갱신한다", async () => {
    vi.mocked(getInstallationRepository).mockResolvedValue({
      ...metadata,
      name: "renamed",
      fullName: "acme/renamed",
      htmlUrl: "https://github.com/acme/renamed",
    });
    const fake = fakeExecutor([
      selects([{ id: "installation" }]),
      selects([{ id: PROJECT }]),
      selects([context()]),
      selects([]),
      executes([]),
      selects([{ id: REPOSITORY }]),
      updates([]),
    ]);
    await connectGithubRepository(
      {
        workspaceId: WORKSPACE,
        projectId: PROJECT,
        installationId: "9",
        externalRepositoryId: "100",
      },
      fake.executor,
    );
    expect(fake.calls.at(-1)?.values).toMatchObject({
      fullName: "acme/renamed",
      name: "renamed",
    });
    expect(fake.calls.some((call) => call.kind === "insert")).toBe(false);
  });

  it("미등록 verified repository는 target Project에 한 행만 만든다", async () => {
    const fake = fakeExecutor([
      selects([{ id: "installation" }]),
      selects([{ id: PROJECT }]),
      selects([]),
      selects([]),
      executes([]),
      selects([]),
      selects([]),
      inserts([{ id: REPOSITORY }]),
    ]);
    const result = await connectGithubRepository(
      {
        workspaceId: WORKSPACE,
        projectId: PROJECT,
        installationId: "9",
        externalRepositoryId: "100",
      },
      fake.executor,
    );
    expect(result.repositoryId).toBe(REPOSITORY);
    expect(fake.calls.filter((call) => call.kind === "insert")).toHaveLength(1);
  });
});
