import "server-only";

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { customFetch, type NextAuthConfig, type Session } from "next-auth";
import GitHub from "next-auth/providers/github";

import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { LOGIN_PATH } from "@/config/routes";
import { withoutStoredCredentials } from "@/lib/auth/account-credentials";
import { githubProfileToUser } from "@/lib/auth/github-profile";
import { authEnv } from "@/lib/env";
import { withAuthPerformance } from "@/lib/performance/auth-adapter";
import { measurePerformance } from "@/lib/performance/timing";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

/**
 * Auth.js 설정.
 *
 * ## 가입 정책
 *
 * 🔴 **누구나 GitHub OAuth 로 가입할 수 있다.** 허용 목록도 초대 전용도 아니다.
 * 처음 로그인하면 그 사람의 Personal Workspace 가 만들어지고 그가 OWNER 가 된다.
 * 다른 Workspace 에는 초대로 들어간다(`src/features/invitations`).
 *
 * ## 왜 Database 세션인가
 *
 * 🔴 **「JWT 를 쓰면 Token 이 브라우저에 노출된다」는 이유가 아니다.** 그것은 잘못된 설명이다 —
 * GitHub Access Token 이 새는 것은 **세션 콜백에 그것을 담을 때**이지 세션 전략 때문이 아니다.
 * 아래 `session` 콜백이 프로필 세 칸만 돌려주므로 어느 전략이든 Token 은 나가지 않는다.
 *
 * 실제 이유는 둘이다.
 *
 * 1. **이미 Adapter 를 쓴다.** `users`·`accounts` 를 Database 에 두는 이상 `sessions` 한 표가
 * 더 붙는 비용은 거의 없고, Adapter 의 기본 동작을 그대로 쓰는 쪽이 갈래가 적다
 * 2. **끊을 수 있다.** 행을 지우면 그 즉시 세션이 죽는다. JWT 는 만료 전까지 살아남으므로
 * Workspace 에서 내보낸 사람의 세션을 즉시 끊으려면 별도의 폐기 목록이 필요해진다
 *
 * ## 설정을 함수로 만드는 이유
 *
 * `NextAuth(config)` 를 모듈 최상단에서 즉시 평가하면 이 파일을 import 만 하는 코드까지
 * 환경 변수를 요구한다. `next build` 는 Secret 없이도 돌아야 하므로 **요청이 왔을 때**
 * 읽는다(`src/db/index.ts` 의 Pool 과 같은 이유다).
 */

/** GitHub 프로필의 `login`(아이디). OAuth 응답은 외부 입력이라 타입을 믿지 않는다. */
function readGithubLogin(profile: unknown): string | null {
 const login = (profile as { login?: unknown } | null | undefined)?.login;
 return typeof login === "string" && login !== "" ? login : null;
}

