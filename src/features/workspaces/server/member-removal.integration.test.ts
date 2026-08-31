import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db, type DbExecutor } from "@/db";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import {
  deleteWorkspace,
  findWorkspaceDeletionImpact,
} from "@/features/workspaces/server/workspace-deletion-service";
import {
  createWorkspace,
  removeMember,
} from "@/features/workspaces/server/workspace-service";
import { findMembership } from "@/lib/auth/workspace-context";
import { AppError } from "@/lib/errors";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

/**
 * 실제 PostgreSQL 을 쓰는 시험 — **멤버 내보내기**.
 *
 * # 🔴 이 파일은 기본 `pnpm test` 에서 «돌지 않는다»
 *
 * ```bash
 * pnpm test                      # 이 파일 전체를 건너뛴다
 * DB_INTEGRATION=true pnpm test  # PostgreSQL 이 떠 있어야 한다
 * ```
 *
 * **기본 실행이 초록인 것은 근거가 아니다.** 아래는 `DB_INTEGRATION=true` 없이는 **한 번도**
 * 확인되지 않는다 — 짝인 `member-removal-plan.test.ts` 는 «판정 규칙»만 본다.
 *
 * - 행이 **실제로** 지워지는가, 그리고 **그 한 행만** 지워지는가
 * - 내보낸 사람이 **곧바로 그 Workspace 를 얻지 못하는가**(`findMembership`)
 * - 같은 사람의 **다른 Workspace 소속이 남는가**
 * - 마지막 외부 멤버를 내보낸 뒤 **Workspace 삭제가 실제로 서는가**(dead-end 해소)
 *
 * 🔴 **데이터를 남기지 않는다.** 모든 시험이 자기 Transaction 안에서 돌고 끝에서 되돌린다.
 * 있는 데이터를 지우거나 바꾸지 않으며 `TRUNCATE` 도 쓰지 않는다. fixture 이름은 전부
 * `mrm-` 으로 시작한다.
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
  return `mrm-${prefix}${Date.now().toString(36)}${seq}`;
}

async function makeUser(tx: DbExecutor, label: string): Promise<string> {
  const rows = await tx
    .insert(users)
    .values({ email: `${unique("u")}@example.test`, name: `mrm-${label}` })
    .returning({ id: users.id });

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }
  return id;
}

/** 팀 Workspace — 사람이 만드는 경로(`createWorkspace`)를 그대로 쓴다. */
async function makeTeamWorkspace(
  tx: DbExecutor,
  ownerId: string,
): Promise<{ workspaceId: string; slug: string }> {
  const created = await createWorkspace(
    { name: unique("team-"), createdBy: ownerId },
    tx,
  );
  return { workspaceId: created.workspaceId, slug: created.slug };
}

async function addMember(
  tx: DbExecutor,
  workspaceId: string,
  userId: string,
  role: "OWNER" | "MEMBER" = "MEMBER",
): Promise<void> {
  await tx.insert(workspaceMembers).values({ workspaceId, userId, role });
}

async function isMember(
  tx: DbExecutor,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    );
  return rows.length === 1;
}

/** 던져진 오류의 `reason` 을 꺼낸다 — 「실패했다」가 아니라 «무슨» 실패인지를 본다. */
async function reasonOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError) {
      return error.reason;
    }
    throw error;
  }
  throw new Error("오류가 나야 하는데 성공했다");
}

