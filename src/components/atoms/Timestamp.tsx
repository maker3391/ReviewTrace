"use client";

import { useSyncExternalStore } from "react";

import type { Locale } from "@/config/i18n";
import {
  formatCompactDateTime,
  formatExactDateTime,
  formatRelativeTime,
} from "@/lib/format/date";

/**
 * 시각을 **보는 사람의 시간대**로 그린다.
 *
 * ## 왜 Client Component 인가
 *
 * 🔴 **서버는 보는 사람이 어디 있는지 알 수 없다.** 서버의 시간대를 사용자 시간대라고
 * 가정하면 배포 지역이 바뀌는 순간 모든 화면의 시각이 틀어진다. 브라우저만이
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` 으로 자기 시간대를 안다.
 *
 * 🔴 **그렇다고 화면을 통째로 Client 로 내리지 않는다.** 시간대를 아는 자리는 이
 * **잎 하나**뿐이고, 이것을 쓰는 목록·상세는 전부 Server Component 그대로다.
 * 시각 하나 때문에 표 전체가 브라우저로 넘어가면 SSR 이 하던 일이 사라진다.
 *
 * ## Hydration 을 어긋내지 않는 방법
 *
 * 🔴 **서버 스냅샷과 브라우저 스냅샷을 «따로» 준다.** 서버는 `undefined`(=UTC), 브라우저는
 * 자기 시간대다. `useSyncExternalStore` 는 바로 이 모양을 위해 있는 API 라, hydration 에서
 * 두 값이 다르면 React 가 조용히 브라우저 값으로 다시 그린다 — 경고도, 어긋남도 없다.
 *
 * 🔴 **`useEffect` + `setState` 로 하지 않는다.** 그 방식은 mount 뒤 한 번 더 렌더를
 * 부르는 cascading render 라 lint(`react-hooks/set-state-in-effect`)가 막는다.
 * 🔴 `suppressHydrationWarning` 으로 덮지도 않는다 — 그것은 경고만 지울 뿐 React 가
 * 서버 HTML 을 그대로 두게 만들어 **영원히 UTC 가 남는다.**
 *
 * ## 화면에 시간대 이름을 쓰지 않는다
 *
 * 사람은 자기 시계와 같은 값을 볼 뿐이라 `KST`·`UTC+09:00` 은 알려 주는 것이 없다.
 * 기계가 읽어야 하는 정확한 instant 는 `dateTime` 속성이 ISO 로 갖고 있고,
 * DB·API 는 UTC instant 그대로다 — 바뀌는 것은 표현뿐이다.
 */

/** 시간대는 세션 중에 바뀌지 않는다 — 구독할 것이 없다. */
const subscribeToNothing = () => () => {};

/**
 * 🔴 **`getSnapshot` 은 같은 값을 돌려줘야 한다.** 매번 새로 계산하면 React 가 store 가
 * 계속 바뀐다고 보고 무한히 다시 그린다. 한 번 읽어 모듈에 담아 둔다.
 */
let cachedTimeZone: string | undefined;
let resolved = false;

function readViewerTimeZone(): string | undefined {
  if (resolved) return cachedTimeZone;
  resolved = true;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // 🔴 빈 문자열을 주는 환경이 있다. 그때는 UTC 로 둔다 — 틀린 지역보다 낫다.
    cachedTimeZone = typeof zone === "string" && zone !== "" ? zone : undefined;
  } catch {
    // Intl 이 없는 환경에서도 UTC 로 계속 그린다.
    cachedTimeZone = undefined;
  }
  return cachedTimeZone;
}

/** 서버는 보는 사람이 어디 있는지 모른다. 결정적인 값(UTC)으로 그린다. */
const readServerTimeZone = (): string | undefined => undefined;

function useViewerTimeZone(): string | undefined {
  return useSyncExternalStore(
    subscribeToNothing,
    readViewerTimeZone,
    readServerTimeZone,
  );
}

export function Timestamp({
  value,
  variant,
  now,
  locale = "ko",
  className,
}: {
  value: Date | null;
  variant: "exact" | "compact" | "relative";
  now?: Date;
  locale?: Locale;
  className?: string;
}) {
  const timeZone = useViewerTimeZone();

  if (value === null || Number.isNaN(value.getTime())) {
    return <span className={className}>—</span>;
  }

  const exact = formatExactDateTime(value, timeZone);
  const display =
    variant === "exact"
      ? exact
      : variant === "compact"
        ? formatCompactDateTime(value, timeZone)
        : formatRelativeTime(value, now ?? value, locale, timeZone);

  return (
    <time
      dateTime={value.toISOString()}
      title={exact}
      aria-label={exact}
      className={className}
    >
      {display}
    </time>
  );
}
