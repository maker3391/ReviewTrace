import { describe, expect, it } from "vitest";

import {
  planAccountDeletion,
  type WorkspaceMembershipFacts,
} from "@/features/users/server/account-deletion-plan";

/**
 * 계정 삭제가 Workspace 를 어떻게 다루는가 — **판단 규칙만** 본다.
 *
 * 🔴 **이 시험이 초록인 것은 계정 삭제가 안전하다는 근거가 아니다.** 여기서 확인하는 것은
 * 순수 함수의 분기뿐이다. 「그 규칙이 실제 Database 에서 그대로 일어나는가」와
 * 「FOR UPDATE 가 경쟁을 막는가」는 `account-deletion.integration.test.ts` 가 본다.
 */

function facts(
  overrides: Partial<WorkspaceMembershipFacts> = {},
): WorkspaceMembershipFacts {
  return {
    workspaceId: "w1",
    slug: "acme",
    name: "Acme",
    isPersonal: false,
    role: "MEMBER",
    otherMembers: 0,
    otherOwners: 0,
    ...overrides,
  };
}

describe("planAccountDeletion", () => {
  it("나 혼자 있는 Workspace 는 함께 지운다", () => {
    const plan = planAccountDeletion([
      facts({ role: "OWNER", isPersonal: true, otherMembers: 0 }),
    ]);

    expect(plan.deleted).toHaveLength(1);
    expect(plan.preserved).toHaveLength(0);
    expect(plan.deletable).toBe(true);
  });

  it("🔴 다른 멤버가 있으면 지우지 않는다 — 남의 Knowledge 다", () => {
    const plan = planAccountDeletion([
      facts({ role: "MEMBER", otherMembers: 3, otherOwners: 1 }),
    ]);

    expect(plan.deleted).toHaveLength(0);
    expect(plan.preserved).toHaveLength(1);
    expect(plan.deletable).toBe(true);
  });

  it("🔴 다른 멤버가 있는데 OWNER 가 나뿐이면 삭제 자체를 막는다", () => {
    const plan = planAccountDeletion([
      facts({ role: "OWNER", otherMembers: 2, otherOwners: 0 }),
    ]);

    expect(plan.blocked).toHaveLength(1);
    expect(plan.deletable).toBe(false);
    // 🔴 막힌 Workspace 를 「지울 것」으로도 「남길 것」으로도 세지 않는다.
    expect(plan.deleted).toHaveLength(0);
    expect(plan.preserved).toHaveLength(0);
  });

  it("다른 OWNER 가 있으면 OWNER 였어도 막지 않는다", () => {
    const plan = planAccountDeletion([
      facts({ role: "OWNER", otherMembers: 2, otherOwners: 1 }),
    ]);

    expect(plan.deletable).toBe(true);
    expect(plan.preserved).toHaveLength(1);
  });

  it("🔴 Personal Workspace 라도 다른 멤버가 있으면 지우지 않는다", () => {
    const plan = planAccountDeletion([
      facts({
        isPersonal: true,
        role: "OWNER",
        otherMembers: 1,
        otherOwners: 1,
      }),
    ]);

    expect(plan.deleted).toHaveLength(0);
    expect(plan.preserved[0]?.disposition).toBe("PRESERVED");
  });

  it("🔴 남는 Personal Workspace 만 주소를 바꾼다 — GitHub 아이디가 박혀 있어서다", () => {
    const plan = planAccountDeletion([
      facts({
        workspaceId: "personal",
        isPersonal: true,
        role: "OWNER",
        otherMembers: 1,
        otherOwners: 1,
      }),
      facts({
        workspaceId: "team",
        isPersonal: false,
        role: "MEMBER",
        otherMembers: 1,
        otherOwners: 1,
      }),
    ]);

    expect(
      plan.preserved.find((entry) => entry.workspaceId === "personal")
        ?.rotateSlug,
    ).toBe(true);
    // 🔴 사람이 고른 이름에서 나온 주소는 건드리지 않는다.
    expect(
      plan.preserved.find((entry) => entry.workspaceId === "team")?.rotateSlug,
    ).toBe(false);
  });

  it("사라지는 Workspace 의 주소는 바꾸지 않는다 — 행 자체가 없어진다", () => {
    const plan = planAccountDeletion([
      facts({ isPersonal: true, role: "OWNER", otherMembers: 0 }),
    ]);

    expect(plan.deleted[0]?.rotateSlug).toBe(false);
  });

  it("하나라도 막히면 계정 전체를 지우지 않는다", () => {
    const plan = planAccountDeletion([
      facts({ workspaceId: "solo", role: "OWNER", otherMembers: 0 }),
      facts({ workspaceId: "stuck", role: "OWNER", otherMembers: 1 }),
    ]);

    expect(plan.deletable).toBe(false);
    // 🔴 지울 수 있는 것만 먼저 지우고 마는 일이 없어야 한다. 부르는 쪽이 통째로 멈춘다.
    expect(plan.deleted.map((entry) => entry.workspaceId)).toEqual(["solo"]);
  });

  it("소속이 하나도 없으면 그냥 지운다", () => {
    const plan = planAccountDeletion([]);

    expect(plan.deletable).toBe(true);
    expect(plan.entries).toHaveLength(0);
  });
});
