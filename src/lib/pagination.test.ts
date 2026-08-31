import { describe, expect, it, vi } from "vitest";

import {
 DEFAULT_PAGE_SIZE,
 listPageHref,
 MAX_PAGE,
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

describe("paginate", () => {
 it("요청한 쪽의 limit·offset 으로 읽는다", async () => {
 const rows = vi.fn().mockResolvedValue(["a", "b"]);

 const result = await paginate(
 { page: 3, pageSize: 25 },
 { count: async () => 100, rows },
);

 expect(rows).toHaveBeenCalledWith(25, 50);
 expect(result).toEqual({ items: ["a", "b"], total: 100, page: 3, pageSize: 25 });
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
