import { z } from "zod";

import { ISSUE_ACTIVITY_TYPES, REVIEWER_TYPES } from "@/types/review";

/**
 * `POST /api/v1/issues/{issueId}/activities` 의 Payload 계약(스펙 32).
 *
 * IssueActivity 는 Issue 의 **의미 있는 변경 History** 다. 🔴 Event Sourcing 이 아니다 —
 * 현재 상태의 정본은 `review_issues` 이고, 이 표는 「어떻게 거기까지 갔는가」를 남긴다(CLAUDE.md 2).
 */

const DESCRIPTION_MAX = 20_000;
const NAME_MAX = 200;

export const activityActorSchema = z.object({
  type: z.enum(REVIEWER_TYPES),
  name: z.string().trim().min(1).max(NAME_MAX),
});

export const issueActivitySchema = z.object({
  type: z.enum(ISSUE_ACTIVITY_TYPES),
  actor: activityActorSchema,
  description: z
    .string()
    .trim()
    .max(DESCRIPTION_MAX)
    .nullish()
    .transform((value) => (value === undefined || value === "" ? null : value)),
  /**
   * 이 Activity 가 가리키는 Commit.
   *
   * 「어떤 코드에서 고쳤다고 주장하는가」를 남기는 값이라 Knowledge 의 일부다 —
   * 없으면 「고쳤다」와 「무엇을 고쳤다」가 이어지지 않는다.
   */
  commitSha: z
    .string()
    .trim()
    .max(NAME_MAX)
    .nullish()
    .transform((value) => (value === undefined || value === "" ? null : value)),
});

export type IssueActivityInput = z.infer<typeof issueActivitySchema>;
