import "server-only";

import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  apiKeys,
  knowledgePages,
  projects,
  reviewIssues,
  users,
  verificationTokens,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import {
  planAccountDeletion,
  type AccountDeletionPlan,
  type WorkspaceDeletionEntry,
  type WorkspaceMembershipFacts,
} from "@/features/users/server/account-deletion-plan";
import { AppError } from "@/lib/errors";

/**
 * 계정 삭제.
 *
 * # 🔴 이것은 `DELETE FROM users` 한 줄이 아니다
 *
 * `users` 행 하나를 지우면 Database 가 이렇게 움직인다(실제 catalog 확인 결과):
 *
 * ```
 * CASCADE accounts · sessions · workspace_members
 * SET NULL workspaces.personal_owner_id · workspaces.created_by
 * projects.created_by · knowledge_pages.created_by
 * workspace_invitations.invited_by · workspace_invitations.accepted_by
 * ```
 *
 * 🔴 **그대로 두면 Personal Workspace 가 «주인 없는 유령»으로 남는다.** 소속 행은
 * CASCADE 로 사라지고 `personal_owner_id` 는 NULL 이 되어, **아무도 들어갈 수 없고
 * 아무도 지울 수 없는데 GitHub 아이디만 주소에 박힌 Workspace** 가 영원히 남는다
 * (slug 는 전역 unique 라 그 아이디를 다시 쓸 수도 없다).
 *
 * 🔴 **반대로 「사람이 지워졌으니 그가 속한 것도 전부 지운다」도 안 된다.** 팀
 * Workspace 의 Review Knowledge 는 남은 사람들의 것이다. 한 사람이 나갔다고 팀의
 * Knowledge 가 사라지면 이 제품의 존재 이유가 무너진다.
 *
 * 그래서 **Workspace 마다 따로 판단한다** — 규칙은 `account-deletion-plan.ts` 에 있다.
 *
 * # 무엇이 지워지고 무엇이 남는가
 *
 * ```
 * 지운다 users(email·name·image) · accounts(provider_account_id) · sessions(전 기기)
 * 나 혼자 있던 Workspace 통째 · 내 이메일이 적힌 초대 행
 * 남긴다 다른 멤버가 있는 Workspace 와 그 안의 Review Knowledge 전부
 * created_by 는 NULL 이 되고 문서·Project 자체는 그대로 남는다
 * ```
 *
 * 🔴 **`issue_activities.actor_name` 은 건드리지 않는다.** 그 Column 은 `users` 를
 * 참조하지 않는 자유 문자열이라(스키마 확인) **어느 행이 이 사람의 것인지 알 방법이
 * 없다** — 이름이 같은 다른 사람이나 같은 이름의 Agent 행까지 함께 지워진다.
 * 그것은 「식별정보를 지운다」가 아니라 **남의 Review 이력을 훼손하는 것**이다.
 * 그 값은 행위가 일어난 시점에 찍힌 **표시용 이름**이고, 「누가 고쳤는가」는 Review
 * 기록의 일부다.
 */

/** 계정을 지울 때 함께 사라지는 것의 규모. 🔴 화면이 «먼저» 보여 준다. */
export interface AccountDeletionLosses {
  projects: number;
  reviewIssues: number;
  knowledgePages: number;
  apiKeys: number;
}

export interface AccountDeletionImpact {
  /** Workspace 째로 사라지는 것들. */
  deleted: WorkspaceDeletionEntry[];
  /** 남는 것들. `rotateSlug` 면 주소가 바뀐다. */
  preserved: WorkspaceDeletionEntry[];
  /** 사람이 먼저 해결해야 하는 것들. 하나라도 있으면 삭제되지 않는다. */
  blocked: WorkspaceDeletionEntry[];
  deletable: boolean;
  /** `deleted` 안에서 함께 사라지는 것의 수. */
  losses: AccountDeletionLosses;
  /**
   * 삭제를 실행하기 전에 사람이 그대로 입력해야 하는 값.
   *
   * Personal Workspace 의 slug 다 — 그 사람의 로그인 신원에서 나온, 화면에 이미 보이는
   * 유일한 식별자다. 🔴 이메일을 쓰지 않는다(화면 어디에도 내보내지 않는 값이다).
   */
  confirmValue: string;
}

