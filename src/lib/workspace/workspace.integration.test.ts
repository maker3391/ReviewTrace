import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { users, workspaceInvitations } from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import {
  acceptInvitation,
  createInvitation,
} from "@/features/invitations/server/invitation-service";
import { hashInvitationToken } from "@/features/invitations/server/invitation-token";
import {
  findMembership,
  listMemberWorkspaces,
} from "@/lib/auth/workspace-context";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

/**
 * 실제 PostgreSQL 을 쓰는 시험 — **가입 흐름 · Workspace 소속 · 초대**.
 *
 * # 🔴 이 파일은 기본 `pnpm test` 에서 «돌지 않는다»
 *
 * ```bash
 * pnpm test                       # 이 파일 전체를 건너뛴다
 * DB_INTEGRATION=true pnpm test   # PostgreSQL 이 떠 있고 .env 에 DATABASE_URL 이 있어야 한다
 * ```
 *
 * **기본 실행이 초록인 것은 Tenant 안전의 근거가 아니다.** 아래는 `DB_INTEGRATION=true`
 * 없이는 **한 번도 확인되지 않는다**:
 *
 * - `findMembership` 의 `userId` 조건이 실제로 **남의 Workspace 를 막는가**
 * - `workspaces.personal_owner_id` 의 unique 가 실제로 걸려 있는가 —
 *   「재로그인해도 Personal Workspace 가 늘지 않는다」의 **최종 방어선**이다
 * - `workspaces.slug` 의 전역 unique 가 slug 재시도를 실제로 유발하는가
 * - `WHERE accepted_at IS NULL` 이 붙은 UPDATE 가 **한 번만** 초대를 잡는가
 * - `workspace_members` 의 PK 가 중복 소속을 막는가
 * - Workspace 와 소속이 **한 Transaction** 으로 함께 저장되는가
 *
 * # 왜 기본에서 빼 두었는가
 *
 * 이 시험은 **실제 PostgreSQL 이 떠 있어야** 돈다. 그 조건을 기본 `pnpm test` 에 걸면
 * Database 가 없는 자리(신규 clone · CI 기본 job)에서 **코드에 아무 문제가 없는데도**
 * 빨간불이 켜지고, 그런 시험은 곧 읽히지 않게 된다. 그래서 실행 조건을 명시적으로 나눴다 —
 * **빼 둔 이유는 「중요하지 않아서」가 아니라 「전제가 다르기 때문」이다.**
 *
 * CI 에서 함께 돌리는 방법은 `README.md` 의 **Testing** 절에 적어 두었다.
 *
 * # 기본 실행에서도 도는 짝
 *
 * Fake 하나로 증명되는 **판정 규칙**은 따로 옮겨 두었다 — 그쪽은 Database 없이 매번 돈다.
 *
 * - `personal-workspace.test.ts` — 이미 있으면 만들지 않는다 · slug 후보 · 경쟁에서 진 뒤 재조회
 * - `../../features/invitations/server/invitation-service.test.ts` —
 *   **Token 원문 미저장** · 거절 사유가 구분되지 않는다 · 초대에 적힌 role 로 들어간다
 *
 * 🔴 **그것이 이 파일을 대신하지 않는다.** Fake 는 `where` 를 해석하지 않고 제약도 없다.
 *
 * 🔴 **데이터를 남기지 않는다.** 모든 시험이 자기 Transaction 안에서 돌고 끝에서 되돌린다.
 * 있는 데이터를 지우거나 바꾸지 않으며 `TRUNCATE` 도 쓰지 않는다.
 */
const enabled = process.env.DB_INTEGRATION === "true";

beforeAll(() => {
  if (enabled) {
    // 🔴 `.env` 가 없어도 환경 변수로 충분하면 돈다. 근거는 그 파일에 있다.
    loadIntegrationDbEnv();
  }
});

/** 시험 하나를 되돌리기 위한 표식. 실제 실패와 구분하려고 전용 타입을 쓴다. */
class Rollback extends Error {}

/**
 * 되돌려지는 Transaction 안에서 돌린다.
 *
 * 안쪽 코드가 다시 Transaction 을 열면 PostgreSQL 의 SAVEPOINT 가 되어,
 * 바깥을 되돌릴 때 함께 사라진다.
 */
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

async function createUser(tx: DbExecutor, name: string): Promise<string> {
  const rows = await tx
    .insert(users)
    .values({ email: `${unique("u")}@example.test`, name })
    .returning({ id: users.id });

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }
  return id;
}

