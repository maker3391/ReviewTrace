import { z } from "zod";

import { normalizeEmail } from "@/lib/validation/email";

/**
 * 초대 입력 Schema.
 *
 * 검증 규칙을 Component 안의 `if` 로 흩뿌리지 않는다(CLAUDE.md 9).
 *
 * 🔴 **이메일 정규화 규칙은 여기 있지 않다.** 초대만의 규칙이 아니라 가입(OAuth 경계)과
 * 소속 판정이 함께 쓰는 identity 규칙이라 `@/lib/validation/email` 한 곳에 둔다 —
 * Feature 안에 두면 인증 경로가 초대 Feature 를 import 해야 하고, 그것은 의존 방향을
 * 거꾸로 세우는 일이다(CLAUDE.md 6).
 */

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
    // 🔴 오류 «문구» 는 여기 없다 — 규칙만 있고 말은 사전이 갖는다(`lib/validation/zod-error-map.ts`).
    .pipe(z.email()),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/**
 * 초대 Token 의 형식.
 *
 * 32바이트를 base64url 로 적으면 43자다. 형식이 아니면 **Database 를 보지도 않고** 거절한다.
 */
export const invitationTokenSchema = z
  .string()
  /*
    🔴 오류 «문구» 는 여기 없다. Zod 의 내장 check(`regex`)는 `params` 를 issue 로 실어
    보내지 않으므로 규칙 이름조차 붙일 수 없다 — 그래서 이 형식 오류를 사람에게 말하는
    자리는 부르는 쪽이다(`accept-invitation.ts` 의 `validation.rules.invitationToken`).
    화면(`invite/[token]/page.tsx`)은 애초에 이 message 를 그리지 않는다.
  */
  .regex(/^[A-Za-z0-9_-]{43}$/);

/**
 * 취소할 초대의 식별자.
 *
 * 🔴 **형식이 아닌 값은 Database 를 보지도 않고 거절한다.** 그대로 내려보내면 PostgreSQL 이
 * `22P02 invalid input syntax for type uuid` 로 터지고, 화면에는 정체 모를
 * `INTERNAL_ERROR` 가 뜬다(CLAUDE.md 9·19).
 *
 * 🔴 오류 «문구» 는 여기 없다 — 규칙만 있고 말은 사전이 갖는다
 * (`lib/validation/zod-error-map.ts`). 이 값은 화면이 만들어 보내는 것이 아니라 서버가
 * 그려 준 목록에서 오므로, 사람이 이 문구를 볼 일은 사실상 없다.
 */
export const invitationIdSchema = z.uuid();
