/**
 * Email 의 **정규 형태(canonical form)** 를 만든다.
 *
 * ## 무엇을 푸는가
 *
 * Email 은 이 제품에서 **identity 다.** 로그인한 사람을 `users` 행에 잇고(Auth.js 의
 * `getUserByEmail`), 아직 회원이 아닌 사람을 초대 대상으로 잡는 유일한 값이다
 * (`workspace_invitations.email`). 그 값이 자리마다 다른 모습으로 오가면
 * **같은 사람이 둘로 갈라진다** — `User@Example.com` 으로 가입한 사람이
 * `user@example.com` 초대를 받으면 「이미 멤버」 판정을 빠져나가고, 수락하는 순간
 * 같은 사람의 계정이 하나 더 생길 수 있다.
 *
 * ## 왜 «저장 시» 정규화인가 — `lower(email) = lower(?)` 가 아니라
 *
 * 비교 시점에 함수를 씌우는 방식은 두 가지를 못 한다.
 *
 * 1. **`users_email_unique` 를 타지 못한다.** 그 index 는 `btree (email)` 이라
 *    Column 에 `lower()` 를 씌우는 순간 쓰이지 않는다 — 별도의 표현식 index 를
 *    새로 만들어야 하고, 그것은 근거 없이 Index 를 더하는 일이다(CLAUDE.md 10)
 * 2. **unique 제약이 case 차이를 막지 못한다.** 조회를 아무리 `lower()` 로 해도
 *    `Guest@x` 와 `guest@x` 는 서로 다른 행으로 **저장될 수 있다.** 정본이 갈라진 뒤에
 *    조회만 합치는 것은 뒷수습이지 방지가 아니다
 *
 * 그래서 **경계에서 한 번 정규화해 저장하고, 이후 비교는 평범한 equality** 로 한다.
 *
 * ```
 * 입력 -> normalizeEmail() -> canonical 값 저장/조회 -> btree equality
 * ```
 *
 * ## 왜 「trim + lowercase」까지만 하는가
 *
 * 🔴 **lowercase 는 우리가 고를 수 있는 값이 아니다.** Auth.js core 는 OAuth 프로필을
 * Adapter 에 넘기기 전에 `email: userFromProfile.email?.toLowerCase()` 를 이미 한다
 * (`@auth/core/lib/actions/callback/oauth/callback.js`). 그것이 `createUser` 와
 * `getUserByEmail` 양쪽에 그대로 들어가므로, 우리가 다른 형태를 정본으로 삼으면
 * **우리가 조회하는 값과 Adapter 가 저장한 값이 어긋난다.** 공백 제거는 core 가 하지
 * 않으므로 우리가 더한다.
 *
 * 🔴 **그 이상은 하지 않는다.** Gmail 의 `.` 제거나 `+태그` 절단 같은 규칙은
 * **Provider 마다 다르다** — 일반화하면 서로 다른 사람의 주소를 한 계정으로 합칠 수 있다.
 * 정규화가 identity 를 «잃게» 만드는 쪽이 갈라지는 것보다 나쁘다.
 *
 * RFC 5321 상 local-part 는 case-sensitive 일 수 있지만, 실제로 대소문자를 구분하는
 * Mailbox 는 사실상 없고 이 제품의 유일한 입구인 GitHub OAuth 도 그렇게 다룬다.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
