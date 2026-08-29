import { messages, type Locale } from "@/config/i18n";

/**
 * 화면에 날짜를 쓰는 자리를 한 곳에 모은다.
 *
 * 🔴 **서버와 브라우저의 Locale·Timezone 차이로 문자열이 갈리지 않게 형식을 직접 고정한다.**
 * `toLocaleDateString()` 은 두 곳에서 다른 값을 내 Hydration 이 어긋난다.
 *
 * 🔴 **날짜 «형식»은 언어를 타지 않는다.** `2026-08-28` 은 두 언어에서 같은 뜻으로 읽히고,
 * 표에서 자릿수가 맞아 세로로 비교된다. `Aug 28, 2026` 으로 바꾸면 폭이 들쭉날쭉해지고
 * `Intl` 이 서버·브라우저에서 같은 값을 낸다는 보장도 없다. 언어를 타는 것은 **낱말이
 * 들어가는 표기**(「오늘」·「3일」)뿐이다.
 *
 * 이 파일은 순수 함수만 둔다 — Server Component 와 Client Component 가 함께 쓴다.
 */

/** `2026-08-28`. 목록의 시각 칸에 쓴다. */
export function formatDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 「며칠째인가」.
 *
 * Issue 목록에서 **오래 열려 있는 것**을 한눈에 고르기 위한 값이다 — 날짜만 있으면
 * 사람이 매번 빼야 한다.
 *
 * @param now 기준 시각. 부르는 쪽이 넘긴다 — 함수 안에서 `new Date()` 를 부르면
 *   서버가 그린 값과 브라우저가 그린 값이 갈린다.
 * @param locale 낱말이 들어가는 표기라 언어를 탄다. 부르는 쪽이 이미 알고 있는 값이다.
 */
export function formatAgeInDays(
  value: Date,
  now: Date,
  locale: Locale,
): string {
  const days = Math.max(
    0,
    Math.floor((now.getTime() - value.getTime()) / 86_400_000),
  );

  const t = messages(locale).date;
  return days === 0 ? t.today : t.days(days);
}
