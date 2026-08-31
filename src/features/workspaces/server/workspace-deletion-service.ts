import "server-only";

import { eq, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  apiKeys,
  knowledgePages,
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
  tags,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import {
  planWorkspaceDeletion,
  type WorkspaceDeletionBlock,
  type WorkspaceDeletionPlan,
} from "@/features/workspaces/server/workspace-deletion-plan";
import { AppError } from "@/lib/errors";

/**
 * Workspace 삭제.
 *
 * # 🔴 수동 DELETE 를 나열하지 않는다 — Database 가 이미 그 일을 한다
 *
 * 실제 catalog(`pg_constraint.confdeltype`)를 전수 조회한 결과, `workspaces` 를 참조하는
 * FK **11개가 전부 `ON DELETE CASCADE`** 다:
 *
 * ```
 * CASCADE  api_keys · issue_activities · issue_code_evidences · knowledge_pages
 *          projects · repositories · review_issues · review_sessions · tags
 *          workspace_invitations · workspace_members
 * ```
 *
 * `issue_tags` 는 `workspace_id` 를 갖지 않지만 `review_issues` 를 타고 함께 사라진다.
 * 🔴 **`workspace_id` Column 을 갖고도 FK 가 없는 표는 하나도 없다**(17개 표 전수 확인) —
 * 그래서 `DELETE FROM workspaces` 한 문장으로 **고아가 남지 않는다.**
 *
 * 🔴 **응용 코드에서 하위 표를 순서대로 지우지 않는다.** 그렇게 하면 표를 새로 더할 때마다
 * 이 목록에 적는 것을 잊는 순간 조용히 고아가 생긴다 — FK 는 잊을 수 없다.
 *
 * # 🔴 다른 Workspace 는 건드리지 않는다
 *
 * 모든 문장의 조건이 `workspace_id = ?` 하나로 닫혀 있고, CASCADE 도 그 Workspace 를
 * 가리키는 행에만 걸린다. 사람(`users`)은 **지우지 않는다** — Workspace 가 사라져도
 * 계정과 다른 Workspace 의 소속은 그대로다(계정 삭제와 별개 기능이다).
 *
 * # 🔴 잠그는 순서는 `workspaces -> workspace_members` 다
 *
 * 전역 규칙이고 근거는 `@/db` 에 있다. 🔴 **`users` 를 잠그지 않는다** — 참조하는 쪽
 * (`workspaces.personal_owner_id`·`created_by`)의 행을 **지우는** 것은 참조되는 `users`
 * 행에 잠금을 요구하지 않는다. 계정 삭제(`workspaces -> users -> workspace_members`)와
 * 초대 수락(`workspaces -> users -> …`)이 **같은 첫 자리**를 잡으므로 고리가 생기지 않는다.
 */

/** 지우면 함께 사라지는 것. 🔴 사용자에게 «무엇을 잃는지» 먼저 보여 주기 위한 값이다. */
export interface WorkspaceDeletionLosses {
  projects: number;
  repositories: number;
  reviewSessions: number;
  reviewIssues: number;
  knowledgePages: number;
  apiKeys: number;
  /** 발행·수락·취소된 초대 이력 전부. 취소된 행도 CASCADE 로 함께 사라진다. */
  invitations: number;
  tags: number;
}

export interface WorkspaceDeletionImpact extends WorkspaceDeletionPlan {
  losses: WorkspaceDeletionLosses;
  /** 나를 뺀 멤버 수. 🔴 화면이 「먼저 내보내라」를 말할 근거다. */
  otherMembers: number;
}

/**
 * 막는 이유 ↔ 오류.
 *
 * 🔴 **`NOT_OWNER` 가 `NOT_FOUND` 인 것은 의도다** — `requireOwner` 가 `notFound()` 로
 * 답하는 것과 같은 판단이다(CLAUDE.md 11).
 *
 * 🔴 **표가 아니라 `switch` 다.** `AppError` 의 인자는 이유마다 «필요한 meta 가 다른»
 * 판별 tuple 이라, 넓힌 `AppErrorReason` 을 그대로 넘기면 타입이 서지 않는다 —
 * 각 가지에서 문자열 그대로 던져야 「그 이유에 맞는 인자」임이 확인된다.
 */
function blockError(block: WorkspaceDeletionBlock): AppError {
  switch (block) {
    case "NOT_OWNER":
      return new AppError("WORKSPACE_OWNER_REQUIRED");
    case "PERSONAL":
      return new AppError("PERSONAL_WORKSPACE_UNDELETABLE");
    case "HAS_MEMBERS":
      return new AppError("WORKSPACE_HAS_MEMBERS");
  }
}

/**
 * 지우면 무엇이 사라지는지 **미리** 센다.
 *
 * 🔴 이 함수는 아무것도 바꾸지 않고 아무것도 잠그지 않는다. 화면이 사람에게 보여 주기
 * 위한 것이고, 실제 판정은 `deleteWorkspace` 가 Transaction 안에서 **다시** 한다 —
 * 보는 사이에 멤버가 늘 수 있으므로 이 결과를 권한 근거로 쓰지 않는다.
 *
 * 🔴 **집계를 JavaScript 에서 세지 않는다**(CLAUDE.md 13). 표를 통째로 읽어 `length` 를
 * 재면 Issue 가 많은 Workspace 에서 설정 화면 하나가 표를 전부 끌어온다.
 */
export async function findWorkspaceDeletionImpact(
  input: { workspaceId: string; userId: string },
  executor: DbExecutor = db(),
): Promise<WorkspaceDeletionImpact> {
  const total = sql<number>`cast(count(*) as int)`;

  const [
    workspaceRows,
    memberRows,
    projectRows,
    repositoryRows,
    sessionRows,
    issueRows,
    pageRows,
    keyRows,
    invitationRows,
    tagRows,
  ] = await Promise.all([
    executor
      .select({ personalOwnerId: workspaces.personalOwnerId })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1),
    executor
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, input.workspaceId)),
    executor
      .select({ value: total })
      .from(projects)
      .where(eq(projects.workspaceId, input.workspaceId)),
    executor
      .select({ value: total })
      .from(repositories)
      .where(eq(repositories.workspaceId, input.workspaceId)),
    executor
      .select({ value: total })
      .from(reviewSessions)
      .where(eq(reviewSessions.workspaceId, input.workspaceId)),
    executor
      .select({ value: total })
      .from(reviewIssues)
      .where(eq(reviewIssues.workspaceId, input.workspaceId)),
    executor
      .select({ value: total })
      .from(knowledgePages)
      .where(eq(knowledgePages.workspaceId, input.workspaceId)),
    executor
      .select({ value: total })
      .from(apiKeys)
      .where(eq(apiKeys.workspaceId, input.workspaceId)),
    executor
      .select({ value: total })
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.workspaceId, input.workspaceId)),
    executor
      .select({ value: total })
      .from(tags)
      .where(eq(tags.workspaceId, input.workspaceId)),
  ]);

  /**
   * 🔴 **멤버는 «수»가 아니라 «행»으로 읽는다.** 내 역할과 남은 사람 수가 **같은 시점**의
   * 값이어야 판정이 거짓이 되지 않는다(`account-deletion-service.ts` 가 겪은 것과 같은
   * 함정이다). 읽는 행은 이 Workspace 의 멤버뿐이라 표를 훑지 않는다.
   */
  const mine = memberRows.find((row) => row.userId === input.userId);
  const otherMembers = memberRows.filter(
    (row) => row.userId !== input.userId,
  ).length;

  const plan = planWorkspaceDeletion({
    isPersonal: workspaceRows[0]?.personalOwnerId != null,
    // 소속이 없으면 화면이 이미 404 다. 여기서는 「지울 수 없다」로 닫는다.
    role: mine?.role ?? "MEMBER",
    otherMembers,
  });

  return {
    ...plan,
    otherMembers,
    losses: {
      projects: projectRows[0]?.value ?? 0,
      repositories: repositoryRows[0]?.value ?? 0,
      reviewSessions: sessionRows[0]?.value ?? 0,
      reviewIssues: issueRows[0]?.value ?? 0,
      knowledgePages: pageRows[0]?.value ?? 0,
      apiKeys: keyRows[0]?.value ?? 0,
      invitations: invitationRows[0]?.value ?? 0,
      tags: tagRows[0]?.value ?? 0,
    },
  };
}

