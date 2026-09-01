import { z } from "zod";

/**
 * 목록을 쪽으로 나누는 **한 곳**.
 *
 * 🔴 **화면마다 page 계산을 다시 적지 않는다.** 「몇 쪽인가」·「지금 쪽이 아직 있는가」·
 * 「기본값을 URL 에 적을 것인가」는 목록마다 답이 달라질 이유가 없다 — 갈라지면 어떤
 * 목록은 마지막 쪽에서 빈 표를 보여 주고 어떤 목록은 그러지 않는다.
 *
 * Filter·Search 와 마찬가지로 **상태는 URL Search Params 에 있다** —
 * 새로고침·주소 공유·뒤로가기가 그대로 되고, Server Query 와 화면이 갈라지지 않는다.
 *
 * 🔴 **Client State 도, Cursor 도 아니다.** 지금 목록은 전부 `LIMIT`/`OFFSET` 과
 * `COUNT` 로 답할 수 있고 그것이 실제로 느리다는 근거가 없다 — 근거 없이 다시 설계하지
 * 않는다.
 */

/** 한 쪽에 담는 수. 표 하나가 화면을 넘기되 스크롤이 지겹지 않은 값. */
export const DEFAULT_PAGE_SIZE = 25;

/** 사용자가 고를 수 있는 쪽 크기. 🔴 여기 없는 값은 URL 로 들어와도 기본값으로 떨어진다. */
export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

/**
 * 쪽 번호의 상한.
 *
 * 없으면 `?page=99999999999` 하나가 그대로 `OFFSET` 이 되어 Database 가 그 지점까지
 * 훑는다. 조회 Filter 는 「거부」가 아니라 「무시」가 맞는 입력이라
 * 오류 대신 기본값으로 떨어뜨린다.
 */
export const MAX_PAGE = 10_000;

/** 목록에 「몇 쪽을, 몇 개씩」을 묻는 값. */
export interface PageRequest {
  page: number;
  pageSize: number;
}

/**
 * 한 쪽의 조회 결과.
 *
 * 🔴 **`total` 이 함께 온다.** 없으면 화면이 「다음 쪽이 있는가」를 알 수 없어,
 * 결국 전부 가져와 Frontend 에서 자르는 가짜 Pagination 이 된다.
 *
 * `page` 는 **요청한 값이 아니라 실제로 그린 쪽**이다(`paginate` 참고).
 */
