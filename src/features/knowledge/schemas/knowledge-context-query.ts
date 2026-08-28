import { z } from "zod";

import { ISSUE_CATEGORIES, ISSUE_SEVERITIES } from "@/types/review";

/**
 * `GET /api/v1/knowledge/context` 의 Query 계약(스펙 34).
 *
 * Search Params 는 전부 문자열로 온다 — **외부 입력**이므로 여기서 형태를 정한다(CLAUDE.md 9).
 *
 * 🔴 `repositoryId` 는 **Filter 일 뿐 권한 근거가 아니다.** 다른 Workspace 의 Repository ID 를
 * 넣어도 조회는 API Key 의 Workspace 안에서만 돈다(스펙 15).
 */

/** 한 묶음이 돌려주는 행 수. 상한을 둬 한 요청이 표를 통째로 긁어 가지 않게 한다. */
export const KNOWLEDGE_LIMIT_DEFAULT = 20;
export const KNOWLEDGE_LIMIT_MAX = 100;

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined || value === "" ? null : value));

export const knowledgeContextQuerySchema = z.object({
  /**
   * Project Scope(스펙 10).
   *
   * 🔴 **Filter 일 뿐 권한 근거가 아니다.** 다른 Workspace 의 Project slug 를 넣어도
   * 조회는 API Key 의 Workspace 안에서만 돌고, 그 안에 없는 slug 면 아무것도 나오지 않는다.
   *
   * 지정하면 그 Project 의 Review Knowledge 로 좁히고, Wiki 는 **Workspace 공통 규칙과
   * 그 Project 문서를 함께** 준다 — Agent 는 둘 다 지켜야 한다.
   */
  projectSlug: optionalTrimmed(200),
  repositoryId: z
    .uuid()
    .nullish()
    .transform((value) => value ?? null),
  category: z
    .enum(ISSUE_CATEGORIES)
    .nullish()
    .transform((value) => value ?? null),
  /** Pattern Key 정확히 일치. 부분 검색이 필요해지면 그때 별도 Filter 를 만든다. */
  pattern: optionalTrimmed(200),
  severity: z
    .enum(ISSUE_SEVERITIES)
    .nullish()
    .transform((value) => value ?? null),
  limit: z
    .coerce.number()
    .int()
    .min(1)
    .max(KNOWLEDGE_LIMIT_MAX)
    .nullish()
    .transform((value) => value ?? KNOWLEDGE_LIMIT_DEFAULT),
});

export type KnowledgeContextQuery = z.infer<typeof knowledgeContextQuerySchema>;

/**
 * `URLSearchParams` 를 Schema 가 읽는 모양으로 바꾼다.
 *
 * 없는 Key 는 `null` 이 아니라 **빠뜨린다** — `null` 을 넣으면 `z.uuid()` 가 타입 오류로
 * 거절해, 「Filter 를 안 걸었다」가 「잘못된 요청」이 된다.
 */
export function readKnowledgeContextQuery(
  params: URLSearchParams,
): Record<string, string> {
  const raw: Record<string, string> = {};

  const keys = [
    "projectSlug",
    "repositoryId",
    "category",
    "pattern",
    "severity",
    "limit",
  ];

  for (const key of keys) {
    const value = params.get(key);
    if (value !== null && value !== "") {
      raw[key] = value;
    }
  }

  return raw;
}
