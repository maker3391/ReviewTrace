import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **UI 를 건너뛰고 Server Action 을 직접 불러도 막히는가.**
 *
 * ## 🔴 이 시험이 무엇을 지키는가
 *
 * 화면은 OWNER 가 아닌 사람에게 내보내기 버튼을 그리지 않는다. 그러나 Server Action 은
 * **HTTP endpoint 다** — 버튼이 없어도 부를 수 있다. 그래서 여기서 보는 것은 두 가지다.
 *
 * 1. MEMBER 가 불렀을 때 `requireOwner` 가 **Application Service 에 닿기 전에** 끊는가
 * 2. Service 에 넘어가는 값이 **전부 서버가 확인한 것**인가 — Client 는 「누구를」만 보내고
 *    `workspaceId` 와 `actorUserId` 는 소속 확인이 돌려준 값이어야 한다
 *
 * ## 🔴 이 시험이 지키지 «못하는» 것
 *
 * 인증 계층(`requireWorkspace`)과 Application Service 를 갈아 끼운다. 「MEMBER 가 정말
 * 행을 지우지 못하는가」는 실제 Database 로 확인한다
 * (`server/member-removal.integration.test.ts`) — **이쪽만 초록인 것은 근거가 아니다.**
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const TARGET = "33333333-3333-4333-8333-333333333333";

const requireWorkspace = vi.fn();
const removeMember = vi.fn();

/** 실제 `requireOwner` 와 같은 동작 — MEMBER 면 `notFound()` 로 던진다. */
class NotFound extends Error {}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth/require-workspace", () => ({
  requireUser: vi.fn(),
  requireWorkspace: (...args: unknown[]) => requireWorkspace(...args),
  requireOwner: (workspace: { role: string }) => {
    if (workspace.role !== "OWNER") {
      throw new NotFound("NEXT_NOT_FOUND");
    }
  },
}));

vi.mock("@/features/workspaces/server/workspace-service", () => ({
  changeMemberRole: vi.fn(),
  createWorkspace: vi.fn(),
  removeMember: (...args: unknown[]) => removeMember(...args),
}));

vi.mock("@/features/workspaces/server/workspace-deletion-service", () => ({
  deleteWorkspace: vi.fn(),
}));

const { removeMemberAction } = await import(
  "@/features/workspaces/actions/workspace-actions"
);

beforeEach(() => {
  vi.clearAllMocks();

  requireWorkspace.mockResolvedValue({
    user: { id: ACTOR, name: "owner", image: null },
    workspace: {
      workspaceId: WORKSPACE,
      slug: "codeapex",
      name: "CodeApex",
      role: "OWNER",
      isPersonal: false,
    },
  });
  removeMember.mockResolvedValue(undefined);
});

describe("removeMemberAction", () => {
  it("OWNER 가 부르면 «서버가 확인한» 값으로 Service 를 부른다", async () => {
    const result = await removeMemberAction("codeapex", { userId: TARGET });

    expect(result.ok).toBe(true);
    // 🔴 workspaceId 도 actorUserId 도 Client 가 보낸 값이 아니다.
    expect(removeMember).toHaveBeenCalledWith({
      workspaceId: WORKSPACE,
      actorUserId: ACTOR,
      targetUserId: TARGET,
    });
  });

  it("🔴 MEMBER 가 직접 부르면 Service 에 닿지 못한다", async () => {
    requireWorkspace.mockResolvedValue({
      user: { id: ACTOR, name: "member", image: null },
      workspace: {
        workspaceId: WORKSPACE,
        slug: "codeapex",
        name: "CodeApex",
        role: "MEMBER",
        isPersonal: false,
      },
    });

    const result = await removeMemberAction("codeapex", { userId: TARGET });

    expect(result.ok).toBe(false);
    /*
     * 🔴 **핵심은 이 줄이다** — 실패했다는 사실보다 「Application Service 에 도달조차
     * 하지 않았다」가 경계의 증거다.
     */
    expect(removeMember).not.toHaveBeenCalled();
  });

  it("형식이 아닌 대상은 Service 에 닿지 못한다", async () => {
    const result = await removeMemberAction("codeapex", {
      userId: "not-a-uuid",
    });

    expect(result.ok).toBe(false);
    expect(removeMember).not.toHaveBeenCalled();
  });
});
