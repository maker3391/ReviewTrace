import { describe, expect, it } from "vitest";

import {
  planWorkspaceDeletion,
  type WorkspaceDeletionFacts,
} from "@/features/workspaces/server/workspace-deletion-plan";

/**
 * Workspace 삭제 **판정 규칙**. Database 없이 기본 `pnpm test` 에서 매번 돈다.
 *
 * 🔴 **이것이 실제 삭제를 검증하지 않는다.** CASCADE 로 무엇이 사라지는지 · 다른 Workspace
 * 가 그대로인지 · 고아가 남지 않는지는 `workspace-deletion.integration.test.ts` 가 실제
 * PostgreSQL 로 확인한다.
 */

/** 지울 수 있는 상태 — 팀 Workspace 의 유일한 멤버이자 OWNER. */
const DELETABLE: WorkspaceDeletionFacts = {
  isPersonal: false,
  role: "OWNER",
  otherMembers: 0,
};

describe("planWorkspaceDeletion", () => {
  it("팀 Workspace 의 유일한 OWNER 는 지울 수 있다", () => {
    expect(planWorkspaceDeletion(DELETABLE)).toEqual({
      deletable: true,
      block: null,
    });
  });

  it("Personal Workspace 는 혼자여도 지울 수 없다", () => {
    expect(
      planWorkspaceDeletion({ ...DELETABLE, isPersonal: true }),
    ).toEqual({ deletable: false, block: "PERSONAL" });
  });

  it("다른 멤버가 «한 명이라도» 있으면 지울 수 없다", () => {
    expect(
      planWorkspaceDeletion({ ...DELETABLE, otherMembers: 1 }),
    ).toEqual({ deletable: false, block: "HAS_MEMBERS" });
  });

  it("MEMBER 는 혼자여도 지울 수 없다", () => {
    expect(planWorkspaceDeletion({ ...DELETABLE, role: "MEMBER" })).toEqual({
      deletable: false,
      block: "NOT_OWNER",
    });
  });

  /**
   * 🔴 **자격이 먼저다.** OWNER 가 아닌 사람에게 「멤버를 내보내세요」라고 말하면 그가
   * 할 수 없는 일을 시키는 것이 된다.
   */
  it("MEMBER 이면서 다른 멤버도 있으면 «자격» 을 먼저 말한다", () => {
    expect(
      planWorkspaceDeletion({
        ...DELETABLE,
        role: "MEMBER",
        otherMembers: 3,
      }).block,
    ).toBe("NOT_OWNER");
  });

  /**
   * 🔴 **Personal 은 「멤버를 내보내면 된다」가 아니다.** 둘 다 걸리면 영구한 쪽을 말해야
   * 사람이 헛수고를 하지 않는다.
   */
  it("Personal 이면서 다른 멤버도 있으면 Personal 을 먼저 말한다", () => {
    expect(
      planWorkspaceDeletion({
        ...DELETABLE,
        isPersonal: true,
        otherMembers: 2,
      }).block,
    ).toBe("PERSONAL");
  });
});
