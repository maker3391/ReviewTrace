import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  listPageHref,
  MAX_PAGE,
  PAGE_SIZE_OPTIONS,
  pageWindow,
  paginate,
  parsePageRequest,
  totalPageCount,
} from "@/lib/pagination";

/**
 * 쪽 나누기의 회귀 시험.
 *
 * 🔴 **여기서 잡는 것은 「그럴듯하게 보이는」 고장이다.** 잘못된 쪽 번호로 빈 표가
 * 나오는 것도, 기본값이 URL 에 눌어붙는 것도 오류를 내지 않는다 — 그래서 눈으로는
 * 늦게 발견된다.
 */

describe("parsePageRequest", () => {
  it("비어 있으면 첫 쪽·기본 크기다", () => {
    expect(parsePageRequest({})).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it("주소창의 값을 읽는다", () => {
    expect(parsePageRequest({ page: "3", pageSize: "50" })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  /**
   * 🔴 **거부가 아니라 무시다.** 조회 Filter 는 잘못된 값 하나로 화면을 500 으로
   * 만들 자리가 아니다.
   */
  it.each([
    ["음수", { page: "-7" }],
    ["숫자가 아님", { page: "abc" }],
    ["상한 초과", { page: String(MAX_PAGE + 1) }],
  ])("%s 인 page 는 첫 쪽으로 떨어진다", (_label, raw) => {
    expect(parsePageRequest(raw).page).toBe(1);
  });

  /** 🔴 고를 수 없는 크기를 그대로 쓰면 `LIMIT` 상한이 URL 로 뚫린다. */
  it.each(["7", "100000", "0", "-25"])(
    "고를 수 없는 pageSize(%s)는 기본값이 된다",
    (pageSize) => {
      expect(parsePageRequest({ pageSize }).pageSize).toBe(DEFAULT_PAGE_SIZE);
    },
  );

  it("같은 키가 여러 번 오면 첫 값만 쓴다", () => {
    expect(parsePageRequest({ page: ["2", "9"] }).page).toBe(2);
  });
});

describe("listPageHref", () => {
  it("🔴 기본값은 주소에 적지 않는다", () => {
    expect(
      listPageHref("/w/a/projects", { page: 1, pageSize: DEFAULT_PAGE_SIZE }),
    ).toBe("/w/a/projects");
  });

  it("기본값이 아닌 것만 담는다", () => {
    expect(listPageHref("/w/a/projects", { page: 3, pageSize: 50 })).toBe(
      "/w/a/projects?page=3&pageSize=50",
    );
  });

  it("왕복해도 같은 값이 나온다", () => {
    const request = { page: 4, pageSize: 100 };
    const href = listPageHref("/w/a/projects", request);
    const query = new URLSearchParams(href.split("?")[1]);

    expect(parsePageRequest(Object.fromEntries(query))).toEqual(request);
  });
});

describe("totalPageCount", () => {
  it("🔴 결과가 없어도 0쪽이 아니라 1쪽이다", () => {
    expect(totalPageCount(0, 25)).toBe(1);
  });

  it.each([
    [1, 25, 1],
    [25, 25, 1],
    [26, 25, 2],
    [100, 25, 4],
    [101, 25, 5],
  ])("%i건을 %i개씩 보면 %i쪽이다", (total, pageSize, expected) => {
    expect(totalPageCount(total, pageSize)).toBe(expected);
  });
});

/**
 * 🔴 **기본 쪽 크기의 «값 자체»를 못박는다.**
 *
 * 다른 시험들은 전부 `DEFAULT_PAGE_SIZE` 를 import 해서 쓴다 — 그래서 그 상수를 20 으로
 * 바꿔도 **전부 초록으로 남는다.** 「23건이 한 쪽에 다 나온다」가 정상인지 결함인지는
 * 그 값 하나로 갈리므로, 여기서는 숫자를 **글자 그대로** 적는다.
 *
 * ```
 * pageSize 25 -> 23·24·25건은 «한 쪽»   26·49·50건은 두 쪽   51건은 세 쪽
 * pageSize 20 -> 23건부터 두 쪽이 된다   41건부터 세 쪽       <- 되돌리면 여기가 빨개진다
 * ```
 *
 * 🔴 **경계는 기본값에 맞춘다.** `pageSize` 가 25 인데 19·20·21 로 재면 셋 다 「한 쪽」이라
 * **아무 경계도 넘지 않는다** — 그런 표는 초록이어도 아무것도 지키지 못한다. 실제로 갈리는
 * 자리는 `24 | 25 | 26`(1쪽↔2쪽)과 `49 | 50 | 51`(2쪽↔3쪽)이다.
 */
describe("기본 쪽 크기의 경계", () => {
  it("🔴 기본 쪽 크기는 25 다", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(25);
  });

  it("고를 수 있는 크기는 25·50·100 뿐이다", () => {
    expect(PAGE_SIZE_OPTIONS).toEqual([25, 50, 100]);
  });

  /** 총 건수만큼의 행을 흉내 내어 실제 `limit`/`offset` 으로 잘라 준다. */
  function sourceOf(total: number) {
    const all = Array.from({ length: total }, (_, index) => index + 1);
    return {
      count: async () => total,
      rows: async (limit: number, offset: number) =>
        all.slice(offset, offset + limit),
    };
  }

  it.each([
    // 🔴 보고된 그 자리다. 기본값이 25 라면 23건이 한 쪽에 다 나오는 것이 «정상»이다.
    [23, 1, 23],
    [24, 1, 24],
    [25, 1, 25],
    [26, 2, 25],
    [49, 2, 25],
    [50, 2, 25],
    [51, 3, 25],
  ])("%i건은 %i쪽이고 첫 쪽에 %i건이 담긴다", async (
    total,
    pages,
    firstCount,
  ) => {
    expect(totalPageCount(total, DEFAULT_PAGE_SIZE)).toBe(pages);

    const first = await paginate(
      { page: 1, pageSize: DEFAULT_PAGE_SIZE },
      sourceOf(total),
    );
    expect(first.total).toBe(total);
    expect(first.items).toHaveLength(firstCount);

    /*
 두 번째 쪽을 «요청»했을 때.

 🔴 한 쪽뿐이면 빈 표가 아니라 **첫 쪽으로 끌려온다**(`paginate`) — 그래서 23~25건에서는
 첫 쪽과 같은 것이 다시 나오는 것이 정상이다. 두 쪽 이상이면 남은 것과 한 쪽 분량 중
 **작은 쪽**이 담긴다 — 51건처럼 세 쪽이면 두 번째 쪽도 가득 찬다.
 */
    const second = await paginate(
      { page: 2, pageSize: DEFAULT_PAGE_SIZE },
      sourceOf(total),
    );
    expect(second.page).toBe(pages === 1 ? 1 : 2);
    expect(second.items).toHaveLength(
      pages === 1
        ? total
        : Math.min(DEFAULT_PAGE_SIZE, total - DEFAULT_PAGE_SIZE),
    );
  });

  /**
   * 🔴 쪽이 갈려도 «같은 행이 두 쪽에 나오거나 빠지지» 않는다.
   *
   * 마지막 쪽까지 전부 걸어야 뜻이 있다 — 앞 두 쪽만 보면 51건처럼 세 쪽인 경우의
   * 마지막 한 건이 검사 밖에 남는다.
   */
  it.each([26, 49, 50, 51])("%i건을 끝까지 넘겨도 겹치거나 빠지지 않는다", async (
    total,
  ) => {
    const pages = totalPageCount(total, DEFAULT_PAGE_SIZE);
    const seen: number[] = [];

    for (let page = 1; page <= pages; page += 1) {
      const result = await paginate(
        { page, pageSize: DEFAULT_PAGE_SIZE },
        sourceOf(total),
      );
      expect(result.page).toBe(page);
      seen.push(...result.items);
    }

    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
  });
});

describe("paginate", () => {
  it("요청한 쪽의 limit·offset 으로 읽는다", async () => {
    const rows = vi.fn().mockResolvedValue(["a", "b"]);

    const result = await paginate(
      { page: 3, pageSize: 25 },
      { count: async () => 100, rows },
    );

    expect(rows).toHaveBeenCalledWith(25, 50);
    expect(result).toEqual({
      items: ["a", "b"],
      total: 100,
      page: 3,
      pageSize: 25,
    });
  });

  /**
   * 🔴 **무효해진 쪽**. 마지막 쪽을 보던 중 그 행들이 사라지면 `OFFSET` 이 범위를 넘어
   * 「결과 없음」과 구분되지 않는 빈 표가 나온다 — 마지막 쪽으로 끌어당겨 그린다.
   */
  it("범위를 넘은 쪽은 마지막 쪽으로 끌어당긴다", async () => {
    const rows = vi.fn().mockResolvedValue(["z"]);

    const result = await paginate(
      { page: 9, pageSize: 25 },
      { count: async () => 26, rows },
    );

    expect(result.page).toBe(2);
    expect(rows).toHaveBeenCalledWith(25, 25);
  });

  it("🔴 결과가 하나도 없으면 행 질의를 던지지 않는다", async () => {
    const rows = vi.fn();

    const result = await paginate(
      { page: 5, pageSize: 25 },
      { count: async () => 0, rows },
    );

    expect(rows).not.toHaveBeenCalled();
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
  });
});

describe("pageWindow", () => {
  it("한 쪽뿐이면 번호도 하나다", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
  });

  it("쪽이 적으면 전부 그린다", () => {
    expect(pageWindow(2, 4)).toEqual([1, 2, 3, 4]);
  });

  /** 🔴 200쪽이어도 버튼이 200개가 되지 않는다. */
  it("멀리 떨어진 구간은 생략표로 접는다", () => {
    expect(pageWindow(50, 200)).toEqual([1, null, 49, 50, 51, null, 200]);
  });

  it("한 칸만 벌어지면 생략표 대신 그 번호를 그린다", () => {
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("끝에 붙어 있으면 앞쪽만 접는다", () => {
    expect(pageWindow(12, 12)).toEqual([1, null, 11, 12]);
  });
});