/** Personal Workspace 가 없는 계정의 확인 문구. 언어와 무관한 고정 낱말이다. */
const FALLBACK_CONFIRM_VALUE = "DELETE";

/** 중립 slug 를 만들 때 붙이는 머리말. 🔴 사람의 정보가 한 글자도 들어가지 않는다. */
const NEUTRAL_SLUG_PREFIX = "w-";

/** 중립 slug 가 이미 쓰이고 있을 때 다시 시도하는 횟수. */
const MAX_SLUG_ATTEMPTS = 5;

/** 잠그기 «전»에 읽은 내 소속 한 줄. 🔴 여기 담긴 `role` 은 낡을 수 있다. */
interface MyWorkspaceRow {
  workspaceId: string;
  slug: string;
  name: string;
  personalOwnerId: string | null;
  role: "OWNER" | "MEMBER";
}

/** 내가 속한 Workspace 를 읽는다. 🔴 아무것도 잠그지 않는다 — 잠글 «대상»을 고르는 조회다. */
async function readMyWorkspaces(
  userId: string,
  executor: DbExecutor,
): Promise<MyWorkspaceRow[]> {
  return executor
    .select({
      workspaceId: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      personalOwnerId: workspaces.personalOwnerId,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.slug);
}

/**
 * Workspace 행을 잠근다 — **가장 먼저 잡는 잠금이다**(`@/db` 의 전역 잠금 순서).
 *
 * 🔴 **소속 행을 잠그기 «전에» Workspace 행을 잠근다.**
 *
 * `FOR UPDATE` 는 **잠글 때 이미 존재하는 행만** 잡는다. 소속 행만 잠그면 그 뒤에
 * INSERT 되는 소속(초대 수락)은 아무 잠금에도 걸리지 않는데, Workspace 를 지우면
 * CASCADE 가 **방금 들어온 사람의 소속과 그 Workspace 의 Knowledge 를 통째로**
 * 지운다 — 「나 혼자였다」는 판단이 이미 낡은 것이 된 뒤다.
 *
 * 그래서 두 경로가 **같은 Workspace 행 하나**를 두고 줄을 서게 만든다.
 *
 * ```
 * 삭제 workspaces(잠금) -> users(잠금) -> 소속 읽기 -> 판단 -> DELETE
 * 수락 workspaces(잠금) -> users(잠금) -> 초대 소진 -> 소속 INSERT (invitation-service.ts)
 * ```
 *
 * 수락이 먼저면 삭제는 여기서 기다렸다가 **새 멤버가 보이는 상태**로 센다.
 * 삭제가 먼저면 수락은 잠금이 풀린 뒤 **사라진 Workspace** 를 보고 거절된다.
 *
 * 🔴 **이 보증은 「소속을 만드는 모든 경로가 이 잠금을 지나간다」에 달려 있다.**
 * 지금 그 경로는 셋뿐이고 나머지 둘(`createWorkspace`·`ensurePersonalWorkspace`)은
 * **자기가 방금 만든 Workspace** 에 넣으므로 남이 지울 대상이 아니다. 🔴 기존
 * Workspace 에 소속을 넣는 경로를 새로 만들면 **여기도 함께 고쳐야 한다.**
 *
 * 🔴 **잠그는 순서를 `id` 로 고정한다.** 두 삭제가 같은 Workspace 집합을 서로 다른
 * 순서로 잡으면 서로를 기다리다 deadlock 이 난다.
 */
async function lockMyWorkspaces(
  mine: readonly MyWorkspaceRow[],
  executor: DbExecutor,
): Promise<string[]> {
  if (mine.length === 0) {
    return [];
  }

  const live = await executor
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      inArray(
        workspaces.id,
        mine.map((row) => row.workspaceId),
      ),
    )
    .orderBy(workspaces.id)
    .for("update");

  // 잠그는 사이에 사라진 Workspace 는 더 이상 판단 대상이 아니다.
  return live.map((row) => row.id);
}

