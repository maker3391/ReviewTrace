import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

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
  findInvitationPreview,
  listPendingInvitations,
  revokeInvitation,
} from "@/features/invitations/server/invitation-service";
import { isAppError } from "@/lib/errors";

/**
 * 실제 PostgreSQL 로 보는 **초대 취소 lifecycle**.
 *
 * ```
 * 발행 ──> 수락        소속이 생긴다. 취소 대상이 아니다
 *      ──> 만료        행은 살아 있다. 재초대가 그 행을 «회전»시킨다
 *      ──> 취소        Token 무효 · 목록에서 사라짐 · 재초대는 «새 행»
 * ```
 *
 * ## 🔴 왜 Fake 로는 부족한가
 *
 * 취소가 지키는 것은 전부 **SQL 조건**이다 — 「그 Workspace 것인가」·「아직 수락되지
 * 않았는가」·「이미 취소되지 않았는가」·「취소된 Token 으로 수락할 수 없는가」.
 * `fakeExecutor` 는 `where` 를 해석하지 않으므로 조건을 통째로 지워도 초록이다
 * (`src/db/testing/fake-executor.ts` 가 그 한계를 스스로 적어 두었다).
 * 그래서 이 파일이 있다.
 *
 * ```bash
 * pnpm test                       # 통째로 건너뛴다
 * DB_INTEGRATION=true pnpm test   # PostgreSQL 이 떠 있어야 한다
 * ```
 *
 * 🔴 **데이터를 남기지 않는다.** 전부 되돌려지는 Transaction 안에서 돌고, 있는 데이터를
 * 지우거나 바꾸지 않으며 `TRUNCATE` 도 쓰지 않는다.
 *
 * 🔴 **여기서 보지 «않는» 것**: 「(Workspace, Email) 당 살아 있는 초대는 하나」와
 * 「취소가 재초대를 막지 않는다」는 부분 unique index 가 지키는 것이라
 * `invitation-invariant.integration.test.ts` 에 있다.
 */
const enabled = process.env.DB_INTEGRATION === "true";

beforeAll(() => {
  if (enabled) {
    loadIntegrationDbEnv();
  }
});

class Rollback extends Error {}

/** 되돌려지는 Transaction 안에서 돌린다. 끝나면 행이 하나도 남지 않는다. */
async function rolledBack(run: (tx: DbExecutor) => Promise<void>): Promise<void> {
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
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

async function createUser(tx: DbExecutor, email?: string): Promise<string> {
  const rows = await tx
    .insert(users)
    .values({ email: email ?? `${unique("user")}@example.test`, name: "Tester" })
    .returning({ id: users.id });

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }
  return id;
}

async function createWorkspace(tx: DbExecutor, ownerId: string): Promise<string> {
  const rows = await tx
    .insert(workspaces)
    .values({ slug: unique("rev-"), name: "Revoke", createdBy: ownerId })
    .returning({ id: workspaces.id });

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("시험용 Workspace 를 만들지 못했다");
  }
  return id;
}

/** 방금 만든 초대의 행 id. 목록은 취소된 것을 감추므로 표를 직접 본다. */
async function invitationIdOf(
  tx: DbExecutor,
  workspaceId: string,
  email: string,
): Promise<string> {
  const rows = await tx
    .select({ id: workspaceInvitations.id })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        eq(workspaceInvitations.email, email),
      ),
    );

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("초대 행을 찾지 못했다");
  }
  return id;
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

const GUEST = "guest@example.test";

