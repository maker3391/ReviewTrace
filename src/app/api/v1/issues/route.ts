import {
  readAgentWorkspaceHint,
  runAgentRoute,
  validationErrorResponse,
} from "@/lib/api/agent-route";
import {
  authenticateAgent,
  requireAgentCapability,
} from "@/lib/api/api-key-auth";
import {
  issueSearchQuerySchema,
  readIssueSearchQuery,
} from "@/features/issues/schemas/issue-search-query";
import { searchAgentIssues } from "@/features/issues/server/issue-agent-query";
import {
  resolveAuthorizedRepositoryContext,
  resolveAuthorizedWorkspace,
} from "@/features/repositories/server/authorized-repository-context-service";

/**
 * `GET /api/v1/issues` — Agent 가 「이 저장소에 지금 뭐가 열려 있나」를 묻는 자리(스펙 5).
 *
 * 🔴 **`repository` 는 Filter 일 뿐 권한 근거가 아니다.** 조회는 언제나 API Key 의
 * Workspace 안에서만 돈다(스펙 19) — 남의 `owner/name` 을 넣어도 결과는 비어서 나간다.
 *
 * 🔴 **내부 ID 를 묻지 않는다**(스펙 6). Agent 가 아는 것은 git remote 의 `owner/name`
 * 이지 우리 UUID 가 아니다.
 */
export async function GET(request: Request): Promise<Response> {
  return runAgentRoute(async () => {
    const agent = await authenticateAgent(request);
    requireAgentCapability(agent, "READ");

    const url = new URL(request.url);
    const parsed = issueSearchQuerySchema.safeParse(
      readIssueSearchQuery(url.searchParams),
    );
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const workspaceHint = readAgentWorkspaceHint(request);
    const workspaceId =
      parsed.data.repository === null
        ? (
            await resolveAuthorizedWorkspace({
              authorization: agent,
              workspaceHint,
            })
          ).id
        : (
            await resolveAuthorizedRepositoryContext({
              authorization: agent,
              identity: {
                provider: "GITHUB",
                fullName: parsed.data.repository,
              },
              workspaceHint,
            })
          ).workspace.id;

    const issues = await searchAgentIssues(workspaceId, parsed.data);

    return Response.json({ issues }, { status: 200 });
  });
}
