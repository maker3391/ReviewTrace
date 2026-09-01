import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  githubInstallationRequests,
  githubInstallations,
  projects,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import {
  exchangeGithubAppCode,
  getGithubInstallation,
  githubAppInstallationUrl,
  listInstallationRepositories,
  createInstallationToken,
  getInstallationRepository,
  userCanManageInstallation,
  type GithubRepositoryMetadata,
} from "@/lib/github/app";
import { AppError } from "@/lib/errors";

const STATE_TTL_MS = 10 * 60 * 1000;
const stateHash = (state: string) =>
  createHash("sha256").update(state).digest("hex");

export interface GithubInstallationSummary {
  id: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
}

export async function beginGithubInstallation(
  input: {
    workspaceId: string;
    projectId: string;
    userId: string;
  },
  executor: DbExecutor = db(),
): Promise<string> {
  const allowed = await executor
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, input.userId),
      ),
    )
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (allowed.length !== 1) throw new AppError("GITHUB_CALLBACK_INVALID");
  const state = randomBytes(32).toString("base64url");
  await executor.insert(githubInstallationRequests).values({
    stateHash: stateHash(state),
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    userId: input.userId,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  return githubAppInstallationUrl(state);
}

/** user token은 이 함수 안에서 설치 소유권을 확인한 뒤 저장하지 않고 버린다. */
export async function completeGithubInstallation(
  input: {
    userId: string;
    state: string;
    code: string;
    installationId: string;
  },
  executor: DbExecutor = db(),
): Promise<{ workspaceSlug: string; projectSlug: string }> {
  const pendingRows = await executor
    .select({
      id: githubInstallationRequests.id,
      workspaceId: githubInstallationRequests.workspaceId,
      projectId: githubInstallationRequests.projectId,
      projectSlug: projects.slug,
    })
    .from(githubInstallationRequests)
    .innerJoin(
      projects,
      and(
        eq(projects.id, githubInstallationRequests.projectId),
        eq(projects.workspaceId, githubInstallationRequests.workspaceId),
      ),
    )
    .innerJoin(
      workspaceMembers,
      and(
        eq(
          workspaceMembers.workspaceId,
          githubInstallationRequests.workspaceId,
        ),
        eq(workspaceMembers.userId, githubInstallationRequests.userId),
      ),
    )
    .where(
      and(
        eq(githubInstallationRequests.stateHash, stateHash(input.state)),
        eq(githubInstallationRequests.userId, input.userId),
        isNull(githubInstallationRequests.consumedAt),
        gt(githubInstallationRequests.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const pending = pendingRows[0];
  if (pending === undefined) throw new AppError("GITHUB_CALLBACK_INVALID");

  const userToken = await exchangeGithubAppCode(input.code);
  if (!(await userCanManageInstallation(userToken, input.installationId))) {
    throw new AppError("GITHUB_CALLBACK_INVALID");
  }
  const metadata = await getGithubInstallation(input.installationId);

  return executor.transaction(async (tx) => {
    const consumed = await tx
      .update(githubInstallationRequests)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(githubInstallationRequests.id, pending.id),
          isNull(githubInstallationRequests.consumedAt),
        ),
      )
      .returning({ id: githubInstallationRequests.id });
    if (consumed.length !== 1) throw new AppError("GITHUB_CALLBACK_INVALID");

    const existing = await tx
      .select({ workspaceId: githubInstallations.workspaceId })
      .from(githubInstallations)
      .where(eq(githubInstallations.installationId, input.installationId))
      .limit(1);
    if (
      existing[0] !== undefined &&
      existing[0].workspaceId !== pending.workspaceId
    ) {
      throw new AppError("GITHUB_INSTALLATION_CONFLICT");
    }
    await tx
      .insert(githubInstallations)
      .values({
        workspaceId: pending.workspaceId,
        installationId: metadata.installationId,
        accountId: metadata.accountId,
        accountLogin: metadata.accountLogin,
        accountType: metadata.accountType,
        repositorySelection: metadata.repositorySelection,
        createdBy: input.userId,
      })
      .onConflictDoUpdate({
        target: githubInstallations.installationId,
        set: {
          accountId: metadata.accountId,
          accountLogin: metadata.accountLogin,
          accountType: metadata.accountType,
          repositorySelection: metadata.repositorySelection,
          updatedAt: new Date(),
        },
      });

    const workspace = await tx
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, pending.workspaceId))
      .limit(1);
    const workspaceSlug = workspace[0]?.slug;
    if (workspaceSlug === undefined)
      throw new AppError("GITHUB_CALLBACK_INVALID");
    return { workspaceSlug, projectSlug: pending.projectSlug };
  });
}

export async function listWorkspaceGithubInstallations(
  workspaceId: string,
  executor: DbExecutor = db(),
): Promise<GithubInstallationSummary[]> {
  return executor
    .select({
      id: githubInstallations.id,
      installationId: githubInstallations.installationId,
      accountLogin: githubInstallations.accountLogin,
      accountType: githubInstallations.accountType,
    })
    .from(githubInstallations)
    .where(eq(githubInstallations.workspaceId, workspaceId));
}

export async function listWorkspaceGithubRepositories(
  workspaceId: string,
  executor: DbExecutor = db(),
): Promise<(GithubRepositoryMetadata & { installationId: string })[]> {
  const installations = await listWorkspaceGithubInstallations(
    workspaceId,
    executor,
  );
  const groups = await Promise.all(
    installations.map(async (installation) =>
      (await listInstallationRepositories(installation.installationId)).map(
        (repository) => ({
          ...repository,
          installationId: installation.installationId,
        }),
      ),
    ),
  );
  return groups.flat().sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** Evidence가 private source를 읽을 때 쓸, 이 Workspace에 한정된 단기 token. */
export async function findWorkspaceRepositoryToken(
  workspaceId: string,
  externalRepositoryId: string,
  executor: DbExecutor = db(),
): Promise<string | null> {
  const installations = await listWorkspaceGithubInstallations(
    workspaceId,
    executor,
  );
  for (const installation of installations) {
    try {
      await getInstallationRepository(
        installation.installationId,
        externalRepositoryId,
      );
      return (await createInstallationToken(installation.installationId)).token;
    } catch {
      // 이 installation에 허용되지 않은 저장소다. 다른 installation만 계속 확인한다.
    }
  }
  return null;
}
