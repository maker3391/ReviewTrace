import {
  issueIdSchema,
  readJsonBody,
  runAgentRoute,
  validationErrorResponse,
} from "@/lib/api/agent-route";
import { after } from "next/server";

import { verifyCodeEvidence } from "@/features/issues/server/code-evidence-service";
import { authenticateAgent } from "@/lib/api/api-key-auth";
import { apiError } from "@/lib/api/error-response";
import { issueActivitySchema } from "@/features/issues/schemas/issue-activity";
import { addIssueActivity } from "@/features/issues/server/issue-activity-service";

/**
 * `POST /api/v1/issues/{issueId}/activities` — Issue History 한 줄 추가(스펙 32).
 *
 * 🔴 **API Key 의 Workspace 와 대상 Issue 의 Workspace 가 반드시 일치해야 한다.**
 * 판정은 Application Service 가 한다 — `WHERE issue.id = ?` 만으로 끝내지 않는다(스펙 15).
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/issues/[issueId]/activities">,
): Promise<Response> {
  return runAgentRoute(async () => {
    const agent = await authenticateAgent(request);

    const { issueId } = await context.params;
    const parsedId = issueIdSchema.safeParse(issueId);
    if (!parsedId.success) {
      return apiError("VALIDATION_ERROR", "issueId 형식이 올바르지 않다.");
    }

    const parsed = issueActivitySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const { evidenceIds, ...activity } = await addIssueActivity({
      /**
       * 🔴 **Agent 는 Project 까지 좁히지 «못한다».** API Key 가 Workspace 를 정하고
       * Payload 에도 Query 에도 Project 자리가 없다. 여기에 Project 를
       * 넣으면 지금 도는 Agent 들의 요청이 전부 `NOT_FOUND` 가 된다.
       */
      scope: { workspaceId: agent.workspaceId },
      issueId: parsedId.data,
      activity: {
        ...parsed.data,
        // 🔴 HTTP Payload 로 HUMAN·SYSTEM 을 가장하지 못하게 인증된 Key 가 행위자를 정한다.
        actor: { type: "AGENT", name: agent.apiKeyName },
      },
    });
    /**
     * 🔴 **GitHub 확인은 응답을 붙잡지 않는다.**
     *
     * `after()` 는 응답이 나간 **뒤** 도는 자리다. 확인 하나에 GitHub 왕복이 최대 4초 걸리는데
     * 그것을 요청 안에 두면 Agent 가 근거를 붙일수록 느려진다 — 그러면 Agent 는 근거를
     * 안 붙이는 쪽을 고른다. 확인은 부가 기능이고, 저장은 이미 끝났다.
     */
    after(() => verifyCodeEvidence(agent.workspaceId, evidenceIds));

    return Response.json({ activity }, { status: 201 });
  });
}