/**
 * 계정 행을 잠근다 — **`workspaces` 다음, 나머지 전부보다 먼저**(`@/db` 의 전역 잠금 순서).
 *
 * 🔴 **존재 확인을 겸하지만 «먼저» 할 수 없다.** 예전에는 이 잠금이 Transaction 의 첫
 * 문장이었고, 그래서 이 경로만 `users -> workspaces` 로 거꾸로 잠갔다 —
 * 초대 수락(`workspaces -> users`)과 동시에 돌리면 실제로 `40P01` 이 났다.
 * 존재 확인은 순서를 바꿀 이유가 되지 못한다. 없는 계정은 여기서도 그대로 0행이다.
 *
 * @returns 잠근 뒤에 읽은 계정. 없으면 `null`.
 */
async function lockAccountRow(
  userId: string,
  executor: DbExecutor,
): Promise<{ id: string; email: string } | null> {
  const rows = await executor
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .for("update")
    .limit(1);

  return rows[0] ?? null;
}

/**
 * 잠근 뒤의 사실로 판정 재료를 만든다 — 소속 행을 잠그는 것이 **마지막**이다.
 *
 * 🔴 **집계와 `FOR UPDATE` 를 함께 쓰지 못한다.** PostgreSQL 이 `FOR UPDATE is not
 * allowed with aggregate functions` 로 거절한다(`changeMemberRole` 에서 실제로 겪었다).
 * 그래서 잠글 때는 **행을 그대로 읽어** 센다. 읽는 행은 「내가 속한 Workspace 의 멤버」뿐이라
 * 표를 훑지 않는다.
 */
