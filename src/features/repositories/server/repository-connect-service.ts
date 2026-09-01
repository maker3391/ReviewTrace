import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { githubInstallations, projects, repositories } from "@/db/schema";
import { listWorkspaceGithubRepositories } from "@/features/repositories/server/github-installation-service";
import { resolveRepositoryContext } from "@/features/repositories/server/repository-context-service";
import { resolveIngestRepository } from "@/features/repositories/server/repository-upsert";
import { AppError } from "@/lib/errors";
import {
  getInstallationRepository,
  type GithubRepositoryMetadata,
} from "@/lib/github/app";

export interface ConnectedRepository {
  repositoryId: string;
  projectId: string;
  fullName: string;
  idempotent: boolean;
}

async function connectVerifiedGithubRepository(
  input: {
    workspaceId: string;
    projectId: string;
    repository: GithubRepositoryMetadata;
  },
  executor: DbExecutor,
): Promise<ConnectedRepository> {
  const project = await executor
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (project.length !== 1) throw new AppError("PROJECT_NOT_FOUND");

  const byId = await resolveRepositoryContext(
    input.workspaceId,
    {
      provider: "GITHUB",
      externalRepositoryId: input.repository.externalRepositoryId,
    },
    executor,
  );
  if (byId !== null && byId.project.id !== input.projectId)
    throw new AppError("REPOSITORY_PROJECT_MISMATCH");

  const sameName = await executor
    .select({ externalRepositoryId: repositories.externalRepositoryId })
    .from(repositories)
    .where(
      and(
        eq(repositories.workspaceId, input.workspaceId),
        eq(repositories.provider, "GITHUB"),
        sql`lower(${repositories.fullName}) = lower(${input.repository.fullName})`,
      ),
    );
  if (
    sameName.some(
      (row) =>
        row.externalRepositoryId !== input.repository.externalRepositoryId &&
        !row.externalRepositoryId.startsWith("fullname:"),
    )
  ) {
    throw new AppError("REPOSITORY_IDENTITY_CONFLICT");
  }

  const repositoryId = await executor.transaction((tx) =>
    resolveIngestRepository(tx, input.workspaceId, input.projectId, {
      provider: "GITHUB",
      externalRepositoryId: input.repository.externalRepositoryId,
      owner: input.repository.owner,
      name: input.repository.name,
      fullName: input.repository.fullName,
      defaultBranch: input.repository.defaultBranch,
      htmlUrl: input.repository.htmlUrl,
    }),
  );
  return {
    repositoryId,
    projectId: input.projectId,
    fullName: input.repository.fullName,
    idempotent: byId !== null,
  };
}

/** UI picker가 보낸 ID를 installation access token으로 다시 읽어 spoofing을 막는다. */
export async function connectGithubRepository(
  input: {
    workspaceId: string;
    projectId: string;
    installationId: string;
    externalRepositoryId: string;
  },
  executor: DbExecutor = db(),
): Promise<ConnectedRepository> {
  if (
    !/^\d+$/.test(input.installationId) ||
    !/^\d+$/.test(input.externalRepositoryId)
  ) {
    throw new AppError("GITHUB_REPOSITORY_NOT_AUTHORIZED");
  }
  const installation = await executor
    .select({ id: githubInstallations.id })
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.workspaceId, input.workspaceId),
        eq(githubInstallations.installationId, input.installationId),
      ),
    )
    .limit(1);
  if (installation.length !== 1)
    throw new AppError("GITHUB_INSTALLATION_NOT_FOUND");
  let repository: GithubRepositoryMetadata;
  try {
    repository = await getInstallationRepository(
      input.installationId,
      input.externalRepositoryId,
    );
  } catch {
    throw new AppError("GITHUB_REPOSITORY_NOT_AUTHORIZED");
  }
  return connectVerifiedGithubRepository({ ...input, repository }, executor);
}

/** MCP/Agent의 owner/name은 Workspace installation이 실제로 볼 수 있을 때만 연결한다. */
export async function connectGithubRepositoryByFullName(
  input: {
    workspaceId: string;
    projectId: string;
    fullName: string;
  },
  executor: DbExecutor = db(),
): Promise<ConnectedRepository> {
  let accessible: Awaited<ReturnType<typeof listWorkspaceGithubRepositories>>;
  try {
    accessible = await listWorkspaceGithubRepositories(
      input.workspaceId,
      executor,
    );
  } catch {
    throw new AppError("GITHUB_REPOSITORY_NOT_AUTHORIZED");
  }
  const matches = [
    ...new Map(
      accessible
        .filter(
          (repository) =>
            repository.fullName.toLowerCase() === input.fullName.toLowerCase(),
        )
        .map((repository) => [repository.externalRepositoryId, repository]),
    ).values(),
  ];
  if (matches.length !== 1)
    throw new AppError("GITHUB_REPOSITORY_NOT_AUTHORIZED");
  return connectVerifiedGithubRepository(
    { ...input, repository: matches[0]! },
    executor,
  );
}

/** 테스트 및 운영 진단용: 연결된 행을 tenant/project를 겹쳐 읽는다. */
export async function findConnectedRepository(
  workspaceId: string,
  projectId: string,
  repositoryId: string,
  executor: DbExecutor = db(),
): Promise<boolean> {
  const rows = await executor
    .select({ id: repositories.id })
    .from(repositories)
    .where(
      and(
        eq(repositories.id, repositoryId),
        eq(repositories.workspaceId, workspaceId),
        eq(repositories.projectId, projectId),
      ),
    )
    .limit(1);
  return rows.length === 1;
}
