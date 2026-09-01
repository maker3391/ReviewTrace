import "server-only";

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { projects, repositories, workspaces } from "@/db/schema";
import type { AgentAuthorization } from "@/lib/api/api-key-auth";
import { AppError } from "@/lib/errors";
import type {
  RepositoryContext,
  RepositoryIdentity,
} from "@/features/repositories/server/repository-context-service";

function identityCondition(identity: RepositoryIdentity): SQL | undefined {
  return identity.repositoryId
    ? eq(repositories.id, identity.repositoryId)
    : identity.externalRepositoryId
      ? eq(repositories.externalRepositoryId, identity.externalRepositoryId)
      : identity.fullName
        ? sql`lower(${repositories.fullName}) = lower(${identity.fullName})`
        : undefined;
}

/**
 * Resolve only inside the principal's live Workspace set. Unauthorized rows are
 * never selected, so a miss cannot disclose whether another tenant has a row.
 */
export async function resolveAuthorizedRepositoryContext(
  input: {
    authorization: AgentAuthorization;
    identity: RepositoryIdentity;
    workspaceHint?: string | null;
  },
  executor: DbExecutor = db(),
): Promise<RepositoryContext> {
  const authorizedWorkspaceIds = [...input.authorization.authorizedWorkspaceIds];
  const matchesIdentity = identityCondition(input.identity);
  if (authorizedWorkspaceIds.length === 0 || matchesIdentity === undefined) {
    throw new AppError("NOT_CONNECTED_OR_NOT_AUTHORIZED");
  }

  const conditions: SQL[] = [
    inArray(repositories.workspaceId, authorizedWorkspaceIds),
    eq(repositories.provider, input.identity.provider),
    eq(repositories.isActive, true),
    matchesIdentity,
  ];
  const hint = input.workspaceHint?.trim() || null;
  if (hint !== null) {
    conditions.push(sql`lower(${workspaces.slug}) = lower(${hint})`);
  }

  const rows = await executor
    .select({
      workspaceId: workspaces.id,
      workspaceSlug: workspaces.slug,
      projectId: projects.id,
      projectSlug: projects.slug,
      projectName: projects.name,
      repositoryId: repositories.id,
      provider: repositories.provider,
      externalRepositoryId: repositories.externalRepositoryId,
      owner: repositories.owner,
      name: repositories.name,
      fullName: repositories.fullName,
      defaultBranch: repositories.defaultBranch,
      htmlUrl: repositories.htmlUrl,
    })
    .from(repositories)
    .innerJoin(
      projects,
      and(
        eq(projects.id, repositories.projectId),
        eq(projects.workspaceId, repositories.workspaceId),
      ),
    )
    .innerJoin(workspaces, eq(workspaces.id, repositories.workspaceId))
    .where(and(...conditions))
    .orderBy(workspaces.slug, projects.slug, repositories.id)
    .limit(20);

  if (rows.length === 0) {
    throw new AppError("NOT_CONNECTED_OR_NOT_AUTHORIZED");
  }
  if (rows.length > 1) {
    throw new AppError("REPOSITORY_CONTEXT_AMBIGUOUS", {
      meta: {
        candidates: rows.map((row) => ({
          workspace: { id: row.workspaceId, slug: row.workspaceSlug },
          project: { slug: row.projectSlug },
          repository: {
            fullName: row.fullName,
            externalRepositoryId: row.externalRepositoryId,
          },
        })),
      },
    });
  }

  const row = rows[0]!;
  return {
    workspace: { id: row.workspaceId, slug: row.workspaceSlug },
    project: {
      id: row.projectId,
      slug: row.projectSlug,
      name: row.projectName,
    },
    repository: {
      id: row.repositoryId,
      provider: row.provider,
      externalRepositoryId: row.externalRepositoryId,
      owner: row.owner,
      name: row.name,
      fullName: row.fullName,
      defaultBranch: row.defaultBranch,
      htmlUrl: row.htmlUrl,
    },
  };
}

export async function resolveAuthorizedWorkspace(
  input: {
    authorization: AgentAuthorization;
    workspaceHint?: string | null;
  },
  executor: DbExecutor = db(),
): Promise<{ id: string; slug: string }> {
  const ids = [...input.authorization.authorizedWorkspaceIds];
  const hint = input.workspaceHint?.trim() || null;
  if (ids.length === 0 || (hint === null && ids.length !== 1)) {
    throw new AppError("AGENT_CONTEXT_REQUIRED");
  }

  const condition =
    hint === null
      ? and(inArray(workspaces.id, ids), eq(workspaces.id, ids[0]!))
      : and(
          inArray(workspaces.id, ids),
          sql`lower(${workspaces.slug}) = lower(${hint})`,
        );
  const rows = await executor
    .select({ id: workspaces.id, slug: workspaces.slug })
    .from(workspaces)
    .where(condition)
    .limit(1);

  const workspace = rows[0];
  if (workspace === undefined) {
    throw new AppError("NOT_CONNECTED_OR_NOT_AUTHORIZED");
  }
  return workspace;
}
