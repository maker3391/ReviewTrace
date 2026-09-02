import "server-only";

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  agentCredentials,
  agentPrincipals,
  agentWorkspaceGrants,
  workspaceMembers,
} from "@/db/schema";
import { hashApiKey, readBearerToken } from "@/lib/api/api-key-token";
import { AppError } from "@/lib/errors";
import {
  AGENT_CAPABILITIES,
  type AgentCapability,
  type AgentPrincipalType,
  type AgentReviewLanguage,
} from "@/types/agent";

export interface AgentAuthorization {
  credentialId: string;
  principalId: string;
  principalType: AgentPrincipalType;
  /**
   * 🔴 **이 Review·Activity 를 «누가» 남겼는가** — `agent_credentials.name` 이다
   * (`codex-ci` · `claude-code-mcp`). principal 의 `display_name` 이 아니다:
   * 그것은 사람 한 명당 하나라 Agent 를 구별하지 못한다.
   *
   * 🔴 **받는 쪽은 이 값을 «snapshot» 으로 저장한다** — `review_sessions.reviewer_name`·
   * `issue_activities.actor_name` 은 JOIN 이 아니라 박힌 문자열이다. 연결은 나중에
   * 폐기되거나 이름이 바뀔 수 있고, 그때 과거 Review 의 «그때 누가 만들었는가» 가
   * 함께 바뀌면 Review history 가 거짓말이 된다(CLAUDE.md 1·2).
   */
  actorName: string;
  capabilities: readonly AgentCapability[];
  /** Default language for Agent-authored Review Knowledge. UI locale is separate. */
  reviewLanguage: AgentReviewLanguage;
  /** Live, effective Workspace scope. Repository queries must start inside this set. */
  authorizedWorkspaceIds: readonly string[];
}

const LAST_USED_REFRESH = sql`interval '1 minute'`;

function validCapabilities(values: readonly string[]): AgentCapability[] {
  return AGENT_CAPABILITIES.filter((capability) => values.includes(capability));
}

export function requireAgentCapability(
  authorization: AgentAuthorization,
  capability: AgentCapability,
): void {
  if (!authorization.capabilities.includes(capability)) {
    throw new AppError("AGENT_CAPABILITY_REQUIRED");
  }
}

async function authenticatePrincipal(
  keyHash: string,
  executor: DbExecutor,
): Promise<AgentAuthorization> {
  const rows = await executor
    .select({
      id: agentCredentials.id,
      principalId: agentCredentials.principalId,
      /**
       * 🔴 **Agent 신원은 principal 이 아니라 «그 연결»의 이름이다.**
       *
       * `agent_principals.display_name` 은 사람 한 명당 하나다
       * (`agent_principals_active_user_owner_unique` — USER_AGENT 는 owner 당 한 행).
       * 그것을 행위자 이름으로 쓰면 한 사람이 만든 **모든 연결이 같은 이름으로
       * 뭉개진다** — codex 가 남긴 Review 와 claude-code 가 남긴 Review 를 구별할 수
       * 없게 된다. 실제로 그랬다(`ReviewTrace Agent` 가 모든 행에 박혔다).
       */
      name: agentCredentials.name,
      capabilityScopes: agentCredentials.capabilityScopes,
      expiresAt: agentCredentials.expiresAt,
      credentialRevokedAt: agentCredentials.revokedAt,
      principalType: agentPrincipals.type,
      ownerUserId: agentPrincipals.ownerUserId,
      reviewLanguage: agentPrincipals.reviewLanguage,
      principalRevokedAt: agentPrincipals.revokedAt,
    })
    .from(agentCredentials)
    .innerJoin(
      agentPrincipals,
      eq(agentPrincipals.id, agentCredentials.principalId),
    )
    .where(eq(agentCredentials.keyHash, keyHash))
    .limit(1);

  const credential = rows[0];
  const now = new Date();
  if (
    credential === undefined ||
    credential.credentialRevokedAt !== null ||
    credential.principalRevokedAt !== null ||
    (credential.expiresAt !== null &&
      credential.expiresAt.getTime() <= now.getTime())
  ) {
    throw new AppError("AGENT_UNAUTHORIZED");
  }

  const workspaceRows =
    credential.principalType === "USER_AGENT"
      ? credential.ownerUserId === null
        ? []
        : await executor
            .select({ workspaceId: agentWorkspaceGrants.workspaceId })
            .from(agentWorkspaceGrants)
            .innerJoin(
              workspaceMembers,
              and(
                eq(
                  workspaceMembers.workspaceId,
                  agentWorkspaceGrants.workspaceId,
                ),
                eq(workspaceMembers.userId, credential.ownerUserId),
              ),
            )
            .where(
              and(
                eq(
                  agentWorkspaceGrants.principalId,
                  credential.principalId,
                ),
                isNull(agentWorkspaceGrants.revokedAt),
              ),
            )
      : await executor
          .select({ workspaceId: agentWorkspaceGrants.workspaceId })
          .from(agentWorkspaceGrants)
          .where(
            and(
              eq(
                agentWorkspaceGrants.principalId,
                credential.principalId,
              ),
              isNull(agentWorkspaceGrants.revokedAt),
            ),
          );

  await executor
    .update(agentCredentials)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(
      and(
        eq(agentCredentials.id, credential.id),
        or(
          isNull(agentCredentials.lastUsedAt),
          lt(
            agentCredentials.lastUsedAt,
            sql`now() - ${LAST_USED_REFRESH}`,
          ),
        ),
      ),
    );

  return {
    credentialId: credential.id,
    principalId: credential.principalId,
    principalType: credential.principalType,
    actorName: credential.name,
    capabilities: validCapabilities(credential.capabilityScopes),
    reviewLanguage: credential.reviewLanguage,
    authorizedWorkspaceIds: workspaceRows.map((row) => row.workspaceId),
  };
}

/** Authenticate a secret without choosing a Workspace, Project, or Repository. */
export async function authenticateAgent(
  request: Request,
  executor: DbExecutor = db(),
): Promise<AgentAuthorization> {
  const token = readBearerToken(request.headers.get("authorization"));
  if (token === null) {
    throw new AppError("AGENT_UNAUTHORIZED");
  }

  return authenticatePrincipal(hashApiKey(token), executor);
}
