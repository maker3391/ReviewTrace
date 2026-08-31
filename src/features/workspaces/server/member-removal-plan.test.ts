import { describe, expect, it } from "vitest";

import {
  planMemberRemoval,
  type MemberRemovalFacts,
} from "@/features/workspaces/server/member-removal-plan";

/**
 * 내보내기 «규칙»만 본다. Database 를 보지 않으므로 기본 `pnpm test` 에서 매번 돈다.
 *
 * 🔴 **이 파일이 초록인 것은 「실제로 행이 지워졌다」의 근거가 아니다** —
 * 잠금 · Transaction · Tenant 격리는 짝인 `member-removal.integration.test.ts` 가 본다.
 */

const owner: MemberRemovalFacts = {
  actorRole: "OWNER",
  isSelf: false,
  targetIsMember: true,
  targetIsPersonalOwner: false,
};

describe("planMemberRemoval", () => {
  it("OWNER 는 다른 멤버를 내보낼 수 있다", () => {
    expect(planMemberRemoval(owner)).toEqual({ removable: true, block: null });
  });

  it("MEMBER 는 누구도 내보내지 못한다", () => {
    expect(planMemberRemoval({ ...owner, actorRole: "MEMBER" })).toEqual({
      removable: false,
      block: "NOT_OWNER",
    });
  });

  it("🔴 OWNER 라도 자기 자신은 내보내지 못한다", () => {
    expect(planMemberRemoval({ ...owner, isSelf: true })).toEqual({
      removable: false,
      block: "SELF",
    });
  });

  it("멤버가 아닌 사람은 내보낼 것이 없다", () => {
    expect(planMemberRemoval({ ...owner, targetIsMember: false })).toEqual({
      removable: false,
      block: "NOT_MEMBER",
    });
  });

  it("🔴 Personal Workspace 의 주인은 내보내지 못한다", () => {
    expect(planMemberRemoval({ ...owner, targetIsPersonalOwner: true })).toEqual(
      { removable: false, block: "PERSONAL_OWNER" },
    );
  });

  /**
   * 🔴 **자격이 «먼저»다.** OWNER 가 아닌 사람에게 「그 사람은 멤버가 아닙니다」로 답하면,
   * 내보낼 권한도 없는 사람이 누가 멤버인지 물어보는 도구를 얻는다.
   */
  it("OWNER 가 아니면 대상의 사정을 알려 주지 않는다", () => {
    expect(
      planMemberRemoval({
        actorRole: "MEMBER",
        isSelf: false,
        targetIsMember: false,
        targetIsPersonalOwner: true,
      }).block,
    ).toBe("NOT_OWNER");
  });

  /**
   * 🔴 **「마지막 OWNER」 판정이 «없는 것»이 규칙이다.** 부르는 사람은 언제나 OWNER 이고
   * 자기 자신은 대상이 될 수 없으니, 내보낸 뒤에도 OWNER 는 최소 한 명 남는다.
   */
  it("OWNER 가 다른 OWNER 를 내보내는 것은 막지 않는다", () => {
    expect(planMemberRemoval(owner).removable).toBe(true);
  });
});
