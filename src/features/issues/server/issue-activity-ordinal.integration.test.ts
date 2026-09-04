import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import { db, type Database } from "@/db";
import * as schema from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import { findAgentIssue } from "@/features/issues/server/issue-agent-query";
import { addIssueActivity } from "@/features/issues/server/issue-activity-service";
import { lockIssuesForActivity } from "@/features/issues/server/issue-activity-ordinal";
import { reviewIngestSchema } from "@/features/reviews/schemas/review-ingest";
import { ingestReview } from "@/features/reviews/server/review-ingest-service";

const {
  issueActivities,
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
  users,
  workspaceMembers,
  workspaces,
} = schema;

/**
 * 순번이 **실제 동시 쓰기**에서도 겹치지 않는가.
 *
 * ```bash
 * DB_INTEGRATION=true pnpm test
 * ```
 *
 * # 🔴 이 파일은 «되돌리는 Transaction» 을 쓰지 못한다
 *
 * 경쟁은 연결이 둘 이상일 때만 생기고, 다른 연결이 fixture 를 보려면 그것이 **commit** 돼
 * 있어야 한다. 그래서 실제로 행을 남겼다가 반드시 지운다 — `lock-order.integration.test.ts`
 * 와 같은 방식이다.
 *
 * - 이름에 `ord-` 접두와 난수를 붙여 실제 데이터와 겹치지 않게 만든다
 * - 지우는 것은 **이 파일이 만든 id** 뿐이다. `TRUNCATE` 도 조건 없는 DELETE 도 쓰지 않는다
 * - 전용 연결은 `finally` 에서 놓는다 — 열린 Transaction 이 남으면 정리 DELETE 가 멈춘다
 *
 * # 무엇을 재는가
 *
 * 1. 같은 Issue 에 **동시에** Activity 를 쓰면 순번이 `1..n` 으로 겹치지 않는가
 * 2. 앞선 쪽이 잠금을 쥔 동안 뒤엣것이 **기다렸다가 성공**하는가(실패가 아니라)
 * 3. 여러 Issue 를 **반대 순서로** 요구해도 `40P01` 이 나지 않는가
 *
 * 🔴 **`Promise` 순서나 mock timer 로 대신하지 않는다.** 3번은 잠금 순서가 어긋나면 실제로
 * 교착이 나는 자리이고, 그것은 진짜 연결 둘로만 재현된다.
 */
const enabled = process.env.DB_INTEGRATION === "true";

beforeAll(() => {
  if (enabled) {
    loadIntegrationDbEnv();
  }
});

/** 이 파일이 만든 것. 🔴 지울 대상을 «id 로» 들고 다닌다. */
const created = { userIds: [] as string[], workspaceIds: [] as string[] };

afterAll(async () => {
  if (!enabled) {
    return;
  }
  if (created.workspaceIds.length > 0) {
    // workspaces 를 참조하는 FK 가 전부 CASCADE 라 아래 것들이 함께 사라진다.
    await db()
      .delete(workspaces)
      .where(inArray(workspaces.id, created.workspaceIds));
  }
  if (created.userIds.length > 0) {
    await db().delete(users).where(inArray(users.id, created.userIds));
  }
});

let seq = 0;
function unique(prefix: string): string {
  seq += 1;
  return `ord-${prefix}${Date.now().toString(36)}${seq}`;
}

interface Fixture {
  workspaceId: string;
  issueIds: string[];
  externalRepositoryId: string;
}

