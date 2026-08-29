import { LOCALE_COOKIE, parseLocale, type Locale } from "@/config/i18n";

/**
 * 브라우저에서 언어 쿠키를 직접 읽는다 — **`global-error.tsx` 전용 최후의 수단**이다.
 *
 * 🔴 **다른 화면은 이것을 쓰지 않는다.** 언어는 서버가 읽어 `<html lang>` 을 그리고
 * Context 로 내려 준다(`lib/ui/locale-context.tsx`). 이 함수가 있는 이유는 하나뿐이다 —
 * `global-error.tsx` 는 **Root Layout 을 대신하므로** Layout 도 Provider 도 없다.
 *
 * ## 🔴 되도록 실패하지 않게 만든다
 *
 * 오류 경계가 스스로 또 오류를 내면 사용자에게 남는 것은 빈 화면뿐이다. 그래서:
 *
 * - 절대 던지지 않는다. `document` 가 없어도(SSR·prerender) 기본 언어를 돌려준다
 * - 쿠키가 없거나 깨졌거나 `ko`·`en` 이 아니어도 `parseLocale` 이 기본 언어로 떨어뜨린다
 * - `decodeURIComponent` 는 잘못된 % 서열에 던지므로 감싸 둔다
 *
 * 🔴 **렌더 중에 부르지 않는다.** 서버에는 `document` 가 없어 늘 기본 언어가 나오므로,
 * 렌더에서 부르면 서버가 그린 것과 첫 클라이언트 렌더가 갈라진다(hydration mismatch).
 * 부르는 쪽은 첫 렌더를 기본 언어로 그린 뒤 `useEffect` 에서 이 값으로 고친다.
 */
export function readBrowserLocale(): Locale {
  if (typeof document === "undefined") {
    return parseLocale(undefined);
  }

  try {
    const raw = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${LOCALE_COOKIE}=`));

    if (raw === undefined) {
      return parseLocale(undefined);
    }

    return parseLocale(decodeURIComponent(raw.slice(LOCALE_COOKIE.length + 1)));
  } catch {
    // 🔴 무엇이 잘못됐든 오류 화면이 다시 죽지 않는다.
    return parseLocale(undefined);
  }
}
