import { beforeAll, describe, expect, it } from "vitest";

import { db, type DbExecutor } from "@/db";
import { projects, repositories, users, workspaces } from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import { findKnowledgeContext } from "@/features/knowledge/server/knowledge-context-query";
import { resolveRepositoryContext } from "@/features/repositories/server/repository-context-service";

const enabled = process.env.DB_INTEGRATION === "true";
beforeAll(() => {
  if (enabled) loadIntegrationDbEnv();
});
class Rollback extends Error {}
async function inRollback(run: (tx: DbExecutor) => Promise<void>) {
  try {
    await db().transaction(async (tx) => {
      await run(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

describe.skipIf(!enabled)("Repository context tenant resolution", () => {
  it("registered Repository → Project → Workspace를 resolve하고 다른 Workspace 행은 보지 않는다", async () => {
    await inRollback(async (tx) => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const [user] = await tx
        .insert(users)
        .values({ email: `ctx-${suffix}@example.test` })
        .returning({ id: users.id });
      const createdWorkspaces = await tx
        .insert(workspaces)
        .values([
          { slug: `ctx-a-${suffix}`, name: "A", createdBy: user!.id },
          { slug: `ctx-b-${suffix}`, name: "B", createdBy: user!.id },
        ])
        .returning({ id: workspaces.id, slug: workspaces.slug });
      const [a, b] = createdWorkspaces;
      const createdProjects = await tx
        .insert(projects)
        .values([
          { workspaceId: a!.id, slug: "alpha", name: "Alpha" },
          { workspaceId: b!.id, slug: "beta", name: "Beta" },
        ])
        .returning({ id: projects.id, workspaceId: projects.workspaceId });
      const pa = createdProjects.find(
        (project) => project.workspaceId === a!.id,
      )!;
      const pb = createdProjects.find(
        (project) => project.workspaceId === b!.id,
      )!;
      await tx.insert(repositories).values([
        {
          workspaceId: a!.id,
          projectId: pa.id,
          provider: "GITHUB",
          externalRepositoryId: "100",
          owner: "acme",
          name: "app",
          fullName: "acme/app",
          defaultBranch: "main",
        },
        {
          workspaceId: b!.id,
          projectId: pb.id,
          provider: "GITHUB",
          externalRepositoryId: "200",
          owner: "acme",
          name: "app",
          fullName: "acme/app",
          defaultBranch: "main",
        },
      ]);

      const context = await resolveRepositoryContext(
        a!.id,
        { provider: "GITHUB", fullName: "ACME/APP" },
        tx,
      );
      expect(context).toMatchObject({
        workspace: { id: a!.id },
        project: { slug: "alpha" },
        repository: { externalRepositoryId: "100" },
      });
      expect(
        await resolveRepositoryContext(
          a!.id,
          { provider: "GITHUB", externalRepositoryId: "200" },
          tx,
        ),
      ).toBeNull();

      const knowledge = await findKnowledgeContext(
        {
          workspaceId: a!.id,
          query: {
            projectSlug: null,
            repository: "acme/app",
            repositoryId: null,
            category: null,
            pattern: null,
            severity: null,
            limit: 20,
          },
        },
        tx,
      );
      expect(knowledge.scope.repository).toMatchObject({
        requested: "acme/app",
        resolved: true,
      });
      expect(knowledge.scope.project).toMatchObject({
        resolved: true,
        slug: "alpha",
        resolutionSource: "REPOSITORY",
      });
    });
  });
});