/** Workspace -> Project -> Repository -> Session -> Issue 둘. **commit 된다.** */
async function seed(issueCount: number): Promise<Fixture> {
  const userRows = await db()
    .insert(users)
    .values({ email: `${unique("u")}@example.test`, name: "ord" })
    .returning({ id: users.id });
  const userId = userRows[0]?.id;
  if (userId === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }
  created.userIds.push(userId);

  const workspaceRows = await db()
    .insert(workspaces)
    .values({ slug: unique("ws-"), name: "ord", createdBy: userId })
    .returning({ id: workspaces.id });
  const workspaceId = workspaceRows[0]?.id;
  if (workspaceId === undefined) {
    throw new Error("시험용 Workspace 를 만들지 못했다");
  }
  created.workspaceIds.push(workspaceId);

  await db()
    .insert(workspaceMembers)
    .values({ workspaceId, userId, role: "OWNER" });

  const projectRows = await db()
    .insert(projects)
    .values({ workspaceId, name: "ord", slug: unique("p-") })
    .returning({ id: projects.id });
  const projectId = projectRows[0]?.id;
  if (projectId === undefined) {
    throw new Error("시험용 Project 를 만들지 못했다");
  }

  const externalRepositoryId = unique("ext-");
  const name = externalRepositoryId;
  const repositoryRows = await db()
    .insert(repositories)
    .values({
      workspaceId,
      projectId,
      provider: "GITHUB",
      externalRepositoryId,
      owner: "acme",
      name,
      fullName: `acme/${name}`,
    })
    .returning({ id: repositories.id });
  const repositoryId = repositoryRows[0]?.id;
  if (repositoryId === undefined) {
    throw new Error("시험용 Repository 를 만들지 못했다");
  }

  const sessionRows = await db()
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

  if (issueCount === 0) {
    return { workspaceId, issueIds: [], externalRepositoryId };
  }

  const issueRows = await db()
    .insert(reviewIssues)
    .values(
      Array.from({ length: issueCount }, (_, index) => ({
        workspaceId,
        reviewSessionId,
        repositoryId,
        title: `ord-${String(index)}`,
        severity: "LOW" as const,
        category: "TESTING" as const,
      })),
    )
    .returning({ id: reviewIssues.id });

  const issueIds = issueRows.map((row) => row.id);
  if (issueIds.length !== issueCount) {
    throw new Error("시험용 Issue 를 만들지 못했다");
  }
  return { workspaceId, issueIds, externalRepositoryId };
}

/* ------------------------------------------------------------------------- *
 * 경쟁에 참여하는 연결
 * ------------------------------------------------------------------------- */

/**
 * 경쟁에 참여하는 **전용 연결** 하나.
 *
 * 🔴 **`db()` 의 공용 Pool 을 쓰지 않는다.** 어느 요청이 어느 물리 연결로 나갔는지 알 수
 * 없으면 「지금 «그» 연결이 막혀 있는가」를 물어볼 수 없다. 제품 함수들은 `executor` 를
 * 인자로 받으므로 **제품 코드를 고치지 않고** 이 연결 위에서 그대로 돈다.
 */
interface Participant {
  readonly pid: number;
  readonly db: Database;
  readonly client: Client;
}

async function connect(label: string): Promise<Participant> {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    application_name: `ordinal:${label}`,
  });
  await client.connect();

  const pid = (
    await client.query<{ pid: number }>("select pg_backend_pid() as pid")
  ).rows[0]?.pid;
  if (pid === undefined) {
    await client.end();
    throw new Error(`${label} 연결의 backend pid 를 읽지 못했다`);
  }

  return { pid, db: drizzle(client, { schema }), client };
}

/**
 * 🔴 **`finally` 에서 반드시 부른다.** 열린 Transaction 이 남으면 뒤따르는 정리 DELETE 가
 * 통째로 멈춘다. 놓는 것 자체가 실패해도 시험을 빨갛게 만들지 않는다.
 */
async function disconnect(...parts: readonly Participant[]): Promise<void> {
  for (const part of parts) {
    try {
      await part.client.query("rollback");
    } catch {
      // 이미 끊긴 연결이다.
    }
    try {
      await part.client.end();
    } catch {
      // 같은 이유다.
    }
  }
}

const POLL_INTERVAL_MS = 20;
/** 🔴 flaky 를 덮으려고 늘리지 마라 — 늘릴수록 원인이 숨는다. */
const BARRIER_TIMEOUT_MS = 10_000;

