import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, type Database } from "@/db";
import * as schema from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import { deleteWorkspace } from "@/features/workspaces/server/workspace-deletion-service";
import {
  changeMemberRole,
  removeMember,
} from "@/features/workspaces/server/workspace-service";

const { users, workspaceMembers, workspaces } = schema;

/**
 * 실제 PostgreSQL · **실제 연결 여럿**으로 `workspace_members` 의 **행 잠금 순서**를 잰다.
 *
 * ```bash
 * DB_INTEGRATION=true pnpm test   # 이 파일은 이때만 돈다
 * ```
 *
 * # 🔴 왜 이 파일이 필요한가 — 「한 표만 잠그니 안전하다」가 반증됐다
 *
 * 멤버 내보내기를 넣을 때 `removeMember` 는 **`workspace_members` 한 표만** 잠그니
 * 전역 잠금 순서(`@/db`)와 무관하다고 적었다. 독립 reviewer 가 실제 병렬 연결로
 * **`40P01 deadlock detected` 를 재현해 그것을 반증했다** — `changeMemberRole` 도 같은
 * 한 표만 잠그는데 **행을 집는 순서가 달랐다.**
 *
 * ```
 * removeMember     : 대상 T 를 잡고 -> 행위자 O 를 기다린다
 * changeMemberRole : OWNER O 를 잡고 -> 대상 T 를 기다린다      고리가 닫힌다
 * ```
 *
 * 🔴 **그 전까지 이 잠금을 지키는 시험이 한 줄도 없었다.** `.for("update")` 를 통째로
 * 지워도 시험 20건이 전부 초록이었다. 이 파일이 그 자리를 메운다.
 *
 * # 🔴 이 파일은 «되돌리는 Transaction» 을 쓰지 못한다
 *
 * 잠금 경쟁은 **연결이 둘 이상일 때만** 생기고, 다른 연결이 fixture 를 보려면 그것이
 * **commit** 돼 있어야 한다. 그래서 실제로 행을 남겼다가 반드시 지운다 —
 * 이름에 `mrmlock-` 접두를 붙이고, 지우는 것은 **이 파일이 만든 id** 뿐이며
 * (`TRUNCATE` 도 조건 없는 DELETE 도 쓰지 않는다), 버티는 연결은 `finally` 에서 놓고,
 * 마지막 시험이 하나도 남지 않았는지 다시 조회해 확인한다.
 * (`src/db/lock-order.integration.test.ts` 가 본보기다 — 그 파일은 **건드리지 않았다.**)
 *
 * # 🔴 user id 를 «직접» 정한다
 *
 * 잠금 순서를 재려면 어느 행이 앞인지 **시험이 알아야** 한다. 무작위 UUID 로는 그 순서가
 * 매번 바뀌어 「무엇을 재고 있는지」가 흔들린다. 그래서 첫 자리만 못 박고 나머지는 난수로
 * 채워, 순서는 결정적이면서 실제 데이터와는 겹치지 않게 한다.
 */
const enabled = process.env.DB_INTEGRATION === "true";

beforeAll(() => {
  if (enabled) {
    loadIntegrationDbEnv();
  }
});

/** 이 파일이 만든 것. 🔴 지울 대상을 «id 로» 들고 다닌다. */
const created = { userIds: [] as string[], workspaceIds: [] as string[] };

async function cleanUp(): Promise<void> {
  if (created.workspaceIds.length > 0) {
    await db()
      .delete(workspaces)
      .where(inArray(workspaces.id, created.workspaceIds));
  }
  if (created.userIds.length > 0) {
    await db().delete(users).where(inArray(users.id, created.userIds));
  }
}

afterAll(async () => {
  if (enabled) {
    await cleanUp();
  }
});

let seq = 0;
function unique(prefix: string): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

function randomHex(length: number): string {
  let out = "";
  while (out.length < length) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out.slice(0, length);
}

/**
 * 첫 자리가 `rank` 인 UUID.
 *
 * PostgreSQL 의 `uuid` 비교는 16 바이트를 앞에서부터 본다 — 첫 hex 한 자리가 순서를 정한다.
 * 나머지는 난수라 실제 데이터와 겹치지 않는다.
 */
function orderedUuid(rank: number): string {
  return `${rank.toString(16)}${randomHex(7)}-${randomHex(4)}-4${randomHex(3)}-8${randomHex(3)}-${randomHex(12)}`;
}

