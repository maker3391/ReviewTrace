import "server-only";

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  agentCredentials,
  agentPrincipals,
  agentWorkspaceGrants,
  apiKeys,
  workspaceMembers,
} from "@/db/schema";
import {
  hashApiKey,
  isPrincipalCredential,
  readBearerToken,
} from "@/lib/api/api-key-token";
import { AppError } from "@/lib/errors";
import {
  AGENT_CAPABILITIES,
  type AgentCapability,
  type AgentPrincipalType,
  type AgentReviewLanguage,
} from "@/types/agent";

export interface AgentAuthorization {
  model: "LEGACY_WORKSPACE" | "PRINCIPAL";
  credentialId: string;
  principalId: string | null;
  principalType: AgentPrincipalType | null;
  actorName: string;
  capabilities: readonly AgentCapability[];
  /** Default language for Agent-authored Review Knowledge. UI locale is separate. */
  reviewLanguage: AgentReviewLanguage;
  /** Live, effective Workspace scope. Repository queries must start inside this set. */
  authorizedWorkspaceIds: readonly string[];
  /** @deprecated Legacy-key compatibility only. New principal credentials omit it. */
  workspaceId?: string;
  /** @deprecated Use credentialId. */
  apiKeyId?: string;
  /** @deprecated Use actorName. */
  apiKeyName?: string;
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

async function authenticateLegacy(
  keyHash: string,
  executor: DbExecutor,
): Promise<AgentAuthorization> {
  const rows = await executor
    .select({
      id: apiKeys.id,
      workspaceId: apiKeys.workspaceId,
      name: apiKeys.name,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  const key = rows[0];
  const now = new Date();
  if (
    key === undefined ||
    key.revokedAt !== null ||
    (key.expiresAt !== null && key.expiresAt.getTime() <= now.getTime())
  ) {
    throw new AppError("AGENT_UNAUTHORIZED");
  }

  await executor
    .update(apiKeys)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(apiKeys.id, key.id),
        or(
          isNull(apiKeys.lastUsedAt),
          lt(apiKeys.lastUsedAt, sql`now() - ${LAST_USED_REFRESH}`),
        ),
      ),
    );

  return {
    model: "LEGACY_WORKSPACE",
    credentialId: key.id,
    principalId: null,
    principalType: null,
    actorName: key.name,
    capabilities: AGENT_CAPABILITIES,
    // Legacy keys predate an authoring preference. Preserve their historical contract.
    reviewLanguage: "en",
    authorizedWorkspaceIds: [key.workspaceId],
    workspaceId: key.workspaceId,
    apiKeyId: key.id,
    apiKeyName: key.name,
  };
}

async function authenticatePrincipal(
  keyHash: string,
  executor: DbExecutor,
): Promise<AgentAuthorization> {
  const rows = await executor
    .select({
      id: agentCredentials.id,
      principalId: agentCredentials.principalId,
      capabilityScopes: agentCredentials.capabilityScopes,
      expiresAt: agentCredentials.expiresAt,
      credentialRevokedAt: agentCredentials.revokedAt,
      principalType: agentPrincipals.type,
      ownerUserId: agentPrincipals.ownerUserId,
      displayName: agentPrincipals.displayName,
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
    model: "PRINCIPAL",
    credentialId: credential.id,
    principalId: credential.principalId,
    principalType: credential.principalType,
    actorName: credential.displayName,
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

  const keyHash = hashApiKey(token);
  return isPrincipalCredential(token)
    ? authenticatePrincipal(keyHash, executor)
    : authenticateLegacy(keyHash, executor);
}
