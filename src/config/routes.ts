/**
 * 경로별 접근 표.
 *
 * 🔴 **공개 경로는 목록이고, 목록에 없으면 보호다**(CLAUDE.md 11).
 * 반대로 「보호할 것 목록」을 두면 화면을 새로 만들 때마다 목록에 적는 것을 잊는 순간
 * 그 화면이 공개된다. 잊으면 막히는 쪽으로 기운다.
 *
 * 🔴 **이 표는 한 곳이다.** `src/config/navigation.ts` 의 메뉴↔라우트 대응표와 갈라지지 않게
 * `src/config/routes.test.ts` 가 둘을 맞대어 본다.
 *
 * 이 파일은 순수 함수만 둔다 — Proxy(`src/proxy.ts`)와 서버 화면이 **같은 판정**을 쓴다.
 */

/** 로그인 화면. 🔴 반드시 공개다 — 막으면 무한 리다이렉트가 된다. */
export const LOGIN_PATH = "/login";

/** Workspace 화면의 뿌리. `/w/{slug}/{section}` 이다. */
export const WORKSPACE_PATH_PREFIX = "/w";

/** 초대 수락. 아직 로그인하지 않은 사람도 링크를 열 수 있어야 한다. */
export const INVITE_PATH_PREFIX = "/invite";

/** Auth.js 가 쓰는 Endpoint(로그인 시작·OAuth 콜백·로그아웃). 막으면 로그인이 시작되지 않는다. */
export const AUTH_API_PREFIX = "/api/auth";

/**
 * Agent 용 Public API.
 *
 * 🔴 여기는 **세션이 아니라 API Key** 로 인증한다(CLAUDE.md 13). 세션 쿠키가 없다고
 * 로그인 화면으로 돌려보내면 Agent 가 HTML 을 받는다 — Route Handler 가 401 로 답해야 한다.
 */
export const AGENT_API_PREFIX = "/api/v1";

const PUBLIC_EXACT_PATHS: readonly string[] = [LOGIN_PATH];

const PUBLIC_PREFIXES: readonly string[] = [
  AUTH_API_PREFIX,
  AGENT_API_PREFIX,
  INVITE_PATH_PREFIX,
];

/** 끝의 `/` 는 같은 화면이다. `/login/` 이 보호로 분류돼 리다이렉트가 도는 것을 막는다. */
function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

/**
 * 이 경로가 세션 없이 열려도 되는가.
 *
 * 🔴 「공개」는 **세션 검사를 건너뛴다**는 뜻일 뿐 **아무나 데이터를 본다**는 뜻이 아니다.
 * 초대 수락 화면은 Token 을 검사하고, Agent API 는 API Key 를 검사한다.
 */
export function isPublicPath(pathname: string): boolean {
  const path = normalizePath(pathname);

  if (PUBLIC_EXACT_PATHS.includes(path)) {
    return true;
  }

  return PUBLIC_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** `/w/{slug}/{section}` 을 만든다. 주소를 문자열로 이어 붙이는 자리를 한 곳에 모은다. */
export function workspacePath(slug: string, section: string): string {
  return `${WORKSPACE_PATH_PREFIX}/${slug}/${section}`;
}

/**
 * 경로에서 Workspace slug 를 읽는다. Proxy 가 「마지막으로 본 Workspace」를 기억할 때 쓴다.
 *
 * 🔴 여기서 나온 값은 **권한 근거가 아니다.** 편의를 위한 표시일 뿐이다.
 */
export function readWorkspaceSlugFromPath(pathname: string): string | null {
  const segments = normalizePath(pathname).split("/");
  // ["", "w", "{slug}", ...]
  if (segments[1] !== "w") {
    return null;
  }

  const slug = segments[2];
  return slug === undefined || slug === "" ? null : slug;
}
