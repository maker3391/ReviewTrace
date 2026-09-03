import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

/**
 * 화면 맨 위 — **이 화면이 무엇인가**를 밝히는 자리.
 *
 * ```
 * Projects / SMIL <- 어디에 있는지 (Breadcrumb)
 * Refresh token race condition <- 무엇인지 (Identity)
 * HIGH · CONCURRENCY · 3일째 <- 그것에 딸린 사실 (Meta)
 * [Action]
 * ```
 *
 * 🔴 **Breadcrumb 을 과하게 쓰지 않는다.** 한 층 위가 실제로 갈 곳일 때만 둔다 —
 * 「Home / Workspace / Project / …」처럼 전부 늘어놓지 않는다.
 *
 * 🔴 **제목 앞에 Icon 을 붙이지 않는다.** 제목은 글자 크기와 굵기로 이미 제일 앞에 있다.
 */
export function PageHeader({
  breadcrumb,
  title,
  titleAdornment,
  description,
  meta,
  actions,
}: {
  /** 한 층 위. 실제로 갈 곳일 때만. */
  breadcrumb?: { label: string; href: Route };
  title: string;
  /** 제목 옆에 붙는 상태 표시(Severity·Status Badge 등). */
  titleAdornment?: ReactNode;
  description?: string;
  /** 제목 아래 한 줄로 흐르는 사실들. Badge 로 만들지 않는다. */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  // 🔴 좁은 폭에서 Action 이 제목 위로 겹치지 않게 «줄바꿈»한다 — 자르지 않는다.
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1">
        {breadcrumb !== undefined && (
          <Link
            href={breadcrumb.href}
            className="mb-1 inline-flex text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            ← {breadcrumb.label}
          </Link>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 break-words text-lg font-semibold leading-tight tracking-[-0.01em] text-foreground sm:text-xl">
            {title}
          </h1>
          {titleAdornment}
        </div>

        {description !== undefined && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
        {/*
 🔴 **`flex-wrap` 만으로는 «한 낱말»을 감당하지 못한다.**

 여기 오는 값은 사람이 쓴 문장이 아니라 식별자다 — `REFRESH_TOKEN_RACE_CONDITION_
 WITH_A_VERY_LONG_PATTERN_KEY_NAME` 같은 Pattern Key 는 빈칸이 없어 «줄바꿈할
 자리»가 없다. 390px 에서 그 조각 하나가 446px 을 차지해 머리글이 화면 밖으로
 나갔고, 그러면 **페이지 전체가 좌우로 넘친다**(실측: main 462 / 311).

 `wrap-anywhere`(overflow-wrap: anywhere) 는 `break-words` 와 달리 **min-content
 계산까지 바꾼다** — 그래야 flex 항목이 실제로 줄어든다. 그리고 「자리가 없을 때만」
 끊으므로 넉넉한 폭에서는 지금과 똑같이 그려진다.
 */}
        {meta !== undefined && (
          <p className="mt-1.5 text-xs leading-5 wrap-anywhere text-muted-foreground">
            {meta}
          </p>
        )}
      </div>

      {actions !== undefined && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

/**
 * 머리글 안의 사실들을 나누는 가운뎃점. 문자열을 손으로 이어 붙이지 않는다.
 *
 * ## 🔴 앞 조각에 «붙어» 있고 뒤에서만 끊긴다
 *
 * 예전에는 이 점이 `flex` 컨테이너의 **독립 항목**이었다. flex 는 항목 사이 어디서나
 * 접히므로 390px 에서 이런 것이 나왔다 —
 *
 * ```
 * GitHub · develop ·        <- 점이 줄 끝에 남거나
 * GitHub                    <- 다음 줄 첫머리에 홀로 선다
 * ```
 *
 * 그래서 머리글의 meta 줄을 **inline 흐름**으로 되돌리고, 이 점 앞에 **줄바꿈하지 않는
 * 공백**(NBSP)을 둔다. 앞 낱말과 점 사이에는 끊길 자리가 아예 없고, 끊길 수 있는 것은
 * 점 «뒤»의 보통 공백 하나뿐이다 — 그래서 점은 **혼자 남지도, 줄 첫머리에 서지도**
 * 못한다.
 *
 * 🔴 **`whitespace-nowrap` 으로 묶지 않는다.** 그러면 Pattern Key 처럼 빈칸 없는 긴
 * 식별자가 줄어들지 못해 머리글이 화면 밖으로 나간다 — 위 `wrap-anywhere` 주석이 적어
 * 둔 실측이 그 자리다.
 *
 * 🔴 **`aria-hidden` 이다.** 읽어 주는 기계에는 이 점이 들리지 않아야 한다.
 */
export function MetaDot() {
  return (
    <>
      {"\u00A0"}
      <span aria-hidden className="mx-0.5 text-border">
        ·
      </span>{" "}
    </>
  );
}
