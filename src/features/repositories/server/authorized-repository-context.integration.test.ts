import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  agentCredentials,
  agentPrincipals,
  agentWorkspaceGrants,
  apiKeys,
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
  users,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import { resolveAuthorizedRepositoryContext } from "@/features/repositories/server/authorized-repository-context-service";
import {
  authenticateAgent,
  requireAgentCapability,
  type AgentAuthorization,
} from "@/lib/api/api-key-auth";
import {
  issueUserAgentCredential,
  setUserAgentWorkspaceGrant,
} from "@/features/agent-credentials/server/agent-credential-service";
import {
  requireAuthorizedIssueWorkspace,
  requireAuthorizedReviewWorkspace,
} from "@/lib/api/agent-resource-authorization";
import {
  generateAgentCredential,
  generateApiKey,
} from "@/lib/api/api-key-token";
import { isAppError } from "@/lib/errors";

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

async function rejectedReason(promise: Promise<unknown>) {
  try {
    await promise;
    return null;
  } catch (error) {
    return isAppError(error) ? error.reason : String(error);
  }
}

function errorChainText(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join("\n");
}

interface Seed {
  userId: string;
  a: { workspaceId: string; slug: string; projectId: string };
  b: { workspaceId: string; slug: string; projectId: string };
  c: { workspaceId: string; slug: string; projectId: string };
}

async function seedTenants(tx: DbExecutor): Promise<Seed> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [user] = await tx
    .insert(users)
    .values({ email: `agent-tenant-${suffix}@example.test`, name: "Agent User" })
    .returning({ id: users.id });
  const created = await tx
    .insert(workspaces)
    .values(["a", "b", "c"].map((key) => ({
      slug: `agent-${key}-${suffix}`,
      name: key.toUpperCase(),
      createdBy: user!.id,
    })))
    .returning({ id: workspaces.id, slug: workspaces.slug });
  await tx.insert(workspaceMembers).values(
    created.slice(0, 2).map((workspace) => ({
      workspaceId: workspace.id,
      userId: user!.id,
      role: "OWNER" as const,
    })),
  );
  const projectRows = await tx
    .insert(projects)
    .values(created.map((workspace, index) => ({
      workspaceId: workspace.id,
      name: `Project ${index}`,
      slug: `project-${index}`,
    })))
    .returning({ id: projects.id, workspaceId: projects.workspaceId });
  const item = (index: number) => ({
    workspaceId: created[index]!.id,
    slug: created[index]!.slug,
    projectId: projectRows.find(
      (project) => project.workspaceId === created[index]!.id,
    )!.id,
  });
  return { userId: user!.id, a: item(0), b: item(1), c: item(2) };
}

async function issuePrincipal(
  tx: DbExecutor,
  seed: Seed,
  grants: readonly string[],
  reviewLanguage: "ko" | "en" = "en",
): Promise<{ token: string; principalId: string; credentialId: string }> {
  const [principal] = await tx
    .insert(agentPrincipals)
    .values({
      type: "USER_AGENT",
      ownerUserId: seed.userId,
      displayName: "Codex",
      reviewLanguage,
    })
    .returning({ id: agentPrincipals.id });
  if (grants.length > 0) {
    await tx.insert(agentWorkspaceGrants).values(
      grants.map((workspaceId) => ({
        principalId: principal!.id,
        workspaceId,
        grantedByUserId: seed.userId,
      })),
    );
  }
  const generated = generateAgentCredential();
  const [credential] = await tx
    .insert(agentCredentials)
    .values({
      principalId: principal!.id,
      name: "one-key",
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      capabilityScopes: ["READ", "WRITE"],
    })
    .returning({ id: agentCredentials.id });
  return {
    token: generated.plainToken,
    principalId: principal!.id,
    credentialId: credential!.id,
  };
}