describe.skipIf(!enabled)("멤버 내보내기 (실제 PostgreSQL)", () => {
  it("OWNER 는 MEMBER 를 내보낸다 — 소속 행 «하나»만 사라진다", async () => {
    await inRollback(async (tx) => {
      const ownerId = await makeUser(tx, "owner");
      const memberId = await makeUser(tx, "member");
      const { workspaceId } = await makeTeamWorkspace(tx, ownerId);
      await addMember(tx, workspaceId, memberId);

      await removeMember(
        { workspaceId, actorUserId: ownerId, targetUserId: memberId },
        tx,
      );

      expect(await isMember(tx, workspaceId, memberId)).toBe(false);
      // 🔴 내보낸 사람은 그대로 OWNER 다.
      expect(await isMember(tx, workspaceId, ownerId)).toBe(true);

      // 🔴 **사람을 지우지 않는다.** 사라진 것은 소속뿐이다.
      const stillThere = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, memberId));
      expect(stillThere).toHaveLength(1);
    });
  });

  it("🔴 MEMBER 는 다른 MEMBER 를 내보내지 못한다", async () => {
    await inRollback(async (tx) => {
      const ownerId = await makeUser(tx, "owner");
      const actorId = await makeUser(tx, "actor");
      const targetId = await makeUser(tx, "target");
      const { workspaceId } = await makeTeamWorkspace(tx, ownerId);
      await addMember(tx, workspaceId, actorId);
      await addMember(tx, workspaceId, targetId);

      expect(
        await reasonOf(() =>
          removeMember(
            { workspaceId, actorUserId: actorId, targetUserId: targetId },
            tx,
          ),
        ),
      ).toBe("WORKSPACE_OWNER_REQUIRED");

      expect(await isMember(tx, workspaceId, targetId)).toBe(true);
    });
  });

  it("🔴 OWNER 도 자기 자신은 내보내지 못한다", async () => {
    await inRollback(async (tx) => {
      const ownerId = await makeUser(tx, "owner");
      const { workspaceId } = await makeTeamWorkspace(tx, ownerId);

      expect(
        await reasonOf(() =>
          removeMember(
            { workspaceId, actorUserId: ownerId, targetUserId: ownerId },
            tx,
          ),
        ),
      ).toBe("WORKSPACE_SELF_REMOVE");

      expect(await isMember(tx, workspaceId, ownerId)).toBe(true);
    });
  });

  it("멤버가 아닌 사람을 내보내면 «없다»로 답한다", async () => {
    await inRollback(async (tx) => {
      const ownerId = await makeUser(tx, "owner");
      const strangerId = await makeUser(tx, "stranger");
      const { workspaceId } = await makeTeamWorkspace(tx, ownerId);

      expect(
        await reasonOf(() =>
          removeMember(
            { workspaceId, actorUserId: ownerId, targetUserId: strangerId },
            tx,
          ),
        ),
      ).toBe("WORKSPACE_MEMBER_NOT_FOUND");
    });
  });

  /**
   * 🔴 남의 Workspace 의 멤버를 내보낼 수 없다. **`FORBIDDEN` 이 아니라 `NOT_FOUND`** 다 —
   * 구분해 주면 그 workspaceId 가 존재한다는 사실이 새어 나간다.
   */
  it("🔴 소속이 없는 Workspace 의 멤버는 내보내지 못한다", async () => {
    await inRollback(async (tx) => {
      const outsiderId = await makeUser(tx, "outsider");
      const ownerId = await makeUser(tx, "owner");
      const memberId = await makeUser(tx, "member");
      const { workspaceId } = await makeTeamWorkspace(tx, ownerId);
      await addMember(tx, workspaceId, memberId);

      expect(
        await reasonOf(() =>
          removeMember(
            { workspaceId, actorUserId: outsiderId, targetUserId: memberId },
            tx,
          ),
        ),
      ).toBe("WORKSPACE_NOT_FOUND");

      expect(await isMember(tx, workspaceId, memberId)).toBe(true);
    });
  });

  it("🔴 Personal Workspace 의 주인은 내보내지 못한다", async () => {
    await inRollback(async (tx) => {
      const soloId = await makeUser(tx, "solo");
      const helperId = await makeUser(tx, "helper");
      const workspaceId = await ensurePersonalWorkspace(
        { userId: soloId, displayName: "mrm", slugSource: unique("p-") },
        tx,
      );
      // 주인이 다른 사람을 OWNER 로 올린 상황을 만든다.
      await addMember(tx, workspaceId, helperId, "OWNER");

      expect(
        await reasonOf(() =>
          removeMember(
            { workspaceId, actorUserId: helperId, targetUserId: soloId },
            tx,
          ),
        ),
      ).toBe("PERSONAL_WORKSPACE_OWNER_FIXED");

      expect(await isMember(tx, workspaceId, soloId)).toBe(true);
    });
  });

  it("🔴 내보낸 사람은 그 Workspace 를 더 이상 얻지 못한다", async () => {
    await inRollback(async (tx) => {
      const ownerId = await makeUser(tx, "owner");
      const memberId = await makeUser(tx, "member");
      const { workspaceId, slug } = await makeTeamWorkspace(tx, ownerId);
      await addMember(tx, workspaceId, memberId);

      // 내보내기 «전»에는 실제로 얻는다 — 그래야 뒤의 `null` 이 의미를 갖는다.
      expect(await findMembership(memberId, slug, tx)).toMatchObject({
        workspaceId,
        role: "MEMBER",
      });

      await removeMember(
        { workspaceId, actorUserId: ownerId, targetUserId: memberId },
        tx,
      );

      /*
       * 🔴 화면 접근의 정본이 이 조회다(`requireWorkspace`). `null` 이면 주소를 알아도
       * 404 이고, 없는 Workspace 와 구분되지 않는다.
       */
      expect(await findMembership(memberId, slug, tx)).toBeNull();
      // OWNER 는 그대로 들어간다.
      expect(await findMembership(ownerId, slug, tx)).not.toBeNull();
    });
  });

  it("🔴 같은 사람의 «다른» Workspace 소속은 그대로다", async () => {
    await inRollback(async (tx) => {
      const ownerId = await makeUser(tx, "owner");
      const otherOwnerId = await makeUser(tx, "other-owner");
      const memberId = await makeUser(tx, "member");

      const here = await makeTeamWorkspace(tx, ownerId);
      const elsewhere = await makeTeamWorkspace(tx, otherOwnerId);
      const personalId = await ensurePersonalWorkspace(
        { userId: memberId, displayName: "mrm", slugSource: unique("p-") },
        tx,
      );

      await addMember(tx, here.workspaceId, memberId);
      await addMember(tx, elsewhere.workspaceId, memberId);

      await removeMember(
        {
          workspaceId: here.workspaceId,
          actorUserId: ownerId,
          targetUserId: memberId,
        },
        tx,
      );

      expect(await isMember(tx, here.workspaceId, memberId)).toBe(false);
      expect(await isMember(tx, elsewhere.workspaceId, memberId)).toBe(true);
      // 🔴 자기 자리(Personal Workspace)도 그대로다.
      expect(await isMember(tx, personalId, memberId)).toBe(true);

      const remaining = await tx
        .select({ workspaceId: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, memberId));
      expect(remaining).toHaveLength(2);
    });
  });

  /**
   * 🔴 **이 시험이 이 기능의 존재 이유다.**
   *
   * 삭제 정책은 「나 말고 멤버가 한 명이라도 있으면 거절」이다. 내보내는 길이 없으면
   * 멤버가 한 번 들어온 Workspace 는 **영원히** 지울 수 없었다.
   */
  it("🔴 마지막 외부 멤버를 내보내면 Workspace 삭제가 «실제로» 선다", async () => {
    await inRollback(async (tx) => {
      const ownerId = await makeUser(tx, "owner");
      const memberId = await makeUser(tx, "member");
      const { workspaceId } = await makeTeamWorkspace(tx, ownerId);
      await addMember(tx, workspaceId, memberId);

      // 막다른 길 — 지우려 해도 멤버가 남아 있다.
      expect(
        await findWorkspaceDeletionImpact({ workspaceId, userId: ownerId }, tx),
      ).toMatchObject({ deletable: false, block: "HAS_MEMBERS", otherMembers: 1 });
      expect(
        await reasonOf(() => deleteWorkspace({ workspaceId, userId: ownerId }, tx)),
      ).toBe("WORKSPACE_HAS_MEMBERS");

      await removeMember(
        { workspaceId, actorUserId: ownerId, targetUserId: memberId },
        tx,
      );

      // 길이 열렸다 — 화면이 보는 판정도, 실제 삭제도.
      expect(
        await findWorkspaceDeletionImpact({ workspaceId, userId: ownerId }, tx),
      ).toMatchObject({ deletable: true, block: null, otherMembers: 0 });

      await deleteWorkspace({ workspaceId, userId: ownerId }, tx);

      const gone = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId));
      expect(gone).toEqual([]);

      // 🔴 사람은 둘 다 남는다 — Workspace 를 지운 것이지 계정을 지운 것이 아니다.
      const people = await tx
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, [ownerId, memberId]));
      expect(people).toHaveLength(2);
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
      .where(sql`${workspaces.slug} like 'mrm-%'`);
    expect(leftovers).toEqual([]);

    const strayUsers = await db()
      .select({ email: users.email })
      .from(users)
      .where(sql`${users.email} like 'mrm-%' or ${users.name} like 'mrm-%'`);
    expect(strayUsers).toEqual([]);
  });
});
