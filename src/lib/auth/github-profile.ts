import type { User } from "next-auth";
import type { GitHubProfile } from "next-auth/providers/github";

import { normalizeEmail } from "@/lib/validation/email";

/**
 * GitHub OAuth 프로필 -> 우리 `users` 행이 될 값.
 *
 * ## 🔴 여기가 Email 이 우리 Database 로 들어오는 «유일한» 입구다
 *
 * Auth.js 는 이 함수가 돌려준 값을 그대로 두 곳에 쓴다
 * (`@auth/core/lib/actions/callback/handle-login.js`).
 *
 * ```
 * getUserByEmail(email)  ->  eq(users.email, email)   기존 계정 찾기
 * createUser({ ...user })                             새 계정 만들기
 * ```
 *
 * **찾을 때와 만들 때가 같은 값이므로**, 이 자리에서 정규화하면 그 뒤로는 정규화가 필요한
 * 자리가 없다 — Adapter 를 우리가 고쳐 끼울 필요도, 조회마다 `lower()` 를 씌울 필요도 없다.
 * 반대로 여기를 놓치면 `User@x` 로 만든 행과 `user@x` 조회가 어긋나
 * **같은 사람의 계정이 둘로 갈라진다**(`users_email_unique` 는 그것을 막지 못한다).
 *
 * `@auth/core` 가 이미 `toLowerCase()` 를 하지만 **거기에 기대지 않는다.** 그것은
 * 문서화된 계약이 아니라 구현 세부이고, 앞뒤 공백은 그쪽이 다루지 않는다
 * (`@/lib/validation/email` 에 근거를 적어 두었다).
 *
 * ## 이 모듈이 `config.ts` 와 나뉜 이유
 *
 * `buildAuthConfig()` 는 `AUTH_SECRET`·GitHub Secret 을 요구하고 Adapter 로 Database 를
 * 문다. 그 전제 없이 **매핑 규칙만** 시험할 수 있어야 이 규칙이 기본 `pnpm test` 에서 돈다.
 */
export function githubProfileToUser(profile: GitHubProfile): User {
  return {
    id: String(profile.id),
    name: profile.name ?? profile.login,
    /**
     * GitHub 은 이메일을 비공개로 둘 수 있어 `email` 이 비어 올 수 있다.
     * `users.email` 은 NOT NULL 이고 unique 라, 비면 로그인이 통째로 실패한다.
     * GitHub 이 계정마다 보장하는 noreply 주소로 채운다 — 값을 지어내지 않으면서
     * 계정마다 다른 값이 된다.
     *
     * 🔴 이 대체 주소도 정규화를 «지나간다». `profile.login` 은 대문자를 가질 수 있어
     * (`Maker3391`) 그대로 두면 이메일을 공개하지 않은 사용자만 갈라진다.
     */
    email: normalizeEmail(
      profile.email ??
        `${profile.id}+${profile.login}@users.noreply.github.com`,
    ),
    image: profile.avatar_url,
  };
}