/** 「그 pid 가 지금 «우리» 연결에 막혀 있는가」. 대기 «수» 같은 간접 지표를 세지 않는다. */
async function isBlockedBy(pid: number, blocker: number): Promise<boolean> {
  const rows = await db().execute<{ blocked: boolean }>(
    sql`select ${blocker} = any(pg_blocking_pids(${pid})) as blocked`,
  );
  return rows.rows[0]?.blocked === true;
}

async function untilBlockedBy(pid: number, blocker: number): Promise<void> {
  const deadline = Date.now() + BARRIER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isBlockedBy(pid, blocker)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `pid ${String(pid)} 가 pid ${String(blocker)} 에 막히기를 기다렸지만 그러지 않았다`,
  );
}

function isDeadlock(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === "40P01" || cause === "40P01";
}

const ACTIVITY = {
  type: "COMMENT" as const,
  actor: { type: "AGENT" as const, name: "ord" },
  description: null,
  commitSha: null,
  decision: null,
  evidence: [],
};

async function ordinalsOf(issueId: string): Promise<(number | null)[]> {
  const rows = await db()
    .select({ ordinal: issueActivities.ordinal })
    .from(issueActivities)
    .where(eq(issueActivities.reviewIssueId, issueId))
    .orderBy(asc(issueActivities.ordinal));
  return rows.map((row) => row.ordinal);
}

describe.skipIf(!enabled)("Activity 순번 — Round Trip", () => {
  /**
   * 🔴 **「Issue 가 1개든 500개든 문장 수는 같다」**(스펙 31).
   *
   * 순번을 알려면 세어야 하고, 세려면 질의가 는다. 늘어난 것이 **상수 두 문장**
   * (`lockIssuesForActivity` · `nextActivityOrdinals`)인지, 아니면 **Issue 마다** 느는지가
   * 이 계약의 전부다 — 그것을 지키는 시험이 지금까지 하나도 없었다.
   *
   * 🔴 **Drizzle 이 만든 SQL 을 세지 않는다.** 실제 연결의 `query` 를 감싸 **드라이버에
   * 나간 횟수**를 센다. 무엇을 보냈는지가 아니라 **몇 번 왕복했는지**가 계약이다.
   */
  it("🔴 Issue 가 스무 개여도 문장 수가 늘지 않는다", async () => {
    const bodyFor = (externalRepositoryId: string, issueCount: number) =>
      reviewIngestSchema.parse({
        repository: {
          provider: "GITHUB",
          externalRepositoryId,
          owner: "acme",
          name: externalRepositoryId,
          fullName: `acme/${externalRepositoryId}`,
        },
        target: { type: "COMMIT", commitSha: "a81f3c2" },
        reviewer: { type: "AGENT", name: "codex" },
        summary: "요약",
        issues: Array.from({ length: issueCount }, (_, index) => ({
          severity: "HIGH",
          category: "TRANSACTION",
          title: `문제 ${String(index)}`,
          source: "codex",
          externalId: `ORD-RT-${String(index)}`,
          tags: ["race-condition"],
        })),
      });

    async function countStatements(issueCount: number): Promise<number> {
      const { workspaceId, externalRepositoryId } = await seed(0);
      const body = bodyFor(externalRepositoryId, issueCount);

      /**
       * 🔴 **먼저 한 번 넣어 «이미 아는 Issue» 로 만든다.**
       *
       * 새로 만든 Issue 는 이번 Transaction 것이라 잠글 필요가 없어 질의가 아예 나가지
       * 않는다 — 그 경로만 재면 순번 때문에 늘어난 문장을 **하나도 세지 못한다.**
       * 재보고 경로라야 `lockIssuesForActivity` 와 `nextActivityOrdinals` 가 실제로 돈다.
       */
      await ingestReview(
        { workspaceId, idempotencyKey: null, payload: body },
        db(),
      );

      const part = await connect(`rt-${String(issueCount)}`);
      let statements = 0;
      const original = part.client.query.bind(part.client);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 드라이버 경계를 세려고 감싼다.
      (part.client as any).query = (...args: unknown[]) => {
        statements += 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 위와 같다.
        return (original as any)(...args);
      };
      try {
        await ingestReview(
          { workspaceId, idempotencyKey: null, payload: body },
          part.db,
        );
      } finally {
        await disconnect(part);
      }
      return statements;
    }

    const one = await countStatements(1);
    const twenty = await countStatements(20);
    expect(twenty).toBe(one);
  });
});

