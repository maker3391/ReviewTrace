import "server-only";

import { and, eq, inArray, or } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import {
  planMemberRemoval,
  type MemberRemovalBlock,
} from "@/features/workspaces/server/member-removal-plan";
import { AppError } from "@/lib/errors";
import { normalizeSlug } from "@/lib/workspace/slug";
import type { WorkspaceRole } from "@/types/review";

/**
 * Workspace 자신에 대한 일 — 만들기와 멤버 역할.
 *
 * 🔴 **Personal Workspace 를 만드는 자리와 나눈다**(`lib/workspace/personal-workspace.ts`).
 * 저쪽은 **가입이 부르는 것**이라 실패하면 안 되고 `personal_owner_id` unique 로 한 개만
 * 생기게 잠겨 있다. 이쪽은 **사람이 누르는 것**이라 이름을 받고 실패를 화면에 알린다.
 * 한 함수로 합치면 「가입 중 slug 충돌」과 「사용자가 고른 이름 충돌」이 같은 처리를 받는다.
 */

/** slug 가 겹칠 때 다음 후보를 시도하는 횟수. Personal Workspace 와 같은 방식이다. */
const MAX_SLUG_ATTEMPTS = 5;

export interface CreatedWorkspace {
  workspaceId: string;
  slug: string;
  name: string;
}

/**
 * 새 Workspace 를 만들고 만든 사람을 OWNER 로 넣는다.
 *
 * 🔴 **Workspace 와 소속을 한 Transaction 에** 넣는다. 중간에 끊겨 「Workspace 는 있는데
 * 소속이 없는」 반쪽 상태가 남으면, 만든 사람이 자기 Workspace 에 들어가지 못한다.
 *
 * 🔴 `personalOwnerId` 는 **비운다.** 이것은 Personal Workspace 가 아니다 — 채우면 그 사람의
 * Personal Workspace 자리를 뺏어 가입 흐름이 어긋난다.
 *
 * @throws {AppError} 이름에서 쓸 만한 slug 를 못 만들면 `CONFLICT`.
 */
export async function createWorkspace(
  input: { name: string; createdBy: string },
  executor: DbExecutor = db(),
): Promise<CreatedWorkspace> {
  const name = input.name.trim();
  if (name === "") {
    throw new AppError("WORKSPACE_NAME_REQUIRED");
  }

  const base = normalizeSlug(name);

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const slug = attempt === 0 ? base : normalizeSlug(`${base}-${attempt + 1}`);

    const created = await executor.transaction(async (tx) => {
      const rows = await tx
        .insert(workspaces)
        .values({ slug, name, createdBy: input.createdBy })
        // slug 는 전역 unique 다. 겹치면 다음 후보로 간다.
        .onConflictDoNothing({ target: workspaces.slug })
        .returning({ id: workspaces.id });

      const workspaceId = rows[0]?.id;
      if (workspaceId === undefined) {
        return null;
      }

      await tx
        .insert(workspaceMembers)
        .values({ workspaceId, userId: input.createdBy, role: "OWNER" });

      return workspaceId;
    });

    if (created !== null) {
      return { workspaceId: created, slug, name };
    }
  }

  // 🔴 값 자체를 message 에 담지 않는다 — 사용자가 넣은 문자열이 로그로 흘러 나간다.
  throw new AppError("WORKSPACE_NAME_UNUSABLE");
}

export interface WorkspaceMemberRow {
  userId: string;
  name: string | null;
  role: WorkspaceRole;
  /** 이 Workspace 가 그 사람의 Personal Workspace 인가. 그러면 역할을 바꿀 수 없다. */
  isPersonalOwner: boolean;
}

/** 멤버 목록. 🔴 이메일은 내보내지 않는다 — 화면이 그리지 않는다. */
export async function listMembers(
  workspaceId: string,
  executor: DbExecutor = db(),
): Promise<WorkspaceMemberRow[]> {
  const rows = await executor
    .select({
      userId: workspaceMembers.userId,
      name: users.name,
      role: workspaceMembers.role,
      personalOwnerId: workspaces.personalOwnerId,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(workspaceMembers.createdAt);

  return rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    role: row.role,
    isPersonalOwner: row.personalOwnerId === row.userId,
  }));
}

