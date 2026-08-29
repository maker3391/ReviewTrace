import { describe, expect, it, vi } from "vitest";

/**
 * `auth()` 는 Next.js 런타임을 끌고 온다. 여기서 검증하는 것은 **역할 판정**뿐이라
 * 세션 조회를 대신 세워 둔다 — 이 시험이 인증 라이브러리를 적재할 이유가 없다.
 */
vi.mock("@/lib/auth/session", () => ({ currentUser: vi.fn() }));

const { requireOwner } = await import("@/lib/auth/require-workspace");

/**
 * OWNER 전용 경계.
 *
 * 🔴 **이 한 줄이 지우면 사라지는 것**: `requireOwner` 는 지금 네 곳을 지킨다 —
 * API Key **발급**(`api-key-actions.ts:52`) · API Key **폐기**(`:79`) ·
 * **멤버 초대**(`invite-member.ts:50`) · **멤버 역할 변경**(`workspace-actions.ts:87`).
 * 함수 본문을 지우면 **그 Workspace 의 아무 MEMBER 나** 남을 초대하고 API Key 를 뽑고
 * 남의 역할을 바꿀 수 있게 되는데, **시험이 하나도 없어 전 스위트가 초록이었다.**
 *
 * 화면에서 버튼을 감추는 것은 편의일 뿐이다(`members/page.tsx`·`settings/page.tsx` 의 주석도
 * 「실제 판정은 Server Action 안의 `requireOwner` 가 한다」고 적어 두었다).
 * 그 「실제 판정」을 여기서 못 박는다.
 *
 * 🔴 **없으면 404 다. 403 이 아니다** — 권한이 없다고 답하면 그 Workspace 가 존재한다는
 * 사실이 새어 나간다(`require-workspace.ts` 의 주석).
 *
 * ## 되돌림 확인
 *
 * `requireOwner` 의 `if` 를 지우면 아래 「MEMBER 는 통과하지 못한다」가 **실패한다.**
 */

function workspaceWith(role: "OWNER" | "MEMBER") {
  return {
    workspaceId: "ws-1",
    slug: "acme",
    name: "Acme",
    role,
    isPersonal: false,
  };
}

describe("requireOwner", () => {
  it("OWNER 는 그대로 통과한다", () => {
    expect(() => requireOwner(workspaceWith("OWNER"))).not.toThrow();
  });

  it("🔴 MEMBER 는 통과하지 못한다", () => {
    // 되돌리면 여기서 아무것도 던져지지 않는다 —
    // MEMBER 가 API Key 발급·폐기·초대·역할 변경을 할 수 있게 된다.
    expect(() => requireOwner(workspaceWith("MEMBER"))).toThrow();
  });

  it("거절은 「없음」으로 나간다 — 권한 부족이라고 알려 주지 않는다", () => {
    try {
      requireOwner(workspaceWith("MEMBER"));
      throw new Error("거절되지 않았다");
    } catch (error) {
      // Next.js 의 notFound() 는 digest 로 404 fallback 을 알린다.
      const digest = (error as { digest?: unknown }).digest;
      expect(typeof digest).toBe("string");
      expect(String(digest)).toContain("404");
      // 역할·Workspace 이름 같은 내부 사정이 실려 나가지 않는다.
      expect(String(digest)).not.toContain("MEMBER");
      expect(String(digest)).not.toContain("acme");
    }
  });
});
