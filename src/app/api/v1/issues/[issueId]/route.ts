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
import { findAgentIssue } from "@/features/issues/server/issue-agent-query";
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

    const parsed = issueStatusUpdateSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const { evidenceIds, ...issue } = await updateIssueStatus({
      /**
       * 🔴 **Agent 는 Workspace 까지만 좁힌다.** API Key 가 Workspace 를 정하고 Payload 에도
       * Query 에도 Project 자리가 없다 — 여기에 Project 를 요구하면 계약이
       * 깨진다. 화면 쪽(Server Action)은 주소의 Project 까지 좁힌다.
       */
      scope: { workspaceId: agent.workspaceId },
      issueId: parsedId.data,
      update: {
        ...parsed.data,
        // 🔴 HTTP Payload 로 HUMAN·SYSTEM 을 가장하지 못하게 인증된 Key 가 행위자를 정한다.
        actor: { type: "AGENT", name: agent.apiKeyName },
      },
      fallbackActorName: agent.apiKeyName,
    });
    /**
     * 🔴 **GitHub 확인은 응답을 붙잡지 않는다.**
     *
     * `after()` 는 응답이 나간 **뒤** 도는 자리다. 확인 하나에 GitHub 왕복이 최대 4초 걸리는데
     * 그것을 요청 안에 두면 Agent 가 근거를 붙일수록 느려진다 — 그러면 Agent 는 근거를
     * 안 붙이는 쪽을 고른다. 확인은 부가 기능이고, 저장은 이미 끝났다.
     */
    after(() => verifyCodeEvidence(agent.workspaceId, evidenceIds));

    return Response.json({ issue }, { status: 200 });
  });
}

/**
 * `GET /api/v1/issues/{issueId}` — Issue 하나를 History 와 근거까지 읽는다(스펙 5).
 *
 * 🔴 **Decision Record 가 Activity 마다 붙어 나온다.** 「무엇을 먼저 해 봤고 왜 그것으로는
 * 안 됐는가」가 다음 판단에 쓰이는 것이라, 최신 하나만 주지 않는다.
 *
 * 🔴 남의 Workspace 의 Issue 는 `FORBIDDEN` 이 아니라 **`NOT_FOUND`** 다 —
 * 구분해 주면 그것만으로 「그 ID 가 존재한다」가 새어 나간다.
 */
export async function GET(
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

    const issue = await findAgentIssue(agent.workspaceId, parsedId.data);
    if (issue === null) {
      return apiError("NOT_FOUND", "Issue 를 찾을 수 없다.");
    }

    return Response.json({ issue }, { status: 200 });
  });
}
