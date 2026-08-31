import { NextResponse, type NextRequest } from "next/server";

import {
 isPublicPath,
 LOGIN_PATH,
 readWorkspaceSlugFromPath,
} from "@/config/routes";
import {
 LAST_WORKSPACE_COOKIE_MAX_AGE,
 LAST_WORKSPACE_COOKIE_NAME,
} from "@/lib/workspace/last-workspace";

/**
 * Proxy — Next.js 16 에서 Middleware 의 새 이름이다. 요청이 화면에 닿기 전에 돈다.
 *
 * 하는 일은 둘뿐이다.
 *
 * 1. 세션 쿠키가 **아예 없는** 요청을 보호된 경로에서 돌려보낸다
 * 2. 지금 보고 있는 Workspace slug 를 쿠키에 적어 둔다 (로그인 뒤 어디로 갈지의 힌트)
 * 3. 현재 경로를 요청 헤더에 실어 준다 (Layout 이 「지금 어느 Project 인가」를 알기 위해)
 *
 * 🔴 **이것은 경계가 아니다.** 쿠키가 「있다」만 볼 뿐 그것이 살아 있는 세션인지, 그 사람이
 * 그 Workspace 의 멤버인지는 보지 않는다. 진짜 판정은 Database 를 보는 서버 화면
 * (`src/lib/auth/require-workspace.ts`)이 한다.
 *
 * 여기서 Database 를 보지 않는 이유는 Proxy 가 **prefetch 를 포함한 모든 요청**마다 돌기
 * 때문이다. 링크에 마우스만 올려도 세션 조회가 한 번씩 나간다.
 *
 * 그래도 Proxy 를 두는 이유는 **렌더가 시작되기 전에** 끊기 위해서다 — 렌더가 시작되면
 * 보호된 화면의 뼈대가 한 번 스트리밍된다.
 */

/**
 * Auth.js 의 세션 쿠키 이름. HTTPS 에서는 `__Secure-` 접두사가 붙는다.
 *
 * 🔴 **값을 해석하지 않는다.** 존재만 본다 — Proxy 는 판정하는 자리가 아니다.
 */
/** 현재 경로를 Layout 에 알리는 헤더. 읽는 쪽은 `app/(workspace)/.../layout.tsx` 다. */
export const CURRENT_PATH_HEADER = "x-current-path";

const SESSION_COOKIE_NAMES = [
 "authjs.session-token",
 "__Secure-authjs.session-token",
];

export function proxy(request: NextRequest): NextResponse {
 const { pathname } = request.nextUrl;

 const hasSessionCookie = SESSION_COOKIE_NAMES.some(
 (name) => request.cookies.get(name) !== undefined,
);

 if (!isPublicPath(pathname) && !hasSessionCookie) {
 return NextResponse.redirect(new URL(LOGIN_PATH, request.nextUrl.origin));
 }

 /**
 * 현재 경로를 헤더로 실어 준다.
 *
 * 🔴 Layout 은 하위 Route 의 `params` 를 받지 못한다 — 상단 바가 Project 이름을 그리려면
 * 경로를 알아야 하는데, Next.js 는 그것을 Layout 에 넘겨 주지 않는다. 여기서 한 번 적어
 * 두면 `headers()` 로 읽을 수 있다.
 *
 * 🔴 **이 값은 표시용이다. 권한 근거가 아니다** — 경로에서 읽은 slug 는 서버가 소속을
 * 확인한 목록에 맞대어 본 뒤에야 쓰인다.
 */
 const requestHeaders = new Headers(request.headers);
 requestHeaders.set(CURRENT_PATH_HEADER, pathname);

 const response = NextResponse.next({ request: { headers: requestHeaders } });

 /**
 * 「마지막으로 본 Workspace」를 남긴다.
 *
 * 🔴 **권한과 무관한 편의 값이다**(스펙 16). 읽는 쪽(`src/app/page.tsx`)이 소속을 다시
 * 확인하므로, 이 쿠키를 손으로 고쳐도 남의 Workspace 가 열리지 않는다.
 * `httpOnly` 로 두는 것은 비밀이라서가 아니라 스크립트가 건드릴 이유가 없기 때문이다.
 */
 const slug = readWorkspaceSlugFromPath(pathname);
 if (slug !== null) {
 response.cookies.set(LAST_WORKSPACE_COOKIE_NAME, slug, {
 httpOnly: true,
 sameSite: "lax",
 path: "/",
 secure: request.nextUrl.protocol === "https:",
 maxAge: LAST_WORKSPACE_COOKIE_MAX_AGE,
 });
 }

 return response;
}

export const config = {
 /**
 * 정적 자원과 이미지 최적화 요청은 건너뛴다. 그 밖의 모든 경로에서 돈다 —
 * 공개 경로 판정은 `isPublicPath` 한 곳에서 하고, matcher 로 나눠 적지 않는다.
 */
 matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