describe.skipIf(!enabled)("Activity 순번 — 한 payload 에 같은 문제가 둘", () => {
  /**
   * 🔴 **같은 문제를 두 번 실어 보내도 History 에 두 줄이 남지 않는다.**
   *
   * # 내가 틀렸던 것
   *
   * 「한 payload 에 같은 `source + externalId` 가 둘 있으면 batch INSERT 가 같은 Issue 에
   * **두 행**을 넣는다」고 적어 두었고, 그것을 `assignActivityOrdinals` 의 존재 이유로 삼았다.
   * 리뷰어가 그 주장을 의심했고 **실제 payload 로 재 보니 Activity 는 하나뿐이었다.**
   *
   * 접히는 자리는 Database 가 아니라 `prepareIssues` 다 — 그 함수가 `source + externalId`
   * 를 `Set` 으로 걸러 **두 번째를 아예 버린다.** 그래서 `resolved` 에 같은 Issue 가 두 번
   * 실릴 일이 없다.
   *
   * # 그래도 `assignActivityOrdinals` 를 남긴 이유
   *
   * 그 함수가 하는 일은 「목록을 순번으로 바꾸는 것」이고, 같은 Issue 가 거듭 나올 때
   * 갈라 주는 것은 **그 계산에 이미 들어 있는 성질**이다. 지금 그 가지에 닿는 경로가 없다는
   * 것이 「없어도 된다」는 뜻은 아니다 — 위 dedup 이 사라지면 그 자리에서 `23505` 가 난다.
   * 🔴 **다만 「지금 일어나는 일」로 적지 않는다.**
   */
  it("🔴 같은 source·externalId 를 두 번 실어 보내면 «한 줄»만 남는다", async () => {
    const { workspaceId, externalRepositoryId } = await seed(0);
    const duplicated = {
      severity: "HIGH",
      category: "TRANSACTION",
      title: "같은 문제",
      source: "codex",
      externalId: "ORD-DUP-1",
    };

    const result = await ingestReview(
      {
        workspaceId,
        idempotencyKey: null,
        payload: reviewIngestSchema.parse({
          repository: {
            provider: "GITHUB",
            externalRepositoryId,
            owner: "acme",
            name: externalRepositoryId,
            fullName: `acme/${externalRepositoryId}`,
          },
          target: { type: "COMMIT", commitSha: "a81f3c2" },
          reviewer: { type: "AGENT", name: "codex" },
          summary: "요약",
          issues: [duplicated, duplicated],
        }),
      },
      db(),
    );

    const ids = new Set(result.issues.map((issue) => issue.id));
    // 행은 하나다 — 같은 문제를 두 번 보고해도 새 행을 만들지 않는다.
    expect(ids.size).toBe(1);
    // 🔴 응답도 한 건이다. 두 번째는 `prepareIssues` 에서 이미 버려졌다.
    expect(result.issues).toHaveLength(1);

    const issueId = [...ids][0];
    if (issueId === undefined) {
      throw new Error("Issue 를 찾지 못했다");
    }
    expect(await ordinalsOf(issueId)).toEqual([1]);
  });
});

