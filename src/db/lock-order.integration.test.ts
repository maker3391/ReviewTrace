import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import { db, type Database } from "@/db";
import * as schema from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import {
  acceptInvitation,
  createInvitation,
} from "@/features/invitations/server/invitation-service";
import { deleteAccount } from "@/features/users/server/account-deletion-service";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

const { users, workspaceInvitations, workspaceMembers, workspaces } = schema;

/**
 * 실제 PostgreSQL · **실제 연결 여럿**으로 전역 잠금 순서(`@/db`)를 잰다.
 *
 * ```bash
 * DB_INTEGRATION=true pnpm test   # 이 파일은 이때만 돈다
 * ```
 *
 * # 🔴 이 파일만 «되돌리는 Transaction» 을 쓰지 못한다
 *
 * 이 저장소의 다른 통합시험은 전부 하나의 Transaction 안에서 돌고 끝에서 ROLLBACK 한다.
 * 그런데 **잠금 경쟁은 연결이 둘 이상일 때만 생긴다** — 한 연결 안에서는 자기 자신을
 * 기다릴 일이 없다. 그리고 다른 연결이 fixture 를 보려면 그것이 **commit** 돼 있어야 한다.
 *
 * 🔴 그래서 이 파일은 **실제로 행을 남겼다가 반드시 지운다.**
 *
 * - 이름에 `dl-` 접두와 난수를 붙여 **실제 데이터와 절대 겹치지 않게** 만든다
 * - 지우는 것은 **이 파일이 만든 id** 뿐이다. `TRUNCATE` 도, 조건 없는 DELETE 도 쓰지 않는다
 * - 버티는 연결은 `finally` 에서 놓는다 — 시험이 던져도 잠금이 남지 않는다
 * - 마지막 시험이 **정말 하나도 남지 않았는지 다시 조회해 확인한다**
 *
 * # 무엇을 재는가
 *
 * ```
 * 계정 삭제  workspaces -> users -> workspace_members     (account-deletion-service.ts)
 * 초대 수락  workspaces -> users -> workspace_invitations (invitation-service.ts)
 * 초대 발행  workspaces -> users(FK) -> workspace_invitations
 * ```
 *
 * 예전에는 계정 삭제가 `users` 를 **먼저** 잠갔다. 그러면 두 경로가
 * `users -> workspaces` 대 `workspaces -> users` 로 엇갈려 고리가 닫힌다 —
 * 실제로 `40P01 deadlock detected` 가 났다.
 *
 * # 🔴 이 시험의 어려운 부분은 «경쟁»이 아니라 «배리어»다
 *
 * 경쟁을 재현하려면 **상대가 정해진 자리에서 멈춘 것을 확인한 뒤** 다음 요청을 들여보내야
 * 한다. 그 확인이 부정확하면 시험은 **결함이 살아 있어도 초록**이 되거나(거짓 초록),
 * **아무 문제가 없는데 빨개진다**(거짓 빨강). 이 파일이 실제로 그 두 번째로 간헐 실패했고,
 * 원인은 제품이 아니라 **배리어가 「대기 «수»」라는 간접 지표를 셌다는 것**이다.
 * 아래 `lockWaitOf` 의 주석이 그 근거와 대안을 적어 두었다.
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

async function signUp(label: string): Promise<{ id: string; email: string }> {
  const email = `${unique("dl-")}@example.test`;
  const rows = await db()
    .insert(users)
    .values({ email, name: label })
    .returning({ id: users.id });

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }
  created.userIds.push(id);
  return { id, email };
}

async function makeWorkspace(ownerId: string, label: string): Promise<string> {
  const rows = await db()
    .insert(workspaces)
    .values({ slug: unique("dl-"), name: label, createdBy: ownerId })
    .returning({ id: workspaces.id });

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("시험용 Workspace 를 만들지 못했다");
  }
  created.workspaceIds.push(id);

  await db()
    .insert(workspaceMembers)
    .values({ workspaceId: id, userId: ownerId, role: "OWNER" });

  return id;
}

/* ------------------------------------------------------------------------- *
 * 경쟁에 참여하는 연결
 * ------------------------------------------------------------------------- */

