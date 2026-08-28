import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { users, workspaceInvitations } from "@/db/schema";
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
 * 실제 PostgreSQL 을 쓰는 시험.
 *
 * 여기 있는 것들은 **Fake 로 증명할 수 없다** — 지키는 주체가 응용 코드가 아니라
 * Database 의 제약과 Transaction 이기 때문이다.
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
    // drizzle.config.ts 와 같은 방식이다. 이것 하나 때문에 dotenv 를 더 넣지 않는다.
    process.loadEnvFile(".env");
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

  it("없는 Token 으로는 수락되지 않는다", async () => {
    await inRollback(async (tx) => {
      const userId = await createUser(tx, "Z");

      await expect(
        acceptInvitation({ token: "A".repeat(43), userId }, tx),
      ).rejects.toThrow();
    });
  });
});