async function lockedMembershipFacts(
  userId: string,
  mine: readonly MyWorkspaceRow[],
  liveIds: readonly string[],
  executor: DbExecutor,
): Promise<WorkspaceMembershipFacts[]> {
  if (liveIds.length === 0) {
    return [];
  }

  const counts = new Map<string, { members: number; owners: number }>();

  /**
   * 🔴 **다른 사람이 같은 순간 역할을 바꾸거나 자기 계정을 지우는 것을 막는다.**
   * 두 OWNER 가 동시에 탈퇴하면 각자 「상대가 아직 OWNER 다」를 보고 둘 다 통과해
   * OWNER 가 0명이 된다. 같은 행을 잠그므로 뒤에 온 쪽이 기다렸다가 다시 본다.
   */
  const locked = await executor
    .select({
      workspaceId: workspaceMembers.workspaceId,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .where(inArray(workspaceMembers.workspaceId, [...liveIds]))
    /*
     * 🔴 **PK 순서 `(workspace_id, user_id)` 로 잠근다.** 여기는 Workspace 를 «여럿»
     * 가로지르므로 첫 열이 실제로 갈린다. 순서를 적지 않으면 Planner 가 고른 scan 순서가
     * 곧 잠금 순서가 되고, 같은 표를 잠그는 다른 경로(`removeMember` · `changeMemberRole` ·
     * `deleteWorkspace`)와 엇갈리면 고리가 닫힌다 — reviewer 가 실제 병렬 연결로 `40P01` 을
     * 재현했다. 근거와 규칙은 `@/db` 에 있다.
     */
    .orderBy(workspaceMembers.workspaceId, workspaceMembers.userId)
    .for("update");

  for (const row of locked) {
    if (row.userId === userId) {
      continue;
    }
    const bucket = counts.get(row.workspaceId) ?? { members: 0, owners: 0 };
    bucket.members += 1;
    if (row.role === "OWNER") {
      bucket.owners += 1;
    }
    counts.set(row.workspaceId, bucket);
  }

  /**
   * 🔴 잠근 뒤에 **내 소속과 «내 역할»을 다시 읽는다.** 목록을 읽고 잠그는 사이에 누가
   * 나를 내보냈다면 그 Workspace 는 더 이상 내 것이 아니고, **나를 OWNER 로 올렸다면
   * 나는 이제 OWNER 다.**
   *
   * 🔴 **낡은 역할과 갓 센 OWNER 수를 섞으면 판정이 거짓이 된다.** A=MEMBER·B=OWNER 로
   * 시작해 A 의 삭제가 첫 조회 «직후» 멈추고, 그 사이 B 가 A 를 OWNER 로 올린 뒤 자신을
   * MEMBER 로 내리면 — 다시 셌을 때 `otherOwners = 0` 인데 역할은 옛 `MEMBER` 라
   * `BLOCKED` 를 비껴가고, **OWNER 가 0명인 Workspace** 가 남는다.
   * 두 값은 반드시 **같은 시점**(잠근 뒤)의 것이어야 한다.
   *
   * 🔴 미리보기(`findAccountDeletionImpact`)는 이 경로를 타지 않는다 — 그것은 화면에
   * 보여 주는 추정치일 뿐 권한의 근거가 아니다.
   */
  const stillMine = new Map(
    locked
      .filter((row) => row.userId === userId)
      .map((row) => [row.workspaceId, row.role] as const),
  );

  return mine.flatMap((row) => {
    const role = stillMine.get(row.workspaceId);
    if (role === undefined) {
      return [];
    }

    return [
      {
        workspaceId: row.workspaceId,
        slug: row.slug,
        name: row.name,
        isPersonal: row.personalOwnerId === userId,
        role,
        otherMembers: counts.get(row.workspaceId)?.members ?? 0,
        otherOwners: counts.get(row.workspaceId)?.owners ?? 0,
      },
    ];
  });
}

/**
 * 미리보기가 쓰는 사실 — **아무것도 잠그지 않는다.**
 *
 * 잠글 필요가 없으므로 Database 가 `GROUP BY` 로 센다.
 */
async function unlockedMembershipFacts(
  userId: string,
  executor: DbExecutor,
): Promise<WorkspaceMembershipFacts[]> {
  const mine = await readMyWorkspaces(userId, executor);

  if (mine.length === 0) {
    return [];
  }

  const workspaceIds = mine.map((row) => row.workspaceId);
  const counts = new Map<string, { members: number; owners: number }>();

  const grouped = await executor
    .select({
      workspaceId: workspaceMembers.workspaceId,
      members: sql<number>`cast(count(*) as int)`,
      owners: sql<number>`cast(count(*) filter (where ${workspaceMembers.role} = 'OWNER') as int)`,
    })
    .from(workspaceMembers)
    .where(
      and(
        inArray(workspaceMembers.workspaceId, workspaceIds),
        ne(workspaceMembers.userId, userId),
      ),
    )
    .groupBy(workspaceMembers.workspaceId);

  for (const row of grouped) {
    counts.set(row.workspaceId, { members: row.members, owners: row.owners });
  }

  return mine.map((row) => ({
    workspaceId: row.workspaceId,
    slug: row.slug,
    name: row.name,
    isPersonal: row.personalOwnerId === userId,
    role: row.role,
    otherMembers: counts.get(row.workspaceId)?.members ?? 0,
    otherOwners: counts.get(row.workspaceId)?.owners ?? 0,
  }));
}

async function countLosses(
  workspaceIds: string[],
  executor: DbExecutor,
): Promise<AccountDeletionLosses> {
  if (workspaceIds.length === 0) {
    return { projects: 0, reviewIssues: 0, knowledgePages: 0, apiKeys: 0 };
  }

  const total = sql<number>`cast(count(*) as int)`;

  const [projectRows, issueRows, pageRows, keyRows] = await Promise.all([
    executor
      .select({ value: total })
      .from(projects)
      .where(inArray(projects.workspaceId, workspaceIds)),
    executor
      .select({ value: total })
      .from(reviewIssues)
      .where(inArray(reviewIssues.workspaceId, workspaceIds)),
    executor
      .select({ value: total })
      .from(knowledgePages)
      .where(inArray(knowledgePages.workspaceId, workspaceIds)),
    executor
      .select({ value: total })
      .from(apiKeys)
      .where(inArray(apiKeys.workspaceId, workspaceIds)),
  ]);

  return {
    projects: projectRows[0]?.value ?? 0,
    reviewIssues: issueRows[0]?.value ?? 0,
    knowledgePages: pageRows[0]?.value ?? 0,
    apiKeys: keyRows[0]?.value ?? 0,
  };
}

/**
 * 계정을 지우면 무엇이 사라지는지 **미리** 센다.
 *
 * 🔴 이 함수는 아무것도 바꾸지 않는다. 화면이 사람에게 보여 주기 위한 것이고,
 * 실제 판정은 `deleteAccount` 가 Transaction 안에서 다시 한다 — 보는 사이에 팀 상황이
 * 바뀔 수 있으므로 이 결과를 권한 근거로 쓰지 않는다.
 */
export async function findAccountDeletionImpact(
  userId: string,
  executor: DbExecutor = db(),
): Promise<AccountDeletionImpact> {
  const facts = await unlockedMembershipFacts(userId, executor);
  const plan = planAccountDeletion(facts);

  const losses = await countLosses(
    plan.deleted.map((entry) => entry.workspaceId),
    executor,
  );

  const personal = facts.find((fact) => fact.isPersonal);

  return {
    deleted: plan.deleted,
    preserved: plan.preserved,
    blocked: plan.blocked,
    deletable: plan.deletable,
    losses,
    confirmValue: personal?.slug ?? FALLBACK_CONFIRM_VALUE,
  };
}

/**
 * 남는 Workspace 의 주소에서 사람의 신원을 걷어낸다.
 *
 * `personal_owner_id` 도 함께 비운다 — 그 사람이 사라지면 FK 가 어차피 NULL 로 만들지만,
 * **여기서 명시적으로 끊어야** 「이것은 이제 그냥 팀 Workspace 다」가 한 Transaction 안에서
 * slug 변경과 함께 확정된다.
 */
async function rotateWorkspaceSlug(
  workspaceId: string,
  executor: DbExecutor,
): Promise<void> {
  /**
   * 🔴 사람의 이름·아이디·이메일을 재료로 쓰지 않는다. 그것을 지우려고 바꾸는 것이다.
   *
   * 첫 후보는 **그 Workspace 자신의 id** 다 — 이미 전역에서 유일하므로 겹칠 수 없고,
   * 같은 Workspace 를 두 번 처리해도 같은 주소가 나온다. 뒤의 후보는 만에 하나
   * 그 문자열을 이름으로 가진 Workspace 가 이미 있을 때의 대비다.
   */
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const seed = attempt === 0 ? workspaceId : crypto.randomUUID();
    const slug = `${NEUTRAL_SLUG_PREFIX}${seed.replaceAll("-", "")}`;

    /**
     * 🔴 **UPDATE 는 `ON CONFLICT` 를 쓸 수 없다.** unique 위반이 나면 그 순간
     * Transaction 전체가 죽어 계정 삭제가 통째로 실패한다 — 그래서 먼저 본다.
     * 확인과 UPDATE 사이의 틈은 이 Transaction 이 `workspaces` 행을 이미 잡고 있는
     * 데다 후보가 uuid 라 실질적으로 닫혀 있다.
     */
    const taken = await executor
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, slug))
      .limit(1);

    if (taken.length > 0) {
      continue;
    }

    await executor
      .update(workspaces)
      .set({ slug, personalOwnerId: null, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));

    return;
  }

  throw new AppError("WORKSPACE_SLUG_RELEASE_FAILED");
}

