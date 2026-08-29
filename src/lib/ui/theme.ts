/**
 * 화면 테마(Light · Dark · System).
 *
 * 🔴 **왜 쿠키인가 — 첫 페인트에 깜빡이지 않기 위해서다.**
 *
 * `localStorage` 에 두면 서버는 그 값을 모른 채 **밝은 화면**을 그려 보내고, 브라우저가
 * JS 를 실행한 뒤에야 어둡게 바꾼다. 새로고침할 때마다 흰 화면이 한 번 번쩍인다.
 * 쿠키는 요청과 함께 오므로 서버가 처음부터 맞는 `<html class>` 로 그린다 —
 * 사이드바 접힘 상태(`sidebar-state.ts`)와 같은 방식이다.
 *
 * 🔴 **권한과 무관한 표시 값이다.** 손으로 고쳐도 색만 달라진다 — `httpOnly` 로 두지
 * 않는 이유는 **브라우저가 직접 써야** 하기 때문이다(전환은 클라이언트에서 일어난다).
 * 서버 왕복 없이 즉시 바뀌는 편이 훨씬 자연스럽다.
 *
 * 이 파일은 순수 함수만 둔다 — 서버(Layout)와 클라이언트(ThemeToggle)가 같은 이름을 본다.
 */

export const THEME_COOKIE = "theme";

/**
 * 세 단계다.
 *
 * 🔴 **`system` 을 빼지 않는다.** 둘로 줄이면 OS 를 어둡게 써 온 사람이 이 제품에서만
 * 밝은 화면을 받고, 그때부터 「내가 고른 적 없는 값」을 매번 다시 고르게 된다.
 */
export const THEMES = ["light", "dark", "system"] as const;

export type Theme = (typeof THEMES)[number];

/** 고른 적이 없으면 OS 를 따른다. */
export const DEFAULT_THEME: Theme = "system";

/** 1년. 다음에 와도 고른 대로 열린다. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** `<html>` 이 어두울 때 붙는 class. `globals.css` 의 `.dark` 토큰이 이것을 본다. */
export const DARK_CLASS = "dark";

export function isTheme(value: string | undefined): value is Theme {
  return value !== undefined && (THEMES as readonly string[]).includes(value);
}

/** 쿠키 값을 상태로 읽는다. 값이 없거나 이상하면 **system** 이 기본이다. */
export function parseTheme(value: string | undefined): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}

/**
 * 서버가 `<html>` 에 바로 붙이는 class.
 *
 * 🔴 **`system` 은 서버가 답할 수 없다.** OS 설정은 요청에 실려 오지 않는다 — 그래서
 * class 를 비워 두고 아래 `SYSTEM_THEME_SCRIPT` 가 첫 페인트 «전에» 채운다.
 */
export function themeClassName(theme: Theme): string {
  return theme === DARK_CLASS ? DARK_CLASS : "";
}

/**
 * 브라우저에서 쿠키를 쓴다.
 *
 * `sameSite=lax` 로 두어 다른 사이트에서 들어온 요청에는 실리지 않게 한다.
 * 비밀이 아니라 표시 값이므로 `secure` 는 프로토콜에 맡긴다.
 */
export function writeThemeCookie(theme: Theme): void {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax${secure}`;
}

/**
 * 브라우저에서 지금 그려진 화면에 즉시 반영한다.
 *
 * 🔴 **서버 왕복을 기다리지 않는다.** 테마는 서버가 조회하는 데이터에 아무 영향이 없으므로
 * `router.refresh()` 를 부를 이유가 없다 — class 하나만 바꾸면 끝이고, 쿠키는 **다음
 * 요청부터** 서버가 같은 값을 그리게 하는 용도다.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle(DARK_CLASS, resolveTheme(theme));
}

/** 이 테마가 지금 «어두운가». `system` 이면 OS 에 묻는다. */
export function resolveTheme(theme: Theme): boolean {
  if (theme !== "system") {
    return theme === DARK_CLASS;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * `system` 을 고른 사람에게만 나가는 한 줄짜리 스크립트.
 *
 * 🔴 **`<body>` 의 맨 앞에서 동기로 돈다** — 뒤따르는 내용이 파싱되기 전에 끝나므로
 * 밝은 화면이 한 번 그려졌다가 어두워지는 일이 없다. `useEffect` 로는 늦다.
 *
 * 🔴 **테마를 «고른» 사람에게는 나가지 않는다.** 그 경우 서버가 이미 맞는 class 를
 * 붙여 보냈고, 스크립트는 할 일이 없다.
 */
export const SYSTEM_THEME_SCRIPT = `try{if(matchMedia("(prefers-color-scheme: dark)").matches)document.documentElement.classList.add("${DARK_CLASS}")}catch(e){}`;