describe.skipIf(!enabled)("가입 흐름", () => {
  it("신규 가입이면 Personal Workspace 와 OWNER 소속이 함께 생긴다", async () => {
    await inRollback(async (tx) => {
      const userId = await createUser(tx, "T1");

      const workspaceId = await ensurePersonalWorkspace(
        { userId, displayName: "T1", slugSource: unique("t1-") },
        tx,
      );
      const list = await listMemberWorkspaces(userId, tx);

      expect(workspaceId).toBeTruthy();
      expect(list).toHaveLength(1);
      expect(list[0]?.role).toBe("OWNER");
      expect(list[0]?.isPersonal).toBe(true);
    });
  });

  it("이미 가입한 사람이 다시 로그인해도 Personal Workspace 가 늘지 않는다", async () => {
    await inRollback(async (tx) => {
      const userId = await createUser(tx, "T2");
      const slugSource = unique("t2-");

      const first = await ensurePersonalWorkspace(
        { userId, displayName: "T2", slugSource },
        tx,
      );
      const second = await ensurePersonalWorkspace(
        { userId, displayName: "T2", slugSource },
        tx,
      );

      expect(second).toBe(first);
      expect(await listMemberWorkspaces(userId, tx)).toHaveLength(1);
    });
  });

  it("slug 가 겹치면 다음 후보로 넘어간다 — 가입이 실패하지 않는다", async () => {
    await inRollback(async (tx) => {
      const slugSource = unique("dup-");
      const a = await createUser(tx, "A");
      const b = await createUser(tx, "B");

      await ensurePersonalWorkspace(
        { userId: a, displayName: "A", slugSource },
        tx,
      );
      await ensurePersonalWorkspace(
        { userId: b, displayName: "B", slugSource },
        tx,
      );

      const slugA = (await listMemberWorkspaces(a, tx))[0]?.slug;
      const slugB = (await listMemberWorkspaces(b, tx))[0]?.slug;

      expect(slugA).toBeTruthy();
      expect(slugB).toBeTruthy();
      expect(slugA).not.toBe(slugB);
    });
  });
});

describe.skipIf(!enabled)("Tenant 격리", () => {
  it("소속이 없으면 slug 를 알아도 Workspace 를 얻지 못한다", async () => {
    await inRollback(async (tx) => {
      const owner = await createUser(tx, "Owner");
      const outsider = await createUser(tx, "Outsider");

      await ensurePersonalWorkspace(
        { userId: owner, displayName: "Owner", slugSource: unique("iso-") },
        tx,
      );
      const slug = (await listMemberWorkspaces(owner, tx))[0]?.slug ?? "";

      // 🔴 주소를 손으로 바꿔 남의 Workspace 를 적은 상황이다.
      expect(await findMembership(outsider, slug, tx)).toBeNull();
      // 소속인 사람에게는 열린다 — 「항상 null」로 통과하지 않게 짝을 둔다.
      expect(await findMembership(owner, slug, tx)).not.toBeNull();
    });
  });

  it("없는 slug 와 남의 slug 를 구분해 알려 주지 않는다", async () => {
    await inRollback(async (tx) => {
      const user = await createUser(tx, "N");

      expect(await findMembership(user, "no-such-workspace", tx)).toBeNull();
    });
  });
});

