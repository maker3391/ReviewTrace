import { z } from "zod";

import {
  firstValue,
  pageNumberSchema,
  pageSizeSchema,
  writePageParams,
  type RawSearchParams,
} from "@/lib/pagination";
import {
  ISSUE_CATEGORIES,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
} from "@/types/review";

/** Filter 를 걸지 않은 상태. Select 는 빈 값을 못 다루므로 명시 값을 쓴다. */
export const FILTER_ALL = "ALL";

/**
 * 저장소 Filter 의 값.
 *
 * 🔴 **내부 UUID(`repositories.id`)다.** `owner/name` 도 GitHub 의 numeric id 도 아니다 —
 * 이름은 GitHub 에서 바뀌고(그 순간 주소가 죽는다), numeric id 는 Workspace 마다 다른
 * `repositories` 행을 가리켜 **한 값이 여러 Tenant 의 행에 걸린다**. Issue 가 실제로 붙들고
 * 있는 것도 `review_issues.repository_id` 라, 조회에 그대로 얹으면 변환이 하나도 없다.
 *
 * 🔴 **UUID 가 아닌 값은 조회로 내려보내지 않는다.** `repositories.id` 는 `uuid` Column 이라
 * `?repositoryId=abc` 하나가 Postgres 의 `22P02` 로 번져 화면이 500 이 된다 — 조회 Filter 는
 * 「거부」가 아니라 「무시」가 맞는 입력이다.
 */
const repositoryFilterSchema = z.union([z.literal(FILTER_ALL), z.uuid()]);

/**
 * Issue 목록의 Filter.
 *
 * Filter·Search·Pagination 상태는 URL Search Params 에 둔다.
 * 새로고침·URL 공유·뒤로가기가 되고, Server Query 와 화면이 갈라지지 않는다.
 *
 * 🔴 Search Params 는 외부 입력이다. 사용자가 주소창에 아무 값이나 넣을 수 있다.
 * 그래서 필드마다 `.catch()` 로 기본값으로 떨어뜨린다 — 잘못된 URL 하나가 화면을 500 으로 만들지 않는다.
 * 「거부해야 하는 입력」과 「무시해도 되는 입력」은 다르다. 조회 Filter 는 후자다.
 */
export const issueFilterSchema = z.object({
  q: z.string().trim().max(200).catch(""),
  /*
 🔴 **범위 밖의 값을 넣어도 「전체」로 넓어지지 않는다.** 형식이 맞는 남의 Repository
 UUID 는 여기서 그대로 통과하고, **조회가 Project·Workspace 조건과 겹쳐 걸어** 빈 결과로
 끝낸다(`issue-query.ts`). 여기서 조용히 `ALL` 로 되돌리면 묻지 않은 것에 답하게 된다.
 */
  repositoryId: repositoryFilterSchema.catch(FILTER_ALL),
  severity: z.enum([FILTER_ALL, ...ISSUE_SEVERITIES]).catch(FILTER_ALL),
  category: z.enum([FILTER_ALL, ...ISSUE_CATEGORIES]).catch(FILTER_ALL),
  status: z.enum([FILTER_ALL, ...ISSUE_STATUSES]).catch(FILTER_ALL),
  /*
 🔴 **쪽 상태도 Filter 와 같은 자리에 산다.** 규칙은 목록마다 다시 적지 않고
 `lib/pagination.ts` 한 곳에서 가져온다 — 어떤 목록만 `pageSize=7` 을 받아들이면
 Query 상한이 목록마다 갈라진다.
 */
  page: pageNumberSchema,
  pageSize: pageSizeSchema,
});

export type IssueFilter = z.infer<typeof issueFilterSchema>;

/**
 * Filter Form 의 Schema.
 *
 * URL Schema 와 나눈 이유: URL 은 「잘못된 값을 무시」해야 하고(`.catch`),
 * Form 은 「잘못된 값을 사용자에게 알려」야 한다. 같은 Schema 로 두 일을 시키면 한쪽이 망가진다.
 *
 * 🔴 검증 규칙을 Component 안의 `if` 로 흩뿌리지 않는다. 여기에 둔다.
 */
export const issueFilterFormSchema = z.object({
  // 🔴 오류 «문구» 는 여기 없다 — 규칙만 있고 말은 사전이 갖는다(`lib/validation/zod-error-map.ts`).
  q: z.string().trim().max(200),
  repositoryId: repositoryFilterSchema,
  severity: z.enum([FILTER_ALL, ...ISSUE_SEVERITIES]),
  category: z.enum([FILTER_ALL, ...ISSUE_CATEGORIES]),
  status: z.enum([FILTER_ALL, ...ISSUE_STATUSES]),
});

export type IssueFilterForm = z.infer<typeof issueFilterFormSchema>;

/** Next.js 가 넘겨주는 Search Params 의 원형. 🔴 목록마다 다시 정의하지 않는다. */
export type { RawSearchParams };

export function parseIssueFilter(raw: RawSearchParams): IssueFilter {
  return issueFilterSchema.parse({
    q: firstValue(raw.q),
    repositoryId: firstValue(raw.repositoryId),
    severity: firstValue(raw.severity),
    category: firstValue(raw.category),
    status: firstValue(raw.status),
    page: firstValue(raw.page),
    pageSize: firstValue(raw.pageSize),
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
  if (filter.repositoryId !== FILTER_ALL) {
    params.set("repositoryId", filter.repositoryId);
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
  writePageParams(params, filter);

  return params.toString();
}
