import { eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db, type DbExecutor } from "@/db";
import {
  apiKeys,
  issueActivities,
  issueTags,
  knowledgePages,
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
  tags,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import {
  deleteWorkspace,
  findWorkspaceDeletionImpact,
} from "@/features/workspaces/server/workspace-deletion-service";
import { createWorkspace } from "@/features/workspaces/server/workspace-service";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

/**
 * 실제 PostgreSQL 을 쓰는 시험 — **Workspace 삭제**.
 *
 * # 🔴 이 파일은 기본 `pnpm test` 에서 «돌지 않는다»
 *
 * ```bash
 * pnpm test                       # 이 파일 전체를 건너뛴다
 * DB_INTEGRATION=true pnpm test   # PostgreSQL 이 떠 있어야 한다
 * ```
 *
 * **기본 실행이 초록인 것은 근거가 아니다.** 아래는 `DB_INTEGRATION=true` 없이는 **한 번도
 * 확인되지 않는다** — 짝인 `workspace-deletion-plan.test.ts` 는 «판정 규칙»만 본다.
 *
 * - `ON DELETE CASCADE` 11개가 실제로 무엇을 지우는가 (**고아 0행**)
 * - `DELETE` 의 `workspace_id` 조건이 **다른 Workspace 를 건드리지 않는가**
 * - `FOR UPDATE` 를 건 소속 조회가 판정 재료를 제대로 만드는가
 * - 집계가 실제 행 수와 맞는가
 *
 * 🔴 **데이터를 남기지 않는다.** 모든 시험이 자기 Transaction 안에서 돌고 끝에서 되돌린다.
 * 있는 데이터를 지우거나 바꾸지 않으며 `TRUNCATE` 도 쓰지 않는다. fixture 이름은 전부
 * `wsdel-` 로 시작한다.
 */
const enabled = process.env.DB_INTEGRATION === "true";

beforeAll(() => {
  if (enabled) {
    loadIntegrationDbEnv();
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
  return `wsdel-${prefix}${Date.now().toString(36)}${seq}`;
}

async function makeUser(tx: DbExecutor, label: string): Promise<string> {
  const rows = await tx
    .insert(users)
    .values({ email: `${unique("u")}@example.test`, name: `wsdel-${label}` })
    .returning({ id: users.id });

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }
  return id;
}

/** Personal Workspace — 실제 가입 경로를 그대로 쓴다. */
async function makePersonalWorkspace(
  tx: DbExecutor,
  userId: string,
): Promise<string> {
  return ensurePersonalWorkspace(
    { userId, displayName: "wsdel", slugSource: unique("p-") },
    tx,
  );
}

/** 팀 Workspace — 사람이 만드는 경로(`createWorkspace`)를 그대로 쓴다. */
async function makeTeamWorkspace(
  tx: DbExecutor,
  ownerId: string,
): Promise<string> {
  const created = await createWorkspace(
    { name: unique("team-"), createdBy: ownerId },
    tx,
  );
  return created.workspaceId;
}

interface Seeded {
  projectId: string;
  repositoryId: string;
  reviewSessionId: string;
  issueId: string;
  tagId: string;
}

/**
 * Workspace 아래를 **CASCADE 가 닿는 모든 표**에 한 벌씩 채운다.
 *
 * 🔴 하나라도 빠뜨리면 「고아가 없다」를 확인했다고 말할 수 없다 — 채우지 않은 표는
 * 삭제 뒤에도 당연히 0행이다.
 */
async function seedWorkspace(
  tx: DbExecutor,
  workspaceId: string,
): Promise<Seeded> {
  const projectRows = await tx
    .insert(projects)
    .values({ workspaceId, name: unique("proj-"), slug: unique("proj-") })
    .returning({ id: projects.id });
  const projectId = projectRows[0]?.id;
  if (projectId === undefined) throw new Error("Project 를 만들지 못했다");

  const repositoryRows = await tx
    .insert(repositories)
    .values({
      workspaceId,
      projectId,
      provider: "GITHUB",
      externalRepositoryId: unique("ext-"),
      owner: "acme",
      name: "svc",
      fullName: `acme/${unique("svc-")}`,
    })
    .returning({ id: repositories.id });
  const repositoryId = repositoryRows[0]?.id;
  if (repositoryId === undefined) throw new Error("Repository 를 만들지 못했다");

  const sessionRows = await tx
    .insert(reviewSessions)
    .values({
      workspaceId,
      repositoryId,
      targetType: "COMMIT",
      reviewerType: "AGENT",
      reviewerName: "codex",
    })
    .returning({ id: reviewSessions.id });
  const reviewSessionId = sessionRows[0]?.id;
  if (reviewSessionId === undefined)
    throw new Error("ReviewSession 을 만들지 못했다");

  const issueRows = await tx
    .insert(reviewIssues)
    .values({
      workspaceId,
      repositoryId,
      reviewSessionId,
      title: unique("issue-"),
      severity: "HIGH",
      category: "TRANSACTION",
      patternKey: "EXTERNAL_IO_IN_TRANSACTION",
    })
    .returning({ id: reviewIssues.id });
  const issueId = issueRows[0]?.id;
  if (issueId === undefined) throw new Error("ReviewIssue 를 만들지 못했다");

  await tx.insert(issueActivities).values({
    workspaceId,
    reviewIssueId: issueId,
    type: "DETECTED",
    actorType: "AGENT",
    actorName: "codex",
  });

  const tagName = unique("tag-");
  const tagRows = await tx
    .insert(tags)
    .values({ workspaceId, name: tagName, normalizedName: tagName })
    .returning({ id: tags.id });
  const tagId = tagRows[0]?.id;
  if (tagId === undefined) throw new Error("Tag 를 만들지 못했다");

  await tx.insert(issueTags).values({ reviewIssueId: issueId, tagId });

  await tx.insert(knowledgePages).values({
    workspaceId,
    projectId: null,
    title: unique("page-"),
    slug: unique("page-"),
    content: "# wsdel",
  });

  await tx.insert(apiKeys).values({
    workspaceId,
    name: unique("key-"),
    keyPrefix: "ci_wsdel",
    keyHash: unique("hash-"),
  });

  await tx.insert(workspaceInvitations).values({
    workspaceId,
    email: `${unique("invite-")}@example.test`,
    tokenHash: unique("token-"),
    expiresAt: new Date(Date.now() + 86_400_000),
  });

  return { projectId, repositoryId, reviewSessionId, issueId, tagId };
}

/** 이 Workspace 를 가리키는 행이 표마다 몇 개 남아 있는가. */
async function countRemains(
  tx: DbExecutor,
  workspaceId: string,
  seeded: Seeded,
): Promise<Record<string, number>> {
  const total = sql<number>`cast(count(*) as int)`;

  const [
    workspaceRows,
    memberRows,
    invitationRows,
    keyRows,
    pageRows,
    projectRows,
    repositoryRows,
    sessionRows,
    issueRows,
    activityRows,
    tagRows,
    issueTagRows,
  ] = await Promise.all([
    tx.select({ value: total }).from(workspaces).where(eq(workspaces.id, workspaceId)),
    tx
      .select({ value: total })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId)),
    tx
      .select({ value: total })
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.workspaceId, workspaceId)),
    tx.select({ value: total }).from(apiKeys).where(eq(apiKeys.workspaceId, workspaceId)),
    tx
      .select({ value: total })
      .from(knowledgePages)
      .where(eq(knowledgePages.workspaceId, workspaceId)),
    tx.select({ value: total }).from(projects).where(eq(projects.workspaceId, workspaceId)),
    tx
      .select({ value: total })
      .from(repositories)
      .where(eq(repositories.workspaceId, workspaceId)),
    tx
      .select({ value: total })
      .from(reviewSessions)
      .where(eq(reviewSessions.workspaceId, workspaceId)),
    tx
      .select({ value: total })
      .from(reviewIssues)
      .where(eq(reviewIssues.workspaceId, workspaceId)),
    tx
      .select({ value: total })
      .from(issueActivities)
      .where(eq(issueActivities.workspaceId, workspaceId)),
    tx.select({ value: total }).from(tags).where(eq(tags.workspaceId, workspaceId)),
    /* 🔴 `issue_tags` 는 `workspace_id` 가 없다 — Issue 를 타고 사라지는지 따로 본다. */
    tx
      .select({ value: total })
      .from(issueTags)
      .where(eq(issueTags.reviewIssueId, seeded.issueId)),
  ]);

  return {
    workspaces: workspaceRows[0]?.value ?? -1,
    workspace_members: memberRows[0]?.value ?? -1,
    workspace_invitations: invitationRows[0]?.value ?? -1,
    api_keys: keyRows[0]?.value ?? -1,
    knowledge_pages: pageRows[0]?.value ?? -1,
    projects: projectRows[0]?.value ?? -1,
    repositories: repositoryRows[0]?.value ?? -1,
    review_sessions: sessionRows[0]?.value ?? -1,
    review_issues: issueRows[0]?.value ?? -1,
    issue_activities: activityRows[0]?.value ?? -1,
    tags: tagRows[0]?.value ?? -1,
    issue_tags: issueTagRows[0]?.value ?? -1,
  };
}

