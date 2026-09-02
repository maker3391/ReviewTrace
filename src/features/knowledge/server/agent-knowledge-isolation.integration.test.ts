import { beforeAll, describe, expect, it } from "vitest";

import { db, type DbExecutor } from "@/db";
import {
  agentCredentials,
  agentPrincipals,
  agentWorkspaceGrants,
  knowledgePages,
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
  users,
  workspaces,
} from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import { findKnowledgeContext } from "@/features/knowledge/server/knowledge-context-query";
import { searchAgentIssues } from "@/features/issues/server/issue-agent-query";
import { resolveAuthorizedRepositoryContext } from "@/features/repositories/server/authorized-repository-context-service";
import {
  authenticateAgent,
  requireAgentCapability,
} from "@/lib/api/api-key-auth";
import { generateAgentCredential } from "@/lib/api/api-key-token";
import { isAppError } from "@/lib/errors";

/**
 * Agent 읽기 경로의 Tenant 격리.
 *
 * 🔴 **목록에 남의 행이 없다」로 끝내지 않는다.** `frequentPatterns` 는 행을 돌려주지 않고
 * **세어서** 돌려주므로, 목록이 깨끗해도 숫자 하나가 다른 Tenant 의 Issue 수를 알려 줄 수
 * 있다. 그래서 이 파일은 **집계값까지** 맞대어 본다 — 집계 유출도 유출이다(CLAUDE.md 11).
 *
 * `DB_INTEGRATION=true pnpm test` 일 때만 돈다. 모든 시험은 되돌아가는 Transaction 안에서
 * 돌고 행을 남기지 않는다.
 */
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

const PATTERN = "SHARED_PATTERN_KEY";

interface Tenant {
  workspaceId: string;
  slug: string;
  projectId: string;
  repositoryId: string;
  externalRepositoryId: string;
  fullName: string;
  issueIds: string[];
  token: string;
}

async function seedTenant(
  tx: DbExecutor,
  input: {
    userId: string;
    key: string;
    suffix: string;
    externalRepositoryId: string;
    fullName: string;
    /** 같은 `patternKey` 로 몇 건을 넣는가. 집계 비교의 근거다. */
    issueCount: number;
    capabilities: string[];
  },
): Promise<Tenant> {
  const slug = `knowledge-${input.key}-${input.suffix}`;
  const [workspace] = await tx
    .insert(workspaces)
    .values({ slug, name: input.key.toUpperCase(), createdBy: input.userId })
    .returning({ id: workspaces.id, slug: workspaces.slug });
  const [project] = await tx
    .insert(projects)
    .values({
      workspaceId: workspace!.id,
      name: `Project ${input.key}`,
      // 🔴 slug 는 Workspace 안에서만 unique 다 — 양쪽을 같은 이름으로 둬야
      // 「projectSlug 로 남의 Project 를 지목할 수 있는가」를 실제로 잰다.
      slug: "platform",
    })
    .returning({ id: projects.id });
  const [repository] = await tx
    .insert(repositories)
    .values({
      workspaceId: workspace!.id,
      projectId: project!.id,
      provider: "GITHUB",
      externalRepositoryId: input.externalRepositoryId,
      owner: input.fullName.split("/")[0]!,
      name: input.fullName.split("/")[1]!,
      fullName: input.fullName,
    })
    .returning({ id: repositories.id });
  const [review] = await tx
    .insert(reviewSessions)
    .values({
      workspaceId: workspace!.id,
      repositoryId: repository!.id,
      targetType: "REPOSITORY",
      reviewerType: "AGENT",
      reviewerName: `${input.key}-agent`,
    })
    .returning({ id: reviewSessions.id });
  const issues = await tx
    .insert(reviewIssues)
    .values(
      Array.from({ length: input.issueCount }, (_, index) => ({
        workspaceId: workspace!.id,
        repositoryId: repository!.id,
        reviewSessionId: review!.id,
        title: `${input.key.toUpperCase()}-ISSUE-${index}`,
        severity: "HIGH" as const,
        category: "SECURITY" as const,
        patternKey: PATTERN,
        filePath: `src/${input.key}.ts`,
        status: "RESOLVED" as const,
        resolutionSummary: `${input.key.toUpperCase()}-RESOLUTION-${index}`,
        resolvedAt: new Date(),
      })),
    )
    .returning({ id: reviewIssues.id });
  await tx.insert(knowledgePages).values({
    workspaceId: workspace!.id,
    projectId: null,
    slug: `rules-${input.suffix}`,
    title: `${input.key.toUpperCase()}-WIKI`,
    content: `${input.key.toUpperCase()}-WIKI-BODY`,
  });

  const [principal] = await tx
    .insert(agentPrincipals)
    .values({
      type: "SERVICE_AGENT",
      ownerUserId: null,
      displayName: `${input.key} agent`,
    })
    .returning({ id: agentPrincipals.id });
  await tx
    .insert(agentWorkspaceGrants)
    .values({ principalId: principal!.id, workspaceId: workspace!.id });
  const generated = generateAgentCredential();
  await tx.insert(agentCredentials).values({
    principalId: principal!.id,
    name: `${input.key}-key`,
    keyPrefix: generated.keyPrefix,
    keyHash: generated.keyHash,
    capabilityScopes: input.capabilities,
  });

  return {
    workspaceId: workspace!.id,
    slug: workspace!.slug,
    projectId: project!.id,
    repositoryId: repository!.id,
    externalRepositoryId: input.externalRepositoryId,
    fullName: input.fullName,
    issueIds: issues.map((row) => row.id),
    token: generated.plainToken,
  };
}