/**
 * 멤버의 역할을 바꾼다.
 *
 * 🔴 **마지막 OWNER 를 강등하지 않는다.** OWNER 가 0명이 되면 그 Workspace 는 초대도
 * 설정 변경도 영원히 못 하는 상태로 잠긴다 — 되돌릴 방법이 화면에 없다.
 *
 * 🔴 **Personal Workspace 의 주인은 바꿀 수 없다.** 그 Workspace 는 그 사람의 것이라는
 * 사실이 `personal_owner_id` 에 박혀 있다.
 *
 * 판정을 UPDATE 와 같은 Transaction 에 둔다 — 「확인하고 그 다음에 바꾼다」로 나누면
 * 두 요청이 각자 「나 말고 OWNER 가 또 있다」를 보고 함께 통과한다.
 *
 * @throws {AppError} 대상이 없으면 `NOT_FOUND`, 마지막 OWNER 면 `CONFLICT`.
 */
export async function changeMemberRole(
  input: { workspaceId: string; userId: string; role: WorkspaceRole },
  executor: DbExecutor = db(),
): Promise<void> {
  await executor.transaction(async (tx) => {
    const personal = await tx
      .select({ personalOwnerId: workspaces.personalOwnerId })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);

    if (personal[0]?.personalOwnerId === input.userId) {
      throw new AppError("PERSONAL_WORKSPACE_ROLE_FIXED");
    }

    /**
     * 🔴 **대상 행과 OWNER 행을 «한 문장으로», PK 순서로 잠근다.**
     *
     * 예전에는 두 걸음이었다 — 「다른 OWNER 행들을 `FOR UPDATE`」 한 뒤 「대상 행을
     * UPDATE」. 그 둘 사이에 순서가 없어서, 같은 표를 `(workspace_id, user_id)` 순으로
     * 잠그는 경로(`removeMember`)와 엇갈리면 **실제로 `40P01 deadlock detected` 가 났다**
     * (독립 reviewer 가 실제 병렬 연결로 재현했다):
     *
     * ```
     * removeMember   : 대상 T 를 잡고 -> 행위자 O 를 기다린다
     * changeMemberRole: OWNER O 를 잡고 -> 대상 T 를 기다린다      고리가 닫힌다
     * ```
     *
     * 한 문장으로 합치면 잠그는 순서가 `ORDER BY` 하나로 정해져 그 고리가 만들어지지 않는다.
     * 🔴 **`or` 로 대상까지 «같은 문장 안에» 넣는 것이 핵심이다** — 문장을 나누는 순간
     * 두 문장 사이의 순서는 다시 아무도 보장하지 않는다.
     *
     * 🔴 `count(*)` 로 세지 않는다 — PostgreSQL 은 집계와 `FOR UPDATE` 를 함께 쓰지 못한다.
     * 행을 그대로 읽어 «그 행들을» 잠근다. 두 창에서 서로를 동시에 강등하면 각자
     * 「상대가 아직 OWNER 다」를 보고 둘 다 통과해 OWNER 가 0명이 되는 것을 이 잠금이 막는다.
     */
    const locked = await tx
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          or(
            eq(workspaceMembers.userId, input.userId),
            eq(workspaceMembers.role, "OWNER"),
          ),
        ),
      )
      .orderBy(workspaceMembers.workspaceId, workspaceMembers.userId)
      .for("update");

    if (!locked.some((row) => row.userId === input.userId)) {
      throw new AppError("WORKSPACE_MEMBER_NOT_FOUND");
    }

    if (input.role !== "OWNER") {
      const others = locked.filter(
        (row) => row.role === "OWNER" && row.userId !== input.userId,
      );

      if (others.length === 0) {
        throw new AppError("WORKSPACE_LAST_OWNER");
      }
    }

    const changed = await tx
      .update(workspaceMembers)
      .set({ role: input.role })
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.userId),
        ),
      )
      .returning({ userId: workspaceMembers.userId });

    if (changed.length === 0) {
      // 잠근 뒤 확인한 행이다 — 사라졌다면 불변식이 깨진 것이다.
      throw new AppError("UNEXPECTED");
    }
  });
}

