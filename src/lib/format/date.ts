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

/**
 * 저장은 UTC instant, 표시는 **보는 사람의 시간대**.
 *
 * 🔴 **`06:47:38 UTC` 를 사람에게 그대로 보여 주지 않는다.** 한국에서 보는 사람에게
 * 그 값은 아홉 시간 전이라, 「방금 만든 Review」가 새벽에 만들어진 것처럼 읽힌다.
 * DB 와 API 는 UTC instant 그대로다 — 바뀌는 것은 **표현 계층 하나**다.
 *
 * 🔴 **`reviewLanguage` 와 잇지 않는다.** 그것은 Agent 가 narrative 를 쓰는 언어이고,
 * 시간대는 **화면을 보는 사람이 있는 곳**이다. `ko -> Asia/Seoul` 같은 표를 만들면
 * 서울에서 영어로 보는 사람과 베를린에서 한국어로 보는 사람이 둘 다 틀린다.
 *
 * 🔴 **화면에 시간대 이름을 붙이지 않는다.** 사람은 자기 시계와 같은 값을 볼 뿐이라
 * `KST`·`UTC+09:00` 은 알려 주는 것이 없다. 정확한 instant 가 필요한 자리는
 * `<time dateTime=...>` 이 기계가 읽을 수 있는 형태로 갖고 있다.
 *
 * @param timeZone IANA 이름. 넘기지 않으면 **UTC** 다 — 서버는 보는 사람이 어디 있는지
 *   알 수 없으므로, 브라우저가 알려 줄 때까지 결정적인 값을 쓴다(`Timestamp`).
 */
type DateFields = {
  year: string;
  month: string;
  day: string;
  hours: string;
  minutes: string;
  seconds: string;
};

/**
 * 🔴 **`toLocaleString()` 을 쓰지 않는다.** 그 출력은 실행 환경의 locale data 를 타서
 * 서버와 브라우저가 다른 문자열을 낼 수 있다. `formatToParts` 로 **조각만** 받아
 * 우리가 직접 조립하면, 시간대만 반영되고 형식은 언제나 같다.
 */
function fieldsIn(value: Date, timeZone: string | undefined): DateFields {
  if (timeZone === undefined || timeZone === "UTC") {
    return {
      year: String(value.getUTCFullYear()).padStart(4, "0"),
      month: String(value.getUTCMonth() + 1).padStart(2, "0"),
      day: String(value.getUTCDate()).padStart(2, "0"),
      hours: String(value.getUTCHours()).padStart(2, "0"),
      minutes: String(value.getUTCMinutes()).padStart(2, "0"),
      seconds: String(value.getUTCSeconds()).padStart(2, "0"),
    };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(value);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: pick("year").padStart(4, "0"),
    month: pick("month"),
    day: pick("day"),
    // 🔴 `h23` 라도 자정을 `24` 로 내는 구현이 있어 한 번 더 접는다.
    hours: (pick("hour") === "24" ? "00" : pick("hour")).padStart(2, "0"),
    minutes: pick("minute"),
    seconds: pick("second"),
  };
}

/** `2026-08-28`. 목록의 시각 칸에 쓴다. */
export function formatDate(value: Date, timeZone?: string): string {
  if (!isValidDate(value)) return "—";
  const { year, month, day } = fieldsIn(value, timeZone);
  return `${year}-${month}-${day}`;
}

/** Detail policy: 초 단위까지. 시간대 이름은 붙이지 않는다. */
export function formatExactDateTime(value: Date, timeZone?: string): string {
  if (!isValidDate(value)) return "—";
  const { year, month, day, hours, minutes, seconds } = fieldsIn(
    value,
    timeZone,
  );
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/** Dense list policy: 월/일과 분 단위. */
export function formatCompactDateTime(value: Date, timeZone?: string): string {
  if (!isValidDate(value)) return "—";
  const { month, day, hours, minutes } = fieldsIn(value, timeZone);
  return `${month}-${day} ${hours}:${minutes}`;
}

/** Dashboard policy. Exact UTC remains available through the Timestamp title/aria-label. */
export function formatRelativeTime(
  value: Date,
  now: Date,
  locale: Locale,
  timeZone?: string,
): string {
  if (!isValidDate(value) || !isValidDate(now)) return "—";
  const elapsedMs = Math.max(0, now.getTime() - value.getTime());
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  const t = messages(locale).date;
  if (elapsedMinutes < 1) return t.justNow;
  if (elapsedMinutes < 60) return t.minutesAgo(elapsedMinutes);

  /**
   * 🔴 **「어제」는 보는 사람의 달력에서 어제여야 한다.** 경과 분이 아니라 **날짜가
   * 몇 번 넘어갔는가**로 세므로, 기준 시간대가 바뀌면 답도 바뀐다 — 서울에서 오늘
   * 오전 8시인 것이 UTC 로는 어제 밤 11시다.
   */
  const dayNumber = (at: Date) => {
    const { year, month, day } = fieldsIn(at, timeZone);
    return Date.UTC(Number(year), Number(month) - 1, Number(day));
  };
  const calendarDays = Math.max(
    0,
    Math.floor((dayNumber(now) - dayNumber(value)) / 86_400_000),
  );
  if (calendarDays === 1) {
    const { hours, minutes } = fieldsIn(value, timeZone);
    return t.yesterdayAt(`${hours}:${minutes}`);
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return t.hoursAgo(elapsedHours);
  return t.days(calendarDays);
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
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
  if (!isValidDate(value) || !isValidDate(now)) return "—";
  const days = Math.max(
    0,
    Math.floor((now.getTime() - value.getTime()) / 86_400_000),
  );

  const t = messages(locale).date;
  return days === 0 ? t.today : t.days(days);
}
