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
  knowledgeContextQuerySchema,
  readKnowledgeContextQuery,
} from "@/features/knowledge/schemas/knowledge-context-query";
import { findKnowledgeContext } from "@/features/knowledge/server/knowledge-context-query";
import {
  resolveAuthorizedRepositoryContext,
  resolveAuthorizedWorkspace,
} from "@/features/repositories/server/authorized-repository-context-service";

/**
 * `GET /api/v1/knowledge/context` — Agent 가 작업 전에 읽는 과거 Knowledge(스펙 34).
 *
 * 🔴 `repositoryId` 는 **Filter 일 뿐 권한 근거가 아니다.** 조회는 언제나 API Key 의
 * Workspace 안에서만 돈다(스펙 15).
 */
export async function GET(request: Request): Promise<Response> {
  return runAgentRoute(async () => {
    const agent = await authenticateAgent(request);
    requireAgentCapability(agent, "READ");

    const url = new URL(request.url);
    const parsed = knowledgeContextQuerySchema.safeParse(
      readKnowledgeContextQuery(url.searchParams),
    );
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const requestedRepository =
      parsed.data.repository ?? parsed.data.repositoryId;
    const workspaceHint = readAgentWorkspaceHint(request);
    const repositoryContext =
      requestedRepository === null
        ? null
        : await resolveAuthorizedRepositoryContext({
            authorization: agent,
            identity: {
              provider: "GITHUB",
              repositoryId: parsed.data.repositoryId,
              fullName: parsed.data.repository,
            },
            workspaceHint,
          });
    const workspace =
      repositoryContext?.workspace ??
      (await resolveAuthorizedWorkspace({
        authorization: agent,
        workspaceHint,
      }));

    const context = await findKnowledgeContext({
      workspaceId: workspace.id,
      workspace,
      authorizedRepositoryContext: repositoryContext,
      query: parsed.data,
    });

    return Response.json(context, { status: 200 });
  });
}
