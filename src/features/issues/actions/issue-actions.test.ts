import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server Action 이 **읽은 범위 그대로 쓰는가**.
 *
 * ## 🔴 이 시험이 왜 필요했는가
 *
 * 결함은 Application Service 가 아니라 **호출 자리**에 있었다. `updateIssueStatus` 는
 * 받은 범위로 정확히 좁혔지만, Server Action 이 `requireProject` 로 Project 를 확인해
 * 놓고 **그것을 넘기지 않았다.** 그래서 화면이 Issue 를 보여 줄 때 쓴 범위
 * (`{workspaceId, projectId}`)와 바꿀 때 쓴 범위(`{workspaceId}`)가 어긋났다 —
 * Project A 화면에서 주소의 Issue ID 만 Project B 의 것으로 바꾸면 그것이 움직였다.
 *
 * Service 쪽 시험만으로는 이것을 잡지 못한다. 규칙은 살아 있는데 아무도 그것을 제대로
 * 부르지 않는 상태를 시험이 놓치기 때문이다.
 *
 * ## 🔴 이 시험이 지키지 «못하는» 것
 *
 * `requireProject` 자체를 갈아 끼운다. 「소속이 없으면 못 얻는다」는 그쪽 시험의 몫이고,
 * 여기서 보는 것은 **확인된 값을 빠뜨리지 않고 넘기는가** 하나다.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const ISSUE = "33333333-3333-4333-8333-333333333333";

const requireProject = vi.fn();
const updateIssueStatus = vi.fn();
const addIssueActivity = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth/require-project", () => ({
  requireProject: (...args: unknown[]) => requireProject(...args),
}));

vi.mock("@/features/issues/server/issue-status-service", () => ({
  updateIssueStatus: (...args: unknown[]) => updateIssueStatus(...args),
}));

vi.mock("@/features/issues/server/issue-activity-service", () => ({
  addIssueActivity: (...args: unknown[]) => addIssueActivity(...args),
}));

const { updateIssueStatusAction, addIssueActivityAction } =
  await import("@/features/issues/actions/issue-actions");

beforeEach(() => {
  vi.clearAllMocks();

  requireProject.mockResolvedValue({
    user: { id: "user-1", name: "사장님", email: "owner@example.test" },
    workspace: { workspaceId: WORKSPACE, role: "OWNER" },
    project: { projectId: PROJECT, slug: "smil", name: "SMIL" },
  });
  updateIssueStatus.mockResolvedValue({ id: ISSUE });
});

const target = {
  workspaceSlug: "codeapex",
  projectSlug: "smil",
  issueId: ISSUE,
};

describe("updateIssueStatusAction", () => {
  it("🔴 확인된 Workspace 와 Project 를 «둘 다» 넘긴다", async () => {
    const result = await updateIssueStatusAction(target, {
      status: "RESOLVED",
      resolutionSummary: "Transaction 밖으로 옮겼다",
    });

    expect(result.ok).toBe(true);
    expect(requireProject).toHaveBeenCalledWith("codeapex", "smil");

    const [input] = updateIssueStatus.mock.calls[0] as [
      { scope: { workspaceId: string; projectId?: string }; issueId: string },
    ];

    // 주소의 Project 로 좁히지 않으면 읽기와 쓰기의 범위가 어긋난다.
    expect(input.scope).toEqual({
      workspaceId: WORKSPACE,
      projectId: PROJECT,
    });
    expect(input.issueId).toBe(ISSUE);
  });

  it("🔴 행위자는 세션에서 온다 — 화면이 보낸 이름을 쓰지 않는다", async () => {
    await updateIssueStatusAction(target, {
      status: "RESOLVED",
      resolutionSummary: "고쳤다",
    });

    const [input] = updateIssueStatus.mock.calls[0] as [
      { update: { actor: { type: string; name: string } } },
    ];

    expect(input.update.actor).toEqual({ type: "HUMAN", name: "사장님" });
  });

  it("RESOLVED 인데 해결 요약이 없으면 Service 를 부르지도 않는다", async () => {
    const result = await updateIssueStatusAction(target, {
      status: "RESOLVED",
      resolutionSummary: null,
    });

    expect(result.ok).toBe(false);
    expect(updateIssueStatus).not.toHaveBeenCalled();
  });

  it("Service 가 거절하면 예외가 아니라 결과로 돌려준다", async () => {
    const { AppError } = await import("@/lib/errors");
    updateIssueStatus.mockRejectedValue(new AppError("RESOURCE_NOT_FOUND"));

    const result = await updateIssueStatusAction(target, {
      status: "REOPENED",
      resolutionSummary: null,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("NOT_FOUND");
  });
});

/**
 * 🔴 **History 한 줄도 같은 범위를 쓴다.**
 *
 * 상태 전이만 좁히고 이 자리를 남겨 두면, 「쓰기는 Project 로 좁힌다」가 셋 중
 * 하나에서 거짓이 된다 — 그리고 거짓인 쪽이 **읽기 화면에는 보이지 않는** History 다.
 */
/**
 * `IssueActivityFormInput` 은 `z.output` 이라 기본값이 채워진 «뒤»의 모양이다 —
 * 화면 폼이 넘기는 것과 같게 모든 칸을 적는다.
 */
const activityInput = (over: Record<string, unknown> = {}) =>
  ({
    type: "FIX_ATTEMPTED",
    description: "Transaction 밖으로 옮겼다",
    commitSha: null,
    decision: null,
    evidence: [],
    ...over,
  }) as Parameters<typeof addIssueActivityAction>[1];

describe("addIssueActivityAction", () => {
  it("🔴 확인된 Workspace 와 Project 를 «둘 다» 넘긴다", async () => {
    const result = await addIssueActivityAction(target, activityInput());

    expect(result.ok).toBe(true);

    const [input] = addIssueActivity.mock.calls[0] as [
      { scope: { workspaceId: string; projectId?: string }; issueId: string },
    ];

    expect(input.scope).toEqual({
      workspaceId: WORKSPACE,
      projectId: PROJECT,
    });
    expect(input.issueId).toBe(ISSUE);
  });

  it("🔴 행위자는 세션에서 온다 — 화면이 보낸 이름을 쓰지 않는다", async () => {
    await addIssueActivityAction(
      target,
      activityInput({ type: "COMMENT", description: "확인했다" }),
    );

    const [input] = addIssueActivity.mock.calls[0] as [
      { activity: { actor: { type: string; name: string } } },
    ];

    expect(input.activity.actor).toEqual({ type: "HUMAN", name: "사장님" });
  });

  it("Service 가 거절하면 예외가 아니라 결과로 돌려준다", async () => {
    const { AppError } = await import("@/lib/errors");
    addIssueActivity.mockRejectedValue(new AppError("RESOURCE_NOT_FOUND"));

    const result = await addIssueActivityAction(
      target,
      activityInput({ type: "COMMENT", description: "확인했다" }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe("NOT_FOUND");
  });
});
