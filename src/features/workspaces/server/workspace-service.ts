import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { users, workspaceMembers, workspaces } from "@/db/schema";
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
    throw new AppError("VALIDATION_ERROR", "Workspace 이름을 입력하세요.");
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
  throw new AppError(
    "CONFLICT",
    "그 이름으로 Workspace 주소를 만들지 못했습니다. 다른 이름을 써 주세요.",
  );
}

export interface WorkspaceMemberRow {
  userId: string;
  name: string | null;
  role: WorkspaceRole;
  /** 이 Workspace 가 그 사람의 Personal Workspace 인가. 그러면 역할을 바꿀 수 없다. */
  isPersonalOwner: boolean;
}

/** 멤버 목록. 🔴 이메일은 내보내지 않는다 — 화면이 그리지 않는다(CLAUDE.md 11). */
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
      throw new AppError(
        "CONFLICT",
        "Personal Workspace 의 주인은 역할을 바꿀 수 없습니다.",
      );
    }

    if (input.role !== "OWNER") {
      /**
       * 🔴 `FOR UPDATE` 로 다른 OWNER 행을 잠근다. 두 창에서 서로를 동시에 강등하면
       * 각자 「상대가 아직 OWNER 다」를 보고 둘 다 통과해 OWNER 가 0명이 된다.
       */
      const others = await tx
        // 🔴 `count(*)` 로 세지 않는다 — PostgreSQL 은 집계와 FOR UPDATE 를 함께 쓰지 못한다.
        //    행을 그대로 읽어 «그 행들을» 잠근다.
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.role, "OWNER"),
            ne(workspaceMembers.userId, input.userId),
          ),
        )
        .for("update");

      if (others.length === 0) {
        throw new AppError(
          "CONFLICT",
          "마지막 OWNER 입니다. 다른 멤버를 OWNER 로 올린 뒤에 바꿔 주세요.",
        );
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
      throw new AppError("NOT_FOUND", "멤버를 찾을 수 없습니다.");
    }
  });
}
