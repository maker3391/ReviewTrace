import { z } from "zod";

import {
  MAX_ISSUES_PER_REVIEW,
  reviewIssueInputSchema,
} from "@/features/reviews/schemas/review-ingest";

/**
 * `POST /api/v1/reviews/{reviewId}/issues` 의 Payload 계약(스펙 5 — `add_issue`).
 *
 * 🔴 **Issue 의 모양은 Ingest 와 같은 Schema 다.** 따로 적으면 한쪽에만 칸이 늘어
 * MCP 로 보낸 것과 REST 로 보낸 것이 다르게 저장된다(스펙 1).
 *
 * 🔴 Repository·Reviewer 자리가 없다 — 그것은 Session 이 이미 정한 값이다.
 */
export const reviewIssueAppendSchema = z.object({
  issues: z.array(reviewIssueInputSchema).min(1).max(MAX_ISSUES_PER_REVIEW),
});

export type ReviewIssueAppendInput = z.infer<typeof reviewIssueAppendSchema>;