async function makeUser(rank: number, label: string): Promise<string> {
  const id = orderedUuid(rank);
  await db()
    .insert(users)
    .values({
      id,
      email: `${unique("mrmlock-")}@example.test`,
      name: `mrmlock-${label}`,
    });
  created.userIds.push(id);
  return id;
}

/**
 * Workspace 와 소속을 만든다.
 *
 * 🔴 **`memberIds` 를 넘긴 «순서대로» INSERT 한다** — 물리 순서가 곧 seq scan 순서이고,
 * 순서를 적지 않은 질의는 그것을 잠금 순서로 쓴다. 되돌림 확인이 그 사실에 기댄다.
 */
async function makeWorkspace(
  ownerId: string,
  members: readonly { userId: string; role: "OWNER" | "MEMBER" }[],
): Promise<string> {
  const id = orderedUuid(9);
  await db()
    .insert(workspaces)
    .values({
      id,
      slug: unique("mrmlock-"),
      name: "mrmlock",
      createdBy: ownerId,
    });
  created.workspaceIds.push(id);

  for (const member of members) {
    await db()
      .insert(workspaceMembers)
      .values({ workspaceId: id, userId: member.userId, role: member.role });
  }

  return id;
}

/* ------------------------------------------------------------------------- *
 * 경쟁에 참여하는 연결
 * ------------------------------------------------------------------------- */

/**
 * 경쟁에 참여하는 **전용 연결** 하나.
 *
 * 🔴 **`db()` 의 공용 Pool 을 쓰지 않는다.** Pool 은 어느 요청이 어느 물리 연결로 나갈지
 * 알려 주지 않아, 「지금 이 함수가 «어느» backend 에서 도는가」를 물을 수 없다.
 * 제품 함수는 전부 `executor` 를 인자로 받으므로 **제품 코드를 고치지 않고** 이 연결
 * 위에서 그대로 돌릴 수 있다.
 */
interface Participant {
  readonly label: string;
  readonly pid: number;
  readonly db: Database;
  readonly client: Client;
}

async function connect(label: string): Promise<Participant> {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    application_name: `mrmlock:${label}`,
  });
  await client.connect();

  const pid = (
    await client.query<{ pid: number }>("select pg_backend_pid() as pid")
  ).rows[0]?.pid;

  if (pid === undefined) {
    await client.end();
    throw new Error(`${label} 연결의 backend pid 를 읽지 못했다`);
  }

  return { label, pid, db: drizzle(client, { schema }), client };
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

/* ------------------------------------------------------------------------- *
 * 배리어 — 「«그» 연결이 지금 실제로 막혀 있는가」
 * ------------------------------------------------------------------------- */

const POLL_INTERVAL_MS = 20;
/** 🔴 flaky 를 덮으려고 늘리지 마라 — 늘릴수록 원인이 숨는다. */
const BARRIER_TIMEOUT_MS = 10_000;

function nextPoll(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}

function pidArray(pids: readonly number[]) {
  for (const pid of pids) {
    if (!Number.isInteger(pid)) {
      throw new Error(`backend pid 가 정수가 아니다: ${String(pid)}`);
    }
  }
  return `array[${pids.join(", ")}]::int[]`;
}

/**
 * `who` 가 `blockedBy` 중 하나 때문에 **실제로 잠금을 기다리는 상태**가 될 때까지 기다린다.
 *
 * 🔴 **「대기 «수»」를 세지 않는다.** 다른 시험 파일이 같은 표를 건드리면 전역 대기 수는
 * 언제든 흔들린다. 여기서 묻는 것은 **「이 pid 가, 내 다른 연결 때문에, 지금 잠금을
 * 기다리는가」** 하나뿐이라 남의 대기가 섞일 자리가 없다.
 */
async function awaitBlocked(
  who: Participant,
  blockedBy: readonly Participant[],
): Promise<void> {
  const pids = blockedBy.map((part) => part.pid);
  const deadline = Date.now() + BARRIER_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const found = await db().execute(
      `select a.pid
         from pg_stat_activity a
        where a.pid = ${who.pid}
          and a.state = 'active'
          and a.wait_event_type = 'Lock'
          and pg_blocking_pids(a.pid) && ${pidArray(pids)}`,
    );

    if (found.rows.length > 0) {
      return;
    }
    await nextPoll();
  }

  const state = await db().execute(
    `select a.state, a.wait_event_type, a.wait_event, pg_blocking_pids(a.pid) as blockers, a.query
       from pg_stat_activity a where a.pid = ${who.pid}`,
  );

  throw new Error(
    `${who.label} 이(가) 막히지 않았다: ${JSON.stringify(state.rows[0] ?? null)}`,
  );
}