function request(token: string): Request {
  return new Request("https://example.test/api/v1/knowledge/context", {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function seedPair(tx: DbExecutor) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [user] = await tx
    .insert(users)
    .values({
      email: `knowledge-isolation-${suffix}@example.test`,
      name: "Isolation User",
    })
    .returning({ id: users.id });
  const a = await seedTenant(tx, {
    userId: user!.id,
    key: "alpha",
    suffix,
    externalRepositoryId: `9100${suffix.slice(-6).replace(/\D/g, "1")}1`,
    fullName: "isoorg/alpha-repo",
    issueCount: 1,
    capabilities: ["READ", "WRITE"],
  });
  const b = await seedTenant(tx, {
    userId: user!.id,
    key: "beta",
    suffix,
    externalRepositoryId: `9200${suffix.slice(-6).replace(/\D/g, "2")}2`,
    fullName: "isoorg/beta-repo",
    issueCount: 4,
    capabilities: ["READ", "WRITE"],
  });
  return { userId: user!.id, suffix, a, b };
}

describe.skipIf(!enabled)("Agent Knowledge tenant isolation", () => {
  it("🔴 Knowledge A ∩ Knowledge B = ∅ — 목록도 집계도 섞이지 않는다", async () => {
    await inRollback(async (tx) => {
      const { a, b } = await seedPair(tx);
      const query = {
        projectSlug: null,
        repository: null,
        repositoryId: null,
        category: null,
        severity: null,
        pattern: null,
        limit: 50,
      };

      const contextA = await findKnowledgeContext(
        {
          workspaceId: a.workspaceId,
          workspace: { id: a.workspaceId, slug: a.slug },
          authorizedRepositoryContext: null,
          query,
        },
        tx,
      );
      const contextB = await findKnowledgeContext(
        {
          workspaceId: b.workspaceId,
          workspace: { id: b.workspaceId, slug: b.slug },
          authorizedRepositoryContext: null,
          query,
        },
        tx,
      );

      const textA = JSON.stringify(contextA);
      const textB = JSON.stringify(contextB);
      expect(textA).not.toContain("BETA-");
      expect(textA).not.toContain(b.repositoryId);
      expect(textB).not.toContain("ALPHA-");
      expect(textB).not.toContain(a.repositoryId);
      for (const id of b.issueIds) expect(textA).not.toContain(id);
      for (const id of a.issueIds) expect(textB).not.toContain(id);

      /**
       * 🔴 **집계 유출도 유출이다.** 두 Workspace 가 같은 `patternKey` 를 쓰는데, 한쪽이
       * 다섯 건을 보면 그 숫자만으로 남의 Issue 수를 센 것이다. 목록이 비어 있어도
       * 여기가 새면 격리가 아니다.
       */
      const patternA = contextA.frequentPatterns.find(
        (pattern) => pattern.patternKey === PATTERN,
      );
      const patternB = contextB.frequentPatterns.find(
        (pattern) => pattern.patternKey === PATTERN,
      );
      expect(patternA?.occurrences).toBe(1);
      expect(patternB?.occurrences).toBe(4);
      expect(contextA.pastResolutions).toHaveLength(1);
      expect(contextB.pastResolutions).toHaveLength(4);
      expect(contextA.wiki.map((page) => page.title)).toEqual(["ALPHA-WIKI"]);
      expect(contextB.wiki.map((page) => page.title)).toEqual(["BETA-WIKI"]);
    });
  });

  it("🔴 같은 이름의 Project slug 를 지목해도 남의 Project 로 넘어가지 않는다", async () => {
    await inRollback(async (tx) => {
      const { a, b } = await seedPair(tx);
      const context = await findKnowledgeContext(
        {
          workspaceId: a.workspaceId,
          workspace: { id: a.workspaceId, slug: a.slug },
          authorizedRepositoryContext: null,
          query: {
            projectSlug: "platform",
            repository: null,
            repositoryId: null,
            category: null,
            severity: null,
            pattern: null,
            limit: 50,
          },
        },
        tx,
      );

      expect(context.scope.project.slug).toBe("platform");
      // 같은 이름이지만 A 의 Project 다 — 행도 숫자도 A 것뿐이다.
      expect(context.scope.workspace.id).toBe(a.workspaceId);
      expect(JSON.stringify(context)).not.toContain("BETA-");
      expect(
        context.frequentPatterns.find(
          (pattern) => pattern.patternKey === PATTERN,
        )?.occurrences,
      ).toBe(1);
      expect(JSON.stringify(context)).not.toContain(b.projectId);
    });
  });

  it("🔴 남의 Repository 는 numeric id·fullName·내부 UUID 중 무엇으로도 열리지 않는다", async () => {
    await inRollback(async (tx) => {
      const { a, b } = await seedPair(tx);
      const authorization = await authenticateAgent(request(a.token), tx);
      expect(authorization.authorizedWorkspaceIds).toEqual([a.workspaceId]);

      const reasons = await Promise.all(
        [
          { provider: "GITHUB" as const, repositoryId: b.repositoryId },
          {
            provider: "GITHUB" as const,
            externalRepositoryId: b.externalRepositoryId,
          },
          { provider: "GITHUB" as const, fullName: b.fullName },
          { provider: "GITHUB" as const, fullName: b.fullName.toUpperCase() },
          /**
           * 🔴 **numeric id 가 이름을 이긴다.** 남의 numeric id 에 내 이름을 붙여 보내도
           * numeric 조건이 먼저 걸려 내 저장소로 떨어지지 않는다 — 이름으로 우회하지 못한다.
           */
          {
            provider: "GITHUB" as const,
            externalRepositoryId: b.externalRepositoryId,
            fullName: a.fullName,
          },
        ].map((identity) =>
          resolveAuthorizedRepositoryContext({ authorization, identity }, tx)
            .then(() => "RESOLVED")
            .catch((error: unknown) =>
              isAppError(error) ? error.reason : String(error),
            ),
        ),
      );
      expect(reasons).toEqual([
        "NOT_CONNECTED_OR_NOT_AUTHORIZED",
        "NOT_CONNECTED_OR_NOT_AUTHORIZED",
        "NOT_CONNECTED_OR_NOT_AUTHORIZED",
        "NOT_CONNECTED_OR_NOT_AUTHORIZED",
        "NOT_CONNECTED_OR_NOT_AUTHORIZED",
      ]);

      // 🔴 Workspace hint 로 남의 Workspace 를 지목해도 authorized set 밖이라 열리지 않는다.
      expect(
        await resolveAuthorizedRepositoryContext(
          {
            authorization,
            identity: { provider: "GITHUB", fullName: a.fullName },
            workspaceHint: b.slug,
          },
          tx,
        )
          .then(() => "RESOLVED")
          .catch((error: unknown) =>
            isAppError(error) ? error.reason : String(error),
          ),
      ).toBe("NOT_CONNECTED_OR_NOT_AUTHORIZED");
    });
  });

  it("🔴 Issue 검색은 남의 Repository 이름을 Filter 로 넣어도 남의 Issue 를 주지 않는다", async () => {
    await inRollback(async (tx) => {
      const { a, b } = await seedPair(tx);
      const base = {
        status: null,
        severity: null,
        category: null,
        patternKey: null,
        q: null,
        limit: 50,
      };

      const own = await searchAgentIssues(
        a.workspaceId,
        { ...base, repository: a.fullName },
        tx,
      );
      expect(own.map((issue) => issue.id)).toEqual(a.issueIds);

      /**
       * 🔴 `repository` 는 Filter 일 뿐 권한 근거가 아니다. Workspace 조건이 함께 걸려
       * 남의 이름을 넣어도 결과가 **비어서** 나간다.
       */
      const foreignName = await searchAgentIssues(
        a.workspaceId,
        { ...base, repository: b.fullName },
        tx,
      );
      expect(foreignName).toEqual([]);

      // `q` 의 LIKE 와일드카드로도 Workspace 를 넘지 못한다.
      const wildcard = await searchAgentIssues(
        a.workspaceId,
        { ...base, repository: null, q: "%" },
        tx,
      );
      expect(wildcard).toEqual([]);

      const patternWide = await searchAgentIssues(
        a.workspaceId,
        { ...base, repository: null, patternKey: PATTERN },
        tx,
      );
      expect(patternWide.map((issue) => issue.id)).toEqual(a.issueIds);
      expect(JSON.stringify(patternWide)).not.toContain("BETA-");
    });
  });

  it("🔴 READ 만 가진 자격은 쓰기 경계를 넘지 못한다", async () => {
    await inRollback(async (tx) => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const [user] = await tx
        .insert(users)
        .values({
          email: `readonly-${suffix}@example.test`,
          name: "ReadOnly User",
        })
        .returning({ id: users.id });
      const readOnly = await seedTenant(tx, {
        userId: user!.id,
        key: "ro",
        suffix,
        externalRepositoryId: `9300${suffix.slice(-6).replace(/\D/g, "3")}3`,
        fullName: "isoorg/ro-repo",
        issueCount: 1,
        capabilities: ["READ"],
      });

      const authorization = await authenticateAgent(
        request(readOnly.token),
        tx,
      );
      expect(authorization.capabilities).toEqual(["READ"]);
      expect(() => requireAgentCapability(authorization, "READ")).not.toThrow();
      expect(() => requireAgentCapability(authorization, "WRITE")).toThrow(
        "AGENT_CAPABILITY_REQUIRED",
      );
    });
  });
});