/**
 * 막는 이유 ↔ 오류.
 *
 * 🔴 **`NOT_OWNER` 가 `NOT_FOUND` 인 것은 의도다** — `requireOwner` 가 `notFound()` 로
 * 답하는 것, `deleteWorkspace` 가 `WORKSPACE_OWNER_REQUIRED` 를 쓰는 것과 같은 판단이다.
 *
 * 🔴 **표가 아니라 `switch` 다.** `AppError` 의 인자는 이유마다 «필요한 meta 가 다른»
 * 판별 tuple 이라, 넓힌 `AppErrorReason` 을 그대로 넘기면 타입이 서지 않는다.
 */
function removalBlockError(block: MemberRemovalBlock): AppError {
  switch (block) {
    case "NOT_OWNER":
      return new AppError("WORKSPACE_OWNER_REQUIRED");
    case "SELF":
      return new AppError("WORKSPACE_SELF_REMOVE");
    case "NOT_MEMBER":
      return new AppError("WORKSPACE_MEMBER_NOT_FOUND");
    case "PERSONAL_OWNER":
      return new AppError("PERSONAL_WORKSPACE_OWNER_FIXED");
  }
}

/**
 * 멤버를 Workspace 에서 내보낸다.
 *
 * # 🔴 이것이 없으면 Workspace 를 영원히 지울 수 없었다
 *
 * 삭제 정책이 「나 말고 멤버가 한 명이라도 있으면 거절」(`workspace-deletion-plan.ts`)인데
 * 내보내는 길이 없으면, 멤버가 한 번 들어온 Workspace 는 **어떤 조작으로도 삭제 조건을
 * 만족시킬 수 없다.** 이 함수가 그 막다른 길을 연다.
 *
 * # 🔴 무엇을 지우고 무엇을 지우지 않는가
 *
 * 지우는 것은 **`workspace_members` 행 하나**뿐이다. 사람(`users`)도, 그 사람이 다른
 * Workspace 에 갖고 있는 소속도, 그가 남긴 Review Knowledge 도 건드리지 않는다 —
 * `issue_activities.actor_name` 은 `users` 를 참조하지 않는 자유 문자열이고
 * 「누가 고쳤는가」는 Review 기록의 일부다(CLAUDE.md 2 · `account-deletion-service.ts`).
 * 🔴 **`workspace_members` 를 참조하는 FK 는 하나도 없다**(실제 catalog 전수 확인) —
 * 그래서 이 한 행을 지워도 고아가 생기지 않는다.
 *
 * # 🔴 잠금은 `workspace_members` «한 표»뿐이지만, 그것이 안전의 근거는 아니다
 *
 * 🔴 **예전에 이 자리에 「한 표만 잠그니 고리를 만들 상대가 없다」고 적었다. 그것은
 * 틀렸다.** 독립 reviewer 가 실제 병렬 연결로 `40P01 deadlock detected` 를 재현했다 —
 * `changeMemberRole` 도 **같은 한 표**만 잠갔는데, 그 경로가 행을 집는 순서가 이쪽과
 * 달라 고리가 닫혔다. **표의 «개수»가 아니라 그 표 «안»의 행 순서가 관건이다.**
 *
 * 그래서 규칙은 이것이다 — **`workspace_members` 의 여러 행을 잠그는 모든 경로는
 * PK 순서 `(workspace_id, user_id)` 오름차순으로 잠근다**(근거는 `@/db`).
 * 지금 그 경로는 넷이다: `removeMember` · `changeMemberRole` ·
 * `deleteWorkspace` · `deleteAccount`. 🔴 **새 경로를 만들면 여기도 함께 고쳐야 한다.**
 *
 * `workspaces` 는 **읽기만 하고 잠그지 않는다.** 그 사이에 멤버가 늘어도 이 판정은
 * 거짓이 되지 않기 때문이다 — 🔴 **다만 그것은 «판정의 정확성»에 대한 근거일 뿐
 * «잠금 안전성»의 근거가 아니다.** 잠금이 안전한 이유는 위의 행 순서 하나다.
 * (자식 행을 DELETE 하는 것은 부모(`workspaces`·`users`) 행에 잠금을 요구하지 않는다 —
 * FK 잠금은 참조를 «쓸» 때 걸린다.)
 *
 * 🔴 **판정에 쓰는 두 행을 `FOR UPDATE` 로 «함께» 잠근다.** 나누면 「내가 아직 OWNER 다」를
 * 읽은 직후 다른 창이 나를 강등해도 제거가 그대로 나간다.
 *
 * 🔴 **`actorUserId` 는 세션에서 온 값이다.** Client 가 보낸 식별자를 쓰지 않는다.
 * 🔴 **화면이 버튼을 감추는 것은 편의일 뿐이다.** OWNER 여부·self·Personal 주인 여부를
 * 여기서 **다시** 판정한다 — 이 함수가 마지막 경계다.
 *
 * @throws {AppError} Workspace 가 없거나 내 Workspace 가 아니면 `NOT_FOUND`,
 * OWNER 가 아니면 `NOT_FOUND`, 대상이 멤버가 아니면 `NOT_FOUND`,
 * 자기 자신이거나 Personal Workspace 의 주인이면 `CONFLICT`.
 */
