/**
 * 사이드바 접힘 상태.
 *
 * 🔴 **왜 쿠키인가 — 새로고침할 때 깜빡이지 않기 위해서다.**
 *
 * `localStorage` 에 두면 서버는 그 값을 모른 채 «펼친» 사이드바를 그려 보내고, 브라우저가
 * JS 를 실행한 뒤에야 접는다. 사용자는 **펼쳐졌다가 접히는 한 프레임**을 보게 된다.
 * 쿠키는 요청과 함께 오므로 서버가 처음부터 맞는 상태로 그린다.
 *
 * 🔴 **권한과 무관한 표시 값이다.** 손으로 고쳐도 사이드바 폭만 달라진다 —
 * `httpOnly` 로 두지 않는 이유는 **브라우저가 직접 써야** 하기 때문이다(토글은 클라이언트에서
 * 일어난다). 서버 왕복 없이 즉시 접히는 편이 훨씬 자연스럽다.
 *
 * 이 파일은 순수 함수만 둔다 — 서버(Layout)와 클라이언트(Sidebar)가 같은 이름을 본다.
 */

export const SIDEBAR_COLLAPSED_COOKIE = "sidebar-collapsed";

/** 1년. 다음에 와도 접어 둔 대로 열린다. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** 쿠키 값을 상태로 읽는다. 값이 없거나 이상하면 **펼침**이 기본이다. */
export function parseSidebarCollapsed(value: string | undefined): boolean {
  return value === "1";
}

/**
 * 브라우저에서 쿠키를 쓴다.
 *
 * `sameSite=lax` 로 두어 다른 사이트에서 들어온 요청에는 실리지 않게 한다.
 * 비밀이 아니라 표시 값이므로 `secure` 는 프로토콜에 맡긴다.
 */
export function writeSidebarCollapsedCookie(collapsed: boolean): void {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax${secure}`;
}