/** 던져진 것이 PostgreSQL 의 교착인가. Drizzle 이 감싸므로 `cause` 를 따라간다. */
function isDeadlock(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }
    if ((current as { code?: unknown }).code === "40P01") {
      return true;
    }
    if (!("cause" in current)) {
      return false;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * 🔴 **만들자마자 결과를 붙잡는다.** 경쟁을 재려면 요청을 «먼저 띄워 두고» 배리어를 기다린
 * 뒤에 결과를 모아야 하는데, 그동안 그 Promise 에는 handler 가 하나도 없다. 그 창에서
 * 거절되면 Node 는 **unhandled rejection** 으로 본다.
 *
 * ## 그것이 실제로 CI 를 빨갛게 만들었다
 *
 * 시험은 **1027건이 전부 통과**했는데 `Errors 1 error` 로 job 이 실패했다. 새어 나온 것은
 * 「내보내기 × Workspace 삭제」에서 `deleteWorkspace` 가 던진 `WORKSPACE_HAS_MEMBERS` 였고,
 * 그것은 **정상 결과**다 — 내보내기가 아직 commit 되지 않았으면 삭제는 거절되는 것이 맞다.
 * 문제는 그 거절이 `Promise.allSettled` 가 붙기 «전»에 일어났다는 것뿐이다.
 *
 * 🔴 **`allSettled` 는 늦다.** 그것은 이미 만들어진 Promise 에 «나중에» handler 를 붙인다 —
 * 사이에 `await` 가 하나라도 있으면 창이 열린다(실제로 두 개 있었다: 배리어 대기와 잠금
 * 해제 왕복). 그래서 결과 수집을 `allSettled` 가 아니라 **이 함수**로 옮겼다.
 */
function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then(
    (value): PromiseSettledResult<T> => ({ status: "fulfilled", value }),
    (reason: unknown): PromiseSettledResult<T> => ({
      status: "rejected",
      reason,
    }),
  );
}

/** 🔴 실패해도 «교착만 아니면» 된다 — 상대가 먼저 끝내 대상이 사라지는 것은 정상이다. */
function expectNoDeadlock(
  results: readonly PromiseSettledResult<unknown>[],
): void {
  for (const result of results) {
    if (result.status === "rejected" && isDeadlock(result.reason)) {
      throw new Error(
        `40P01 deadlock detected — 잠금 순서가 어긋났다: ${String(result.reason)}`,
      );
    }
  }
}

/** 잠금을 쥐고 버티는 연결. 놓기 전까지 그 행을 아무도 못 가져간다. */
async function holdMemberRow(
  holder: Participant,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await holder.client.query("begin");
  await holder.client.query(
    "select 1 from workspace_members where workspace_id = $1 and user_id = $2 for update",
    [workspaceId, userId],
  );
}

