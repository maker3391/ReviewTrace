import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

/**
 * 화면 맨 위 — **이 화면이 무엇인가**를 밝히는 자리.
 *
 * ```
 * Projects / SMIL              <- 어디에 있는지 (Breadcrumb)
 * Refresh token race condition <- 무엇인지 (Identity)
 * HIGH · CONCURRENCY · 3일째    <- 그것에 딸린 사실 (Meta)
 *                              [Action]
 * ```
 *
 * 🔴 **Breadcrumb 을 과하게 쓰지 않는다.** 한 층 위가 실제로 갈 곳일 때만 둔다 —
 * 「Home / Workspace / Project / …」처럼 전부 늘어놓지 않는다(CLAUDE.md 16).
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
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
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
          <h1 className="text-xl font-semibold leading-tight tracking-[-0.01em] text-foreground">
            {title}
          </h1>
          {titleAdornment}
        </div>

        {description !== undefined && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
        {meta !== undefined && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
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

/** 머리글 안의 사실들을 나누는 가운뎃점. 문자열을 손으로 이어 붙이지 않는다. */
export function MetaDot() {
  return <span aria-hidden className="text-border">·</span>;
}
