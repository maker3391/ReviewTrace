import { authenticateAgent } from "@/lib/api/api-key-auth";
import {
  readIdempotencyKey,
  readJsonBody,
  runAgentRoute,
  validationErrorResponse,
} from "@/lib/api/agent-route";
import { reviewIngestSchema } from "@/features/reviews/schemas/review-ingest";
import { ingestReview } from "@/features/reviews/server/review-ingest-service";

/**
 * `POST /api/v1/reviews` — Agent Review Ingestion(스펙 29).
 *
 * ```
 * Route Handler -> API Key Authentication -> Zod -> Application Service -> Repository -> PostgreSQL
 * ```
 *
 * 🔴 **Workspace 는 API Key 가 정한다.** Payload 에 Workspace 자리가 없다(스펙 19).
 *
 * | 응답 | 뜻 |
 * |---|---|
 * | `201` | 새 ReviewSession 을 저장했다 |
 * | `200` | 같은 `Idempotency-Key` 가 이미 있어 아무것도 새로 쓰지 않았다 |
 */
export async function POST(request: Request): Promise<Response> {
  return runAgentRoute(async () => {
    const agent = await authenticateAgent(request);

    const parsed = reviewIngestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const result = await ingestReview({
      workspaceId: agent.workspaceId,
      idempotencyKey: readIdempotencyKey(request),
      payload: parsed.data,
    });

    return Response.json(result, { status: result.idempotentReplay ? 200 : 201 });
  });
}
