import { beforeAll, describe, expect, it } from "vitest";

import { db, type DbExecutor } from "@/db";
import { repositories, reviewIssues, reviewSessions, users } from "@/db/schema";
import { findProjectDashboard } from "@/features/dashboard/server/project-dashboard-query";
import { findWorkspaceDashboard } from "@/features/dashboard/server/workspace-dashboard-query";
import { findIssues } from "@/features/issues/server/issue-query";
import { parseIssueFilter } from "@/features/issues/schemas/issue-filter";
import {
  createKnowledgePage,
  findKnowledgePage,
  listKnowledgeExcerpts,
  listKnowledgePages,
} from "@/features/knowledge/server/knowledge-page-service";
import {
  createProject,
  findProjectBySlug,
  listProjectSummaries,
  resolveIngestProject,
} from "@/features/projects/server/project-service";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

/**
 * 실제 PostgreSQL 을 쓰는 시험 — **Project 계층과 Tenant 격리**.
 *
 * 여기 있는 것들은 **Fake 로 증명할 수 없다** — 지키는 주체가 응용 코드가 아니라
 * Database 의 제약과 Join 조건이기 때문이다.
 *
 * ```bash
 * # 기본 실행에서는 건너뛴다. PostgreSQL 이 떠 있고 .env 에 DATABASE_URL 이 있어야 한다.
 * DB_INTEGRATION=true pnpm test
 * ```
 *
 * 🔴 **데이터를 남기지 않는다.** 모든 시험이 자기 Transaction 안에서 돌고 끝에서 되돌린다.
 * 있는 데이터를 지우거나 바꾸지 않으며 `TRUNCATE` 도 쓰지 않는다.
 */
const enabled = process.env.DB_INTEGRATION === "true";

beforeAll(() => {
  if (enabled) {
    process.loadEnvFile(".env");
  }
});

/** 시험 하나를 되돌리기 위한 표식. 실제 실패와 구분하려고 전용 타입을 쓴다. */
class Rollback extends Error {}