/**
 * Workspace 를 지운다.
 *
 * 🔴 **되돌릴 수 없다.** 그 안의 Project · Repository · Review · Issue · Activity ·
 * Code Evidence · Wiki · API Key · Tag · 초대 이력이 **함께 사라진다.** 부르는 쪽은
 * `findWorkspaceDeletionImpact` 로 무엇을 잃는지 먼저 보여 준다.
 *
 * 🔴 **`userId` 는 세션에서 온 값이다.** Client 가 보낸 식별자를 쓰지 않는다(CLAUDE.md 11).
 * 🔴 **화면이 버튼을 감추는 것은 편의일 뿐이다.** OWNER 여부·Personal 여부를 여기서
 * **다시** 판정한다 — 이 함수가 마지막 경계다.
 *
 * @throws {AppError} 대상이 없거나 내 Workspace 가 아니면 `NOT_FOUND`,
 *   OWNER 가 아니면 `NOT_FOUND`, Personal 이거나 멤버가 남아 있으면 `CONFLICT`.
 */
export async function deleteWorkspace(
  input: { workspaceId: string; userId: string },
  executor: DbExecutor = db(),
): Promise<void> {
  await executor.transaction(async (tx) => {
    /**
     * 1. `workspaces` — 전역 잠금 순서의 첫 자리다.
     *
     * 🔴 **멤버를 세기 «전에» 이 행을 잠근다.** `FOR UPDATE` 는 잠글 때 이미 존재하는
     * 행만 잡는다 — 소속 행만 잠그면 그 뒤 INSERT 되는 소속(초대 수락)이 어떤 잠금에도
     * 걸리지 않아, 「나 혼자다」로 판정한 직후 들어온 사람의 데이터까지 CASCADE 가
     * 지운다. 초대 수락도 같은 행을 먼저 잠그므로 둘이 줄을 선다
     * (`invitation-service.ts` · `account-deletion-service.ts`).
     */
    const locked = await tx
      .select({ personalOwnerId: workspaces.personalOwnerId })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .for("update")
      .limit(1);

    const workspace = locked[0];
    if (workspace === undefined) {
      throw new AppError("WORKSPACE_NOT_FOUND");
    }

    /**
     * 2. `workspace_members` — 판정에 쓰는 사실은 전부 «잠근 뒤»의 값이다.
     *
     * 🔴 **집계와 `FOR UPDATE` 를 함께 쓰지 못한다.** PostgreSQL 이
     * `FOR UPDATE is not allowed with aggregate functions` 로 거절한다
     * (`changeMemberRole` 에서 실제로 겪었다). 행을 그대로 읽어 센다.
     */
    const members = await tx
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, input.workspaceId))
      .for("update");

    const mine = members.find((row) => row.userId === input.userId);
    if (mine === undefined) {
      /**
       * 🔴 **소속이 없으면 `FORBIDDEN` 이 아니라 `NOT_FOUND` 다.** 둘을 구분해 주면
       * 그 workspaceId 가 존재한다는 사실이 새어 나간다(CLAUDE.md 11 · 13).
       */
      throw new AppError("WORKSPACE_NOT_FOUND");
    }

    const plan = planWorkspaceDeletion({
      isPersonal: workspace.personalOwnerId !== null,
      role: mine.role,
      otherMembers: members.filter((row) => row.userId !== input.userId).length,
    });

    if (plan.block !== null) {
      throw blockError(plan.block);
    }

    /**
     * 3. 한 문장이다. 아래는 전부 `ON DELETE CASCADE` 로 따라 사라진다 —
     *    Project · Repository · Review · Issue · Activity · Evidence · Wiki ·
     *    API Key · Tag · 초대 · 소속.
     */
    const deleted = await tx
      .delete(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .returning({ id: workspaces.id });

    if (deleted.length === 0) {
      throw new AppError("WORKSPACE_NOT_FOUND");
    }
  });
}
