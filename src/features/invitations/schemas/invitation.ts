import { z } from "zod";

/**
 * 초대 입력 Schema.
 *
 * 검증 규칙을 Component 안의 `if` 로 흩뿌리지 않는다(CLAUDE.md 9).
 */

/**
 * 이메일 정규화.
 *
 * 🔴 **보내는 쪽과 받는 쪽이 같은 규칙을 써야 한다**(CLAUDE.md 11). 초대는 이메일로 대상을
 * 잡는데, 한쪽만 소문자로 만들면 `A@b.com` 으로 초대한 사람이 `a@b.com` 으로 가입해 들어오지
 * 못한다. 그래서 정규화는 **이 함수 한 곳**에서 한다.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 초대 폼의 입력.
 *
 * 🔴 **역할을 입력으로 받지 않는다.** 초대로 만들 수 있는 것은 `MEMBER` 뿐이고, 그것은
 * 서버가 정한다 — 폼에 `role` 칸을 두면 브라우저에서 `OWNER` 로 바꿔 보낼 수 있다.
 */
export const inviteMemberSchema = z.object({
  email: z
    .string()
    .transform(normalizeEmail)
    .pipe(z.email("이메일 형식이 아닙니다.")),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/**
 * 초대 Token 의 형식.
 *
 * 32바이트를 base64url 로 적으면 43자다. 형식이 아니면 **Database 를 보지도 않고** 거절한다.
 */
export const invitationTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "초대 링크가 올바르지 않습니다.");