async function inRollback(
  run: (tx: DbExecutor) => Promise<void>,
): Promise<void> {
  try {
    await db().transaction(async (tx) => {
      await run(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) {
      throw error;
    }
  }
}

let seq = 0;
/** 시험끼리 unique 제약으로 부딪히지 않게 매번 다른 값을 만든다. */
function unique(prefix: string): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

/** 소속까지 갖춘 Workspace 하나. 실제 가입 경로(`ensurePersonalWorkspace`)를 그대로 쓴다. */
async function makeWorkspace(
  tx: DbExecutor,
  label: string,
): Promise<{ userId: string; workspaceId: string }> {
  const created = await tx
    .insert(users)
    .values({ email: `${unique("u")}@example.test`, name: label })
    .returning({ id: users.id });

  const userId = created[0]?.id;
  if (userId === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }

  const workspaceId = await ensurePersonalWorkspace(
    { userId, displayName: label, slugSource: unique("ws-") },
    tx,
  );

  return { userId, workspaceId };
}

/** Repository -> ReviewSession -> ReviewIssue 를 한 벌 만든다. */
async function seedReview(
  tx: DbExecutor,
  input: { workspaceId: string; projectId: string; title: string },
): Promise<{ repositoryId: string; issueId: string }> {
  const repositoryRows = await tx
    .insert(repositories)
    .values({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      provider: "GITHUB",
      externalRepositoryId: unique("ext-"),
      owner: "acme",
      name: "svc",
      fullName: "acme/svc",
    })
    .returning({ id: repositories.id });

  const repositoryId = repositoryRows[0]?.id;
  if (repositoryId === undefined) {
    throw new Error("시험용 Repository 를 만들지 못했다");
  }

  const sessionRows = await tx
    .insert(reviewSessions)
    .values({
      workspaceId: input.workspaceId,
      repositoryId,
      targetType: "COMMIT",
      reviewerType: "AGENT",
      reviewerName: "codex",
    })
    .returning({ id: reviewSessions.id });

  const reviewSessionId = sessionRows[0]?.id;
  if (reviewSessionId === undefined) {
    throw new Error("시험용 ReviewSession 을 만들지 못했다");
  }

  const issueRows = await tx
    .insert(reviewIssues)
    .values({
      workspaceId: input.workspaceId,
      repositoryId,
      reviewSessionId,
      title: input.title,
      severity: "HIGH",
      category: "TRANSACTION",
      patternKey: "EXTERNAL_IO_IN_TRANSACTION",
    })
    .returning({ id: reviewIssues.id });

  const issueId = issueRows[0]?.id;
  if (issueId === undefined) {
    throw new Error("시험용 ReviewIssue 를 만들지 못했다");
  }

  return { repositoryId, issueId };
}

const ALL_FILTER = parseIssueFilter({});

describe.skipIf(!enabled)("Project slug", () => {
  it("같은 Workspace 안에서 slug 가 겹치면 다음 후보로 넘어간다", async () => {
    await inRollback(async (tx) => {
      const { userId, workspaceId } = await makeWorkspace(tx, "A");

      const first = await createProject(
        {
          workspaceId,
          createdBy: userId,
          input: { name: "SMIL", slug: "", description: "" },
        },
        tx,
      );
      const second = await createProject(
        {
          workspaceId,
          createdBy: userId,
          input: { name: "SMIL", slug: "", description: "" },
        },
        tx,
      );

      expect(first.slug).toBe("smil");
      expect(second.slug).not.toBe(first.slug);
    });
  });

  it("🔴 slug 를 «직접» 적었는데 겹치면 조용히 바꾸지 않고 거절한다", async () => {
    await inRollback(async (tx) => {
      const { userId, workspaceId } = await makeWorkspace(tx, "A");

      await createProject(
        {
          workspaceId,
          createdBy: userId,
          input: { name: "SMIL", slug: "smil", description: "" },
        },
        tx,
      );

      await expect(
        createProject(
          {
            workspaceId,
            createdBy: userId,
            input: { name: "다른 것", slug: "smil", description: "" },
          },
          tx,
        ),
      ).rejects.toThrow();
    });
  });

  it("🔴 Workspace 가 다르면 같은 slug 를 쓸 수 있다 — 전역 unique 가 아니다", async () => {
    await inRollback(async (tx) => {
      const alpha = await makeWorkspace(tx, "Alpha");
      const beta = await makeWorkspace(tx, "Beta");

      const one = await createProject(
        {
          workspaceId: alpha.workspaceId,
          createdBy: alpha.userId,
          input: { name: "ERP", slug: "erp", description: "" },
        },
        tx,
      );
      const two = await createProject(
        {
          workspaceId: beta.workspaceId,
          createdBy: beta.userId,
          input: { name: "ERP", slug: "erp", description: "" },
        },
        tx,
      );

      expect(one.slug).toBe("erp");
      expect(two.slug).toBe("erp");
      expect(one.projectId).not.toBe(two.projectId);
    });
  });
});

describe.skipIf(!enabled)("Project Tenant 격리", () => {
  it("🔴 slug 를 알아도 다른 Workspace 의 Project 는 얻지 못한다", async () => {
    await inRollback(async (tx) => {
      const alpha = await makeWorkspace(tx, "Alpha");
      const beta = await makeWorkspace(tx, "Beta");

      const project = await createProject(
        {
          workspaceId: alpha.workspaceId,
          createdBy: alpha.userId,
          input: { name: "SMIL", slug: "smil", description: "" },
        },
        tx,
      );

      // 주소를 손으로 바꿔 남의 Project slug 를 적은 상황이다.
      expect(
        await findProjectBySlug(beta.workspaceId, project.slug, tx),
      ).toBeNull();
      // 주인에게는 열린다 — 「항상 null」로 통과하지 않게 짝을 둔다.
      expect(
        await findProjectBySlug(alpha.workspaceId, project.slug, tx),
      ).not.toBeNull();
    });
  });

  it("🔴 Project 목록에 다른 Workspace 의 Project 가 섞이지 않는다", async () => {
    await inRollback(async (tx) => {
      const alpha = await makeWorkspace(tx, "Alpha");
      const beta = await makeWorkspace(tx, "Beta");

      await createProject(
        {
          workspaceId: alpha.workspaceId,
          createdBy: alpha.userId,
          input: { name: "SMIL", slug: "smil", description: "" },
        },
        tx,
      );

      expect(await listProjectSummaries(beta.workspaceId, tx)).toHaveLength(0);
      expect(await listProjectSummaries(alpha.workspaceId, tx)).toHaveLength(1);
    });
  });

  it("🔴 Project 의 집계에 다른 Workspace 의 Repository·Issue 가 섞이지 않는다", async () => {
    await inRollback(async (tx) => {
      const alpha = await makeWorkspace(tx, "Alpha");
      const beta = await makeWorkspace(tx, "Beta");

      const alphaProject = await createProject(
        {
          workspaceId: alpha.workspaceId,
          createdBy: alpha.userId,
          input: { name: "SMIL", slug: "smil", description: "" },
        },
        tx,
      );
      const betaProject = await createProject(
        {
          workspaceId: beta.workspaceId,
          createdBy: beta.userId,
          input: { name: "SMIL", slug: "smil", description: "" },
        },
        tx,
      );

      await seedReview(tx, {
        workspaceId: alpha.workspaceId,
        projectId: alphaProject.projectId,
        title: "Alpha 의 문제",
      });

      const alphaSummary = await listProjectSummaries(alpha.workspaceId, tx);
      const betaSummary = await listProjectSummaries(beta.workspaceId, tx);

      expect(alphaSummary[0]?.repositoryCount).toBe(1);
      expect(alphaSummary[0]?.openIssueCount).toBe(1);
      // 같은 이름·같은 slug 지만 Beta 쪽은 비어 있어야 한다.
      expect(betaSummary[0]?.projectId).toBe(betaProject.projectId);
      expect(betaSummary[0]?.repositoryCount).toBe(0);
      expect(betaSummary[0]?.openIssueCount).toBe(0);
    });
  });
});

describe.skipIf(!enabled)("Dashboard Tenant 격리", () => {
  it("🔴 Workspace Dashboard 에 다른 Workspace 의 Issue·Pattern 이 새지 않는다", async () => {
    await inRollback(async (tx) => {
      const alpha = await makeWorkspace(tx, "Alpha");
      const beta = await makeWorkspace(tx, "Beta");

      const alphaProject = await createProject(
        {
          workspaceId: alpha.workspaceId,
          createdBy: alpha.userId,
          input: { name: "SMIL", slug: "smil", description: "" },
        },
        tx,
      );

      await seedReview(tx, {
        workspaceId: alpha.workspaceId,
        projectId: alphaProject.projectId,
        title: "Alpha 의 문제",
      });

      const alphaBoard = await findWorkspaceDashboard(alpha.workspaceId, tx);
      const betaBoard = await findWorkspaceDashboard(beta.workspaceId, tx);

      expect(alphaBoard.kpi.openIssues).toBe(1);
      expect(alphaBoard.needsAttention).toHaveLength(1);
      expect(alphaBoard.frequentPatterns).toHaveLength(1);
      expect(alphaBoard.recentActivity.length).toBeGreaterThan(0);

      expect(betaBoard.kpi.openIssues).toBe(0);
      expect(betaBoard.needsAttention).toHaveLength(0);
      expect(betaBoard.frequentPatterns).toHaveLength(0);
      expect(betaBoard.recentActivity).toHaveLength(0);
    });
  });

  it("🔴 Project Dashboard 는 «다른 Workspace 의 projectId» 를 받아도 비어서 돌아온다", async () => {
    await inRollback(async (tx) => {
      const alpha = await makeWorkspace(tx, "Alpha");
      const beta = await makeWorkspace(tx, "Beta");

      const alphaProject = await createProject(
        {
          workspaceId: alpha.workspaceId,
          createdBy: alpha.userId,
          input: { name: "SMIL", slug: "smil", description: "" },
        },
        tx,
      );

      await seedReview(tx, {
        workspaceId: alpha.workspaceId,
        projectId: alphaProject.projectId,
        title: "Alpha 의 문제",
      });

      /**
       * 🔴 이것이 조건을 «겹쳐» 거는 이유다.
       *
       * Beta 의 `workspaceId` 와 Alpha 의 `projectId` 를 섞어 넣었다. `projectId` 하나로만
       * 좁혔다면 Alpha 의 Issue 가 그대로 나온다.
       */
      const leaked = await findProjectDashboard(
        { workspaceId: beta.workspaceId, projectId: alphaProject.projectId },
        tx,
      );

      expect(leaked.kpi.openIssues).toBe(0);
      expect(leaked.openIssues).toHaveLength(0);
      expect(leaked.recentReviews).toHaveLength(0);
      expect(leaked.repositories).toHaveLength(0);
      expect(leaked.frequentPatterns).toHaveLength(0);

      // 짝: 제대로 된 조합에서는 나온다.
      const owned = await findProjectDashboard(
        { workspaceId: alpha.workspaceId, projectId: alphaProject.projectId },
        tx,
      );
      expect(owned.openIssues).toHaveLength(1);
    });
  });
});

describe.skipIf(!enabled)("Issue 목록의 Project Scope", () => {
  it("🔴 다른 Project·다른 Workspace 의 Issue 가 목록에 섞이지 않는다", async () => {
    await inRollback(async (tx) => {
      const alpha = await makeWorkspace(tx, "Alpha");
      const beta = await makeWorkspace(tx, "Beta");

      const one = await createProject(
        {
          workspaceId: alpha.workspaceId,
          createdBy: alpha.userId,
          input: { name: "SMIL", slug: "smil", description: "" },
        },
        tx,
      );
      const two = await createProject(
        {
          workspaceId: alpha.workspaceId,
          createdBy: alpha.userId,
          input: { name: "ERP", slug: "erp", description: "" },
        },
        tx,
      );

      await seedReview(tx, {
        workspaceId: alpha.workspaceId,
        projectId: one.projectId,
        title: "SMIL 의 문제",
      });
      await seedReview(tx, {
        workspaceId: alpha.workspaceId,
        projectId: two.projectId,
        title: "ERP 의 문제",
      });

      const smilIssues = await findIssues(
        { workspaceId: alpha.workspaceId, projectId: one.projectId },
        ALL_FILTER,
        tx,
      );
      const erpIssues = await findIssues(
        { workspaceId: alpha.workspaceId, projectId: two.projectId },
        ALL_FILTER,
        tx,
      );

      expect(smilIssues.total).toBe(1);
      expect(smilIssues.items[0]?.title).toBe("SMIL 의 문제");
      expect(erpIssues.total).toBe(1);
      expect(erpIssues.items[0]?.title).toBe("ERP 의 문제");

      // 🔴 다른 Workspace 의 id 를 섞으면 «둘 다» 비어야 한다.
      const leaked = await findIssues(
        { workspaceId: beta.workspaceId, projectId: one.projectId },
        ALL_FILTER,
        tx,
      );
      expect(leaked.total).toBe(0);
      expect(leaked.items).toHaveLength(0);
    });
  });
});

describe.skipIf(!enabled)("Agent Ingest 의 Project 확보", () => {
  it("Project 를 보내지 않으면 default 로 들어가고, 두 번째 요청이 늘리지 않는다", async () => {
    await inRollback(async (tx) => {
      const alpha = await makeWorkspace(tx, "Alpha");

      const first = await resolveIngestProject(
        { workspaceId: alpha.workspaceId, project: null },
        tx,
      );
      const second = await resolveIngestProject(
        { workspaceId: alpha.workspaceId, project: null },
        tx,
      );

      expect(second).toBe(first);
      expect(await listProjectSummaries(alpha.workspaceId, tx)).toHaveLength(1);
    });
  });

  it("🔴 Agent 가 «다른 Workspace 의» Project slug 를 적어도 그 Project 에 닿지 못한다", async () => {
    await inRollback(async (tx) => {
      const alpha = await makeWorkspace(tx, "Alpha");
      const beta = await makeWorkspace(tx, "Beta");

      const alphaProject = await createProject(
        {
          workspaceId: alpha.workspaceId,
          createdBy: alpha.userId,
          input: { name: "SMIL", slug: "smil", description: "" },
        },
        tx,
      );

      // Beta 의 API Key 로 Alpha 의 Project slug 를 지목한 상황이다.
      const resolved = await resolveIngestProject(
        { workspaceId: beta.workspaceId, project: { slug: "smil", name: null } },
        tx,
      );

      // Alpha 의 것이 아니라 **Beta 안에 새로 만들어진** Project 다.
      expect(resolved).not.toBe(alphaProject.projectId);

      const betaProjects = await listProjectSummaries(beta.workspaceId, tx);
      expect(betaProjects).toHaveLength(1);
      expect(betaProjects[0]?.projectId).toBe(resolved);
    });
  });
});

describe.skipIf(!enabled)("Knowledge Scope", () => {
  it("🔴 Workspace 문서와 Project 문서가 서로의 목록에 섞이지 않는다", async () => {
    await inRollback(async (tx) => {
      const alpha = await makeWorkspace(tx, "Alpha");
      const project = await createProject(
        {
          workspaceId: alpha.workspaceId,
          createdBy: alpha.userId,
          input: { name: "SMIL", slug: "smil", description: "" },
        },
        tx,
      );

      await createKnowledgePage(
        {
          scope: { workspaceId: alpha.workspaceId, projectId: null },
          createdBy: alpha.userId,
          input: { title: "공통 규칙", slug: "rules", content: "W" },
        },
        tx,
      );
      await createKnowledgePage(
        {
          scope: {
            workspaceId: alpha.workspaceId,
            projectId: project.projectId,
          },
          createdBy: alpha.userId,
          input: { title: "SMIL 규칙", slug: "rules", content: "P" },
        },
        tx,
      );

      const workspacePages = await listKnowledgePages(
        { workspaceId: alpha.workspaceId, projectId: null },
        tx,
      );
      const projectPages = await listKnowledgePages(
        { workspaceId: alpha.workspaceId, projectId: project.projectId },
        tx,
      );

      // 같은 slug 를 Scope 마다 하나씩 가질 수 있다 — 부분 unique index 두 개가 그것을 잠근다.
      expect(workspacePages).toHaveLength(1);
      expect(workspacePages[0]?.title).toBe("공통 규칙");
      expect(projectPages).toHaveLength(1);
      expect(projectPages[0]?.title).toBe("SMIL 규칙");
    });
  });

  it("🔴 Workspace Scope 안에서 같은 slug 를 두 번 만들지 못한다", async () => {
    await inRollback(async (tx) => {
      const alpha = await makeWorkspace(tx, "Alpha");
      const scope = { workspaceId: alpha.workspaceId, projectId: null };

      await createKnowledgePage(
        {
          scope,
          createdBy: alpha.userId,
          input: { title: "규칙", slug: "rules", content: "" },
        },
        tx,
      );

      await expect(
        createKnowledgePage(
          {
            scope,
            createdBy: alpha.userId,
            input: { title: "규칙 둘", slug: "rules", content: "" },
          },
          tx,
        ),
      ).rejects.toThrow();
    });
  });

  it("🔴 다른 Workspace 는 slug 를 알아도 문서를 열지 못한다", async () => {
    await inRollback(async (tx) => {
      const alpha = await makeWorkspace(tx, "Alpha");
      const beta = await makeWorkspace(tx, "Beta");

      await createKnowledgePage(
        {
          scope: { workspaceId: alpha.workspaceId, projectId: null },
          createdBy: alpha.userId,
          input: { title: "Alpha 규칙", slug: "rules", content: "비밀" },
        },
        tx,
      );

      expect(
        await findKnowledgePage(
          { workspaceId: beta.workspaceId, projectId: null },
          "rules",
          tx,
        ),
      ).toBeNull();
      expect(
        await findKnowledgePage(
          { workspaceId: alpha.workspaceId, projectId: null },
          "rules",
          tx,
        ),
      ).not.toBeNull();
    });
  });

  it("Agent Context 는 Project 를 지목해도 Workspace 공통 규칙을 함께 준다", async () => {
    await inRollback(async (tx) => {
      const alpha = await makeWorkspace(tx, "Alpha");
      const project = await createProject(
        {
          workspaceId: alpha.workspaceId,
          createdBy: alpha.userId,
          input: { name: "SMIL", slug: "smil", description: "" },
        },
        tx,
      );

      await createKnowledgePage(
        {
          scope: { workspaceId: alpha.workspaceId, projectId: null },
          createdBy: alpha.userId,
          input: { title: "공통 규칙", slug: "common", content: "W" },
        },
        tx,
      );
      await createKnowledgePage(
        {
          scope: {
            workspaceId: alpha.workspaceId,
            projectId: project.projectId,
          },
          createdBy: alpha.userId,
          input: { title: "SMIL 규칙", slug: "smil-rules", content: "P" },
        },
        tx,
      );

      const excerpts = await listKnowledgeExcerpts(
        {
          workspaceId: alpha.workspaceId,
          projectId: project.projectId,
          limit: 20,
        },
        tx,
      );

      expect(excerpts).toHaveLength(2);
      expect(excerpts.map((item) => item.scope).sort()).toEqual([
        "PROJECT",
        "WORKSPACE",
      ]);
    });
  });

  it("🔴 Workspace Scope 조회에는 Project 문서가 섞이지 않는다", async () => {
    await inRollback(async (tx) => {
      const alpha = await makeWorkspace(tx, "Alpha");
      const project = await createProject(
        {
          workspaceId: alpha.workspaceId,
          createdBy: alpha.userId,
          input: { name: "SMIL", slug: "smil", description: "" },
        },
        tx,
      );

      await createKnowledgePage(
        {
          scope: {
            workspaceId: alpha.workspaceId,
            projectId: project.projectId,
          },
          createdBy: alpha.userId,
          input: { title: "SMIL 규칙", slug: "smil-rules", content: "P" },
        },
        tx,
      );

      const excerpts = await listKnowledgeExcerpts(
        { workspaceId: alpha.workspaceId, projectId: null, limit: 20 },
        tx,
      );

      expect(excerpts).toHaveLength(0);
    });
  });
});