function request(token: string) {
  return new Request("https://example.test/api/v1/knowledge/context", {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function addRepository(
  tx: DbExecutor,
  context: Seed["a"],
  input: { externalId: string; fullName: string },
) {
  const [owner, name] = input.fullName.split("/");
  const [repository] = await tx
    .insert(repositories)
    .values({
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      provider: "GITHUB",
      externalRepositoryId: input.externalId,
      owner: owner!,
      name: name!,
      fullName: input.fullName,
    })
    .returning({ id: repositories.id });
  return repository!.id;
}

describe.skipIf(!enabled)("principal Agent authorized Repository context", () => {
  it("schema rejects a USER_AGENT without an owner", async () => {
    await inRollback(async (tx) => {
      const error = await tx
        .insert(agentPrincipals)
        .values({
          type: "USER_AGENT",
          ownerUserId: null,
          displayName: "invalid",
        })
        .catch((caught) => caught);
      expect(errorChainText(error)).toContain(
        "agent_principals_owner_type_check",
      );
    });
  });

  it("CASE 1/2: one credential resolves different repositories to their own Workspace and Project", async () => {
    await inRollback(async (tx) => {
      const seed = await seedTenants(tx);
      await addRepository(tx, seed.a, {
        externalId: "1001",
        fullName: "acme/repo-a",
      });
      await addRepository(tx, seed.b, {
        externalId: "1002",
        fullName: "acme/repo-b",
      });
      const credential = await issuePrincipal(
        tx,
        seed,
        [seed.a.workspaceId, seed.b.workspaceId],
        "ko",
      );
      const authorization = await authenticateAgent(
        request(credential.token),
        tx,
      );
      expect(authorization.reviewLanguage).toBe("ko");

      const a = await resolveAuthorizedRepositoryContext(
        {
          authorization,
          identity: { provider: "GITHUB", fullName: "acme/repo-a" },
        },
        tx,
      );
      const b = await resolveAuthorizedRepositoryContext(
        {
          authorization,
          identity: { provider: "GITHUB", fullName: "acme/repo-b" },
        },
        tx,
      );
      expect(a).toMatchObject({
        workspace: { id: seed.a.workspaceId },
        project: { id: seed.a.projectId },
      });
      expect(b).toMatchObject({
        workspace: { id: seed.b.workspaceId },
        project: { id: seed.b.projectId },
      });
    });
  });

  it("CASE 3/4/5: duplicate identity is ambiguous, and only an authorized matching hint resolves it", async () => {
    await inRollback(async (tx) => {
      const seed = await seedTenants(tx);
      await addRepository(tx, seed.a, {
        externalId: "same-77",
        fullName: "acme/shared",
      });
      await addRepository(tx, seed.b, {
        externalId: "same-77",
        fullName: "acme/shared",
      });
      await addRepository(tx, seed.c, {
        externalId: "same-77",
        fullName: "acme/shared",
      });
      const credential = await issuePrincipal(tx, seed, [
        seed.a.workspaceId,
        seed.b.workspaceId,
      ]);
      const authorization = await authenticateAgent(
        request(credential.token),
        tx,
      );
      const identity = { provider: "GITHUB" as const, fullName: "acme/shared" };

      const ambiguous = await resolveAuthorizedRepositoryContext(
        { authorization, identity },
        tx,
      ).catch((error) => error);
      expect(isAppError(ambiguous) && ambiguous.reason).toBe(
        "REPOSITORY_CONTEXT_AMBIGUOUS",
      );
      expect(
        isAppError(ambiguous)
          ? (
              ambiguous.meta as {
                candidates: Array<{ workspace: { slug: string } }>;
              }
            ).candidates.map((candidate) => candidate.workspace.slug)
          : [],
      ).toEqual([seed.a.slug, seed.b.slug]);
      await expect(
        resolveAuthorizedRepositoryContext(
          { authorization, identity, workspaceHint: seed.a.slug },
          tx,
        ),
      ).resolves.toMatchObject({ workspace: { id: seed.a.workspaceId } });
      expect(
        await rejectedReason(
          resolveAuthorizedRepositoryContext(
            { authorization, identity, workspaceHint: seed.c.slug },
            tx,
          ),
        ),
      ).toBe("NOT_CONNECTED_OR_NOT_AUTHORIZED");
    });
  });

  it("CASE 6/7/9/12: live membership, explicit grant, unknown repository, and revocation are enforced immediately", async () => {
    await inRollback(async (tx) => {
      const seed = await seedTenants(tx);
      await addRepository(tx, seed.a, {
        externalId: "live-1",
        fullName: "acme/live",
      });
      const credential = await issuePrincipal(tx, seed, [seed.a.workspaceId]);
      const initial = await authenticateAgent(request(credential.token), tx);
      expect(initial.authorizedWorkspaceIds).toEqual([seed.a.workspaceId]);
      expect(
        await rejectedReason(
          resolveAuthorizedRepositoryContext(
            {
              authorization: initial,
              identity: { provider: "GITHUB", fullName: "acme/unknown" },
            },
            tx,
          ),
        ),
      ).toBe("NOT_CONNECTED_OR_NOT_AUTHORIZED");

      await tx
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, seed.a.workspaceId),
            eq(workspaceMembers.userId, seed.userId),
          ),
        );
      expect(
        (await authenticateAgent(request(credential.token), tx))
          .authorizedWorkspaceIds,
      ).toEqual([]);

      await tx
        .update(agentCredentials)
        .set({ revokedAt: new Date() })
        .where(eq(agentCredentials.id, credential.credentialId));
      expect(
        await rejectedReason(authenticateAgent(request(credential.token), tx)),
      ).toBe("AGENT_UNAUTHORIZED");

      const seedWithoutGrant = await seedTenants(tx);
      const noGrant = await issuePrincipal(tx, seedWithoutGrant, []);
      expect(
        (await authenticateAgent(request(noGrant.token), tx))
          .authorizedWorkspaceIds,
      ).toEqual([]);
    });
  });

  it("CASE 8: legacy key remains a single-Workspace authorization", async () => {
    await inRollback(async (tx) => {
      const seed = await seedTenants(tx);
      const generated = generateApiKey();
      await tx.insert(apiKeys).values({
        workspaceId: seed.a.workspaceId,
        name: "legacy",
        keyPrefix: generated.keyPrefix,
        keyHash: generated.keyHash,
      });
      const authorization = await authenticateAgent(
        request(generated.plainToken),
        tx,
      );
      expect(authorization).toMatchObject({
        model: "LEGACY_WORKSPACE",
        authorizedWorkspaceIds: [seed.a.workspaceId],
        workspaceId: seed.a.workspaceId,
      });
    });
  });

  it("CASE 10: known Issue/Review UUID cannot cross the authorized Workspace set", async () => {
    await inRollback(async (tx) => {
      const seed = await seedTenants(tx);
      const repositoryId = await addRepository(tx, seed.b, {
        externalId: "uuid-1",
        fullName: "acme/uuid",
      });
      const [review] = await tx
        .insert(reviewSessions)
        .values({
          workspaceId: seed.b.workspaceId,
          repositoryId,
          targetType: "REPOSITORY",
          reviewerType: "AGENT",
          reviewerName: "test",
        })
        .returning({ id: reviewSessions.id });
      const [issue] = await tx
        .insert(reviewIssues)
        .values({
          workspaceId: seed.b.workspaceId,
          repositoryId,
          reviewSessionId: review!.id,
          title: "private",
          severity: "HIGH",
          category: "SECURITY",
        })
        .returning({ id: reviewIssues.id });
      const authorization: AgentAuthorization = {
        model: "PRINCIPAL",
        credentialId: crypto.randomUUID(),
        principalId: crypto.randomUUID(),
        principalType: "USER_AGENT",
        actorName: "test",
        capabilities: ["READ", "WRITE"],
        reviewLanguage: "en",
        authorizedWorkspaceIds: [seed.a.workspaceId],
      };
      await expect(
        requireAuthorizedIssueWorkspace(authorization, issue!.id, tx),
      ).rejects.toThrow("RESOURCE_NOT_FOUND");
      await expect(
        requireAuthorizedReviewWorkspace(authorization, review!.id, tx),
      ).rejects.toThrow("RESOURCE_NOT_FOUND");
    });
  });

  it("USER_AGENT issuance keeps grants on the principal across credential rotation", async () => {
    await inRollback(async (tx) => {
      const seed = await seedTenants(tx);
      const first = await issueUserAgentCredential(
        {
          userId: seed.userId,
          displayName: "Codex",
          name: "first",
          expiresAt: null,
          capabilityScopes: ["READ", "WRITE"],
          reviewLanguage: "ko",
        },
        tx,
      );
      await expect(
        setUserAgentWorkspaceGrant(
          {
            ownerUserId: seed.userId,
            principalOwnerUserId: seed.userId,
            workspaceId: seed.c.workspaceId,
            granted: true,
          },
          tx,
        ),
      ).rejects.toThrow("WORKSPACE_OWNER_REQUIRED");
      await setUserAgentWorkspaceGrant(
        {
          ownerUserId: seed.userId,
          principalOwnerUserId: seed.userId,
          workspaceId: seed.a.workspaceId,
          granted: true,
        },
        tx,
      );
      const second = await issueUserAgentCredential(
        {
          userId: seed.userId,
          displayName: "Codex",
          name: "rotated",
          expiresAt: null,
          capabilityScopes: ["READ"],
          reviewLanguage: "ko",
        },
        tx,
      );

      const firstAuthorization = await authenticateAgent(
        request(first.plainToken),
        tx,
      );
      const secondAuthorization = await authenticateAgent(
        request(second.plainToken),
        tx,
      );
      expect(firstAuthorization.principalId).toBe(
        secondAuthorization.principalId,
      );
      expect(secondAuthorization.authorizedWorkspaceIds).toEqual([
        seed.a.workspaceId,
      ]);
      expect(() => requireAgentCapability(secondAuthorization, "WRITE")).toThrow(
        "AGENT_CAPABILITY_REQUIRED",
      );

      const stored = await tx
        .select({ keyHash: agentCredentials.keyHash })
        .from(agentCredentials)
        .where(eq(agentCredentials.id, first.id));
      expect(stored[0]?.keyHash).not.toContain(first.plainToken);
    });
  });

  it("SERVICE_AGENT uses explicit grants without inheriting human membership", async () => {
    await inRollback(async (tx) => {
      const seed = await seedTenants(tx);
      const [principal] = await tx
        .insert(agentPrincipals)
        .values({
          type: "SERVICE_AGENT",
          ownerUserId: null,
          displayName: "CI service",
        })
        .returning({ id: agentPrincipals.id });
      await tx.insert(agentWorkspaceGrants).values({
        principalId: principal!.id,
        workspaceId: seed.c.workspaceId,
        grantedByUserId: seed.userId,
      });
      const generated = generateAgentCredential();
      await tx.insert(agentCredentials).values({
        principalId: principal!.id,
        name: "service",
        keyPrefix: generated.keyPrefix,
        keyHash: generated.keyHash,
        capabilityScopes: ["READ"],
      });

      await expect(
        authenticateAgent(request(generated.plainToken), tx),
      ).resolves.toMatchObject({
        principalType: "SERVICE_AGENT",
        authorizedWorkspaceIds: [seed.c.workspaceId],
      });
    });
  });
});