describe.skipIf(!enabled)("초대 취소", () => {
  it("🔴 Token 을 가진 다른 이메일 계정은 초대를 소진하지 못한다", async () => {
    await rolledBack(async (tx) => {
      const owner = await createUser(tx);
      const recipient = await createUser(tx, GUEST);
      const attacker = await createUser(tx);
      const workspace = await createWorkspace(tx, owner);
      const invitation = await createInvitation(
        { workspaceId: workspace, email: GUEST, invitedBy: owner },
        tx,
      );

      const error = await rejection(
        acceptInvitation({ token: invitation.token, userId: attacker }, tx),
      );
      expect(isAppError(error) && error.code).toBe("NOT_FOUND");

      const attackerMembership = await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspace),
            eq(workspaceMembers.userId, attacker),
          ),
        );
      expect(attackerMembership).toHaveLength(0);

      // 잘못된 시도가 Token 을 소진하지 않았으므로 실제 수신자는 그대로 수락할 수 있다.
      await expect(
        acceptInvitation({ token: invitation.token, userId: recipient }, tx),
      ).resolves.toBeTruthy();
    });
  });

  /**
   * # 🔴 이것이 취소가 존재하는 이유다
   *
   * 취소가 목록에서 행을 감추기만 하면 **이미 새어 나간 Token 은 그대로 살아 있다.**
   * 그러면 기능이 있으나 마나다.
   *
   * 🔴 **되돌림 확인이 시험 안에 있다.** 수락 UPDATE 에서 `revoked_at IS NULL` 을 뺀 것과
   * 같은 조건으로 같은 Token 을 잡아 보아 **잡히는 것**까지 본다 — 그러지 않으면
   * 「원래 못 쓰는 Token 아닌가」와 구분되지 않는다.
   */
  it("🔴 취소된 Token 으로는 수락할 수 없다 (보호를 빼면 그 행이 그대로 잡힌다)", async () => {
    await rolledBack(async (tx) => {
      const owner = await createUser(tx);
      const guest = await createUser(tx, GUEST);
      const workspace = await createWorkspace(tx, owner);

      const invitation = await createInvitation(
        { workspaceId: workspace, email: GUEST, invitedBy: owner },
        tx,
      );
      await revokeInvitation(
        {
          workspaceId: workspace,
          invitationId: await invitationIdOf(tx, workspace, GUEST),
        },
        tx,
      );

      const error = await rejection(
        acceptInvitation({ token: invitation.token, userId: guest }, tx),
      );
      expect(isAppError(error) && error.code).toBe("NOT_FOUND");

      // 소속이 생기지 않았다.
      const membership = await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspace),
            eq(workspaceMembers.userId, guest),
          ),
        );
      expect(membership).toHaveLength(0);

      // 초대는 소진되지 않았다 — 취소됐을 뿐이다.
      const rows = await tx
        .select({
          acceptedAt: workspaceInvitations.acceptedAt,
          revokedAt: workspaceInvitations.revokedAt,
        })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.workspaceId, workspace));
      expect(rows[0]?.acceptedAt).toBeNull();
      expect(rows[0]?.revokedAt).not.toBeNull();

      /*
        🔴 되돌림: `revoked_at IS NULL` 이 없는 조건은 **같은 행을 그대로 잡는다.**
        보호가 실제로 무언가를 막고 있다는 증거다.
      */
      const withoutGuard = await tx
        .select({ id: workspaceInvitations.id })
        .from(workspaceInvitations)
        .where(
          and(
            eq(workspaceInvitations.workspaceId, workspace),
            eq(workspaceInvitations.email, GUEST),
          ),
        );
      expect(withoutGuard).toHaveLength(1);
    });
  });

  it("🔴 다른 Workspace 의 초대는 취소되지 않는다 — id 를 알아도 «404» 다", async () => {
    await rolledBack(async (tx) => {
      const owner = await createUser(tx);
      const acme = await createWorkspace(tx, owner);
      const other = await createWorkspace(tx, owner);

      const invitation = await createInvitation(
        { workspaceId: acme, email: GUEST, invitedBy: owner },
        tx,
      );
      const invitationId = await invitationIdOf(tx, acme, GUEST);

      const error = await rejection(
        // 남의 Workspace 의 초대 id 를 그대로 지목한다.
        revokeInvitation({ workspaceId: other, invitationId }, tx),
      );
      // 🔴 `FORBIDDEN` 이 아니다 — 구분해 주면 그 id 가 실재한다는 사실이 새어 나간다.
      expect(isAppError(error) && error.code).toBe("NOT_FOUND");

      // 초대는 멀쩡하다 — 원래 Workspace 의 목록에 그대로 있고 Token 도 살아 있다.
      expect(await listPendingInvitations(acme, tx)).toHaveLength(1);
      expect(await findInvitationPreview(invitation.token, tx)).not.toBeNull();
    });
  });

  it("이미 수락된 초대는 취소 대상이 아니다 — 소속은 그대로 남는다", async () => {
    await rolledBack(async (tx) => {
      const owner = await createUser(tx);
      const guest = await createUser(tx, GUEST);
      const workspace = await createWorkspace(tx, owner);

      const invitation = await createInvitation(
        { workspaceId: workspace, email: GUEST, invitedBy: owner },
        tx,
      );
      const invitationId = await invitationIdOf(tx, workspace, GUEST);
      await acceptInvitation({ token: invitation.token, userId: guest }, tx);

      const error = await rejection(
        revokeInvitation({ workspaceId: workspace, invitationId }, tx),
      );
      expect(isAppError(error) && error.code).toBe("NOT_FOUND");

      // 🔴 소속을 되돌리는 일은 「초대 취소」가 아니라 「멤버 내보내기」다.
      const membership = await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspace),
            eq(workspaceMembers.userId, guest),
          ),
        );
      expect(membership).toHaveLength(1);

      const rows = await tx
        .select({ revokedAt: workspaceInvitations.revokedAt })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.id, invitationId));
      expect(rows[0]?.revokedAt).toBeNull();
    });
  });

  it("취소된 초대는 수락 대기 목록에서 사라지고 미리보기도 열리지 않는다", async () => {
    await rolledBack(async (tx) => {
      const owner = await createUser(tx);
      const workspace = await createWorkspace(tx, owner);

      const invitation = await createInvitation(
        { workspaceId: workspace, email: GUEST, invitedBy: owner },
        tx,
      );
      expect(await listPendingInvitations(workspace, tx)).toHaveLength(1);
      expect(await findInvitationPreview(invitation.token, tx)).not.toBeNull();

      await revokeInvitation(
        {
          workspaceId: workspace,
          invitationId: await invitationIdOf(tx, workspace, GUEST),
        },
        tx,
      );

      expect(await listPendingInvitations(workspace, tx)).toHaveLength(0);
      // 🔴 「취소됐습니다」가 아니라 「없는 초대」와 같은 결과다.
      expect(await findInvitationPreview(invitation.token, tx)).toBeNull();

      // 🔴 행은 남는다 — 누구를 초대했다가 거뒀는지가 History 로 보존된다.
      const rows = await tx
        .select({ email: workspaceInvitations.email })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.workspaceId, workspace));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.email).toBe(GUEST);
    });
  });

  it("이미 취소된 초대를 다시 취소하지 못한다 — 취소 시각이 덮어써지지 않는다", async () => {
    await rolledBack(async (tx) => {
      const owner = await createUser(tx);
      const workspace = await createWorkspace(tx, owner);

      await createInvitation(
        { workspaceId: workspace, email: GUEST, invitedBy: owner },
        tx,
      );
      const invitationId = await invitationIdOf(tx, workspace, GUEST);
      await revokeInvitation({ workspaceId: workspace, invitationId }, tx);

      const first = await tx
        .select({ revokedAt: workspaceInvitations.revokedAt })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.id, invitationId));

      const error = await rejection(
        revokeInvitation({ workspaceId: workspace, invitationId }, tx),
      );
      expect(isAppError(error) && error.code).toBe("NOT_FOUND");

      const second = await tx
        .select({ revokedAt: workspaceInvitations.revokedAt })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.id, invitationId));
      expect(second[0]?.revokedAt?.getTime()).toBe(
        first[0]?.revokedAt?.getTime(),
      );
    });
  });

  /**
   * # 🔴 대소문자·공백이 달라도 같은 초대다
   *
   * 취소는 id 로 하므로 email 을 다시 보지 않는다. 확인할 것은 **정규화된 주소로 저장된 행이
   * 취소된 뒤, 그 변형 표기로 «재초대»가 되는가**다 — 정규화가 한쪽만 되어 있으면 재초대가
   * 취소된 행 옆이 아니라 **또 다른 살아 있는 행**으로 서서 초대가 둘이 된다.
   */
  it("🔴 취소 뒤 대소문자·공백만 다른 주소로 재초대해도 살아 있는 초대는 하나다", async () => {
    await rolledBack(async (tx) => {
      const owner = await createUser(tx);
      const workspace = await createWorkspace(tx, owner);

      await createInvitation(
        { workspaceId: workspace, email: "  Guest@Example.TEST ", invitedBy: owner },
        tx,
      );
      const invitationId = await invitationIdOf(tx, workspace, GUEST);
      await revokeInvitation({ workspaceId: workspace, invitationId }, tx);

      await createInvitation(
        { workspaceId: workspace, email: "GUEST@EXAMPLE.TEST", invitedBy: owner },
        tx,
      );

      const pending = await listPendingInvitations(workspace, tx);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.email).toBe(GUEST);

      const all = await tx
        .select({ email: workspaceInvitations.email })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.workspaceId, workspace));
      expect(all).toHaveLength(2);
      // 저장된 형태가 둘 다 정규 형태다 — 한쪽만 정규화하면 여기서 갈린다.
      expect(all.every((row) => row.email === GUEST)).toBe(true);
    });
  });

  /**
   * # 🔴 동시에 들어온 취소 둘이 함께 성공하지 않는다
   *
   * 두 호출을 **한 연결 위에서 동시에** 던진다. node-postgres 는 문장을 그 연결의 큐에
   * 넣으므로 「조회해서 확인하고 그 다음에 UPDATE」로 구현돼 있었다면 두 조회가 «먼저»
   * 나가 **둘 다 성공한다.** 조건이 UPDATE 자체에 붙어 있어야만 한쪽이 0행을 돌려받는다.
   *
   * 🔴 **이것으로 «두 세션의 실제 경쟁»을 증명하지는 못한다.** 그것을 보려면 fixture 를
   * commit 해야 하는데, 이 Database 에는 사장님의 실제 데이터가 있어 되돌리지 못하는
   * 쓰기를 하지 않는다. 여기서 붙드는 것은 **응용 코드가 read-then-write 로 되돌아가는
   * 회귀**다.
   */
  it("🔴 동시에 들어온 취소 둘 중 하나만 성공한다", async () => {
    await rolledBack(async (tx) => {
      const owner = await createUser(tx);
      const workspace = await createWorkspace(tx, owner);

      await createInvitation(
        { workspaceId: workspace, email: GUEST, invitedBy: owner },
        tx,
      );
      const invitationId = await invitationIdOf(tx, workspace, GUEST);

      const results = await Promise.allSettled([
        revokeInvitation({ workspaceId: workspace, invitationId }, tx),
        revokeInvitation({ workspaceId: workspace, invitationId }, tx),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected");
      expect(
        rejected?.status === "rejected" &&
          isAppError(rejected.reason) &&
          rejected.reason.code,
      ).toBe("NOT_FOUND");
    });
  });

  /**
   * 취소와 수락은 **어느 쪽이 먼저 닿든 한쪽만** 성공한다. 둘 다 같은 행에 조건부 UPDATE 를
   * 걸기 때문이다 — 나중에 온 쪽은 잠금이 풀린 뒤 조건을 다시 보고 0행을 돌려받는다.
   */
  it("🔴 수락이 먼저면 취소가 실패하고, 취소가 먼저면 수락이 실패한다", async () => {
    await rolledBack(async (tx) => {
      const owner = await createUser(tx);
      const guest = await createUser(tx, GUEST);
      const workspace = await createWorkspace(tx, owner);

      // 수락이 먼저
      const first = await createInvitation(
        { workspaceId: workspace, email: GUEST, invitedBy: owner },
        tx,
      );
      const firstId = await invitationIdOf(tx, workspace, GUEST);
      await acceptInvitation({ token: first.token, userId: guest }, tx);
      expect(
        isAppError(
          await rejection(
            revokeInvitation({ workspaceId: workspace, invitationId: firstId }, tx),
          ),
        ),
      ).toBe(true);
    });

    await rolledBack(async (tx) => {
      const owner = await createUser(tx);
      const guest = await createUser(tx, GUEST);
      const workspace = await createWorkspace(tx, owner);

      // 취소가 먼저
      const second = await createInvitation(
        { workspaceId: workspace, email: GUEST, invitedBy: owner },
        tx,
      );
      await revokeInvitation(
        {
          workspaceId: workspace,
          invitationId: await invitationIdOf(tx, workspace, GUEST),
        },
        tx,
      );
      const error = await rejection(
        acceptInvitation({ token: second.token, userId: guest }, tx),
      );
      expect(isAppError(error) && error.code).toBe("NOT_FOUND");
    });
  });

  /**
   * 🔴 **만료 · 취소 · 재초대 셋이 갈리는 자리를 한 시험에 모아 둔다.**
   *
   * ```
   * 만료  같은 행이 새 Token·새 기한으로 «회전»한다          (행이 늘지 않는다)
   * 취소  행은 그대로 남고 재초대는 «새 행»으로 선다          (행이 는다)
   * ```
   */
  it("🔴 만료는 회전하고 취소는 새 행이 된다", async () => {
    await rolledBack(async (tx) => {
      const owner = await createUser(tx);
      const workspace = await createWorkspace(tx, owner);

      await createInvitation(
        { workspaceId: workspace, email: GUEST, invitedBy: owner },
        tx,
      );

      // 만료 -> 재초대: 행이 늘지 않는다
      await tx
        .update(workspaceInvitations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(workspaceInvitations.workspaceId, workspace));
      await createInvitation(
        { workspaceId: workspace, email: GUEST, invitedBy: owner },
        tx,
      );

      const afterRotation = await tx
        .select({ id: workspaceInvitations.id })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.workspaceId, workspace));
      expect(afterRotation).toHaveLength(1);

      // 취소 -> 재초대: 행이 는다
      await revokeInvitation(
        {
          workspaceId: workspace,
          invitationId: afterRotation[0]?.id as string,
        },
        tx,
      );
      await createInvitation(
        { workspaceId: workspace, email: GUEST, invitedBy: owner },
        tx,
      );

      const afterRevoke = await tx
        .select({ revokedAt: workspaceInvitations.revokedAt })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.workspaceId, workspace));
      expect(afterRevoke).toHaveLength(2);
      expect(afterRevoke.filter((row) => row.revokedAt === null)).toHaveLength(1);

      // 살아 있는 것은 언제나 하나다.
      expect(await listPendingInvitations(workspace, tx)).toHaveLength(1);
    });
  });
});
