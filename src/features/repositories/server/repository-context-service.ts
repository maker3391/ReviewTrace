import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { projects, repositories, workspaces } from "@/db/schema";
import type { ScmProvider } from "@/types/review";

export interface RepositoryContext {
  workspace: { id: string; slug: string };
  project: { id: string; slug: string; name: string };
  repository: {
    id: string;
    provider: ScmProvider;
    externalRepositoryId: string;
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
    htmlUrl: string | null;
  };
}

export interface RepositoryIdentity {
  provider: ScmProvider;
  repositoryId?: string | null;
  externalRepositoryId?: string | null;
  fullName?: string | null;
}

/** API Key가 정한 Workspace 안에서 Repository → Project → Workspace를 한 번에 확인한다. */
export async function resolveRepositoryContext(
  workspaceId: string,
  identity: RepositoryIdentity,
  executor: DbExecutor = db(),
): Promise<RepositoryContext | null> {
  const identityCondition = identity.repositoryId
    ? eq(repositories.id, identity.repositoryId)
    : identity.externalRepositoryId
      ? eq(repositories.externalRepositoryId, identity.externalRepositoryId)
      : identity.fullName
        ? sql`lower(${repositories.fullName}) = lower(${identity.fullName})`
        : undefined;
  if (identityCondition === undefined) return null;

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
    .where(
      and(
        eq(repositories.workspaceId, workspaceId),
        eq(repositories.provider, identity.provider),
        eq(repositories.isActive, true),
        identityCondition,
      ),
    )
    .limit(identity.externalRepositoryId ? 1 : 2);

  // 같은 fullname이 두 numeric identity를 가리키면 임의로 고르지 않는다.
  if (rows.length !== 1) return null;
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