describe.skipIf(!enabled)("Activity 순번 — History 정렬", () => {
  /**
   * 🔴 **이 시험이 이 Issue 의 결론이다.**
   *
   * 두 Activity 에 **같은 `created_at`** 을 주고 순번만 뒤집어 넣는다. 정렬이 시각으로
   * 되돌아가면 어느 것이 먼저 나올지 정해지지 않고, `ordinal` 을 보면 반드시 순번 순서다.
   *
   * 되돌림 확인: `issue-agent-query.ts` 의 `.orderBy(...ACTIVITY_TIMELINE_ORDER)` 를
   * `.orderBy(asc(issueActivities.createdAt))` 로 되돌리면 이 시험이 **실제로 실패한다.**
   */
  it("🔴 `created_at` 이 같아도 순번 순서로 읽힌다", async () => {
    const { workspaceId, issueIds } = await seed(1);
    const issueId = issueIds[0];
    if (issueId === undefined) {
      throw new Error("시험용 Issue 가 없다");
    }

    // 한 Transaction 의 batch INSERT 가 실제로 만들어 내는 모양이다 — 시각이 «같다».
    const sameMoment = new Date("2026-09-04T00:00:00.000Z");
    await db()
      .insert(issueActivities)
      .values([
        {
          workspaceId,
          reviewIssueId: issueId,
          type: "COMMENT" as const,
          actorType: "AGENT" as const,
          actorName: "두번째",
          createdAt: sameMoment,
          ordinal: 2,
        },
        {
          workspaceId,
          reviewIssueId: issueId,
          type: "COMMENT" as const,
          actorType: "AGENT" as const,
          actorName: "첫번째",
          createdAt: sameMoment,
          ordinal: 1,
        },
      ]);

    const detail = await findAgentIssue(workspaceId, issueId);
    expect(detail?.activities.map((activity) => activity.actorName)).toEqual([
      "첫번째",
      "두번째",
    ]);
  });
});

