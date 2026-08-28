import { z } from "zod";

import {
  ISSUE_CATEGORIES,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
} from "@/types/review";

/** Filter 를 걸지 않은 상태. Select 는 빈 값을 못 다루므로 명시 값을 쓴다. */
export const FILTER_ALL = "ALL";

export const ISSUE_PAGE_SIZE = 25;

/**
 * Issue 목록의 Filter.
 *
 * Filter·Search·Pagination 상태는 URL Search Params 에 둔다(CLAUDE.md 8).
 * 새로고침·URL 공유·뒤로가기가 되고, Server Query 와 화면이 갈라지지 않는다.
 *
 * 🔴 Search Params 는 외부 입력이다. 사용자가 주소창에 아무 값이나 넣을 수 있다.
 * 그래서 필드마다 `.catch()` 로 기본값으로 떨어뜨린다 — 잘못된 URL 하나가 화면을 500 으로 만들지 않는다.
 * 「거부해야 하는 입력」과 「무시해도 되는 입력」은 다르다. 조회 Filter 는 후자다.
 */
export const issueFilterSchema = z.object({
  q: z.string().trim().max(200).catch(""),
  severity: z.enum([FILTER_ALL, ...ISSUE_SEVERITIES]).catch(FILTER_ALL),
  category: z.enum([FILTER_ALL, ...ISSUE_CATEGORIES]).catch(FILTER_ALL),
  status: z.enum([FILTER_ALL, ...ISSUE_STATUSES]).catch(FILTER_ALL),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type IssueFilter = z.infer<typeof issueFilterSchema>;

/**
 * Filter Form 의 Schema.
 *
 * URL Schema 와 나눈 이유: URL 은 「잘못된 값을 무시」해야 하고(`.catch`),
 * Form 은 「잘못된 값을 사용자에게 알려」야 한다. 같은 Schema 로 두 일을 시키면 한쪽이 망가진다.
 *
 * 🔴 검증 규칙을 Component 안의 `if` 로 흩뿌리지 않는다. 여기에 둔다(CLAUDE.md 9).
 */
export const issueFilterFormSchema = z.object({
  q: z.string().trim().max(200, "검색어는 200자를 넘을 수 없습니다."),
  severity: z.enum([FILTER_ALL, ...ISSUE_SEVERITIES]),
  category: z.enum([FILTER_ALL, ...ISSUE_CATEGORIES]),
  status: z.enum([FILTER_ALL, ...ISSUE_STATUSES]),
});

export type IssueFilterForm = z.infer<typeof issueFilterFormSchema>;

/** Next.js 가 넘겨주는 Search Params 의 원형. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function parseIssueFilter(raw: RawSearchParams): IssueFilter {
  return issueFilterSchema.parse({
    q: firstValue(raw.q),
    severity: firstValue(raw.severity),
    category: firstValue(raw.category),
    status: firstValue(raw.status),
    page: firstValue(raw.page),
  });
}

/**
 * Filter 를 URL Query String 으로 되돌린다.
 *
 * 기본값은 적지 않는다 — `/issues?severity=ALL&page=1` 같은 주소를 공유하게 두지 않는다.
 */
export function issueFilterToQueryString(filter: IssueFilter): string {
  const params = new URLSearchParams();

  if (filter.q !== "") {
    params.set("q", filter.q);
  }
  if (filter.severity !== FILTER_ALL) {
    params.set("severity", filter.severity);
  }
  if (filter.category !== FILTER_ALL) {
    params.set("category", filter.category);
  }
  if (filter.status !== FILTER_ALL) {
    params.set("status", filter.status);
  }
  if (filter.page > 1) {
    params.set("page", String(filter.page));
  }

  return params.toString();
}