/**
 * 경쟁에 참여하는 **전용 연결** 하나.
 *
 * 🔴 **`db()` 의 공용 Pool 을 쓰지 않는다.** Pool 은 어느 요청이 어느 물리 연결로 나갈지
 * 알려 주지 않는다 — 「지금 이 `deleteAccount` 가 «어느» backend 에서 돌고 있는가」를
 * 모르면 그 backend 가 막혔는지 물어볼 수도 없다. 그래서 참여자마다 `Client` 를 하나씩
 * 잡고 **그 자리에서 `pg_backend_pid()` 를 읽어 못 박는다.**
 *
 * 제품 함수들은 전부 `executor` 를 인자로 받으므로(`deleteAccount`·`acceptInvitation`·
 * `createInvitation`) **제품 코드를 고치지 않고** 이 연결 위에서 그대로 돌릴 수 있다.
 */
interface Participant {
  readonly label: string;
  /** 🔴 이 연결의 backend pid. 배리어가 «이 pid 만» 본다. */
  readonly pid: number;
  /** 제품 함수에 그대로 넘기는 executor. */
  readonly db: Database;
  readonly client: Client;
}

async function connect(label: string): Promise<Participant> {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    /**
     * 사람이 `pg_stat_activity` 를 눈으로 볼 때를 위한 **이름표일 뿐이다.**
     * 🔴 배리어는 이 값을 보지 않는다 — 판정 근거는 pid 하나다.
     */
    application_name: `lock-order:${label}`,
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
 * 통째로 멈춘다(실제로 겪었다). 놓는 것 자체가 실패해도 시험을 빨갛게 만들지 않는다 —
 * 그것은 시험의 결론이 아니다.
 */
async function disconnect(...parts: readonly Participant[]): Promise<void> {
  for (const part of parts) {
    try {
      // 열려 있으면 되돌리고, 없으면 PostgreSQL 이 경고만 하고 넘어간다.
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

/** 관찰 주기. 🔴 **타이밍을 «맞추는» 값이 아니라 다시 «물어보는» 간격이다.** */
const POLL_INTERVAL_MS = 20;

/** 배리어가 포기하는 시각. 🔴 flaky 를 덮으려고 늘리지 마라 — 늘릴수록 원인이 숨는다. */
const BARRIER_TIMEOUT_MS = 10_000;

function nextPoll(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}

/** 막혀 있는 backend 가 알려 주는 것. */
interface LockWait {
  /** `transactionid` · `tuple` · `relation` … 무엇을 기다리는가. */
  waitEvent: string | null;
  /** 지금 이 backend 를 막고 있는 backend 들. */
  blockers: number[];
  /** 🔴 **어느 문장에서** 멈췄는가. */
  query: string;
}

/** 배리어가 풀리지 않았을 때 사람에게 보여 줄, 그 backend 의 «지금» 모습. */
interface BackendState {
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  blockers: number[];
  query: string;
}

/** `db().execute` 가 요구하는 모양. 관찰 결과를 담을 뿐 뜻은 위 타입들이 갖는다. */
type Row<T> = T & Record<string, unknown>;

/** pid 목록을 SQL 배열로. 🔴 값이 Database 에서 온 정수임을 여기서 못 박는다. */
function pidArray(pids: readonly number[]) {
  for (const pid of pids) {
    if (!Number.isInteger(pid)) {
      throw new Error(`backend pid 가 정수가 아니다: ${String(pid)}`);
    }
  }
  return sql.raw(`array[${pids.join(", ")}]::int[]`);
}

/**
 * **「pid 가 지금 잠금을 기다리고 있고, 그 blocker 중에 «우리 연결»이 있는가」** — 아니면 `null`.
 *
 * # 🔴 옛 방식이 왜 flaky 했는가 (실측)
 *
 * 배리어가 「**대기 «수»**」를 셌다. 처음에는 `pg_locks` 로 Database **전역**의 대기를 셌고,
 * 그 다음에는 `pg_blocking_pids` 로 **blocker 가 막고 있는 backend 수**를 셌다.
 * 두 번째도 여전히 «간접 지표»다 — **누가 기다리는지는 묻지 않고 몇이 기다리는지만 묻는다.**
 *
 * 이 파일의 둘째 시험은 blocker 가 **`lock table workspace_members in exclusive mode`**
 * 로 **표 전체**를 잠갔다. 그러면 `workspace_members` 에 INSERT 하는 **다른 시험 파일의
 * 연결이 그대로 그 blocker 뒤에 줄을 서고**, 옛 배리어는 그것을 «내 경쟁자»로 세었다.
 * vitest 는 파일을 병렬 워커로 돌리므로 이 일은 언제든 일어난다.
 *
 * 실제 PostgreSQL 로 재현해 숫자를 찍어 봤다 — 이 시험의 참여자는 **하나도 시작하지 않은
 * 상태**에서, 상관없는 연결 둘이 소속을 하나씩 INSERT 하자:
 *
 * ```
 * blocker 가 표를 잠근 직후        waiters() = 0
 * 남의 연결 하나가 막힌 뒤          waiters() = 1   <- 옛 배리어 `>= 1` 이 여기서 풀린다
 * 남의 연결 둘이 막힌 뒤            waiters() = 2   <- 옛 배리어 `>= 2` 도 여기서 풀린다
 * ```
 *
 * 즉 **수락이 아직 초대를 소진하지도 않았는데 발행이 들어갔다.** 그러면 발행은 아직 살아
 * 있는 옛 초대와 부딪혀 `INVITATION_ALREADY_PENDING` 으로 거절되고, 시험은
 * `WORKSPACE_MEMBER_ALREADY` 를 기대하다 **빨개진다.** 제품은 멀쩡한데 시험이 진 것이다.
 *
 * # 🔴 그래서 «수»를 세지 않는다
 *
 * 배리어가 묻는 것은 이제 하나다 — **「내가 방금 실행한 그 연결이, 내 다른 연결 때문에,
 * 지금 잠금을 기다리고 있는가」.** 셋 다 직접 관찰이다:
 *
 * ```
 * a.pid = <내 참여자의 pid>          어느 연결인지  — Pool 이 아니라 전용 Client 라 확정된다
 * a.state = 'active'                 지금 문장을 돌리는 중인가
 * a.wait_event_type = 'Lock'         그 문장이 «잠금»을 기다리는가 (I/O·Client 대기가 아니다)
 * pg_blocking_pids(a.pid) && 내것들   막고 있는 것이 «내 연결»인가
 * ```
 *
 * 🔴 **남의 대기가 섞일 자리가 없다.** 옛 방식은 「blocker 를 기다리는 아무나」를 셌지만,
 * 이것은 「**이** pid 가 막혔는가」를 묻는다 — 다른 파일이 무엇을 하든 이 답은 바뀌지 않는다.
 * 남의 연결이 같은 잠금을 함께 기다려도 우리 pid 의 `state`·`wait_event_type` 은 그대로다.
 *
 * `query` 까지 함께 읽어 두면 **「어느 문장에서 멈췄는가」**를 시험이 직접 확인할 수 있다 —
 * 「막히기는 했는데 엉뚱한 자리였다」는 거짓 초록을 여기서 걸러 낸다.
 */
async function lockWaitOf(
  pid: number,
  blockedBy: readonly number[],
): Promise<LockWait | null> {
  const result = await db().execute<Row<LockWait>>(sql`
    select a.wait_event              as "waitEvent",
           pg_blocking_pids(a.pid)   as "blockers",
           a.query                   as "query"
      from pg_stat_activity a
     where a.pid = ${pid}
       and a.state = 'active'
       and a.wait_event_type = 'Lock'
       and pg_blocking_pids(a.pid) && ${pidArray(blockedBy)}
  `);

  return result.rows[0] ?? null;
}

/** 배리어가 풀리지 않았을 때 **왜 안 풀렸는지** 그대로 적어 준다. */
async function describeBackend(pid: number): Promise<string> {
  const result = await db().execute<Row<BackendState>>(sql`
    select a.state                   as "state",
           a.wait_event_type         as "waitEventType",
           a.wait_event              as "waitEvent",
           pg_blocking_pids(a.pid)   as "blockers",
           a.query                   as "query"
      from pg_stat_activity a
     where a.pid = ${pid}
  `);

  const row = result.rows[0];
  if (row === undefined) {
    return `pid ${pid} 은 pg_stat_activity 에 없다 (연결이 이미 끊겼다)`;
  }

  return (
    `pid ${pid}: state=${row.state ?? "-"} ` +
    `wait=${row.waitEventType ?? "-"}/${row.waitEvent ?? "-"} ` +
    `blockers=[${row.blockers.join(",")}] query=${row.query}`
  );
}

/**
 * `who` 가 `blockedBy` 중 하나 때문에 **실제로 잠금을 기다리는 상태**가 될 때까지 기다린다.
 *
 * 🔴 **고정 대기(sleep)로 순서를 «믿지» 않는다.** 기계가 바쁘면 그 순서가 뒤집히고,
 * 뒤집힌 시험은 결함이 살아 있어도 초록이 된다. 「막혔다」는 사실을 Database 에 직접 묻는다.
 */
async function untilLockWait(
  who: Participant,
  blockedBy: readonly Participant[],
  what: string,
): Promise<LockWait> {
  const pids = blockedBy.map((part) => part.pid);
  const deadline = Date.now() + BARRIER_TIMEOUT_MS;

  for (;;) {
    const wait = await lockWaitOf(who.pid, pids);
    if (wait !== null) {
      return wait;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `${what} — ${who.label} 이 막히지 않았다. ${await describeBackend(who.pid)}`,
      );
    }
    await nextPoll();
  }
}

/**
 * `who` 가 잠금 대기에 **들어가는 순간**을 지켜본다 — 「기다린 적이 있는가」를 재는 쪽이다.
 *
 * 🔴 **본 적이 없으면 영원히 결말이 나지 않는다.** 「아직 못 봤다」를 「기다린 적 없다」로
 * 바꿔 돌려주면, 관찰이 늦은 것뿐인데 시험이 초록이 된다. 결말은 «봤을 때»만 낸다 —
 * 못 본 채로 끝나는 판정은 **상대 Promise 가 끝났다는 사실**이 내린다.
 */
function watchLockWait(
  who: Participant,
  blockedBy: readonly Participant[],
): { seen: Promise<LockWait>; stop: () => void } {
  const pids = blockedBy.map((part) => part.pid);
  let stopped = false;

  const seen = new Promise<LockWait>((resolve, reject) => {
    const poll = async (): Promise<void> => {
      while (!stopped) {
        const wait = await lockWaitOf(who.pid, pids);
        if (wait !== null) {
          resolve(wait);
          return;
        }
        await nextPoll();
      }
    };

    poll().catch((error: unknown) => {
      if (!stopped) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });

  // 관찰을 그만둔 뒤 늦게 도착하는 오류가 unhandled 로 남지 않게 한다.
  seen.catch(() => undefined);

  return {
    seen,
    stop: () => {
      stopped = true;
    },
  };
}

/**
 * `40P01 deadlock detected` 인가.
 *
 * 🔴 **겉만 보면 안 된다.** Drizzle 은 Driver 오류를 `DrizzleQueryError` 로 **감싸서** 던지고
 * 원본은 `cause` 에 들어간다 — 겉 객체에는 `code` 가 없다. 예전에는 겉만 봤고, 그래서
 * 되돌림 확인에서 **진짜 deadlock 이 났는데도 이 함수가 `false` 를 돌려줬다**(시험은
 * 뒤따르는 다른 assertion 덕에 빨개졌을 뿐, 정작 deadlock 을 보는 두 줄은 통과했다).
 * 원인 사슬을 따라 내려가 확인한다.
 */
function isDeadlock(error: unknown): boolean {
  let current: unknown = error;

  // 사슬이 스스로를 가리켜도 멈추도록 깊이를 제한한다.
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }
    if ((current as { code?: unknown }).code === "40P01") {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

describe.skipIf(!enabled)("전역 잠금 순서 — 실제 연결 여럿", () => {
  /**
   * # 🔴 계정 삭제 ↔ 초대 수락이 서로를 물지 않는다
   *
   * ## 무엇이 깨져 있었는가
   *
   * ```
   * 계정 삭제  users(FOR UPDATE) -> workspaces -> ... -> 그 사람 이메일의 초대 행 DELETE
   * 초대 수락  workspaces -> 초대 행 UPDATE(accepted_by FK 가 users 를 잠근다)
   * ```
   *
   * 잠그는 «대상»이 아니라 **순서**가 엇갈렸다. 삭제가 `users` 를 쥔 채 초대 행을 기다리고,
   * 수락이 초대 행을 쥔 채 `users` 를 기다린다 — 고리가 닫힌다.
   *
   * ## 어떻게 재는가
   *
   * ```
   * blocker    삭제가 «가장 먼저» 잠글 Workspace 행을 미리 쥔다   (시간을 못 박는 도구)
   * deleter    계정 삭제 — Workspace 잠금 앞에서 멈춘다
   * accepter   초대 수락 — 순서가 옳으면 «여기서 끝난다»
   * ```
   *
   * 🔴 **blocker 가 잠그는 것은 «이 시험이 만든 Workspace 행 하나»뿐이다.** 표를 잠그지
   * 않으므로 다른 시험 파일이 이 잠금 뒤에 줄을 설 일이 없다.
   *
   * 🔴 **되돌림 확인**: `deleteAccount` 의 `lockAccountRow` 를 `lockMyWorkspaces` 앞으로
   * 되돌리고 `acceptInvitation` 의 `lockAccountRow` 를 지우면, 이 시험이 실제로
   * `40P01 deadlock detected` 로 실패한다. 직접 돌려 보고 되돌렸다.
   */
  it("🔴 계정 삭제와 초대 수락을 동시에 돌려도 deadlock 이 나지 않는다", async () => {
    const me = await signUp("삭제하는 사람");
    const host = await signUp("초대하는 사람");

    // 내 Personal Workspace — 삭제가 잠그고 통째로 지울 대상이다.
    const personalId = await ensurePersonalWorkspace(
      { userId: me.id, displayName: "삭제하는 사람", slugSource: unique("dl-") },
      db(),
    );
    created.workspaceIds.push(personalId);

    // 남의 Workspace — 수락이 잠글 대상이다. 🔴 내가 «속하지 않은» 곳이어야 한다.
    const teamId = await makeWorkspace(host.id, "Deadlock Team");

    /*
      🔴 이 초대가 고리의 «두 번째 변»이다.

      초대 행에는 내 이메일이 적혀 있고, 계정 삭제는 그 이메일이 적힌 초대 행을 지운다.
      수락은 같은 행을 UPDATE 한다 — 두 경로가 같은 행을 두고 만난다.
    */
    const invitation = await createInvitation(
      { workspaceId: teamId, email: me.email, invitedBy: host.id },
      db(),
    );

    const blocker = await connect("blocker");
    const deleter = await connect("deleter");
    const accepter = await connect("accepter");

    let deletionError: unknown = null;
    let acceptanceResult: unknown = null;
    let acceptedBeforeRelease = false;

    try {
      // blocker — 삭제가 가장 먼저 잡을 «그 행»을 미리 쥔다.
      await blocker.client.query("begin");
      await blocker.client.query(
        'select "id" from "workspaces" where "id" = $1 for update',
        [personalId],
      );

      // deleter — 계정 삭제. Workspace 잠금 앞에서 멈춘다.
      const deletion = deleteAccount({ userId: me.id }, deleter.db).then(
        () => null,
        (error: unknown) => error,
      );

      const stopped = await untilLockWait(
        deleter,
        [blocker],
        "계정 삭제가 Workspace 잠금 앞에서 멈춘 상태",
      );

      /*
        🔴 **막힌 «자리»까지 확인한다.** 「막히기는 했다」만 보면, 엉뚱한 문장에서 멈춘
        것을 우리가 기다리던 상태로 착각한 채 다음 요청을 들여보내게 된다.
      */
      expect(stopped.query).toMatch(/"workspaces"[\s\S]*for update/i);

      // accepter — 초대 수락. 🔴 여기서 `users` 를 기다리기 시작하면 고리가 닫힌다.
      const acceptance = acceptInvitation(
        { token: invitation.token, userId: me.id },
        accepter.db,
      ).then(
        (slug) => slug as unknown,
        (error: unknown) => error,
      );

      /*
        🔴 잠금 순서가 옳으면 **수락은 여기서 이미 끝난다** — 계정 삭제가 `users` 를 아직
        잡지 않았기 때문이다. 그래서 blocker 를 놓기 «전»에 수락이 끝나는지 본다.

        🔴 **시계로 재지 않는다.** 예전에는 「2초 안에 끝나면 기다리지 않은 것」으로 쳤는데,
        그것은 기계가 바쁘면 그대로 거짓 빨강이 된다. 대신 **수락이 잠금 대기에 들어가는
        순간을 직접 지켜본다** — 둘 중 먼저 일어난 쪽이 답이다.
      */
      const watch = watchLockWait(accepter, [deleter, blocker]);
      try {
        acceptedBeforeRelease = await Promise.race([
          acceptance.then(() => true),
          watch.seen.then(() => false),
        ]);
      } finally {
        watch.stop();
      }

      await blocker.client.query("rollback");

      deletionError = await deletion;
      acceptanceResult = await acceptance;
    } finally {
      await disconnect(blocker, deleter, accepter);
    }

    // 🔴 어느 쪽도 deadlock 으로 죽지 않았다.
    expect(isDeadlock(deletionError)).toBe(false);
    expect(isDeadlock(acceptanceResult)).toBe(false);

    // 둘 다 «성공»했다 — 어느 하나가 조용히 오류로 끝난 것이 아니다.
    expect(deletionError).toBeNull();
    const teamSlug = await db()
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, teamId));
    expect(acceptanceResult).toBe(teamSlug[0]?.slug);

    // 🔴 수락이 계정 삭제를 기다리지 않았다는 것까지 본다(잠금 순서의 결과다).
    expect(acceptedBeforeRelease).toBe(true);

    // 계정과 Personal Workspace 는 사라지고, 남의 Workspace 는 그대로다.
    const survivors = await db()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, me.id));
    expect(survivors).toHaveLength(0);
    expect(teamSlug).toHaveLength(1);

    // 내 이메일이 적힌 초대 행은 남지 않는다.
    const leftovers = await db()
      .select({ id: workspaceInvitations.id })
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.email, me.email));
    expect(leftovers).toHaveLength(0);
  }, 60_000);

  /**
   * # 🔴 초대 발행이 수락과 겹쳐도 「이미 멤버」에게 새 Token 이 나가지 않는다
   *
   * ## 무엇이 깨져 있었는가
   *
   * 발행 문장은 `INSERT ... SELECT ... WHERE NOT EXISTS` 하나였다. 조건이 쓰는 문장 «안»에
   * 있으니 안전해 보이지만, `NOT EXISTS` 도 READ COMMITTED 의 **statement snapshot** 으로
   * 평가된다. 발행이 먼저 snapshot 을 잡고 부분 unique 충돌로 «기다리는» 사이에 수락이
   * commit 하면, 옛 초대 행이 index 밖으로 빠져 **INSERT 가 성공한다** —
   * `NOT EXISTS` 는 이미 옛 snapshot 으로 평가된 뒤다.
   *
   * 수락은 초대 주소와 계정 주소를 맞대므로 다른 계정이 Token 만으로 들어오지는 못한다.
   * 그래도 이미 멤버인 주소 앞으로 쓸 수 없는 bearer credential 을 다시 내면 안 된다.
   *
   * ## 어떻게 재는가 — 🔴 잠금을 «하나도 더» 걸지 않는다
   *
   * 필요한 상태는 하나다 — **「수락이 초대 행을 소진했지만 아직 commit 되지 않았다」.**
   *
   * 예전에는 그 상태를 만들려고 `lock table workspace_members in exclusive mode` 로
   * **표 전체**를 잠갔다. 그것이 이 파일 flaky 의 원인이었다(`lockWaitOf` 주석) — 게다가
   * 병렬로 도는 **다른 시험 파일들의 소속 INSERT 를 통째로 세워 둔다**(그 표에 쓰는 통합시험
   * 파일이 여섯이다).
   *
   * 🔴 **잠금 대신 «commit 시점»을 쥔다.** 수락을 이 하네스가 연 Transaction 안에서 부르면
   * 제품 경로는 그대로 다 돌고(초대 행 UPDATE · 소속 INSERT · 잠금 전부 그대로), **COMMIT 만**
   * 우리가 쥐게 된다. Drizzle 은 열린 Transaction 안의 `transaction()` 을 SAVEPOINT 로 잇고
   * SAVEPOINT 는 잠금을 놓지 않으므로, 경쟁이 보는 상태는 전과 같다.
   *
   * ```
   * accepter   수락 — 다 돌았지만 COMMIT 전에서 «결정적으로» 멈춘다  (배리어가 필요 없다)
   * issuer     발행 — 수락이 쥔 것 앞에서 멈춘다                     (배리어가 이것만 본다)
   * COMMIT -> 발행이 «새 snapshot» 으로 판정 -> 이미 멤버다
   * ```
   *
   * 🔴 **발행이 «어느» 문장에서 멈추는지는 굳이 고정하지 않는다.** 지금 구현에서는
   * `lockWorkspaceRow` 의 `for update` 이고, 그것을 되돌리면 부분 unique index 충돌이다 —
   * 둘 다 「수락 뒤에 줄을 섰다」는 같은 뜻이다. 한쪽으로 못 박으면 되돌림 확인이
   * 「배리어가 안 풀렸다」는 엉뚱한 실패로 바뀐다.
   *
   * 🔴 **되돌림 확인**: `createInvitation` 의 `lockWorkspaceRow` 를 지우면 발행이 옛
   * snapshot 으로 INSERT 에 성공해 이 시험이 실패한다. 직접 돌려 보고 되돌렸다.
   */
  it("🔴 수락과 겹친 초대 발행이 살아 있는 Token 을 하나 더 만들지 않는다", async () => {
    const host = await signUp("초대하는 사람");
    const guest = await signUp("초대받는 사람");
    const workspaceId = await makeWorkspace(host.id, "Race Team");

    const first = await createInvitation(
      { workspaceId, email: guest.email, invitedBy: host.id },
      db(),
    );

    const accepter = await connect("accepter");
    const issuer = await connect("issuer");

    let acceptanceResult: unknown = null;
    let issuanceResult: unknown = null;

    try {
      /*
        🔴 `pending` 을 «객체에 담아» 돌려준다. 그대로 돌려주면 Drizzle 이 commit 하기
        «전»에 await 되어(Promise 가 펼쳐진다) 발행이 영원히 풀리지 않는다.
      */
      const { pending } = await accepter.db.transaction(async (tx) => {
        acceptanceResult = await acceptInvitation(
          { token: first.token, userId: guest.id },
          tx,
        ).then(
          (slug) => slug as unknown,
          (error: unknown) => error,
        );

        // issuer — 발행. 🔴 여기가 갈리는 자리다.
        const issuance = createInvitation(
          { workspaceId, email: guest.email, invitedBy: host.id },
          issuer.db,
        ).then(
          (invitation) => invitation as unknown,
          (error: unknown) => error,
        );

        // 발행이 «수락 때문에» 실제로 막힌 것을 확인하고 나서야 commit 한다.
        await untilLockWait(
          issuer,
          [accepter],
          "발행이 수락 뒤에서 자리를 잡고 기다리는 상태",
        );

        return { pending: issuance };
      });

      issuanceResult = await pending;
    } finally {
      await disconnect(accepter, issuer);
    }

    // 수락은 성공한다.
    expect(typeof acceptanceResult).toBe("string");

    // 🔴 발행은 «이미 멤버» 로 거절된다 — 새 Token 이 나가지 않는다.
    expect(issuanceResult).toBeInstanceOf(Error);
    expect((issuanceResult as { reason?: string }).reason).toBe(
      "WORKSPACE_MEMBER_ALREADY",
    );

    // 🔴 Database 로 다시 확인한다 — 소속 둘, 살아 있는 초대 0개.
    const members = await db()
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    expect(members.map((row) => row.userId).sort()).toEqual(
      [host.id, guest.id].sort(),
    );

    const live = await db()
      .select({ id: workspaceInvitations.id })
      .from(workspaceInvitations)
      .where(
        sql`${workspaceInvitations.workspaceId} = ${workspaceId}
              and ${workspaceInvitations.acceptedAt} is null
              and ${workspaceInvitations.revokedAt} is null`,
      );
    expect(live).toHaveLength(0);
  }, 60_000);

  /** 🔴 이 파일이 만든 것이 하나도 남지 않았음을 **조회로** 확인한다. */
  it("🔴 시험이 만든 행이 남지 않는다", async () => {
    await cleanUp();

    const leftoverUsers = await db()
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.email} like 'dl-%@example.test'`);
    expect(leftoverUsers).toHaveLength(0);

    const leftoverWorkspaces = await db()
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(sql`${workspaces.slug} like 'dl-%'`);
    expect(leftoverWorkspaces).toHaveLength(0);

    const leftoverInvitations = await db()
      .select({ id: workspaceInvitations.id })
      .from(workspaceInvitations)
      .where(sql`${workspaceInvitations.email} like 'dl-%@example.test'`);
    expect(leftoverInvitations).toHaveLength(0);
  });
});
