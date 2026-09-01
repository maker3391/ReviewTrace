import {
  issueIdSchema,
  readJsonBody,
  runAgentRoute,
  validationErrorResponse,
} from "@/lib/api/agent-route";
import { after } from "next/server";

import { verifyCodeEvidence } from "@/features/issues/server/code-evidence-service";
import {
  authenticateAgent,
  requireAgentCapability,
} from "@/lib/api/api-key-auth";
import { requireAuthorizedIssueWorkspace } from "@/lib/api/agent-resource-authorization";
import { apiError } from "@/lib/api/error-response";
import { issueActivitySchema } from "@/features/issues/schemas/issue-activity";
import { addIssueActivity } from "@/features/issues/server/issue-activity-service";

/**
 * `POST /api/v1/issues/{issueId}/activities` — Issue History 한 줄 추가(스펙 32).
 *
 * 🔴 대상 Issue의 Workspace가 credential의 live authorized set에 포함되어야 한다.
 * 조회는 처음부터 `issue.id`와 authorized Workspace 조건을 함께 사용한다.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/issues/[issueId]/activities">,
): Promise<Response> {
  return runAgentRoute(async () => {
    const agent = await authenticateAgent(request);
    requireAgentCapability(agent, "WRITE");

    const { issueId } = await context.params;
    const parsedId = issueIdSchema.safeParse(issueId);
    if (!parsedId.success) {
      return apiError("VALIDATION_ERROR", "issueId 형식이 올바르지 않다.");
    }
    const workspaceId = await requireAuthorizedIssueWorkspace(
      agent,
      parsedId.data,
    );

    const parsed = issueActivitySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const { evidenceIds, ...activity } = await addIssueActivity({
      /**
       * 🔴 UUID를 아는 것만으로 접근할 수 없다. authorized resource lookup에서 확정한
       * Workspace scope만 Activity service에 전달한다.
       */
      scope: { workspaceId },
      issueId: parsedId.data,
      activity: {
        ...parsed.data,
        // 🔴 HTTP Payload 로 HUMAN·SYSTEM 을 가장하지 못하게 인증된 Key 가 행위자를 정한다.
        actor: { type: "AGENT", name: agent.actorName },
      },
    });
    /**
     * 🔴 **GitHub 확인은 응답을 붙잡지 않는다.**
     *
     * `after()` 는 응답이 나간 **뒤** 도는 자리다. 확인 하나에 GitHub 왕복이 최대 4초 걸리는데
     * 그것을 요청 안에 두면 Agent 가 근거를 붙일수록 느려진다 — 그러면 Agent 는 근거를
     * 안 붙이는 쪽을 고른다. 확인은 부가 기능이고, 저장은 이미 끝났다.
     */
    after(() => verifyCodeEvidence(workspaceId, evidenceIds));

    return Response.json({ activity }, { status: 201 });
  });
}
