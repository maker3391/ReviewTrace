import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import {
  acceptInvitation,
  createInvitation,
} from "@/features/invitations/server/invitation-service";
import { deleteAccount } from "@/features/users/server/account-deletion-service";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

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

async function makeWorkspace(
  ownerId: string,
  label: string,
): Promise<string> {
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

/** 몇 밀리초에 한 번 조건을 다시 본다. */
async function until(
  condition: () => Promise<boolean>,
  what: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`기다리던 상태가 오지 않았다: ${what}`);
}

/**
 * 잠금을 기다리고 있는 backend 수.
 *
 * 🔴 **고정 대기(sleep)로 순서를 «믿지» 않는다.** 기계가 바쁘면 그 순서가 뒤집히고,
 * 뒤집힌 시험은 결함이 살아 있어도 초록이 된다. 「누가 기다리기 시작했다」는 사실을
 * Database 에 직접 묻는다. 이 파일의 시험들은 **한 파일 안에서 차례로** 도므로 서로의
 * 대기를 섞어 세지 않는다.
 */
async function waiters(): Promise<number> {
  const result = await db().execute<{ n: number }>(
    sql`select count(*)::int as n from pg_locks where not granted`,
  );
  return result.rows[0]?.n ?? 0;
}

/**
 * 한 연결이 잠금을 쥐고 버티는 동안 `body` 를 돌린다.
 *
 * 🔴 이것은 «제품 경로»가 아니라 **시간을 못 박는 도구**다. 이것이 있어야 상대 경로가
 * 정해진 자리에서 «반드시» 멈추고, 그 상태에서 다른 요청을 들여보낼 수 있다.
 *
 * 🔴 **`finally` 에서 반드시 놓는다.** 시험이 도중에 던져도 잠금이 남지 않는다 —
 * 남으면 뒤따르는 정리 DELETE 가 통째로 멈춘다(실제로 겪었다).
 */
async function holdingLock(
  acquire: (tx: DbExecutor) => Promise<unknown>,
  body: (release: () => void) => Promise<void>,
): Promise<void> {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready: () => void = () => {};
  const isReady = new Promise<void>((resolve) => {
    ready = resolve;
  });

  const blocker = db().transaction(async (tx) => {
    await acquire(tx);
    ready();
    await released;
  });

  try {
    // 잠금을 못 잡고 죽는 경우까지 본다 — 그러면 여기서 곧바로 터진다.
    await Promise.race([
      isReady,
      blocker.then(() => {
        throw new Error("버티는 연결이 잠금을 잡지 못했다");
      }),
    ]);
    await body(release);
  } finally {
    release();
    await blocker.catch(() => undefined);
  }
}

function isDeadlock(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "40P01"
  );
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
   * 연결 0   삭제가 잠글 Workspace 행을 미리 쥔다   (시간을 못 박는 도구)
   * 연결 1   계정 삭제 — Workspace 잠금 앞에서 멈춘다
   * 연결 2   초대 수락 — 순서가 옳으면 «여기서 끝난다»
   * ```
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

    let deletionError: unknown = null;
    let acceptanceResult: unknown = null;
    let acceptedBeforeRelease = false;

    await holdingLock(
      (tx) =>
        tx
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.id, personalId))
          .for("update"),
      async (release) => {
        // 연결 1 — 계정 삭제. Workspace 잠금 앞에서 멈춘다.
        const deletion = deleteAccount({ userId: me.id }).then(
          () => null,
          (error: unknown) => error,
        );

        await until(
          async () => (await waiters()) >= 1,
          "계정 삭제가 Workspace 잠금을 기다리는 상태",
        );

        // 연결 2 — 초대 수락. 🔴 여기서 `users` 를 기다리기 시작하면 고리가 닫힌다.
        const acceptance = acceptInvitation({
          token: invitation.token,
          userId: me.id,
        }).then(
          (slug) => slug as unknown,
          (error: unknown) => error,
        );

        /*
          🔴 잠금 순서가 옳으면 **수락은 여기서 이미 끝난다** — 계정 삭제가 `users` 를 아직
          잡지 않았기 때문이다. 그래서 버티던 연결을 놓기 «전»에 수락이 끝나는지 본다.
        */
        acceptedBeforeRelease = await Promise.race([
          acceptance.then(() => true),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(false), 2_000),
          ),
        ]);

        release();

        deletionError = await deletion;
        acceptanceResult = await acceptance;
      },
    );

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
   * 🔴 초대는 이메일을 대조하지 않는 **bearer credential** 이다. 그 새 Token 을 주운
   * 다른 계정이 그대로 그 Workspace 에 들어온다.
   *
   * ## 어떻게 재는가 — 멈춰 세우는 «자리»가 요점이다
   *
   * 수락이 초대 행을 소진하기 **전**에 멈추면 발행은 commit 된 옛 행과 부딪혀 곧바로
   * 거절당하고, 그러면 문제의 경쟁이 재현되지 않는다. **소속 INSERT 앞**에서 멈춰야
   * 「초대 행은 이미 갱신됐지만 아직 commit 되지 않은」 상태가 만들어진다.
   *
   * ```
   * 연결 0   소속 표를 EXCLUSIVE 로 잠근다        (평범한 SELECT 는 막지 않는다)
   * 연결 1   수락 — 초대를 소진하고 소속 INSERT 앞에서 멈춘다
   * 연결 2   발행 — 같은 Workspace 를 잠그려다 멈춘다
   * 놓음 -> 수락 commit -> 발행이 «새 snapshot» 으로 판정 -> 이미 멤버다
   * ```
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

    let acceptanceResult: unknown = null;
    let issuanceResult: unknown = null;

    await holdingLock(
      (tx) => tx.execute(sql`lock table workspace_members in exclusive mode`),
      async (release) => {
        // 연결 1 — 수락. 초대를 소진한 뒤 소속 INSERT 앞에서 멈춘다.
        const acceptance = acceptInvitation({
          token: first.token,
          userId: guest.id,
        }).then(
          (slug) => slug as unknown,
          (error: unknown) => error,
        );

        await until(
          async () => (await waiters()) >= 1,
          "수락이 소속 INSERT 앞에서 멈춘 상태",
        );

        // 연결 2 — 발행. 🔴 여기가 갈리는 자리다.
        const issuance = createInvitation(
          { workspaceId, email: guest.email, invitedBy: host.id },
          db(),
        ).then(
          (invitation) => invitation as unknown,
          (error: unknown) => error,
        );

        // 발행도 «기다리는 상태»가 된 것을 확인하고 나서 놓는다.
        await until(
          async () => (await waiters()) >= 2,
          "발행이 자리를 잡고 기다리는 상태",
        );

        release();

        acceptanceResult = await acceptance;
        issuanceResult = await issuance;
      },
    );

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