describe.skipIf(!enabled)("Activity 순번 — 실제 동시 쓰기", () => {
  /**
   * 🔴 **되돌림 확인**: `issue-activity-service.ts` 의 `.for("update")` 를 지우면 이 시험이
   * 실제로 빨개진다 — 여러 연결이 같은 최대값을 읽어 `23505` 로 실패한다.
   */
  it("🔴 같은 Issue 에 동시에 여덟 번 써도 순번이 1..8 로 겹치지 않는다", async () => {
    const { workspaceId, issueIds } = await seed(1);
    const issueId = issueIds[0];
    if (issueId === undefined) {
      throw new Error("시험용 Issue 가 없다");
    }

    /**
     * 🔴 **연결 하나가 동시에 두 요청을 돌리지 못한다.** `pg` 의 `Client` 는 질의를 하나씩만
     * 처리하므로, 여덟 요청을 넷에 나눠 실으면 제품이 아니라 **드라이버**가 거절한다.
     * 경쟁을 재려면 참여자 수만큼 연결을 연다.
     */
    const parts = await Promise.all(
      Array.from({ length: 8 }, (_, index) => connect(`race-${String(index)}`)),
    );

    try {
      const results = await Promise.allSettled(
        parts.map((part) =>
          addIssueActivity(
            { scope: { workspaceId }, issueId, activity: ACTIVITY },
            part.db,
          ),
        ),
      );

      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(0);
      expect(await ordinalsOf(issueId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    } finally {
      await disconnect(...parts);
    }
  });

  /**
   * 낙관(잠금 없음)이었다면 여기서 뒤엣것이 **기다렸다가 `23505` 로 실패**한다 — 실제 연결
   * 둘로 재 보고 확인했다. 잠금을 잡으면 **기다렸다가 그대로 성공**한다.
   */
  it("🔴 앞선 쪽이 잠금을 쥔 동안 뒤엣것은 «기다렸다가 성공»한다 — 실패가 아니다", async () => {
    const { workspaceId, issueIds } = await seed(1);
    const issueId = issueIds[0];
    if (issueId === undefined) {
      throw new Error("시험용 Issue 가 없다");
    }

    const holder = await connect("holder");
    const waiter = await connect("waiter");

    try {
      await holder.client.query("begin");
      await holder.client.query(
        "select id from review_issues where id = $1 for update",
        [issueId],
      );

      /**
       * 🔴 **거절까지 «만들자마자» 받아 낸다.** `.finally()` 는 결과를 그대로 흘려보내서,
       * 아래 배리어를 기다리는 동안 이 Promise 에는 거절 handler 가 없다 — 그 창에서
       * 실패하면 **unhandled rejection** 이 되어 시험이 전부 통과해도 vitest 가 실행을
       * 실패시킨다(`member-removal-lock-order.integration.test.ts` 가 실제로 그랬다).
       */
      let settled = false;
      let failure: unknown = null;
      const pending = addIssueActivity(
        { scope: { workspaceId }, issueId, activity: ACTIVITY },
        waiter.db,
      ).then(
        (value) => {
          settled = true;
          return value;
        },
        (error: unknown) => {
          settled = true;
          failure = error;
          return null;
        },
      );

      await untilBlockedBy(waiter.pid, holder.pid);
      expect(settled).toBe(false);

      await holder.client.query("commit");
      await expect(pending).resolves.toBeDefined();
      expect(failure).toBeNull();
      expect(await ordinalsOf(issueId)).toEqual([1]);
    } finally {
      await disconnect(holder, waiter);
    }
  });

  /**
   * 🔴 **Review 수집 두 개가 같은 Issue 를 동시에 다시 보고해도 교착이 나지 않는다.**
   *
   * # 무엇이 위험했는가
   *
   * `linkTags` 가 넣는 `issue_tags` 는 `review_issues` 를 참조하므로 FK 검사가 그 행에
   * **`FOR KEY SHARE`** 를 건다. 그 잠금은 **서로 호환**돼서 두 Transaction 이 나란히
   * 얻는다 — 그 상태에서 둘 다 `FOR UPDATE` 로 «승격»하려 하면 서로를 기다려 고리가 닫힌다.
   *
   * 실제로 재현했다. 두 연결이 각각 `issue_tags` 를 넣어 KEY SHARE 를 얻은 뒤 같은 행에
   * `for update` 를 걸자 **`40P01 deadlock detected`** 가 났고, 잠금을 «먼저» 잡으면
   * 뒤엣것이 기다렸다가 그대로 성공했다.
   *
   * 🔴 **되돌림 확인**: `review-ingest-service.ts` 에서 `lockIssuesForActivity` 를
   * `linkTags` **뒤로** 옮기면 이 시험이 실제로 빨개진다.
   */
  it("🔴 같은 Issue 를 다시 보고하는 Review 둘이 동시에 들어와도 교착이 없다", async () => {
    const { workspaceId, issueIds, externalRepositoryId } = await seed(1);
    expect(issueIds).toHaveLength(1);

    /**
     * 🔴 **두 Review 의 Tag 를 «다르게» 준다.** 같은 Tag 를 주면 `tags` 의
     * `(workspace_id, normalized_name)` unique 에서 뒤엣것이 먼저 줄을 서 버려,
     * 정작 재려던 `issue_tags` 의 FK 잠금 경쟁이 일어나지 않는다 — 실제로 그렇게 만들었다가
     * 되돌림 확인이 «초록»이 나와서 알았다.
     */
    const bodyWith = (tag: string) =>
      reviewIngestSchema.parse({
      repository: {
        provider: "GITHUB",
        externalRepositoryId,
        owner: "acme",
        name: externalRepositoryId,
        fullName: `acme/${externalRepositoryId}`,
      },
      target: { type: "COMMIT", commitSha: "a81f3c2" },
      reviewer: { type: "AGENT", name: "codex" },
      summary: "요약",
      issues: [
        {
          severity: "HIGH",
          category: "TRANSACTION",
          title: "같은 문제",
          source: "codex",
          externalId: "ORD-DEADLOCK-1",
          // 🔴 Tag 가 있어야 `issue_tags` 가 FK 잠금을 건다 — 그것이 이 시험의 조건이다.
          tags: [tag],
        },
        ],
      });

    const body = bodyWith("공통");

    // 먼저 한 번 넣어 «이미 있는 Issue» 로 만든다. 그래야 아래 둘이 재보고 경로를 탄다.
    await ingestReview(
      { workspaceId, idempotencyKey: null, payload: body },
      db(),
    );

    const a = await connect("ingest-a");
    const b = await connect("ingest-b");

    try {
      const results = await Promise.allSettled([
        ingestReview(
          { workspaceId, idempotencyKey: null, payload: bodyWith("가-태그") },
          a.db,
        ),
        ingestReview(
          { workspaceId, idempotencyKey: null, payload: bodyWith("나-태그") },
          b.db,
        ),
      ]);

      const deadlocks = results.filter(
        (result) => result.status === "rejected" && isDeadlock(result.reason),
      );
      expect(deadlocks).toHaveLength(0);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);

      const issueId = issueIds[0];
      if (issueId === undefined) {
        throw new Error("시험용 Issue 가 없다");
      }
      // 세 Review 가 각각 한 줄씩 남겼고 순번이 겹치지 않는다.
      const reported = await db()
        .select({ id: reviewIssues.id })
        .from(reviewIssues)
        .where(eq(reviewIssues.workspaceId, workspaceId));
      const target = reported.find((row) => row.id !== issueId)?.id;
      if (target === undefined) {
        throw new Error("보고된 Issue 를 찾지 못했다");
      }
      expect(await ordinalsOf(target)).toEqual([1, 2, 3]);
    } finally {
      await disconnect(a, b);
    }
  });

  /**
   * 부르는 쪽이 준 배열 순서가 **잠금 순서가 되지 않는다** — 뒤엣것은 교착이 아니라 대기다.
   *
   * # 🔴 이 시험의 정직한 한계
   *
   * `orderBy(asc(id))` 를 지워도 **이 시험은 빨개지지 않는다.** 두 연결이 쓰는 문장이
   * 똑같은 한 문장(`in (…)`)이라 Planner 가 고르는 scan 순서도 같고, 그러면 잠금 순서도
   * 우연히 같아진다. 교착은 **문장을 나눠 한 행씩 잠글 때** 실제로 났다(따로 재현했다).
   *
   * 그래서 `orderBy` 가 지키는 것은 이 시험이 아니라 **미래**다 — `@/db` 의 전역 잠금 순서가
   * 적어 둔 그대로, 순서를 적지 않으면 「지금 우연히 안전한 조합」이 데이터가 커져 Planner 가
   * 다른 계획을 고르는 순간 뒤집힌다. 그 사실을 시험이 아니라 이 주석이 지킨다.
   */
  it("🔴 여러 Issue 를 «반대 순서»로 요구해도 교착이 아니라 «대기» 다", async () => {
    const { issueIds } = await seed(2);
    const sorted = [...issueIds].sort();
    const reversed = [...sorted].reverse();

    const a = await connect("deadlock-a");
    const b = await connect("deadlock-b");

    try {
      await a.client.query("begin");
      await b.client.query("begin");

      // A 가 둘 다 쥔다.
      await lockIssuesForActivity(a.db, sorted);

      let settled = false;
      let failure: unknown = null;
      const pending = lockIssuesForActivity(b.db, reversed).then(
        () => {
          settled = true;
        },
        (error: unknown) => {
          settled = true;
          failure = error;
        },
      );

      await untilBlockedBy(b.pid, a.pid);
      expect(settled).toBe(false);

      await a.client.query("commit");
      await pending;

      expect(failure).toBeNull();
      expect(isDeadlock(failure)).toBe(false);
    } finally {
      await disconnect(a, b);
    }
  });
});
