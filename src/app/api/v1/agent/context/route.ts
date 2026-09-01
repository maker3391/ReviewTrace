import { runAgentRoute } from "@/lib/api/agent-route";
import {
  authenticateAgent,
  requireAgentCapability,
} from "@/lib/api/api-key-auth";

/**
 * MCP startup context. It exposes authoring preferences, not Principal or tenant internals.
 */
export async function GET(request: Request): Promise<Response> {
  return runAgentRoute(async () => {
    const agent = await authenticateAgent(request);
    requireAgentCapability(agent, "READ");

    return Response.json(
      { reviewLanguage: agent.reviewLanguage },
      { status: 200 },
    );
  });
}