export function buildAuthConfig(): NextAuthConfig {
 const env = authEnv();
 const github = GitHub({
 clientId: env.GITHUB_CLIENT_ID,
 clientSecret: env.GITHUB_CLIENT_SECRET,
 // 🔴 Email 이 `users` 로 들어오는 유일한 입구다 — 규칙은 `github-profile.ts` 에 있다.
 profile: (profile) =>
 measurePerformance("auth.callback.profile", () =>
 githubProfileToUser(profile),
 ),
 [customFetch]: (...args: Parameters<typeof fetch>) =>
 measurePerformance("auth.github.token_exchange", () => fetch(...args)),
 });

 if (typeof github.userinfo === "object" && github.userinfo.request !== undefined) {
 const userinfo = github.userinfo;
 const request = userinfo.request;
 github.userinfo = {
...userinfo,
 request: (context: Parameters<typeof request>[0]) =>
 measurePerformance("auth.github.profile", () =>
 request.call(userinfo, context),
 ),
 };
 }

 return {
 /**
 * 🔴 Adapter 가 users·accounts·sessions 를 쓴다. 표의 정본은 `src/db/schema` 다.
 *
 * 🔴 **감싼 이유는 하나다 — GitHub OAuth Token 을 `accounts` 에 남기지 않기 위해서다.**
 * Adapter 의 기본 `linkAccount` 는 넘겨받은 Account 를 그대로 INSERT 해서
 * `access_token`·`refresh_token` 이 평문으로 눌러앉는다. 로그인이 끝난 뒤 그 값을 쓰는
 * 코드가 없으므로 **암호화가 아니라 저장하지 않는 쪽**을 골랐다
 * (근거와 조사 내용은 `account-credentials.ts` 에 있다).
 */
 adapter: withAuthPerformance(withoutStoredCredentials(
 DrizzleAdapter(db(), {
 usersTable: users,
 accountsTable: accounts,
 sessionsTable: sessions,
 verificationTokensTable: verificationTokens,
 }),
)),

 session: { strategy: "database" },

 secret: env.AUTH_SECRET,

 /**
 * 앞단(리버스 프록시·컨테이너)이 넘긴 Host 를 콜백 URL 계산에 쓴다.
 * Vercel 밖에서 돌리려면 필요하다 — 없으면 `UntrustedHost` 로 로그인 자체가 막힌다.
 */
 trustHost: true,

 providers: [github],

 /**
 * 기본 로그인·오류 화면을 쓰지 않는다.
 *
 * Auth.js 기본 오류 화면은 Provider 가 왜 거절했는지를 그대로 보여 준다.
 * 그 내용을 사용자에게 그리지 않는다 — 두 경로 모두 `/login` 이다.
 */
 pages: {
 signIn: LOGIN_PATH,
 error: LOGIN_PATH,
 },

 callbacks: {
 /**
 * 🔴 **세션에는 화면이 쓰는 프로필만 담는다.**
 *
 * 기본 동작은 `sessions` 행을 통째로 펼쳐 돌려준다 — 거기에는 브라우저 쿠키 값 그대로인
 * `sessionToken` 이 들어 있다. 그것이 세션 응답이나 RSC payload 로 나가면 HttpOnly 쿠키를
 * 쓰는 의미가 사라진다.
 *
 * 🔴 **GitHub Access Token 은 `accounts` 표에만 있다.** `session.accessToken` 같은 칸을
 * 만들지 않는다 — 여기에 한 줄 더하는 순간 브라우저까지 나간다(스펙 4).
 */
 async session({ session, user }): Promise<Session> {
 return measurePerformance("auth.callback.session", () => ({
 // Database 세션의 만료는 Date 로 온다. 계약은 ISO 문자열이다.
 expires: session.expires.toISOString(),
 user: {
 id: user.id,
 name: user.name ?? null,
 image: user.image ?? null,
 },
 }));
 },
 },

 events: {
 /**
 * 가입·로그인 뒤 Personal Workspace 를 확보한다.
 *
 * `signIn` 콜백이 아니라 이벤트인 이유는 순서 때문이다 — 콜백은 Adapter 가 `users` 행을
 * 만들기 전에 돌아서 OWNER 로 붙일 대상이 아직 없다.
 *
 * slug 재료로 GitHub 아이디를 쓴다. 이미 전역에서 유일하고 URL 에 그대로 넣을 수 있다.
 * 여기서 실패하면 랜딩(`src/app/page.tsx`)이 같은 함수를 다시 불러 메운다 —
 * 「User 는 있는데 Workspace 가 없는」 반쪽 상태로 남지 않게 하려는 것이다.
 */
 async signIn({ user, profile }) {
 if (typeof user.id !== "string") {
 return;
 }
 const userId = user.id;

 await measurePerformance("auth.workspace.ensure", () =>
 ensurePersonalWorkspace({
 userId,
 displayName: user.name ?? null,
 slugSource: readGithubLogin(profile),
 }),
 );
 },
 },
 };
}
