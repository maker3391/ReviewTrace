import "server-only";

import { cookies } from "next/headers";

import {
  LOCALE_COOKIE,
  messages,
  parseLocale,
  type Locale,
  type Messages,
} from "@/config/i18n";
import { parseTheme, THEME_COOKIE, type Theme } from "@/lib/ui/theme";

/**
 * 서버가 「이 사람이 무엇을 골랐는가」를 읽는 자리.
 *
 * 🔴 **읽는 자리를 한 곳에 모은다.** 화면마다 `cookies()` 를 직접 열고 이름을 손으로
 * 적으면, 쿠키 이름이나 기본값이 바뀔 때 한 화면만 옛 값으로 남는다(CLAUDE.md 11).
 *
 * 🔴 **`server-only` 를 붙인다.** 이 모듈이 Client Bundle 로 넘어가면 `next/headers` 가
 * 빌드를 깨뜨린다 — 경계를 주석이 아니라 빌드가 지키게 한다(CLAUDE.md 19).
 *
 * `cookies()` 는 요청 하나 안에서 이미 읽어 둔 값이라 화면마다 불러도 왕복이 늘지 않는다.
 * 그래서 Layout 이 아래로 흘려 보내는 대신 **필요한 Server Component 가 스스로 읽는다** —
 * Layout 은 하위 화면에 prop 을 내려 줄 수 없다.
 */

export async function readLocale(): Promise<Locale> {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value);
}

/** 대부분의 화면이 실제로 쓰는 것 — 언어가 아니라 그 언어의 문구다. */
export async function readMessages(): Promise<Messages> {
  return messages(await readLocale());
}

export async function readTheme(): Promise<Theme> {
  const store = await cookies();
  return parseTheme(store.get(THEME_COOKIE)?.value);
}
