import { describe, expect, it } from "vitest";

import { normalizeEmail } from "@/lib/validation/email";

/**
 * Email 정규화 규칙 자체.
 *
 * 🔴 이 규칙이 깨지면 **같은 사람이 두 계정이 된다.** 그것을 잡는 시험은
 * 세 곳에 나뉘어 있다 — 규칙(이 파일) · OAuth 입구(`../auth/github-profile.test.ts`) ·
 * 초대 판정(`../../features/invitations/server/invitation-service.test.ts`).
 */
describe("normalizeEmail", () => {
  it("소문자로 맞춘다", () => {
    expect(normalizeEmail("User@Example.com")).toBe("user@example.com");
    expect(normalizeEmail("USER@EXAMPLE.COM")).toBe("user@example.com");
  });

  it("앞뒤 공백을 없앤다 — 붙여넣기가 끌고 오는 것이다", () => {
    expect(normalizeEmail("  user@example.com ")).toBe("user@example.com");
    expect(normalizeEmail("\tUser@Example.COM\n")).toBe("user@example.com");
  });

  it("이미 정규 형태면 그대로다 — 두 번 걸어도 같다", () => {
    expect(normalizeEmail("user@example.com")).toBe("user@example.com");
    expect(normalizeEmail(normalizeEmail(" A@B.COM "))).toBe(
      normalizeEmail(" A@B.COM "),
    );
  });

  /**
   * 🔴 **이 파일에서 가장 중요한 한 줄.** case 차이가 별도 identity 가 되지 않는다.
   */
  it("🔴 대소문자만 다른 주소는 «같은 하나»로 접힌다", () => {
    const forms = [
      "user@example.com",
      "User@Example.com",
      "USER@EXAMPLE.COM",
      "  uSeR@ExAmPlE.cOm  ",
    ];

    expect(new Set(forms.map(normalizeEmail)).size).toBe(1);
  });

  /**
   * 🔴 **정규화가 identity 를 «잃게» 만들지 않는다.** Gmail 의 `.` 이나 `+태그` 를
   * 지우는 규칙은 Provider 마다 달라서, 일반화하면 서로 다른 사람의 주소가 한 계정으로 합쳐진다.
   */
  it("🔴 local-part 의 `.` 과 `+태그` 는 «지우지 않는다»", () => {
    expect(normalizeEmail("first.last+github@example.com")).toBe(
      "first.last+github@example.com",
    );
    expect(normalizeEmail("firstlast@example.com")).not.toBe(
      normalizeEmail("first.last@example.com"),
    );
  });

  it("가운데 공백은 건드리지 않는다 — 형식 거부는 Schema 의 몫이다", () => {
    expect(normalizeEmail(" a b@example.com ")).toBe("a b@example.com");
  });
});