export async function removeMember(
  input: { workspaceId: string; actorUserId: string; targetUserId: string },
  executor: DbExecutor = db(),
): Promise<void> {
  await executor.transaction(async (tx) => {
    const workspaceRows = await tx
      .select({ personalOwnerId: workspaces.personalOwnerId })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1);

    const workspace = workspaceRows[0];
    if (workspace === undefined) {
      throw new AppError("WORKSPACE_NOT_FOUND");
    }

    /**
     * 🔴 **집계와 `FOR UPDATE` 를 함께 쓰지 못한다**(PostgreSQL 이 거절한다 —
     * `changeMemberRole` 에서 실제로 겪었다). 행을 그대로 읽는다.
     * 읽는 행은 최대 둘이라 표를 훑지 않는다.
     */
    const locked = await tx
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          inArray(workspaceMembers.userId, [
            input.actorUserId,
            input.targetUserId,
          ]),
        ),
      )
      /*
       * 🔴 PK 순서다. 이 표를 여러 행 잠그는 네 경로가 모두 이 순서를 쓴다(`@/db`).
       *
       * 🔴 **이 한 줄만은 「빼면 빨개지는 시험」이 없다.** 실제로 지워 보니
       * `member-removal-lock-order.integration.test.ts` 4건이 그대로 초록이었다 —
       * `IN (…)` 두 행을 Planner 가 이미 PK 순서로 돌려주기 때문이다. **그것이 이 줄을
       * 빼도 되는 근거가 아니라 이 줄이 필요한 이유다**: 지금 안전한 것은 우리가 정한
       * 것이 아니라 Planner 가 고른 것이고, 행이 늘거나 통계가 바뀌면 뒤집힌다.
       */
      .orderBy(workspaceMembers.workspaceId, workspaceMembers.userId)
      .for("update");

    const actor = locked.find((row) => row.userId === input.actorUserId);
    if (actor === undefined) {
      /**
       * 🔴 **소속이 없으면 `FORBIDDEN` 이 아니라 `NOT_FOUND` 다.** 둘을 구분해 주면
       * 그 workspaceId 가 존재한다는 사실이 새어 나간다.
       */
      throw new AppError("WORKSPACE_NOT_FOUND");
    }

    const plan = planMemberRemoval({
      actorRole: actor.role,
      isSelf: input.actorUserId === input.targetUserId,
      targetIsMember: locked.some((row) => row.userId === input.targetUserId),
      targetIsPersonalOwner: workspace.personalOwnerId === input.targetUserId,
    });

    if (plan.block !== null) {
      throw removalBlockError(plan.block);
    }

    const removed = await tx
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.targetUserId),
        ),
      )
      .returning({ userId: workspaceMembers.userId });

    if (removed.length === 0) {
      // 잠근 뒤 확인한 행이다 — 사라졌다면 불변식이 깨진 것이지 사용자의 잘못이 아니다.
      throw new AppError("UNEXPECTED");
    }
  });
}