describe.skipIf(!enabled)("초대", () => {
  async function setupWorkspace(tx: DbExecutor): Promise<{
    ownerId: string;
    ownerEmail: string;
    workspaceId: string;
    slug: string;
  }> {
    const ownerId = await createUser(tx, "Owner");
    const workspaceId = await ensurePersonalWorkspace(
      { userId: ownerId, displayName: "Owner", slugSource: unique("ws-") },
      tx,
    );
    const slug = (await listMemberWorkspaces(ownerId, tx))[0]?.slug ?? "";

    const ownerRow = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, ownerId))
      .limit(1);

    return {
      ownerId,
      ownerEmail: ownerRow[0]?.email ?? "",
      workspaceId,
      slug,
    };
  }

  it("기존 회원이 초대를 수락하면 기존 소속은 그대로 두고 하나가 더 생긴다", async () => {
    await inRollback(async (tx) => {
      const { ownerId, workspaceId, slug } = await setupWorkspace(tx);

      const guestId = await createUser(tx, "Guest");
      await ensurePersonalWorkspace(
        { userId: guestId, displayName: "Guest", slugSource: unique("g-") },
        tx,
      );
      const guestEmail = (
        await tx
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, guestId))
          .limit(1)
      )[0]?.email;

      const invitation = await createInvitation(
        { workspaceId, email: guestEmail ?? "", invitedBy: ownerId },
        tx,
      );
      const joined = await acceptInvitation(
        { token: invitation.token, userId: guestId },
        tx,
      );

      const list = await listMemberWorkspaces(guestId, tx);

      expect(joined).toBe(slug);
      expect(list).toHaveLength(2);
      // Personal 은 OWNER 그대로, 초대받은 곳은 MEMBER 다.
      expect(list.find((item) => item.isPersonal)?.role).toBe("OWNER");
      expect(list.find((item) => item.slug === slug)?.role).toBe("MEMBER");
    });
  });

  it("같은 초대를 두 번 수락해도 소속이 둘로 늘지 않는다", async () => {
    await inRollback(async (tx) => {
      const { ownerId, workspaceId } = await setupWorkspace(tx);
      const guestId = await createUser(tx, "Guest");
      const guestEmail = (
        await tx
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, guestId))
          .limit(1)
      )[0]?.email;

      const invitation = await createInvitation(
        { workspaceId, email: guestEmail ?? "", invitedBy: ownerId },
        tx,
      );

      await acceptInvitation({ token: invitation.token, userId: guestId }, tx);

      // 🔴 두 번째 수락은 초대가 이미 소진돼 거절된다.
      await expect(
        acceptInvitation({ token: invitation.token, userId: guestId }, tx),
      ).rejects.toThrow();

      expect(await listMemberWorkspaces(guestId, tx)).toHaveLength(1);
    });
  });

  it("Token 원문을 저장하지 않는다 — 저장된 값은 Hash 다", async () => {
    await inRollback(async (tx) => {
      const { ownerId, workspaceId } = await setupWorkspace(tx);
      const guestId = await createUser(tx, "Guest");
      const guestEmail = (
        await tx
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, guestId))
          .limit(1)
      )[0]?.email;

      const invitation = await createInvitation(
        { workspaceId, email: guestEmail ?? "", invitedBy: ownerId },
        tx,
      );

      const rows = await tx
        .select({ tokenHash: workspaceInvitations.tokenHash })
        .from(workspaceInvitations)
        .where(
          eq(
            workspaceInvitations.tokenHash,
            hashInvitationToken(invitation.token),
          ),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).not.toBe(invitation.token);
    });
  });

  it("이미 멤버인 이메일은 초대되지 않는다", async () => {
    await inRollback(async (tx) => {
      const { ownerId, ownerEmail, workspaceId } = await setupWorkspace(tx);

      await expect(
        createInvitation(
          { workspaceId, email: ownerEmail, invitedBy: ownerId },
          tx,
        ),
      ).rejects.toThrow();
    });
  });

  /**
   * 🔴 **대소문자만 다른 주소로 「이미 멤버」 판정을 빠져나가지 못한다.**
   *
   * Fake 시험(`invitation-service.test.ts`)은 조건절에 실린 값까지만 본다 —
   * PostgreSQL 이 그 값으로 실제로 행을 잡는지는 여기서만 확인된다.
   */
  it("🔴 대소문자만 다른 주소로도 이미 멤버인 사람을 다시 초대할 수 없다", async () => {
    await inRollback(async (tx) => {
      const { ownerId, ownerEmail, workspaceId } = await setupWorkspace(tx);

      // 저장된 값은 정규 형태다 — 그것이 이 시험의 전제다.
      expect(ownerEmail).toBe(ownerEmail.toLowerCase());

      await expect(
        createInvitation(
          {
            workspaceId,
            email: `  ${ownerEmail.toUpperCase()} `,
            invitedBy: ownerId,
          },
          tx,
        ),
      ).rejects.toThrow();
    });
  });

  it("초대는 정규 형태의 이메일로 저장된다", async () => {
    await inRollback(async (tx) => {
      const { ownerId, workspaceId } = await setupWorkspace(tx);
      const target = `${unique("Guest")}@Example.TEST`;

      const invitation = await createInvitation(
        { workspaceId, email: ` ${target} `, invitedBy: ownerId },
        tx,
      );

      const rows = await tx
        .select({ email: workspaceInvitations.email })
        .from(workspaceInvitations)
        .where(
          eq(
            workspaceInvitations.tokenHash,
            hashInvitationToken(invitation.token),
          ),
        );

      expect(rows[0]?.email).toBe(target.toLowerCase());
      expect(invitation.email).toBe(target.toLowerCase());
    });
  });

  it("없는 Token 으로는 수락되지 않는다", async () => {
    await inRollback(async (tx) => {
      const userId = await createUser(tx, "Z");

      await expect(
        acceptInvitation({ token: "A".repeat(43), userId }, tx),
      ).rejects.toThrow();
    });
  });
});
