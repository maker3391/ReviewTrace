import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Repository 이동이 **읽은 범위 그대로 쓰는가**.
 *
 * ## 🔴 이 시험이 왜 필요했는가
 *
 * 목적지는 소속을 확인한 Workspace 안에서 다시 찾으면서 **출발지는 넘기지 않았다.**
 * 화면은 「이 Project 의 이 Repository 를 옮긴다」인데 서버는 「이 Workspace 의 이
 * Repository 를 옮긴다」로 읽었다 — Project A 화면에서 다른 Project 의 Repository ID 를
 * 적어 보내는 것만으로 그것이 옮겨졌다.
 *
 * ## 🔴 이 시험이 지키지 «못하는» 것
 *
 * `requireProject` 와 Repository 계층을 갈아 끼운다. 여기서 보는 것은
 * **확인된 값을 빠뜨리지 않고 넘기는가** 하나다.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const SOURCE_PROJECT = "22222222-2222-4222-8222-222222222222";
const TARGET_PROJECT = "33333333-3333-4333-8333-333333333333";
const REPOSITORY = "44444444-4444-4444-8444-444444444444";

const requireProject = vi.fn();
const findProjectBySlug = vi.fn();
const moveRepositoryToProject = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth/require-project", () => ({
  requireProject: (...args: unknown[]) => requireProject(...args),
}));

vi.mock("@/features/projects/server/project-service", () => ({
  findProjectBySlug: (...args: unknown[]) => findProjectBySlug(...args),
}));

vi.mock("@/features/repositories/server/repository-query", () => ({
  moveRepositoryToProject: (...args: unknown[]) =>
    moveRepositoryToProject(...args),
}));

const { moveRepositoryAction } =
  await import("@/features/repositories/actions/move-repository");

beforeEach(() => {
  vi.clearAllMocks();

  requireProject.mockResolvedValue({
    user: { id: "user-1", name: "사장님", email: "owner@example.test" },
    workspace: { workspaceId: WORKSPACE, role: "OWNER" },
    project: { projectId: SOURCE_PROJECT, slug: "smil", name: "SMIL" },
  });
  findProjectBySlug.mockResolvedValue({ projectId: TARGET_PROJECT });
  moveRepositoryToProject.mockResolvedValue(undefined);
});

const target = {
  workspaceSlug: "codeapex",
  projectSlug: "smil",
  repositoryId: REPOSITORY,
  targetProjectSlug: "erp",
};

describe("moveRepositoryAction", () => {
  it("🔴 출발 Project 와 목적지 Project 를 «둘 다» 넘긴다", async () => {
    const result = await moveRepositoryAction(target);

    expect(result.ok).toBe(true);
    // 목적지는 화면이 보낸 ID 가 아니라 slug 로 다시 찾는다.
    expect(findProjectBySlug).toHaveBeenCalledWith(WORKSPACE, "erp");

    expect(moveRepositoryToProject).toHaveBeenCalledWith({
      workspaceId: WORKSPACE,
      repositoryId: REPOSITORY,
      sourceProjectId: SOURCE_PROJECT,
      targetProjectId: TARGET_PROJECT,
    });
  });

  it("목적지가 같은 Workspace 에 없으면 옮기지 않는다", async () => {
    findProjectBySlug.mockResolvedValue(null);

    const result = await moveRepositoryAction(target);

    expect(result.ok).toBe(false);
    expect(moveRepositoryToProject).not.toHaveBeenCalled();
  });
});
