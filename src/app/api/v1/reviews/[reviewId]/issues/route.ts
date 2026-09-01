import { after } from "next/server";
import { z } from "zod";

import { verifyCodeEvidence } from "@/features/issues/server/code-evidence-service";
import { reviewIssueAppendSchema } from "@/features/reviews/schemas/review-issue-append";
import { appendReviewIssues } from "@/features/reviews/server/review-ingest-service";
import {
  readJsonBody,
  runAgentRoute,
  validationErrorResponse,
} from "@/lib/api/agent-route";
import {
  authenticateAgent,
  requireAgentCapability,
} from "@/lib/api/api-key-auth";
import { requireAuthorizedReviewWorkspace } from "@/lib/api/agent-resource-authorization";
import { apiError } from "@/lib/api/error-response";

/**
 * `POST /api/v1/reviews/{reviewId}/issues` — 진행 중인 Review 에 Issue 를 붙인다(스펙 5).
 *
 * Agent 는 문제를 한 번에 다 알지 못한다. 읽으면서 하나씩 찾는다 — 그때마다 새
 * ReviewSession 을 만들면 **한 번의 Review 가 세션 열 개로 흩어진다.**
 *
 * 🔴 남의 Session 은 `FORBIDDEN` 이 아니라 **`NOT_FOUND`** 다(스펙 15).
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/reviews/[reviewId]/issues">,
): Promise<Response> {
  return runAgentRoute(async () => {
    const agent = await authenticateAgent(request);
    requireAgentCapability(agent, "WRITE");

    const { reviewId } = await context.params;
    const parsedId = z.uuid().safeParse(reviewId);
    if (!parsedId.success) {
      return apiError("VALIDATION_ERROR", "reviewId 형식이 올바르지 않다.");
    }
    const workspaceId = await requireAuthorizedReviewWorkspace(
      agent,
      parsedId.data,
    );

    const parsed = reviewIssueAppendSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const { evidenceIds, ...body } = await appendReviewIssues({
      workspaceId,
      reviewSessionId: parsedId.data,
      issues: parsed.data.issues,
    });

    // 🔴 GitHub 확인은 응답을 붙잡지 않는다 — `after()` 는 응답이 나간 뒤 도는 자리다.
    after(() => verifyCodeEvidence(workspaceId, evidenceIds));

    return Response.json(body, { status: 201 });
  });
}
