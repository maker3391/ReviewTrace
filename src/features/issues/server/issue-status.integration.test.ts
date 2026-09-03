import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import { db, type DbExecutor } from "@/db";
import {
  issueActivities,
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
  users,
  workspaces,
} from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import * as schema from "@/db/schema";
import { issueStatusUpdateSchema } from "@/features/issues/schemas/issue-status-update";
import { updateIssueStatus } from "@/features/issues/server/issue-status-service";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

/**
 * 상태 전이가 남기는 **시각이 언제의 것인가** — 실제 PostgreSQL · 실제 잠금 대기로 잰다.
 *
 * ```bash
 * DB_INTEGRATION=true pnpm test   # 이 파일은 이때만 돈다
 * ```
 *
 * # 🔴 이 파일은 «되돌리는 Transaction» 을 쓰지 못한다
 *
 * 잠금 대기는 연결이 둘 이상일 때만 생기고, 버티는 연결이 fixture 를 보려면 그것이
 * **commit** 돼 있어야 한다. 게다가 되돌리는 Transaction 안에서는 `now()` 가 바깥
 * Transaction 시작 시각으로 «고정»되어 시각 차이를 잴 수 없다.
 *
 * 🔴 그래서 행을 실제로 남겼다가 반드시 지운다 — 지우는 것은 **이 파일이 만든 사용자 id**
 * 뿐이고, 그 아래는 `ON DELETE CASCADE` 로 함께 사라진다.
 *
 * # 무엇을 재는가
 *
 * `resolvedAt` 은 「이 문제가 해결된 시각」이다. 그런데 그 값을 **연결을 얻기도 전에**
 * 만들어 두면, connection pool 대기와 행 잠금 대기만큼 낡은 채 저장된다. 그러면
 * 나중에 commit 된 `RESOLVED` 의 `resolvedAt` 이 **그 직전에 일어난 `REOPENED` 보다
 * 이른** 조합이 나온다 — Issue 는 「해결됨」인데 해결 시각이 마지막 재개보다 앞선다.
 */
const enabled = process.env.DB_INTEGRATION === "true";

beforeAll(() => {
  if (enabled) {
    loadIntegrationDbEnv();
  }
});

/**
 * 🔴 지울 대상을 «id 로» 들고 다닌다. 조건 없는 DELETE 를 쓰지 않는다.
 *
 * 🔴 **Workspace 를 «따로» 들고 다녀야 한다.** 사용자만 지우면 Workspace 는 남는다 —
 * `workspaces.personal_owner_id` 와 `created_by` 는 `ON DELETE SET NULL` 이고
 * CASCADE 로 사라지는 것은 `workspace_members` 뿐이라, **멤버 0명의 열 수 없는 행**이
 * 그대로 남는다. 실제로 이 파일이 dev Database 에 그런 행을 20개 남겼다.
 */
const createdUserIds: string[] = [];
const createdWorkspaceIds: string[] = [];

afterAll(async () => {
  if (!enabled) return;

  // 🔴 `workspaces -> users` 순서다(`@/db` 의 전역 잠금 순서와 같다).
  if (createdWorkspaceIds.length > 0) {
    await db()
      .delete(workspaces)
      .where(inArray(workspaces.id, createdWorkspaceIds));
  }
  if (createdUserIds.length > 0) {
    await db().delete(users).where(inArray(users.id, createdUserIds));
  }
});

let seq = 0;
function unique(prefix: string): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

