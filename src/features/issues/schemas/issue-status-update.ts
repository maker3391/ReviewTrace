import { z } from "zod";

import { activityActorSchema } from "@/features/issues/schemas/issue-activity";
import {
  ISSUE_STATUSES,
  type IssueActivityType,
  type IssueStatus,
} from "@/types/review";

/**
 * `PATCH /api/v1/issues/{issueId}` 의 Payload 계약(스펙 33).
 *
 * 🔴 **상태와 History 가 서로 모순되지 않게 한다.** 그래서 이 API 는 Column 하나를
 * 바꾸는 것이 아니라 **상태 전이**를 받는다 — 상태·`resolvedAt`·`resolutionSummary`·
 * IssueActivity 네 가지가 **한 Transaction 안에서 같은 이야기를 하도록** 함께 움직인다.
 */

const RESOLUTION_SUMMARY_MAX = 20_000;

/**
 * 상태 전이마다 남는 Activity.
 *
 * 🔴 **모든 전이가 History 를 남긴다.** 「상태만 바뀌고 아무도 왜인지 모르는」 행을 만들지
 * 않는다. Activity Type 은 7개뿐이라 Status 6개와 1:1 이 아니므로 여기서 못 박는다.
 *
 * | Status | Activity | 왜 |
 * |---|---|---|
 * | `OPEN` · `REOPENED` | `REOPENED` | 닫혔던 것을 다시 여는 행위다 |
 * | `IN_PROGRESS` | `FIX_ATTEMPTED` | 누군가 고치기 시작했다는 뜻이다 |
 * | `RESOLVED` | `RESOLVED` | |
 * | `IGNORED` · `FALSE_POSITIVE` | `IGNORED` | 오탐도 「더 보지 않는다」의 한 갈래다 |
 */
export const ACTIVITY_TYPE_BY_STATUS: Record<IssueStatus, IssueActivityType> = {
  OPEN: "REOPENED",
  IN_PROGRESS: "FIX_ATTEMPTED",
  RESOLVED: "RESOLVED",
  IGNORED: "IGNORED",
  FALSE_POSITIVE: "IGNORED",
  REOPENED: "REOPENED",
};

export const issueStatusUpdateSchema = z
  .object({
    status: z.enum(ISSUE_STATUSES),
    resolutionSummary: z
      .string()
      .trim()
      .max(RESOLUTION_SUMMARY_MAX)
      .nullish()
      .transform((value) =>
        value === undefined || value === "" ? null : value,
      ),
    /**
     * 누가 바꿨는가. 생략하면 API Key 의 이름이 대신 들어간다 —
     * Key 하나가 곧 한 Agent 라, 「누구의 요청인가」는 Key 가 이미 말한다.
     */
    actor: activityActorSchema.nullish().transform((value) => value ?? null),
  })
  .refine(
    (input) => input.status !== "RESOLVED" || input.resolutionSummary !== null,
    {
      // 🔴 `resolved = true` 만 저장하지 않는다 — **어떻게 해결했는가가 Knowledge 의 핵심**이다(CLAUDE.md 2).
      message: "RESOLVED 로 바꿀 때는 resolutionSummary 가 필요하다",
      path: ["resolutionSummary"],
    },
  );

export type IssueStatusUpdateInput = z.infer<typeof issueStatusUpdateSchema>;
