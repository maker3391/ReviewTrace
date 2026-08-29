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
 * CASCADE   accounts · sessions · workspace_members
 * SET NULL  workspaces.personal_owner_id · workspaces.created_by
 *           projects.created_by · knowledge_pages.created_by
 *           workspace_invitations.invited_by · workspace_invitations.accepted_by
 * ```
 *
 * 🔴 **그대로 두면 Personal Workspace 가 «주인 없는 유령»으로 남는다.** 소속 행은
 * CASCADE 로 사라지고 `personal_owner_id` 는 NULL 이 되어, **아무도 들어갈 수 없고
 * 아무도 지울 수 없는데 GitHub 아이디만 주소에 박힌 Workspace** 가 영원히 남는다
 * (slug 는 전역 unique 라 그 아이디를 다시 쓸 수도 없다).
 *
 * 🔴 **반대로 「사람이 지워졌으니 그가 속한 것도 전부 지운다」도 안 된다.** 팀
 * Workspace 의 Review Knowledge 는 남은 사람들의 것이다. 한 사람이 나갔다고 팀의
 * Knowledge 가 사라지면 이 제품의 존재 이유가 무너진다(CLAUDE.md 1·23).
 *
 * 그래서 **Workspace 마다 따로 판단한다** — 규칙은 `account-deletion-plan.ts` 에 있다.
 *
 * # 무엇이 지워지고 무엇이 남는가
 *
 * ```
 * 지운다   users(email·name·image) · accounts(provider_account_id) · sessions(전 기기)
 *          나 혼자 있던 Workspace 통째 · 내 이메일이 적힌 초대 행
 * 남긴다   다른 멤버가 있는 Workspace 와 그 안의 Review Knowledge 전부
 *          created_by 는 NULL 이 되고 문서·Project 자체는 그대로 남는다
 * ```
 *
 * 🔴 **`issue_activities.actor_name` 은 건드리지 않는다.** 그 Column 은 `users` 를
 * 참조하지 않는 자유 문자열이라(스키마 확인) **어느 행이 이 사람의 것인지 알 방법이
 * 없다** — 이름이 같은 다른 사람이나 같은 이름의 Agent 행까지 함께 지워진다.
 * 그것은 「식별정보를 지운다」가 아니라 **남의 Review 이력을 훼손하는 것**이다.
 * 그 값은 행위가 일어난 시점에 찍힌 **표시용 이름**이고, 「누가 고쳤는가」는 Review
 * 기록의 일부다(CLAUDE.md 2).
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

/**
 * 이 사람이 속한 Workspace 의 사실을 모은다.
 *
 * `lock` 이면 소속 행을 `FOR UPDATE` 로 잠근다 — 실제로 지울 때만 쓴다.
 *
 * 🔴 **집계와 `FOR UPDATE` 를 함께 쓰지 못한다.** PostgreSQL 이 `FOR UPDATE is not
 * allowed with aggregate functions` 로 거절한다(`changeMemberRole` 에서 실제로 겪었다).
 * 그래서 잠글 때는 **행을 그대로 읽어** 세고, 잠글 필요가 없는 미리보기에서는 Database 가
 * `GROUP BY` 로 센다. 읽는 행은 「내가 속한 Workspace 의 멤버」뿐이라 표를 훑지 않는다.
 */
async function readMembershipFacts(
  userId: string,
  executor: DbExecutor,
  lock: boolean,
): Promise<WorkspaceMembershipFacts[]> {
  const mine = await executor
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

  if (mine.length === 0) {
    return [];
  }

  const workspaceIds = mine.map((row) => row.workspaceId);

  const counts = new Map<string, { members: number; owners: number }>();

  if (lock) {
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
      .where(inArray(workspaceMembers.workspaceId, workspaceIds))
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
     * 🔴 잠근 뒤에 **내 소속을 다시 확인한다.** 목록을 읽고 잠그는 사이에 누가 나를
     * 내보냈다면 그 Workspace 는 더 이상 내 것이 아니다 — 그것을 지우면 안 된다.
     */
    const stillMine = new Set(
      locked
        .filter((row) => row.userId === userId)
        .map((row) => row.workspaceId),
    );

    return mine
      .filter((row) => stillMine.has(row.workspaceId))
      .map((row) => ({
        workspaceId: row.workspaceId,
        slug: row.slug,
        name: row.name,
        isPersonal: row.personalOwnerId === userId,
        role: row.role,
        otherMembers: counts.get(row.workspaceId)?.members ?? 0,
        otherOwners: counts.get(row.workspaceId)?.owners ?? 0,
      }));
  }

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
  const facts = await readMembershipFacts(userId, executor, false);
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
    const seed =
      attempt === 0 ? workspaceId : crypto.randomUUID();
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
 * 「남의 계정 삭제」가 곧바로 열린다(CLAUDE.md 11).
 *
 * 🔴 **한 Transaction 이다.** 중간에 실패하면 Workspace 도 소속도 그대로 남는다 —
 * 「Workspace 는 지워졌는데 계정은 살아 있는」 반쪽 상태를 만들지 않는다.
 *
 * @throws {AppError} 계정이 없으면 `NOT_FOUND`, 마지막 OWNER 인 Workspace 가 있으면 `CONFLICT`.
 */
export async function deleteAccount(
  input: { userId: string },
  executor: DbExecutor = db(),
): Promise<void> {
  await executor.transaction(async (tx) => {
    const found = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update")
      .limit(1);

    const account = found[0];
    if (account === undefined) {
      throw new AppError("ACCOUNT_NOT_FOUND");
    }

    const plan: AccountDeletionPlan = planAccountDeletion(
      await readMembershipFacts(input.userId, tx, true),
    );

    if (!plan.deletable) {
      /**
       * 🔴 **어느 Workspace 인지 message 에 적지 않는다.** 화면은 미리보기로 이미 이름을
       * 알고 있고, 오류 문자열은 로그로도 흘러 나간다(CLAUDE.md 11·19).
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
     * 남의 Workspace 초대 목록에 남아 있으면 지운 것이 아니다(CLAUDE.md 19).
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