/** 버티는 연결이 잡을 행을 만들 만큼만 심는다. */
async function seedIssue(
  executor: DbExecutor,
): Promise<{ workspaceId: string; issueId: string }> {
  const userRows = await executor
    .insert(users)
    .values({ email: `${unique("st-")}@example.test`, name: "status" })
    .returning({ id: users.id });
  const userId = userRows[0]?.id;
  if (userId === undefined) throw new Error("시험용 사용자를 만들지 못했다");
  createdUserIds.push(userId);

  const workspaceId = await ensurePersonalWorkspace(
    { userId, displayName: "status", slugSource: unique("st-") },
    executor,
  );
  createdWorkspaceIds.push(workspaceId);

  const projectRows = await executor
    .insert(projects)
    .values({ workspaceId, name: "status", slug: unique("p-") })
    .returning({ id: projects.id });
  const projectId = projectRows[0]?.id;
  if (projectId === undefined) throw new Error("시험용 Project 를 만들지 못했다");

  const name = unique("repo-");
  const repositoryRows = await executor
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
  if (repositoryId === undefined)
    throw new Error("시험용 Repository 를 만들지 못했다");

  const sessionRows = await executor
    .insert(reviewSessions)
    .values({
      workspaceId,
      repositoryId,
      targetType: "COMMIT",
      commitSha: "a81f3c2a81f3c2a81f3c2a81f3c2a81f3c2a81f3c",
      reviewerType: "AGENT",
      reviewerName: "codex",
    })
    .returning({ id: reviewSessions.id });
  const reviewSessionId = sessionRows[0]?.id;
  if (reviewSessionId === undefined)
    throw new Error("시험용 ReviewSession 을 만들지 못했다");

  const issueRows = await executor
    .insert(reviewIssues)
    .values({
      workspaceId,
      repositoryId,
      reviewSessionId,
      title: "상태 전이 시각",
      severity: "HIGH",
      category: "CONCURRENCY",
    })
    .returning({ id: reviewIssues.id });
  const issueId = issueRows[0]?.id;
  if (issueId === undefined) throw new Error("시험용 Issue 를 만들지 못했다");

  return { workspaceId, issueId };
}

/**
 * 🔴 **행 잠금을 «실제로» 잡아 둔다.** `setTimeout` 으로 흉내내지 않는다 —
 * 재려는 것이 「잠금을 기다린 만큼 시각이 낡는가」이기 때문이다.
 */
const HOLD_MS = 400;

/** 대기 시간의 절반만 넘으면 「잠금 뒤에 만든 시각」으로 친다. 기계가 느려도 흔들리지 않는다. */
const MARGIN_MS = 200;