export interface PageResult<Item> {
  items: Item[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 🔴 Search Params 는 외부 입력이다 — 사용자가 주소창에 아무 값이나 넣는다.
 * `.catch()` 로 기본값에 떨어뜨려, 잘못된 URL 하나가 화면을 500 으로 만들지 않게 한다.
 */
export const pageNumberSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE)
  .catch(1);

export const pageSizeSchema = z.coerce
  .number()
  .int()
  .refine((value) => (PAGE_SIZE_OPTIONS as readonly number[]).includes(value))
  .catch(DEFAULT_PAGE_SIZE);

export const pageRequestSchema = z.object({
  page: pageNumberSchema,
  pageSize: pageSizeSchema,
});

/** Next.js 가 넘겨주는 Search Params 의 원형. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** 같은 키가 여러 번 오면 첫 값만 쓴다. */
export function firstValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parsePageRequest(raw: RawSearchParams): PageRequest {
  return pageRequestSchema.parse({
    page: firstValue(raw.page),
    pageSize: firstValue(raw.pageSize),
  });
}

/**
 * 쪽 상태를 Query String 으로 되돌린다.
 *
 * 🔴 **기본값은 적지 않는다.** `?page=1&pageSize=25` 같은 주소를 공유하게 두지 않는다 —
 * 기본값이 바뀌면 그 주소가 옛 값에 못박힌다.
 */
export function writePageParams(
  params: URLSearchParams,
  request: PageRequest,
): void {
  if (request.page > 1) {
    params.set("page", String(request.page));
  } else {
    params.delete("page");
  }

  if (request.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set("pageSize", String(request.pageSize));
  } else {
    params.delete("pageSize");
  }
}

/**
 * Filter 가 없는 목록의 주소.
 *
 * 🔴 **주소를 손으로 이어 붙이지 않는다.** `?page=` 를 화면마다 적으면 어떤 목록은
 * 기본값을 URL 에 남기고 어떤 목록은 남기지 않는 식으로 갈라진다.
 *
 * Filter 가 있는 목록(Issues)은 그 Filter 의 Query String 함수가 이 일을 겸한다 —
 * 쪽만 따로 붙이면 쪽을 넘기는 순간 검색어가 사라진다.
 */
export function listPageHref(basePath: string, request: PageRequest): string {
  const params = new URLSearchParams();
  writePageParams(params, request);

  const query = params.toString();
  return query === "" ? basePath : `${basePath}?${query}`;
}

/** 전체 쪽 수. 🔴 결과가 없어도 **0쪽이 아니라 1쪽**이다 — 빈 목록도 한 쪽이다. */
export function totalPageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * 세고 → 쪽을 바로잡고 → 그 쪽만 읽는다.
 *
 * 🔴 **이 순서가 요점이다.** 3쪽을 보던 사람이 새로고침하는 사이에 마지막 쪽의 데이터가
 * 지워지면(다른 사람이 지웠거나 Filter 가 좁혀졌거나) `OFFSET` 이 범위를 넘어 **아무 것도
 * 없는 표**가 나온다 — 오류도 아니고 「결과 없음」도 아닌, 고장난 것처럼 보이는 화면이다.
 * 먼저 세어 두면 그 쪽으로 **끌어당겨** 그릴 수 있다.
 *
 * 그래서 `PageResult.page` 는 요청한 값이 아니라 **실제로 그린 쪽**이다. 화면은 그 값으로
 * 아래 이동 줄을 그리므로, 「4쪽을 눌렀는데 3쪽이 칠해져 있는」 어긋남이 생기지 않는다.
 *
 * 🔴 **결과가 0건이면 행 질의를 아예 던지지 않는다.** 던져 봐야 빈 배열이다.
 */
export async function paginate<Item>(
  request: PageRequest,
  source: {
    count: () => Promise<number>;
    rows: (limit: number, offset: number) => Promise<Item[]>;
  },
): Promise<PageResult<Item>> {
  const total = await source.count();
  const page = Math.min(request.page, totalPageCount(total, request.pageSize));

  const items =
    total === 0
      ? []
      : await source.rows(request.pageSize, (page - 1) * request.pageSize);

  return { items, total, page, pageSize: request.pageSize };
}

/**
 * 이동 줄에 그릴 쪽 번호. `null` 은 생략표(`…`)다.
 *
 * 🔴 **쪽 수만큼 버튼을 늘어놓지 않는다.** 200쪽이면 버튼 200개가 표 아래를 채운다.
 * 첫 쪽·마지막 쪽·현재 쪽 언저리만 남긴다 — 그 셋이 실제로 누르는 자리다.
 */
export function pageWindow(
  page: number,
  totalPages: number,
  span = 1,
): (number | null)[] {
  const wanted = new Set<number>([1, totalPages]);
  for (let candidate = page - span; candidate <= page + span; candidate += 1) {
    if (candidate >= 1 && candidate <= totalPages) {
      wanted.add(candidate);
    }
  }

  const sorted = [...wanted].sort((left, right) => left - right);
  const window: (number | null)[] = [];
  let previous = 0;

  for (const current of sorted) {
    // 사이가 «두 칸 이상» 벌어졌을 때만 생략표를 둔다 — 한 칸이면 그 번호를 그리는 편이 낫다.
    if (previous !== 0 && current - previous > 1) {
      window.push(null);
    }
    window.push(current);
    previous = current;
  }

  return window;
}
