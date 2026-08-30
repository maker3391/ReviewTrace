import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { PageSizeSelect } from "@/components/molecules/PageSizeSelect";
import { PAGE_SIZE_OPTIONS, pageWindow, totalPageCount } from "@/lib/pagination";
import { cn } from "@/lib/utils";

/**
 * 표 아래를 마감하는 줄.
 *
 * ```
 * 128건                         [25 ▾]   ‹  1 … 3 4 5 … 12  ›
 * ```
 *
 * 🔴 **「전체 128건 중 76–100」 같은 문장을 쓰지 않는다.** 읽어야 이해되는 문장은 표
 * 아래에서 하는 일이 아니다 — 총 건수는 숫자 하나로 족하고, 지금 어디인지는 **칠해진
 * 쪽 번호**가 말한다.
 *
 * 🔴 **한 쪽뿐이면 이동 도구를 그리지 않는다.** 누를 수 없는 화살표와 「1」 하나짜리
 * 쪽 번호는 정보가 아니라 장식이다(CLAUDE.md 16).
 *
 * 🔴 **Server Component 다.** 이동은 `Link` 라 JavaScript 없이도 동작하고, 가운데 클릭으로
 * 새 탭에 열린다. Client 로 내려가는 것은 쪽 크기 고르기 하나뿐이다(CLAUDE.md 7).
 */
export interface TablePaginationLabels {
  /** 총 건수. 🔴 「중 x–y」를 붙이지 않는다. */
  total: (total: number) => string;
  previous: string;
  next: string;
  /** 쪽 크기 Select 의 이름표. 화면에는 숫자만 보이므로 `aria-label` 로만 쓴다. */
  pageSize: string;
  /** 쪽 번호 링크의 이름표(`3페이지`). 숫자만으로는 읽는 도구가 무엇인지 알 수 없다. */
  page: (page: number) => string;
  /** 이동 줄 자체의 이름표. */
  navigation: string;
}

export function TablePagination({
  total,
  page,
  pageSize,
  pageHref,
  pageSizeHref,
  labels,
  className,
}: {
  total: number;
  /** 🔴 **실제로 그린 쪽**이다(`lib/pagination.ts` 의 `paginate`). 요청 값이 아니다. */
  page: number;
  pageSize: number;
  pageHref: (page: number) => Route;
  pageSizeHref: (pageSize: number) => Route;
  labels: TablePaginationLabels;
  className?: string;
}) {
  const totalPages = totalPageCount(total, pageSize);
  const hasPages = totalPages > 1;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/70 px-4 py-2.5",
        className,
      )}
    >
      <p className="text-xs text-muted-foreground tabular-nums">
        {labels.total(total)}
      </p>

      {hasPages && (
        <div className="flex items-center gap-2">
          <PageSizeSelect
            label={labels.pageSize}
            value={pageSize}
            options={PAGE_SIZE_OPTIONS.map((value) => ({
              value,
              /*
                🔴 **쪽 크기를 바꾸면 첫 쪽으로 간다.** 25개씩 볼 때의 7쪽은 100개씩 볼 때
                존재하지 않는다 — 그대로 두면 있던 자리도 아니고 빈 화면도 아닌 곳에 떨어진다.
              */
              href: pageSizeHref(value),
            }))}
          />

          <nav
            aria-label={labels.navigation}
            className="flex items-center gap-0.5"
          >
            <Step
              href={pageHref(page - 1)}
              label={labels.previous}
              disabled={page <= 1}
              icon={<ChevronLeft className="size-4" />}
            />

            {pageWindow(page, totalPages).map((candidate, index) =>
              candidate === null ? (
                // 생략표는 누를 것이 아니라 「사이가 비었다」는 표시다.
                <span
                  key={`gap-${index}`}
                  aria-hidden
                  className="px-1 text-xs text-muted-foreground"
                >
                  …
                </span>
              ) : (
                <PageLink
                  key={candidate}
                  href={pageHref(candidate)}
                  label={labels.page(candidate)}
                  page={candidate}
                  current={candidate === page}
                />
              ),
            )}

            <Step
              href={pageHref(page + 1)}
              label={labels.next}
              disabled={page >= totalPages}
              icon={<ChevronRight className="size-4" />}
            />
          </nav>
        </div>
      )}
    </div>
  );
}

/**
 * 이전·다음.
 *
 * 🔴 **끝에 닿으면 링크가 아니라 «글자»가 된다.** `<a>` 는 disabled 될 수 없어서, 링크로
 * 두고 회색으로만 칠하면 Tab 으로 닿고 눌러서 같은 쪽으로 되돌아온다.
 */
function Step({
  href,
  label,
  disabled,
  icon,
}: {
  href: Route;
  label: string;
  disabled: boolean;
  icon: ReactNode;
}) {
  const shape =
    "inline-flex size-8 items-center justify-center rounded-md transition-colors";

  if (disabled) {
    return (
      <span aria-hidden className={cn(shape, "text-muted-foreground/40")}>
        {icon}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      scroll={false}
      className={cn(
        shape,
        "text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
      )}
    >
      {icon}
    </Link>
  );
}

/**
 * 쪽 번호 하나.
 *
 * 지금 쪽은 **칠해서** 나타낸다 — 그것 하나로 「전체 몇 건 중 어디」를 문장으로 적을
 * 이유가 없어진다. 🔴 색은 새로 만들지 않고 이미 있는 선택 상태(`accent`)를 쓴다.
 */
function PageLink({
  href,
  label,
  page,
  current,
}: {
  href: Route;
  label: string;
  page: number;
  current: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      scroll={false}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs tabular-nums transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        current
          ? "bg-accent font-semibold text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {page}
    </Link>
  );
}
