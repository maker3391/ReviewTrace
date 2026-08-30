import { describe, expect, it } from "vitest";

import { visibleInviteUrl } from "@/features/invitations/utils/invite-link";

const ISSUED = {
  id: "11111111-1111-4111-8111-111111111111",
  url: "https://example.test/invite/plain-token",
};

describe("visibleInviteUrl — 죽은 초대 링크를 화면에 남기지 않는다", () => {
  it("살아 있는 초대면 주소를 그대로 돌려준다", () => {
    expect(visibleInviteUrl(ISSUED, [ISSUED.id])).toBe(ISSUED.url);
  });

  /**
   * 🔴 이 시험이 붙드는 결함. 취소·수락은 **다른 컴포넌트**에서 일어나고 서버가 목록만
   * 다시 그린다 — 그때 이 패널이 스스로 사라지지 않으면 죽은 Token 이 화면에 남는다.
   */
  it("🔴 목록에서 빠진 초대의 주소는 돌려주지 않는다 — 취소·수락된 것이다", () => {
    expect(visibleInviteUrl(ISSUED, [])).toBeNull();
    expect(
      visibleInviteUrl(ISSUED, ["22222222-2222-4222-8222-222222222222"]),
    ).toBeNull();
  });

  it("발행한 적이 없으면 아무것도 그리지 않는다", () => {
    expect(visibleInviteUrl(null, [ISSUED.id])).toBeNull();
  });

  /**
   * 🔴 **id 로만 판정한다.** 같은 주소를 가진 다른 행이라는 것은 있을 수 없지만,
   * 주소로 비교하기 시작하면 죽은 Token 문자열이 판정 경로에 한 벌 더 남는다.
   */
  it("주소가 같아도 id 가 다르면 남기지 않는다", () => {
    expect(
      visibleInviteUrl(ISSUED, ["33333333-3333-4333-8333-333333333333"]),
    ).toBeNull();
  });
});
