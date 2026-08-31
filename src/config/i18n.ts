import { en } from "@/config/messages/en";
import { ko, type Messages } from "@/config/messages/ko";

/**
 * 화면 언어.
 *
 * 🔴 **i18n 라이브러리를 들이지 않는다**. `next-intl` · `react-i18next` 가
 * 푸는 문제는 **언어가 여럿이고 문구가 수천 개일 때의 지연 로딩 · 복수형 · 형식화**다.
 * 여기는 언어 둘에 화면 수십 개이고 복수형 규칙을 쓰는 자리가 없다 —
 * **타입이 잡히는 사전 객체 하나**로 충분하고, 그편이 키 누락을 컴파일 시점에 잡는다.
 *
 * 🔴 **왜 쿠키인가 — 서버가 그릴 때 이미 알아야 하기 때문이다.** 조회 화면이 전부
 * Server Component 라 문구도 서버에서 정해진다. 쿠키는 요청과 함께 오므로
 * 첫 응답부터 맞는 언어로 나간다. 사이드바 접힘 상태(`lib/ui/sidebar-state.ts`)·
 * 테마(`lib/ui/theme.ts`)와 같은 방식이다.
 *
 * 🔴 **권한과 무관한 표시 값이다.** 손으로 고쳐도 문구만 달라진다 — `httpOnly` 로 두지
 * 않는 이유는 **브라우저가 직접 써야** 하기 때문이다(전환은 클라이언트에서 일어난다).
 *
 * 이 파일은 순수 함수만 둔다 — 서버(Layout·화면)와 클라이언트(LocaleToggle)가 같은
 * 이름을 본다. 쿠키를 «읽는» 쪽은 `lib/ui/appearance.ts` 한 곳이다.
 */

export const LOCALES = ["ko", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/** 고른 적이 없으면 한국어다. */
export const DEFAULT_LOCALE: Locale = "ko";

export const LOCALE_COOKIE = "locale";

/** 1년. 다음에 와도 고른 언어로 열린다. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function isLocale(value: string | undefined): value is Locale {
 return value !== undefined && (LOCALES as readonly string[]).includes(value);
}

/** 쿠키 값을 언어로 읽는다. 값이 없거나 이상하면 기본 언어다. */
export function parseLocale(value: string | undefined): Locale {
 return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * 그 언어의 사전.
 *
 * 🔴 **동적 import 로 나누지 않는다.** 사전 둘을 합쳐도 몇 KB 이고, 서버가 그리는 문구라
 * 브라우저 번들에 통째로 실리지도 않는다 — 나누면 얻는 것 없이 비동기 경계만 는다.
 */
export function messages(locale: Locale): Messages {
 return locale === "en" ? en : ko;
}

/**
 * 브라우저에서 쿠키를 쓴다.
 *
 * `sameSite=lax` 로 두어 다른 사이트에서 들어온 요청에는 실리지 않게 한다.
 * 비밀이 아니라 표시 값이므로 `secure` 는 프로토콜에 맡긴다.
 *
 * 🔴 **테마와 달리 이것만으로 화면이 바뀌지 않는다.** 문구는 서버가 그린 것이라
 * 쓰고 나서 `router.refresh()` 로 **서버에 다시 그리게** 해야 한다 —
 * 브라우저에서 문구를 갈아 끼우지 않는다.
 */
export function writeLocaleCookie(locale: Locale): void {
 const secure = window.location.protocol === "https:" ? "; secure" : "";
 document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax${secure}`;
}

export type { Messages };
