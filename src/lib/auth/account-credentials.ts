import "server-only";

import type { Adapter, AdapterAccount } from "next-auth/adapters";

/**
 * GitHub OAuth Credential 을 **Database 에 영구 저장하지 않게** 만드는 자리.
 *
 * # 무엇이 문제였는가
 *
 * `@auth/drizzle-adapter` 의 `linkAccount(data)` 는 Auth.js 가 넘긴 Account 객체를
 * **그대로** `accounts` 에 INSERT 한다(`lib/pg.js`). 그 객체에는 GitHub 이 방금 돌려준
 * `access_token`·`refresh_token` 이 들어 있어, 첫 로그인 한 번으로 **평문 Credential 이
 * 표에 눌러앉는다.** 해시도 암호화도 걸리지 않는다.
 *
 * `api_keys` 는 SHA-256 Hash 만 저장한다(CLAUDE.md 12). **같은 기준이 GitHub Token 에는
 * 적용되지 않고 있었다.**
 *
 * # 왜 «암호화»가 아니라 «저장하지 않기» 인가
 *
 * 🔴 **ReviewTrace 는 로그인이 끝난 뒤 그 Token 을 한 번도 쓰지 않는다.**
 *
 * - GitHub 프로필 조회는 **콜백 안에서** 응답으로 받은 Token 으로 끝난다
 *   (`@auth/core/providers/github.js` 의 `userinfo.request`). Database 를 보지 않는다
 * - 세션 콜백은 프로필 세 칸만 돌려준다(`config.ts`) — Token 은 세션에 담기지 않는다
 * - **재로그인은 `linkAccount` 를 다시 부르지 않는다.** OAuth 계정 행이 이미 있으면
 *   Auth.js 는 세션만 만들고 돌아간다(`@auth/core/lib/actions/callback/handle-login.js`).
 *   저장된 Token 은 갱신되지도 않아 **어차피 만료된 채 남는다**
 * - GitHub Evidence 대조는 서버가 따로 들고 있는 `GITHUB_API_TOKEN` 을 쓴다
 *   (`src/lib/github/content.ts`) — 사용자 OAuth Token 과 무관하다
 *
 * 암호화는 **쓸 데가 있는 값**을 지키는 방법이다. 쓰지 않는 값에 그것을 붙이면 키 관리와
 * 회전이라는 새 짐만 지고 유출 표면은 그대로 남는다. 안 가지고 있는 것은 샐 수 없다.
 *
 * # 왜 Column 을 지우지 않는가
 *
 * 🔴 **「Adapter 호환 때문에 필요한 Column」과 「값을 저장해야 하는 Column」은 별개다.**
 * Adapter 는 넘겨받은 객체를 그대로 INSERT 하므로, Column 이 없으면 Auth.js 가 Token 을
 * 담아 보내는 순간 **INSERT 자체가 실패해 로그인이 깨진다.** nullable Column 은 그대로 두고
 * **값만** 넣지 않는다. 목표는 Schema 모양이 아니라 Credential 이 남지 않는 것이다.
 */

/** 저장하지 않는 Credential 칸. 나머지(`scope`·`token_type` 등)는 신원·이력 정보다. */
const CREDENTIAL_FIELDS = ["access_token", "refresh_token"] as const;

/**
 * Account 객체에서 Credential «값»만 걷어낸다.
 *
 * 🔴 **신원 칸은 건드리지 않는다** — `provider`·`providerAccountId`·`userId`·`type` 이
 * 없으면 다음 로그인에 사용자를 찾지 못한다(`getUserByAccount`).
 */
export function stripAccountCredentials(
  account: AdapterAccount,
): AdapterAccount {
  const stripped: AdapterAccount = { ...account };

  for (const field of CREDENTIAL_FIELDS) {
    delete stripped[field];
  }

  return stripped;
}

/**
 * Adapter 를 감싸 `linkAccount` 로 들어가는 Credential 을 걷어낸다.
 *
 * 🔴 **막는 자리는 여기 하나뿐이다.** `accounts` 에 행을 만드는 Adapter 함수가
 * `linkAccount` 밖에 없어서다 — Auth.js 를 fork 하거나 Adapter 를 복제할 이유가 없다.
 *
 * Adapter 의 나머지 동작은 그대로 흘려보낸다.
 */
export function withoutStoredCredentials(adapter: Adapter): Adapter {
  if (adapter.linkAccount === undefined) {
    return adapter;
  }

  return {
    ...adapter,
    // 원본 Adapter 를 수신자로 두고 부른다 — 구현이 `this` 를 쓰더라도 깨지지 않는다.
    linkAccount: (account) =>
      adapter.linkAccount!(stripAccountCredentials(account)),
  };
}
