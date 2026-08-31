import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 🔴 **Project 삭제는 OWNER 만이다 — 그 사실을 못 박는 시험.**
 *
 * ## 왜 이 파일이 필요했는가
 *
 * `deleteProjectAction` 은 `requireProject` 만 불렀다. 그것이 보는 것은 두 가지다 —
 * 「그 Workspace 의 멤버인가」와 「그 Workspace 안의 Project 인가」. 🔴 **그것만으로는
 * MEMBER 도 Project 를 통째로 지울 수 있었다.** 저장소·리뷰·이슈·문서가 CASCADE 로 함께
 * 사라지는 작업이다 — **조회 권한과 파괴 권한은 다른 판정이다.**
 *
 * 🔴 **되돌림 확인이 이 파일을 낳았다.** `requireOwner(workspace)` 를 지워 보니 전 스위트가
 * **그대로 초록이었다.** 화면에서 Danger Zone 을 감추는 것은 편의일 뿐이고(CLAUDE.md 11),
 * Server Action 은 주소만 알면 누구나 부를 수 있다.
 *
 * ## 🔴 이 시험이 지키지 «못하는» 것
 *
 * `requireProject` 와 `requireOwner` 를 갈아 끼운다. 「소속을 어떻게 확인하는가」는
 * `require-workspace.test.ts` 의 몫이고, 여기서 보는 것은 **Action 이 그 둘을 «부르는가»,
 * 그리고 막혔을 때 «삭제가 일어나지 않는가»** 하나다.
 */

const requireProject = vi.fn();
const requireOwner = vi.fn();
const deleteProject = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth/require-project", () => ({
  requireProject: (...args: unknown[]) => requireProject(...args),
}));

vi.mock("@/lib/auth/require-workspace", () => ({
  requireOwner: (...args: unknown[]) => requireOwner(...args),
}));

vi.mock("@/features/projects/server/project-service", () => ({
  deleteProject: (...args: unknown[]) => deleteProject(...args),
  updateProject: vi.fn(),
}));

const { deleteProjectAction } = await import(
  "@/features/projects/actions/manage-project"
);

const WORKSPACE = { workspaceId: "11111111-1111-4111-8111-111111111111" };
const PROJECT = { projectId: "22222222-2222-4222-8222-222222222222" };

beforeEach(() => {
  vi.clearAllMocks();
  requireProject.mockResolvedValue({ workspace: WORKSPACE, project: PROJECT });
  requireOwner.mockReturnValue(undefined);
  deleteProject.mockResolvedValue(undefined);
});

describe("deleteProjectAction — 파괴 권한", () => {
  it("🔴 OWNER 검증을 «지우기 전에» 부른다", async () => {
    await deleteProjectAction({ workspaceSlug: "acme", projectSlug: "smil" });

    expect(requireOwner).toHaveBeenCalledWith(WORKSPACE);
    expect(deleteProject).toHaveBeenCalledTimes(1);

    // 🔴 순서가 뒤집히면 「지운 뒤에 권한을 본다」가 된다.
    const ownerCall = requireOwner.mock.invocationCallOrder[0] ?? 0;
    const deleteCall = deleteProject.mock.invocationCallOrder[0] ?? 0;
    expect(ownerCall).toBeLessThan(deleteCall);
  });

  /**
   * 🔴 `requireOwner` 는 `notFound()` 를 던진다 — 그 자리를 흉내 낸다.
   * 던지는 예외의 «종류»가 아니라 **삭제가 일어나지 않는다**는 사실을 붙든다.
   */
  it("🔴 OWNER 가 아니면 삭제가 «일어나지 않는다»", async () => {
    requireOwner.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });

    await deleteProjectAction({ workspaceSlug: "acme", projectSlug: "smil" });

    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("Workspace·Project 는 «주소가 아니라» 소속 확인이 돌려준 값을 쓴다", async () => {
    await deleteProjectAction({ workspaceSlug: "acme", projectSlug: "smil" });

    expect(deleteProject).toHaveBeenCalledWith({
      workspaceId: WORKSPACE.workspaceId,
      projectId: PROJECT.projectId,
    });
  });
});