describe.runIf(enabled)("상태 전이가 남기는 시각", () => {
  it("🔴 resolvedAt 은 «행 잠금을 얻은 뒤»의 시각이다 — 부르기 전의 시각이 아니다", async () => {
    const { workspaceId, issueId } = await seedIssue(db());

    const holder = new Client({
      connectionString: process.env.DATABASE_URL,
      application_name: "issue-status:holder",
    });
    await holder.connect();

    let resolvedAt: Date | null = null;
    let startedAt = 0;

    try {
      await holder.query("begin");
      await holder.query(
        'select "id" from "review_issues" where "id" = $1 for update',
        [issueId],
      );

      const update = issueStatusUpdateSchema.parse({
        status: "RESOLVED",
        resolutionSummary: "잠금을 기다린 뒤에 시각을 만든다",
        evidence: [],
      });

      // 🔴 부르기 «직전»의 시각. 예전 구현은 사실상 이 값을 그대로 저장했다.
      startedAt = Date.now();
      const running = updateIssueStatus({
        scope: { workspaceId },
        issueId,
        update,
        fallbackActorName: "codex",
      });

      // 행 잠금을 붙들고 있는 동안 상태 전이는 UPDATE 앞에서 멈춰 있다.
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
      await holder.query("rollback");

      resolvedAt = (await running).resolvedAt;
    } finally {
      try {
        await holder.query("rollback");
      } catch {
        // 이미 끝난 Transaction 이다.
      }
      await holder.end();
    }

    expect(resolvedAt).not.toBeNull();

    /*
      🔴 **이것이 결함의 관측 지점이다.**

      `resolvedAt` 을 연결·잠금보다 «먼저» 만들면 그 값은 `startedAt` 근처에 머문다.
      그러면 그 사이에 commit 된 `REOPENED` 보다 이른 「해결 시각」이 저장될 수 있다 —
      Issue 는 해결됨인데 해결 시각이 마지막 재개보다 앞선다.

      잠금을 얻은 «뒤»에 만들면 최소한 기다린 만큼은 지나 있다.
    */
    expect((resolvedAt as Date).getTime() - startedAt).toBeGreaterThan(
      MARGIN_MS,
    );

    // 실제로 저장된 값도 같은지 본다 — 돌려준 값만 맞춰 놓고 넘어가지 않는다.
    const stored = await db()
      .select({ resolvedAt: reviewIssues.resolvedAt })
      .from(reviewIssues)
      .where(eq(reviewIssues.id, issueId));
    expect(stored[0]?.resolvedAt?.getTime()).toBe(
      (resolvedAt as Date).getTime(),
    );
  }, 60_000);

  /**
   * 🔴 **이 수정이 «새로 들인 잠금»이 안전한지 보는 최소 검증이다.**
   *
   * 시각을 잠금 뒤에 만들려고 `SELECT ... FOR UPDATE` 를 하나 더 넣었다. 같은
   * transaction 이 곧이어 같은 행을 UPDATE 하므로 새 잠금이 아니라는 것이 판단이었고,
   * 여기서 **실제 연결 둘을 같은 Issue 에 동시에 던져** 그 판단을 확인한다.
   *
   * ## 무엇을 주장하는가
   *
   * 어느 쪽이 이기는지는 정하지 않는다 — 경쟁이므로 매번 달라도 된다. 주장하는 것은
   * **「이긴 쪽의 상태와 History 의 마지막 줄이 같다」** 하나다. 상태와 History 가
   * 어긋나면 그 Issue 는 스스로 모순된 기록이 된다.
   *
   * 🔴 **이 시험은 시각 수정 «자체»를 가르지 못한다.** 그 몫은 위의 400ms 잠금 시험이다.
   * 여기서 보는 것은 **deadlock 이 나지 않는 것**과 **상태·History 정합** 둘이다.
   *
   * 🔴 **부하를 재는 시험이 아니다.** 둘이 한 번 부딪히는 것까지다 — 처리량과 다중
   * 동시 실행은 별도 작업으로 남겼다.
   */
  it("🔴 같은 Issue 에 상태 전이 둘이 동시에 와도 deadlock 없이 상태와 History 가 일치한다", async () => {
    const { workspaceId, issueId } = await seedIssue(db());

    const first = new Client({
      connectionString: process.env.DATABASE_URL,
      application_name: "issue-status:resolve",
    });
    const second = new Client({
      connectionString: process.env.DATABASE_URL,
      application_name: "issue-status:reopen",
    });
    await first.connect();
    await second.connect();

    let outcomes: unknown[] = [];

    try {
      const resolve = issueStatusUpdateSchema.parse({
        status: "RESOLVED",
        resolutionSummary: "동시 전이 시험",
        evidence: [],
      });
      const reopen = issueStatusUpdateSchema.parse({
        status: "REOPENED",
        evidence: [],
      });

      // 🔴 배리어를 두지 않는다 — 둘을 그대로 같은 행에 던져 «실제로» 부딪히게 한다.
      outcomes = await Promise.all([
        updateIssueStatus(
          {
            scope: { workspaceId },
            issueId,
            update: resolve,
            fallbackActorName: "codex",
          },
          drizzle(first, { schema }),
        ).then(
          (value) => value as unknown,
          (error: unknown) => error,
        ),
        updateIssueStatus(
          {
            scope: { workspaceId },
            issueId,
            update: reopen,
            fallbackActorName: "claude-code",
          },
          drizzle(second, { schema }),
        ).then(
          (value) => value as unknown,
          (error: unknown) => error,
        ),
      ]);
    } finally {
      for (const client of [first, second]) {
        try {
          await client.query("rollback");
        } catch {
          // 이미 끝난 Transaction 이다.
        }
        await client.end();
      }
    }

    // 🔴 어느 쪽도 deadlock 으로 죽지 않았다.
    for (const outcome of outcomes) {
      expect(
        outcome instanceof Error && /40P01|deadlock/i.test(outcome.message),
      ).toBe(false);
    }

    const stored = await db()
      .select({
        status: reviewIssues.status,
        resolvedAt: reviewIssues.resolvedAt,
        resolutionSummary: reviewIssues.resolutionSummary,
      })
      .from(reviewIssues)
      .where(eq(reviewIssues.id, issueId));
    const finalStatus = stored[0]?.status;
    expect(finalStatus === "RESOLVED" || finalStatus === "REOPENED").toBe(true);

    const history = await db()
      .select({ type: issueActivities.type })
      .from(issueActivities)
      .where(
        and(
          eq(issueActivities.reviewIssueId, issueId),
          eq(issueActivities.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(issueActivities.createdAt));

    // 진 쪽의 시도도 History 에 남는다 — 사라지지 않는다.
    expect(history).toHaveLength(2);

    // 🔴 **주장** — History 의 마지막 줄이 최종 상태와 같다.
    expect(history[history.length - 1]?.type).toBe(finalStatus);

    // 상태 ↔ 해결 요약 정합도 함께 본다.
    if (finalStatus === "RESOLVED") {
      expect(stored[0]?.resolvedAt).not.toBeNull();
      expect(stored[0]?.resolutionSummary).not.toBeNull();
    } else {
      expect(stored[0]?.resolvedAt).toBeNull();
      expect(stored[0]?.resolutionSummary).toBeNull();
    }
  }, 60_000);

});
