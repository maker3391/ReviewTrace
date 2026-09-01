import { after } from "next/server";

import { verifyCodeEvidence } from "@/features/issues/server/code-evidence-service";
import {
  authenticateAgent,
  requireAgentCapability,
} from "@/lib/api/api-key-auth";
import {
  readIdempotencyKey,
  readAgentWorkspaceHint,
  readJsonBody,
  runAgentRoute,
  validationErrorResponse,
} from "@/lib/api/agent-route";
import { reviewIngestSchema } from "@/features/reviews/schemas/review-ingest";
import { ingestReview } from "@/features/reviews/server/review-ingest-service";
import { resolveAgentReviewWorkspace } from "@/features/reviews/server/agent-review-context";

/**
 * `POST /api/v1/reviews` — Agent Review Ingestion(스펙 29).
 *
 * ```
 * Route Handler -> Agent Authentication -> Zod -> Authorized Repository Context -> Application Service
 * ```
 *
 * 🔴 Principal credential은 Workspace를 고르지 않는다. Repository가 authorized Workspace
 * 집합 안에서 Project와 Workspace를 결정하며, legacy key만 기존 단일 Workspace를 유지한다.
 *
 * | 응답 | 뜻 |
 * |---|---|
 * | `201` | 새 ReviewSession 을 저장했다 |
 * | `200` | 같은 `Idempotency-Key` 가 이미 있어 아무것도 새로 쓰지 않았다 |
 */
export async function POST(request: Request): Promise<Response> {
  return runAgentRoute(async () => {
    const agent = await authenticateAgent(request);
    requireAgentCapability(agent, "WRITE");

    const parsed = reviewIngestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }
    const workspaceId = await resolveAgentReviewWorkspace({
      authorization: agent,
      payload: parsed.data,
      workspaceHint: readAgentWorkspaceHint(request),
    });

    const result = await ingestReview({
      workspaceId,
      idempotencyKey: readIdempotencyKey(request),
      payload: {
        ...parsed.data,
        /**
         * 🔴 **Review 작성자는 인증된 credential principal이 정한다.** Payload 의 type/name 을
         * 믿으면 Agent Key 하나로 HUMAN·SYSTEM 기록을 가장할 수 있다.
         */
        reviewer: {
          type: "AGENT",
          name: agent.actorName,
          version: parsed.data.reviewer.version,
        },
      },
    });

    const { evidenceIds, ...body } = result;
    /**
     * 🔴 **GitHub 확인은 응답을 붙잡지 않는다.**
     *
     * `after()` 는 응답이 나간 **뒤** 도는 자리다. 확인 하나에 GitHub 왕복이 최대 4초 걸리는데
     * 그것을 요청 안에 두면 Agent 가 근거를 붙일수록 느려진다 — 그러면 Agent 는 근거를
     * 안 붙이는 쪽을 고른다. 확인은 부가 기능이고, 저장은 이미 끝났다.
     */
    after(() => verifyCodeEvidence(workspaceId, evidenceIds));

    return Response.json(body, { status: body.idempotentReplay ? 200 : 201 });
  });
}
