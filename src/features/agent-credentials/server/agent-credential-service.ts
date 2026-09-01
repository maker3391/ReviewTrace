import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  agentCredentials,
  agentPrincipals,
  agentWorkspaceGrants,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { generateAgentCredential } from "@/lib/api/api-key-token";
import { AppError } from "@/lib/errors";
import type { AgentCapability, AgentReviewLanguage } from "@/types/agent";

export interface AgentCredentialSummary {
  id: string;
  name: string;
  keyPrefix: string;
  capabilityScopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  reviewLanguage: AgentReviewLanguage;
}

export interface IssuedAgentCredential extends AgentCredentialSummary {
  plainToken: string;
}

export interface AgentWorkspaceGrantOption {
  workspaceId: string;
  slug: string;
  name: string;
  role: "OWNER" | "MEMBER";
  granted: boolean;
}

async function findUserPrincipal(
  userId: string,
  executor: DbExecutor,
): Promise<{
  id: string;
  displayName: string;
  reviewLanguage: AgentReviewLanguage;
} | null> {
  const rows = await executor
    .select({
      id: agentPrincipals.id,
      displayName: agentPrincipals.displayName,
      reviewLanguage: agentPrincipals.reviewLanguage,
    })
    .from(agentPrincipals)
    .where(
      and(
        eq(agentPrincipals.type, "USER_AGENT"),
        eq(agentPrincipals.ownerUserId, userId),
        isNull(agentPrincipals.revokedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function requireUserPrincipal(
  userId: string,
  displayName: string,
  executor: DbExecutor,
): Promise<{
  id: string;
  displayName: string;
  reviewLanguage: AgentReviewLanguage;
}> {
  const existing = await findUserPrincipal(userId, executor);
  if (existing !== null) return existing;

  await executor
    .insert(agentPrincipals)
    .values({
      type: "USER_AGENT",
      ownerUserId: userId,
      displayName: displayName.trim() || "ReviewTrace Agent",
    })
    .onConflictDoNothing();

  const created = await findUserPrincipal(userId, executor);
  if (created === null) throw new AppError("UNEXPECTED");
  return created;
}

export async function issueUserAgentCredential(
  input: {
    userId: string;
    displayName: string;
    name: string;
    expiresAt: Date | null;
    capabilityScopes: readonly AgentCapability[];
    reviewLanguage: AgentReviewLanguage;
  },
  executor?: DbExecutor,
): Promise<IssuedAgentCredential> {
  if (executor === undefined) {
    return db().transaction((tx) => issueUserAgentCredential(input, tx));
  }

  const name = input.name.trim();
  if (name === "" || name.length > 100) {
    throw new AppError("AGENT_CREDENTIAL_NAME_INVALID");
  }
  const generated = generateAgentCredential();
  const principal = await requireUserPrincipal(
    input.userId,
    input.displayName,
    executor,
  );
  if (principal.reviewLanguage !== input.reviewLanguage) {
    await executor
      .update(agentPrincipals)
      .set({ reviewLanguage: input.reviewLanguage, updatedAt: new Date() })
      .where(eq(agentPrincipals.id, principal.id));
  }
  const rows = await executor
    .insert(agentCredentials)
    .values({
      principalId: principal.id,
      name,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      capabilityScopes: [...input.capabilityScopes],
      expiresAt: input.expiresAt,
    })
    .returning({
      id: agentCredentials.id,
      name: agentCredentials.name,
      keyPrefix: agentCredentials.keyPrefix,
      capabilityScopes: agentCredentials.capabilityScopes,
      lastUsedAt: agentCredentials.lastUsedAt,
      expiresAt: agentCredentials.expiresAt,
      revokedAt: agentCredentials.revokedAt,
      createdAt: agentCredentials.createdAt,
    });
  const credential = rows[0];
  if (credential === undefined) throw new AppError("UNEXPECTED");
  return {
    ...credential,
    reviewLanguage: input.reviewLanguage,
    plainToken: generated.plainToken,
  };
}

export async function listUserAgentCredentials(
  userId: string,
  executor: DbExecutor = db(),
): Promise<AgentCredentialSummary[]> {
  const principal = await findUserPrincipal(userId, executor);
  if (principal === null) return [];
  return executor
    .select({
      id: agentCredentials.id,
      name: agentCredentials.name,
      keyPrefix: agentCredentials.keyPrefix,
      capabilityScopes: agentCredentials.capabilityScopes,
      lastUsedAt: agentCredentials.lastUsedAt,
      expiresAt: agentCredentials.expiresAt,
      revokedAt: agentCredentials.revokedAt,
      createdAt: agentCredentials.createdAt,
      reviewLanguage: agentPrincipals.reviewLanguage,
    })
    .from(agentCredentials)
    .innerJoin(
      agentPrincipals,
      eq(agentPrincipals.id, agentCredentials.principalId),
    )
    .where(eq(agentCredentials.principalId, principal.id))
    .orderBy(desc(agentCredentials.createdAt));
}

export async function revokeUserAgentCredential(
  input: { userId: string; credentialId: string },
  executor: DbExecutor = db(),
): Promise<void> {
  const principal = await findUserPrincipal(input.userId, executor);
  if (principal === null) throw new AppError("RESOURCE_NOT_FOUND");
  const rows = await executor
    .update(agentCredentials)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(agentCredentials.id, input.credentialId),
        eq(agentCredentials.principalId, principal.id),
        isNull(agentCredentials.revokedAt),
      ),
    )
    .returning({ id: agentCredentials.id });
  if (rows.length === 0) throw new AppError("RESOURCE_NOT_FOUND");
}

export async function listUserAgentWorkspaceGrants(
  userId: string,
  executor: DbExecutor = db(),
): Promise<AgentWorkspaceGrantOption[]> {
  const principal = await findUserPrincipal(userId, executor);
  const rows = await executor
    .select({
      workspaceId: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      role: workspaceMembers.role,
      grantRevokedAt: agentWorkspaceGrants.revokedAt,
      grantPrincipalId: agentWorkspaceGrants.principalId,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .leftJoin(
      agentWorkspaceGrants,
      principal === null
        ? eq(agentWorkspaceGrants.principalId, "00000000-0000-0000-0000-000000000000")
        : and(
            eq(agentWorkspaceGrants.principalId, principal.id),
            eq(agentWorkspaceGrants.workspaceId, workspaceMembers.workspaceId),
          ),
    )
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.name, workspaces.id);

  return rows.map((row) => ({
    workspaceId: row.workspaceId,
    slug: row.slug,
    name: row.name,
    role: row.role,
    granted:
      row.grantPrincipalId !== null && row.grantRevokedAt === null,
  }));
}

export async function setUserAgentWorkspaceGrant(
  input: {
    ownerUserId: string;
    principalOwnerUserId: string;
    workspaceId: string;
    granted: boolean;
  },
  executor: DbExecutor = db(),
): Promise<void> {
  const ownerRows = await executor
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, input.workspaceId),
        eq(workspaceMembers.userId, input.ownerUserId),
        eq(workspaceMembers.role, "OWNER"),
      ),
    )
    .limit(1);
  if (ownerRows.length === 0) throw new AppError("WORKSPACE_OWNER_REQUIRED");

  const memberRows = await executor
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, input.workspaceId),
        eq(workspaceMembers.userId, input.principalOwnerUserId),
      ),
    )
    .limit(1);
  if (memberRows.length === 0) throw new AppError("RESOURCE_NOT_FOUND");

  const principal = await requireUserPrincipal(
    input.principalOwnerUserId,
    "ReviewTrace Agent",
    executor,
  );
  const now = new Date();
  await executor
    .insert(agentWorkspaceGrants)
    .values({
      principalId: principal.id,
      workspaceId: input.workspaceId,
      grantedByUserId: input.ownerUserId,
      revokedAt: input.granted ? null : now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        agentWorkspaceGrants.principalId,
        agentWorkspaceGrants.workspaceId,
      ],
      set: {
        grantedByUserId: input.ownerUserId,
        revokedAt: input.granted ? null : now,
        updatedAt: now,
      },
    });
}
