import { describe, expect, it } from "vitest";

import {
  inviteMemberSchema,
  invitationTokenSchema,
} from "@/features/invitations/schemas/invitation";

/** 정규화 규칙 자체의 시험은 `src/lib/validation/email.test.ts` 에 있다. */
describe("inviteMemberSchema", () => {
  it("정규화한 이메일을 돌려준다", () => {
    const result = inviteMemberSchema.safeParse({ email: " A@B.com " });

    expect(result.success).toBe(true);
    expect(result.data?.email).toBe("a@b.com");
  });

  it("이메일이 아니면 거부한다", () => {
    expect(
      inviteMemberSchema.safeParse({ email: "not-an-email" }).success,
    ).toBe(false);
    expect(inviteMemberSchema.safeParse({ email: "" }).success).toBe(false);
  });

  it("역할을 입력으로 받지 않는다 — 브라우저에서 OWNER 로 바꿔 보낼 수 없다", () => {
    const result = inviteMemberSchema.safeParse({
      email: "a@b.com",
      role: "OWNER",
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("role");
  });
});

describe("invitationTokenSchema", () => {
  /** 32바이트를 base64url 로 적으면 43자다. */
  const validToken = "A".repeat(43);

  it("형식이 맞으면 통과한다", () => {
    expect(invitationTokenSchema.safeParse(validToken).success).toBe(true);
    expect(invitationTokenSchema.safeParse(`${"a".repeat(41)}-_`).success).toBe(
      true,
    );
  });

  it("길이가 다르면 Database 를 보지도 않고 거부한다", () => {
    expect(invitationTokenSchema.safeParse("A".repeat(42)).success).toBe(false);
    expect(invitationTokenSchema.safeParse("A".repeat(44)).success).toBe(false);
    expect(invitationTokenSchema.safeParse("").success).toBe(false);
  });

  it("base64url 이 아닌 글자를 거부한다", () => {
    expect(invitationTokenSchema.safeParse(`${"A".repeat(42)}/`).success).toBe(
      false,
    );
    expect(invitationTokenSchema.safeParse(`${"A".repeat(42)}+`).success).toBe(
      false,
    );
  });
});
