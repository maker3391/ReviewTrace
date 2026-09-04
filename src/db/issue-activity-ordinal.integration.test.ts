import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db, type DbExecutor } from "@/db";
import {
  issueActivities,
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
  users,
} from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import { isUniqueViolation } from "@/db/unique-violation";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

/**
 * `0015` 가 세우는 **순번의 DB 계약**을 잰다 — `issue_activities.ordinal`.
 *
 * ```bash
 * pnpm test                     # 이 파일 전체를 건너뛴다
 * DB_INTEGRATION=true pnpm test # PostgreSQL 이 떠 있어야 한다
 * ```
 *
 * # 왜 이 시험이 필요한가
 *
 * History 는 `created_at` 하나로 정렬한다. 그런데 `created_at` 은 `defaultNow()` 이고
 * PostgreSQL 의 `now()` 는 **transaction 시작 시각**이라, 한 Transaction 에서 batch
 * INSERT 된 Activity 는 밀리초가 아니라 **값 자체가 정확히 같다.** 시각으로는 순서를
 * 담을 수 없어 별도의 순번을 둔다.
 *
 * 🔴 **이 파일은 Column 이 있다는 것을 확인하지 않는다.** 확인하는 것은 그 Column 이
 * 실제로 **무엇을 막고 무엇을 허용하는가**다 — 그것이 계약이다.
 *
 * # 되돌림 확인
 *
 * `issue_activities_issue_ordinal_unique` 를 지우면 「겹친 순번을 막는다」와
 * 「`MAX + 1` 은 한 문장 안의 중복을 막지 못한다」가 **실제로 실패한다** — 직접 지워서
 * 확인했다.
 *
 * 🔴 **`WHERE ordinal IS NOT NULL` 은 되돌려도 아무 시험이 빨개지지 않는다.** 그 절을
 * 뺀 index 로 돌려 보니 5건이 그대로 통과했다 — PostgreSQL 의 unique 는 기본이
 * `NULLS DISTINCT` 라, 절이 없어도 NULL 여럿은 서로 다른 값으로 취급된다.
 * 그러니 그 절은 **NULL 을 허용하려고 붙인 것이 아니다.** 계약이 미치지 않는 행을
 * index 밖에 두려는 것이고, 그 사실은 시험이 아니라 이 주석이 지킨다.
 *
 * 🔴 **데이터를 남기지 않는다.** 모든 시험이 자기 Transaction 안에서 돌고 끝에서 되돌린다.
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
function unique(prefix: string): string {
  seq += 1;
  return `ord-${prefix}${Date.now().toString(36)}${seq}`;
}

interface Fixture {
  workspaceId: string;
  issueId: string;
  otherIssueId: string;
}

/** Workspace -> Project -> Repository -> Session -> Issue 둘. */
async function seed(tx: DbExecutor): Promise<Fixture> {
  const created = await tx
    .insert(users)
    .values({ email: `${unique("u")}@example.test`, name: "ord" })
    .returning({ id: users.id });
  const userId = created[0]?.id;
  if (userId === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }

  const workspaceId = await ensurePersonalWorkspace(
    { userId, displayName: "ord", slugSource: unique("ws-") },
    tx,
  );

  const projectRows = await tx
    .insert(projects)
    .values({ workspaceId, name: "ord", slug: unique("p-") })
    .returning({ id: projects.id });
  const projectId = projectRows[0]?.id;
  if (projectId === undefined) {
    throw new Error("시험용 Project 를 만들지 못했다");
  }

  const name = unique("repo-");
  const repositoryRows = await tx
    .insert(repositories)
    .values({
      workspaceId,
      projectId,
      provider: "GITHUB",
      externalRepositoryId: unique("ext-"),
      owner: "acme",
      name,
      fullName: `acme/${name}`,
    })
    .returning({ id: repositories.id });
  const repositoryId = repositoryRows[0]?.id;
  if (repositoryId === undefined) {
    throw new Error("시험용 Repository 를 만들지 못했다");
  }

  const sessionRows = await tx
    .insert(reviewSessions)
    .values({
      workspaceId,
      repositoryId,
      targetType: "COMMIT",
      commitSha: "a81f3c2",
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
    .values([
      {
        workspaceId,
        reviewSessionId,
        repositoryId,
        title: "ord-1",
        severity: "LOW",
        category: "TESTING",
      },
      {
        workspaceId,
        reviewSessionId,
        repositoryId,
        title: "ord-2",
        severity: "LOW",
        category: "TESTING",
      },
    ])
    .returning({ id: reviewIssues.id });
  const issueId = issueRows[0]?.id;
  const otherIssueId = issueRows[1]?.id;
  if (issueId === undefined || otherIssueId === undefined) {
    throw new Error("시험용 Issue 를 만들지 못했다");
  }

  return { workspaceId, issueId, otherIssueId };
}

function activity(
  workspaceId: string,
  reviewIssueId: string,
  ordinal: number | null,
) {
  return {
    workspaceId,
    reviewIssueId,
    type: "COMMENT" as const,
    actorType: "AGENT" as const,
    actorName: "ord",
    ordinal,
  };
}

describe.skipIf(!enabled)("issue_activities.ordinal 의 DB 계약", () => {
  it("한 Issue 안에서 겹친 순번을 막는다", async () => {
    await inRollback(async (tx) => {
      const { workspaceId, issueId } = await seed(tx);
      await tx.insert(issueActivities).values(activity(workspaceId, issueId, 1));

      // 되돌리면(unique index 를 지우면) 여기서 그냥 통과해 History 에 1 이 둘 남는다.
      const clash = tx
        .insert(issueActivities)
        .values(activity(workspaceId, issueId, 1));
      await expect(clash).rejects.toSatisfy(isUniqueViolation);
    });
  });

  it("서로 다른 Issue 는 같은 순번을 가진다 — 순번은 Issue 안에서만 뜻이 있다", async () => {
    await inRollback(async (tx) => {
      const { workspaceId, issueId, otherIssueId } = await seed(tx);
      await tx
        .insert(issueActivities)
        .values([
          activity(workspaceId, issueId, 1),
          activity(workspaceId, otherIssueId, 1),
        ]);

      const rows = await tx
        .select({ ordinal: issueActivities.ordinal })
        .from(issueActivities)
        .where(eq(issueActivities.workspaceId, workspaceId));
      expect(rows).toHaveLength(2);
    });
  });

  /**
   * 🔴 **배포 창을 견디는 것이 이 Column 이 `NOT NULL` 이 아닌 이유다.**
   *
   * Migration 이 먼저 적용되고 코드가 뒤에 올라오는 동안, 순번을 모르는 옛 코드가
   * 계속 Activity 를 쓴다. `NOT NULL` 이면 그 사이 모든 쓰기가 실패한다.
   */
  it("🔴 순번 있는 행과 없는 행이 한 Issue 에 섞여도 된다", async () => {
    await inRollback(async (tx) => {
      const { workspaceId, issueId } = await seed(tx);
      await tx
        .insert(issueActivities)
        .values([
          activity(workspaceId, issueId, null),
          activity(workspaceId, issueId, 1),
          activity(workspaceId, issueId, null),
        ]);

      const rows = await tx
        .select({ ordinal: issueActivities.ordinal })
        .from(issueActivities)
        .where(eq(issueActivities.reviewIssueId, issueId));
      expect(rows.filter((row) => row.ordinal === null)).toHaveLength(2);
    });
  });

  /**
   * 🔴 **부여 규칙의 정본은 여기다.**
   *
   * 한 payload 에 같은 `source + externalId` 가 둘 실리면 batch INSERT 한 문장이
   * **같은 Issue 에 두 행**을 넣는다(`review-ingest-service.ts`). 그때 행마다
   * `MAX(ordinal) + 1` 을 계산하면 두 행이 **같은 값**을 얻는다 — 한 문장 안에서는
   * 서로의 INSERT 가 아직 보이지 않기 때문이다.
   */
  it("🔴 MAX + 1 은 한 문장 안의 중복을 막지 못한다", async () => {
    await inRollback(async (tx) => {
      const { workspaceId, issueId } = await seed(tx);
      await tx.insert(issueActivities).values(activity(workspaceId, issueId, 1));

      const clash = tx.execute(sql`
        insert into issue_activities (workspace_id, review_issue_id, type, actor_type, actor_name, ordinal)
        select ${workspaceId}::uuid, v.iid, 'REVIEWED_AGAIN', 'AGENT', 'ord',
               (select coalesce(max(a.ordinal), 0)
                  from issue_activities a
                 where a.review_issue_id = v.iid) + 1
          from (values (${issueId}::uuid, 1), (${issueId}::uuid, 2)) as v(iid, pos)
      `);
      await expect(clash).rejects.toSatisfy(isUniqueViolation);
    });
  });

  it("MAX + row_number() 는 통과하고 순번이 이어진다", async () => {
    await inRollback(async (tx) => {
      const { workspaceId, issueId } = await seed(tx);
      await tx.insert(issueActivities).values(activity(workspaceId, issueId, 1));

      await tx.execute(sql`
        insert into issue_activities (workspace_id, review_issue_id, type, actor_type, actor_name, ordinal)
        select ${workspaceId}::uuid, v.iid, 'REVIEWED_AGAIN', 'AGENT', 'ord',
               (select coalesce(max(a.ordinal), 0)
                  from issue_activities a
                 where a.review_issue_id = v.iid)
               + row_number() over (partition by v.iid order by v.pos)
          from (values (${issueId}::uuid, 1), (${issueId}::uuid, 2)) as v(iid, pos)
      `);

      const rows = await tx
        .select({ ordinal: issueActivities.ordinal })
        .from(issueActivities)
        .where(eq(issueActivities.reviewIssueId, issueId))
        .orderBy(issueActivities.ordinal);
      expect(rows.map((row) => row.ordinal)).toEqual([1, 2, 3]);
    });
  });
});