/**
 * 계정을 지운다.
 *
 * 🔴 **`userId` 는 세션에서만 온다.** 이 함수를 부르는 Server Action 은 인자를 하나도
 * 받지 않는다(`actions/delete-account.ts`) — 지울 대상을 화면이 고를 수 있게 두면
 * 「남의 계정 삭제」가 곧바로 열린다.
 *
 * 🔴 **한 Transaction 이다.** 중간에 실패하면 Workspace 도 소속도 그대로 남는다 —
 * 「Workspace 는 지워졌는데 계정은 살아 있는」 반쪽 상태를 만들지 않는다.
 *
 * # 🔴 잠그는 순서는 `workspaces -> users -> workspace_members` 다
 *
 * 전역 규칙이고 근거는 `@/db` 에 적혀 있다. **여기서만 순서를 바꾸면 곧바로 deadlock 이다** —
 * 초대 수락이 `workspaces -> users` 로 잠그기 때문이다. 존재 확인을 위해 `users` 를 먼저
 * 잠갔던 것이 실제로 `40P01` 을 만들었다.
 *
 * @throws {AppError} 계정이 없으면 `NOT_FOUND`, 마지막 OWNER 인 Workspace 가 있으면 `CONFLICT`.
 */
export async function deleteAccount(
  input: { userId: string },
  executor: DbExecutor = db(),
): Promise<void> {
  await executor.transaction(async (tx) => {
    // 0. 잠글 «대상»을 고른다. 🔴 이 조회는 아무것도 잠그지 않는다.
    const mine = await readMyWorkspaces(input.userId, tx);

    // 1. workspaces — 가장 먼저다.
    const liveIds = await lockMyWorkspaces(mine, tx);

    /**
     * 2. users — Workspace 다음이다.
     *
     * 🔴 **존재 확인을 여기서 한다.** 계정이 없으면 잠글 행도 없어 0행이 돌아온다 —
     * 「먼저 확인하고 그 다음에 잠근다」로 나눌 이유가 없고, 나누면 잠금 순서가 깨진다.
     */
    const account = await lockAccountRow(input.userId, tx);
    if (account === null) {
      throw new AppError("ACCOUNT_NOT_FOUND");
    }

    // 3. workspace_members — 판정에 쓰는 사실은 전부 «잠근 뒤»의 값이다.
    const plan: AccountDeletionPlan = planAccountDeletion(
      await lockedMembershipFacts(input.userId, mine, liveIds, tx),
    );

    if (!plan.deletable) {
      /**
       * 🔴 **어느 Workspace 인지 message 에 적지 않는다.** 화면은 미리보기로 이미 이름을
       * 알고 있고, 오류 문자열은 로그로도 흘러 나간다.
       */
      throw new AppError("ACCOUNT_LAST_OWNER");
    }

    const doomed = plan.deleted.map((entry) => entry.workspaceId);
    if (doomed.length > 0) {
      // Workspace 아래는 전부 ON DELETE CASCADE 다 — Project·Review·Issue·Wiki·API Key.
      await tx.delete(workspaces).where(inArray(workspaces.id, doomed));
    }

    for (const entry of plan.preserved) {
      if (entry.rotateSlug) {
        await rotateWorkspaceSlug(entry.workspaceId, tx);
      }
    }

    /**
     * 🔴 **초대 행에는 이메일이 «평문»으로 남는다.** `invited_by`·`accepted_by` 는 FK 라
     * NULL 이 되지만 `email` Column 은 그대로다 — 계정을 지웠는데 그 사람의 이메일이
     * 남의 Workspace 초대 목록에 남아 있으면 지운 것이 아니다.
     *
     * 지우는 것은 **이 이메일이 적힌 행**뿐이다. 초대 자체는 Workspace 의 것이고,
     * 그 사람은 이제 그 Workspace 의 멤버도 아니다.
     */
    await tx
      .delete(workspaceInvitations)
      .where(eq(workspaceInvitations.email, account.email));

    // Auth.js 가 쓰는 표. GitHub OAuth 만 쓰는 지금은 대개 비어 있지만 이메일이 식별자다.
    await tx
      .delete(verificationTokens)
      .where(eq(verificationTokens.identifier, account.email));

    /**
     * 마지막으로 계정 자체. CASCADE 가 함께 지우는 것:
     * `accounts`(provider_account_id·scope) · `sessions`(전 기기) · `workspace_members`.
     */
    await tx.delete(users).where(eq(users.id, input.userId));
  });
}
