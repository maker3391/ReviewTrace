"use client";

import { createContext, use, type ReactNode } from "react";

import { DEFAULT_LOCALE, type Locale } from "@/config/i18n";

/**
 * 서버가 이미 아는 언어를 **브라우저 쪽 코드까지** 전하는 자리.
 *
 * ## 🔴 왜 필요한가 — prop 을 줄 수 없는 자리가 있다
 *
 * 조회 화면은 서버가 그리므로 문구도 서버가 정하고, Client Component 는 `labels` prop 으로
 * 받는다(`AppearanceControls` 참고). 그 길이 막힌 자리가 둘이다:
 *
 * ```text
 * app/error.tsx Next.js 가 error·retry 두 개만 넘긴다. prop 을 끼워 넣을 수 없다
 * 폼의 Zod 검증 브라우저에서 도는 검증이라 문구도 브라우저에서 정해진다
 * ```
 *
 * 🔴 **그렇다고 사전을 통째로 내려보내지 않는다.** 여기 실려 가는 것은 `"ko"` · `"en"`
 * **두 글자뿐**이고, 문구는 각자 `messages(locale)` 에서 꺼낸다.
 *
 * 🔴 **전역 변수가 아니다.** 값은 Root Layout 이 요청마다 읽은 쿠키에서 오고 React Tree 를
 * 따라 내려간다 — 서버에 「지금 언어」라는 상태를 만들지 않는다.
 *
 * 🔴 **hydration 이 어긋나지 않는다.** 서버가 `<html lang>` 을 그릴 때 쓴 값을 그대로
 * 넘기므로 서버가 그린 것과 첫 클라이언트 렌더가 같다.
 *
 * 🔴 **`global-error.tsx` 는 이것을 쓸 수 없다.** 그 자리는 Root Layout 자체를 대신하므로
 * Provider 가 아예 없다 — 거기서는 쿠키를 직접 읽는다(`lib/ui/browser-locale.ts`).
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

/**
 * 지금 화면의 언어.
 *
 * Provider 밖에서 불러도 던지지 않는다 — 오류 화면에서 쓰는 값이라
 * **없을 때 기본 언어로 그려지는 편**이 다시 죽는 것보다 낫다.
 */
export function useLocale(): Locale {
  return use(LocaleContext);
}
