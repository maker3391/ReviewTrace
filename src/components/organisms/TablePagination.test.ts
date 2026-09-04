import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * 🔴 **`PageSizeSelect` 가 `useRouter` 를 부른다.** 그 Hook 은 App Router 가 붙어 있어야
 * 돌아서, 정적 렌더만으로는 「쪽이 여럿일 때」 가지가 통째로 터진다 — 그러면 «안 그린다»만
 * 확인하고 «그린다»는 확인하지 못해 시험이 반쪽이 된다. 화면 전환은 이 시험의 관심사가
 * 아니므로 자리만 채운다.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import { TablePagination } from "@/components/organisms/TablePagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import type { Route } from "next";

/**
 * 🔴 **쪽이 하나뿐이면 넘길 것이 «없다» — 그래서 그리지 않는다.**
 *
 * 「23건이 한 화면에 다 나오는데 pagination 이 안 보인다」는 보고가 있었다. 기본 쪽 크기가
 * 25 이므로 23건은 한 쪽이 맞고, 한 쪽이면 이 컴포넌트가 **이동 화살표·쪽 번호·쪽 크기
 * Select 를 통째로 그리지 않는다.** 「고장난 화면」과 구분되어야 해서 **총 건수는 남긴다.**
 *
 * ## 되돌림 확인
 *
 * `TablePagination.tsx` 의 `hasPages = totalPages > 1` 을 `true` 로 되돌리면
 * 「한 쪽이면 넘기는 자리를 그리지 않는다」가 실패한다.
 *
 * 🔴 **Radix Select 는 «고른 값»을 정적 렌더에 내놓지 않는다.** 그래서 이 시험은 값이
 * 아니라 **그 자리가 있는가 없는가**만 본다.
 */
describe("TablePagination — 쪽이 하나뿐일 때", () => {
  function render(total: number, pageSize = DEFAULT_PAGE_SIZE): string {
    return renderToStaticMarkup(
      createElement(TablePagination, {
        total,
        page: 1,
        pageSize,
        pageHref: (page: number) => `/w/x/p/y/issues?page=${String(page)}` as Route,
        pageSizeHref: (size: number) =>
          `/w/x/p/y/issues?pageSize=${String(size)}` as Route,
        labels: {
          total: (count: number) => `총 ${String(count)}건`,
          pageSize: "쪽 크기",
          previous: "이전",
          next: "다음",
          page: (page: number) => `${String(page)}쪽`,
          navigation: "쪽 이동",
        },
      }),
    );
  }

  it("🔴 23건은 한 쪽이라 넘기는 자리를 그리지 않는다", () => {
    const markup = render(23);

    // 「고장난 화면」과 구분되도록 총 건수는 남는다.
    expect(markup).toContain("총 23건");
    expect(markup).not.toContain("쪽 이동");
    expect(markup).not.toContain("다음");
    expect(markup).not.toContain("쪽 크기");
  });

  it("25건까지는 여전히 한 쪽이다", () => {
    expect(render(25)).not.toContain("쪽 이동");
  });

  /**
   * 🔴 **첫 쪽에서는 「이전」이 그려지지 않는다** — 갈 곳이 없다. 그래서 「그린다」 쪽은
   * 「다음」과 쪽 번호로 확인한다. 「이전」이 없는 것을 근거로 삼으면 위 시험과 구분되지 않는다.
   */
  it("🔴 26건부터는 넘기는 자리가 생긴다", () => {
    const markup = render(26);

    expect(markup).toContain("총 26건");
    expect(markup).toContain("쪽 이동");
    expect(markup).toContain("다음");
    expect(markup).toContain("쪽 크기");
    expect(markup).toContain("2쪽");
  });

  it("쪽 크기를 50 으로 올리면 26건이 다시 한 쪽이 된다", () => {
    expect(render(26, 50)).not.toContain("쪽 이동");
  });
});
