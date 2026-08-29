import { z } from "zod";

import { ISSUE_CATEGORIES, ISSUE_SEVERITIES, ISSUE_STATUSES } from "@/types/review";

/**
 * `GET /api/v1/issues` 의 Query 계약(스펙 5 — `search_issues`).
 *
 * 🔴 **Workspace 자리가 없다.** 조회 범위는 API Key 가 정한다(스펙 19).
 * `repository` 는 Filter 일 뿐 권한 근거가 아니다.
 *
 * 🔴 **내부 ID 를 묻지 않는다**(스펙 6). Agent 가 아는 것은 `owner/name` 이지
 * 우리 UUID 가 아니다 — Filter 도 그 말로 받는다.
 */

/** 한 번에 돌려주는 수. Agent 는 목록을 훑는 것이 아니라 **판단에 쓸 것**을 찾는다. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export const issueSearchQuerySchema = z.object({
  /** `owner/name`. 대소문자를 가리지 않는다. */
  repository: z
    .string()
    .trim()
    .max(401)
    .nullish()
    .transform((v) => (v === undefined || v === "" ? null : v)),
  status: z.enum(ISSUE_STATUSES).nullish().transform((v) => v ?? null),
  severity: z.enum(ISSUE_SEVERITIES).nullish().transform((v) => v ?? null),
  category: z.enum(ISSUE_CATEGORIES).nullish().transform((v) => v ?? null),
  patternKey: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v === undefined || v === "" ? null : v)),
  /** 제목·파일 경로·Pattern 을 훑는 낱말. */
  q: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v === undefined || v === "" ? null : v)),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .nullish()
    .transform((v) => v ?? DEFAULT_LIMIT),
});

export type IssueSearchQuery = z.infer<typeof issueSearchQuerySchema>;

/**
 * Query String 을 Schema 가 볼 모양으로 바꾼다.
 *
 * 🔴 보내지 않은 칸과 빈 칸을 같게 만든다 — `?status=` 하나 때문에 400 이 나가면
 * Agent 는 무엇이 잘못됐는지 알 방법이 없다.
 */
export function readIssueSearchQuery(
  params: URLSearchParams,
): Record<string, string | undefined> {
  const read = (key: string) => {
    const value = params.get(key);
    return value === null || value.trim() === "" ? undefined : value;
  };

  return {
    repository: read("repository"),
    status: read("status"),
    severity: read("severity"),
    category: read("category"),
    patternKey: read("patternKey"),
    q: read("q"),
    limit: read("limit"),
  };
}