const FULL = {
  workspaces: 1,
  workspace_members: 1,
  workspace_invitations: 1,
  api_keys: 1,
  knowledge_pages: 1,
  projects: 1,
  repositories: 1,
  review_sessions: 1,
  review_issues: 1,
  issue_activities: 1,
  tags: 1,
  issue_tags: 1,
};

const EMPTY = Object.fromEntries(
  Object.keys(FULL).map((table) => [table, 0]),
);

describe.skipIf(!enabled)("Workspace 삭제 (실제 PostgreSQL)", () => {
  it("혼자 쓰던 팀 Workspace 는 지워지고 CASCADE 대상이 «전부» 0행이 된다", async () => {
    await inRollback(async (tx) => {
      const ownerId = await makeUser(tx, "owner");
      await makePersonalWorkspace(tx, ownerId);
      const workspaceId = await makeTeamWorkspace(tx, ownerId);
      const seeded = await seedWorkspace(tx, workspaceId);

      expect(await countRemains(tx, workspaceId, seeded)).toEqual(FULL);

      await deleteWorkspace({ workspaceId, userId: ownerId }, tx);

      // 🔴 고아 0행 — 표 하나하나를 실제로 세어 확인한다.
      expect(await countRemains(tx, workspaceId, seeded)).toEqual(EMPTY);

      // 🔴 사람은 지우지 않는다. 계정 삭제와 별개 기능이다.
      const survivor = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, ownerId));
      expect(survivor).toHaveLength(1);
    });
  });

  it("다른 Workspace 의 데이터는 한 행도 건드리지 않는다", async () => {
    await inRollback(async (tx) => {
      const ownerId = await makeUser(tx, "owner");
      const neighborId = await makeUser(tx, "neighbor");

      const doomed = await makeTeamWorkspace(tx, ownerId);
      const doomedSeed = await seedWorkspace(tx, doomed);

      const kept = await makeTeamWorkspace(tx, neighborId);
      const keptSeed = await seedWorkspace(tx, kept);

      await deleteWorkspace({ workspaceId: doomed, userId: ownerId }, tx);

      expect(await countRemains(tx, doomed, doomedSeed)).toEqual(EMPTY);
      // 🔴 옆 Workspace 는 그대로다 — 표마다 1행씩 살아 있다.
      expect(await countRemains(tx, kept, keptSeed)).toEqual(FULL);
    });
  });

  it("Personal Workspace 는 혼자여도 거절된다", async () => {
    await inRollback(async (tx) => {
      const ownerId = await makeUser(tx, "solo");
      const workspaceId = await makePersonalWorkspace(tx, ownerId);
      const seeded = await seedWorkspace(tx, workspaceId);

      await expect(
        deleteWorkspace({ workspaceId, userId: ownerId }, tx),
      ).rejects.toMatchObject({ reason: "PERSONAL_WORKSPACE_UNDELETABLE" });

      // 🔴 거절은 «아무것도 지우지 않는다» — 반쪽 삭제가 없다.
      expect(await countRemains(tx, workspaceId, seeded)).toEqual(FULL);
    });
  });

  it("다른 멤버가 «한 명이라도» 있으면 거절된다", async () => {
    await inRollback(async (tx) => {
      const ownerId = await makeUser(tx, "owner");
      const otherId = await makeUser(tx, "other");
      const workspaceId = await makeTeamWorkspace(tx, ownerId);
      const seeded = await seedWorkspace(tx, workspaceId);

      await tx
        .insert(workspaceMembers)
        .values({ workspaceId, userId: otherId, role: "MEMBER" });

      await expect(
        deleteWorkspace({ workspaceId, userId: ownerId }, tx),
      ).rejects.toMatchObject({ reason: "WORKSPACE_HAS_MEMBERS" });

      expect(await countRemains(tx, workspaceId, seeded)).toEqual({
        ...FULL,
        workspace_members: 2,
      });
    });
  });

  it("MEMBER 가 부르면 거절된다", async () => {
    await inRollback(async (tx) => {
      const ownerId = await makeUser(tx, "owner");
      const memberId = await makeUser(tx, "member");
      const workspaceId = await makeTeamWorkspace(tx, ownerId);
      const seeded = await seedWorkspace(tx, workspaceId);

      await tx
        .insert(workspaceMembers)
        .values({ workspaceId, userId: memberId, role: "MEMBER" });

      await expect(
        deleteWorkspace({ workspaceId, userId: memberId }, tx),
      ).rejects.toMatchObject({ reason: "WORKSPACE_OWNER_REQUIRED" });

      expect(await countRemains(tx, workspaceId, seeded)).toEqual({
        ...FULL,
        workspace_members: 2,
      });
    });
  });

  /**
   * 🔴 **소속이 없는 사람에게는 `FORBIDDEN` 이 아니라 `NOT_FOUND` 다.** 구분해 주면
   * 그 workspaceId 가 존재한다는 사실이 새어 나간다(CLAUDE.md 11 · 13).
   */
  it("소속이 아닌 사람이 부르면 «없는 것» 으로 답한다", async () => {
    await inRollback(async (tx) => {
      const ownerId = await makeUser(tx, "owner");
      const strangerId = await makeUser(tx, "stranger");
      const workspaceId = await makeTeamWorkspace(tx, ownerId);
      const seeded = await seedWorkspace(tx, workspaceId);

      await expect(
        deleteWorkspace({ workspaceId, userId: strangerId }, tx),
      ).rejects.toMatchObject({ reason: "WORKSPACE_NOT_FOUND" });

      expect(await countRemains(tx, workspaceId, seeded)).toEqual(FULL);
    });
  });

  it("영향 집계는 실제 행 수를 세고, 막힌 이유를 함께 말한다", async () => {
    await inRollback(async (tx) => {
      const ownerId = await makeUser(tx, "owner");
      const workspaceId = await makeTeamWorkspace(tx, ownerId);
      await seedWorkspace(tx, workspaceId);
      // 🔴 두 벌째 — 「1 을 세는 것」과 「실제로 세는 것」을 구분한다.
      await seedWorkspace(tx, workspaceId);

      const impact = await findWorkspaceDeletionImpact(
        { workspaceId, userId: ownerId },
        tx,
      );

      expect(impact.losses).toEqual({
        projects: 2,
        repositories: 2,
        reviewSessions: 2,
        reviewIssues: 2,
        knowledgePages: 2,
        apiKeys: 2,
        invitations: 2,
        tags: 2,
      });
      expect(impact).toMatchObject({
        deletable: true,
        block: null,
        otherMembers: 0,
      });

      const otherId = await makeUser(tx, "other");
      await tx
        .insert(workspaceMembers)
        .values({ workspaceId, userId: otherId, role: "MEMBER" });

      expect(
        await findWorkspaceDeletionImpact({ workspaceId, userId: ownerId }, tx),
      ).toMatchObject({ deletable: false, block: "HAS_MEMBERS", otherMembers: 1 });
    });
  });

  /** 🔴 Personal 은 집계 화면에서도 「지울 수 있다」로 보이지 않는다. */
  it("Personal Workspace 의 집계는 PERSONAL 로 막힌다", async () => {
    await inRollback(async (tx) => {
      const ownerId = await makeUser(tx, "solo");
      const workspaceId = await makePersonalWorkspace(tx, ownerId);

      expect(
        await findWorkspaceDeletionImpact({ workspaceId, userId: ownerId }, tx),
      ).toMatchObject({ deletable: false, block: "PERSONAL" });
    });
  });

  /**
   * 🔴 **이 파일이 만든 행이 남지 않았는지 마지막에 직접 확인한다.** 시험은 전부 되돌아가는
   * Transaction 안에서 돌지만, 「돌았다」와 「남지 않았다」는 다른 사실이다.
   */
  it("시험이 만든 행이 하나도 남지 않았다", async () => {
    const leftovers = await db()
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(sql`${workspaces.slug} like 'wsdel-%'`);
    expect(leftovers).toEqual([]);

    const strayUsers = await db()
      .select({ email: users.email })
      .from(users)
      .where(sql`${users.email} like 'wsdel-%'`);
    expect(strayUsers).toEqual([]);

    const strayKeys = await db()
      .select({ prefix: apiKeys.keyPrefix })
      .from(apiKeys)
      .where(inArray(apiKeys.keyPrefix, ["ci_wsdel"]));
    expect(strayKeys).toEqual([]);
  });
});