describe.skipIf(!enabled)(
  "workspace_members 행 잠금 순서 (실제 연결 여럿)",
  () => {
    /**
     * # F1 — `removeMember` × `changeMemberRole`
     *
     * 🔴 **이 배치는 planner 에 기대지 않는다.** 고친 뒤의 `changeMemberRole` 은 대상까지
     * **한 문장 안에서** PK 순으로 잠그지만, 고치기 전에는 대상 행을 **맨 마지막 UPDATE**
     * 로 집었다 — 그 위치는 scan 방식과 무관한 «구조»다. 그래서 되돌리면 반드시 어긋난다.
     *
     * ```
     * 1. X 가 Ob 를 쥔다
     * 2. C(changeMemberRole, 대상 T) 가 Ob 에서 막힌다      — 고치기 전이면 Oa 만 쥔 채
     * 3. R(removeMember, 행위자 Oa, 대상 T) 가 막힌다        — T 를 쥔 채 Oa 를 기다린다
     * 4. X 가 놓는다  ->  고치기 전: C 가 T 를 기다려 «고리»가 닫힌다
     * ```
     */
    it("🔴 내보내기와 역할 변경을 부딪혀도 교착이 나지 않는다", async () => {
      const targetId = await makeUser(1, "target");
      const actorId = await makeUser(2, "actor");
      const otherOwnerId = await makeUser(3, "other-owner");

      const workspaceId = await makeWorkspace(actorId, [
        { userId: targetId, role: "MEMBER" },
        { userId: actorId, role: "OWNER" },
        { userId: otherOwnerId, role: "OWNER" },
      ]);

      const holder = await connect("holder");
      const changer = await connect("changer");
      const remover = await connect("remover");

      try {
        await holdMemberRow(holder, workspaceId, otherOwnerId);

        const changing = settle(
          changeMemberRole(
            { workspaceId, userId: targetId, role: "MEMBER" },
            changer.db,
          ),
        );
        await awaitBlocked(changer, [holder]);

        const removing = settle(
          removeMember(
            { workspaceId, actorUserId: actorId, targetUserId: targetId },
            remover.db,
          ),
        );
        // 🔴 배리어가 「누구 때문에」까지 본다 — 고치기 전이든 후든 막는 쪽은 C 다.
        await awaitBlocked(remover, [holder, changer]);

        await holder.client.query("rollback");

        const results = await Promise.all([changing, removing]);
        expectNoDeadlock(results);

        // 둘 다 끝까지 갔다 — 대상은 더 이상 멤버가 아니다.
        const left = await db()
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, targetId),
            ),
          );
        expect(left).toEqual([]);
      } finally {
        await disconnect(holder, changer, remover);
      }
    });

    /**
     * # F2 — `removeMember` × `deleteWorkspace`
     *
     * `deleteWorkspace` 는 `workspaces` 를 먼저 잠그지만 `removeMember` 는 그 행을 잠그지
     * 않는다 — **뒤에 줄 서지 않고 곧바로 멤버 행을 집는다.** 그래서 둘의 안전은 오로지
     * **멤버 행 순서**에 달려 있다.
     *
     * 🔴 여기서는 **물리 순서**(insert 순)를 `user_id` 순과 «거꾸로» 만들어 둔다 —
     * 순서를 적지 않은 질의가 seq scan 순서를 잠금 순서로 쓰던 시절을 재현하기 위해서다.
     */
    it("🔴 내보내기와 Workspace 삭제를 부딪혀도 교착이 나지 않는다", async () => {
      const actorId = await makeUser(1, "actor");
      const targetId = await makeUser(2, "target");

      // 🔴 물리 순서는 target -> actor 인데 user_id 순서는 actor -> target 이다.
      const workspaceId = await makeWorkspace(actorId, [
        { userId: targetId, role: "MEMBER" },
        { userId: actorId, role: "OWNER" },
      ]);

      const holder = await connect("holder");
      const deleter = await connect("deleter");
      const remover = await connect("remover");

      try {
        await holdMemberRow(holder, workspaceId, targetId);

        const deleting = settle(
          deleteWorkspace({ workspaceId, userId: actorId }, deleter.db),
        );
        await awaitBlocked(deleter, [holder]);

        const removing = settle(
          removeMember(
            { workspaceId, actorUserId: actorId, targetUserId: targetId },
            remover.db,
          ),
        );
        await awaitBlocked(remover, [holder, deleter]);

        await holder.client.query("rollback");

        /*
         * 🔴 **둘 다 성공하기를 기대하지 않는다.** 삭제가 먼저 끝나면 내보낼 Workspace 가
         * 사라져 `WORKSPACE_NOT_FOUND` 다 — 그것은 정상이고, 재는 것은 «교착이 없는가» 다.
         */
        expectNoDeadlock(await Promise.all([deleting, removing]));
      } finally {
        await disconnect(holder, deleter, remover);
      }
    });

    /**
     * # F5 — `changeMemberRole` × `changeMemberRole`
     *
     * 🔴 **내가 만든 문제가 아니라 원래 있던 것이다.** 두 걸음(「OWNER 행을 잠그고」 →
     * 「대상을 UPDATE」)이면 서로의 대상을 강등하는 두 요청이 각자 상대의 대상을 이미 쥔
     * 채로 만난다. 대상까지 한 문장에 넣으면 함께 풀린다.
     */
    it("🔴 서로를 동시에 강등해도 교착이 나지 않는다", async () => {
      const firstId = await makeUser(1, "owner-a");
      const secondId = await makeUser(2, "owner-b");
      const thirdId = await makeUser(3, "owner-c");

      const workspaceId = await makeWorkspace(firstId, [
        { userId: firstId, role: "OWNER" },
        { userId: secondId, role: "OWNER" },
        { userId: thirdId, role: "OWNER" },
      ]);

      const holder = await connect("holder");
      const left = await connect("left");
      const right = await connect("right");

      try {
        // 🔴 셋째 OWNER 를 쥐어 두 요청을 «같은 자리»에서 멈춰 세운다.
        await holdMemberRow(holder, workspaceId, thirdId);

        const demotingSecond = settle(
          changeMemberRole(
            { workspaceId, userId: secondId, role: "MEMBER" },
            left.db,
          ),
        );
        await awaitBlocked(left, [holder]);

        const demotingFirst = settle(
          changeMemberRole(
            { workspaceId, userId: firstId, role: "MEMBER" },
            right.db,
          ),
        );
        await awaitBlocked(right, [holder, left]);

        await holder.client.query("rollback");

        expectNoDeadlock(
          await Promise.all([demotingSecond, demotingFirst]),
        );
      } finally {
        await disconnect(holder, left, right);
      }
    });

    /**
     * 🔴 **`settle` 이 «만들자마자» 거절까지 받아 낸다.**
     *
     * 위 세 시험은 요청을 먼저 띄우고 배리어를 기다린 뒤에야 결과를 모은다. 그 사이에
     * 거절되면 handler 가 없어 **unhandled rejection** 이 되고, 시험이 전부 통과해도
     * vitest 는 `Errors 1` 로 job 을 실패시킨다 — 실제로 CI 에서 한 번 그렇게 됐다.
     *
     * 🔴 **여기서 일부러 새는 쪽을 재현하지 않는다.** 그러면 vitest 가 그 실행 전체를
     * 빨갛게 만들어, 시험이 자기 실행을 망가뜨린다. 「나중에 붙이면 샌다」는 별도로
     * 결정론적으로 확인했고(`unhandledRejection` 이 실제로 발생), 여기서는 **`settle` 이
     * 그 창을 만들지 않는 쪽**만 고정한다.
     *
     * ## 되돌림 확인
     *
     * `settle` 을 그냥 통과시키거나(`(p) => p`) 성공만 받게 되돌리면 **이 시험이 던진다** —
     * 거절이 결과 객체가 되지 못하고 그대로 올라온다.
     */
    it("🔴 `settle` 은 거절을 결과로 바꾼다 — 늦게 모아도 새지 않는다", async () => {
      const rejecting = new Promise<number>((_, reject) => {
        setTimeout(() => {
          reject(new Error("늦게 거절"));
        }, 5);
      });

      const captured = settle(rejecting);

      // 🔴 거절이 «먼저» 일어나도록 충분히 기다린 뒤에 결과를 본다.
      await new Promise((resolve) => setTimeout(resolve, 30));

      const result = await captured;
      expect(result.status).toBe("rejected");

      // 🔴 `.resolves` 는 «기다려야» 단언이 된다 — 지금 vitest 는 알아서 기다려 주지만
      // 경고를 내고 다음 major 에서는 실패한다. 성공 쪽도 값까지 확인한다.
      await expect(settle(Promise.resolve(7))).resolves.toEqual({
        status: "fulfilled",
        value: 7,
      });
    });

    /**
     * 🔴 **이 파일이 만든 행이 남지 않았는지 마지막에 직접 확인한다.** 이 파일은 commit 을
     * 쓰므로 「돌았다」와 「남지 않았다」가 정말 다른 사실이다.
     */
    it("시험이 만든 행이 하나도 남지 않았다", async () => {
      await cleanUp();
      created.userIds = [];
      created.workspaceIds = [];

      const leftoverWorkspaces = await db()
        .select({ slug: workspaces.slug })
        .from(workspaces);
      expect(
        leftoverWorkspaces.filter((row) => row.slug.startsWith("mrmlock-")),
      ).toEqual([]);

      const leftoverUsers = await db()
        .select({ email: users.email })
        .from(users);
      expect(
        leftoverUsers.filter((row) => row.email.startsWith("mrmlock-")),
      ).toEqual([]);
    });
  },
);
