import {
  issueIdSchema,
  readJsonBody,
  runAgentRoute,
  validationErrorResponse,
} from "@/lib/api/agent-route";
import { authenticateAgent } from "@/lib/api/api-key-auth";
import { apiError } from "@/lib/api/error-response";
import { issueStatusUpdateSchema } from "@/features/issues/schemas/issue-status-update";
import { updateIssueStatus } from "@/features/issues/server/issue-status-service";

/**
 * `PATCH /api/v1/issues/{issueId}` — Issue 상태 전이(스펙 33).
 *
 * 🔴 상태·`resolvedAt`·`resolutionSummary`·IssueActivity 가 **한 Transaction 안에서 함께**
 * 움직인다. 「상태는 RESOLVED 인데 History 에는 아무것도 없는」 행을 만들지 않는다.
 */
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/v1/issues/[issueId]">,
): Promise<Response> {
  return runAgentRoute(async () => {
    const agent = await authenticateAgent(request);

    const { issueId } = await context.params;
    const parsedId = issueIdSchema.safeParse(issueId);
    if (!parsedId.success) {
      return apiError("VALIDATION_ERROR", "issueId 형식이 올바르지 않다.");
    }

    const parsed = issueStatusUpdateSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const issue = await updateIssueStatus({
      workspaceId: agent.workspaceId,
      issueId: parsedId.data,
      update: parsed.data,
      fallbackActorName: agent.apiKeyName,
    });

    return Response.json({ issue }, { status: 200 });
  });
}
