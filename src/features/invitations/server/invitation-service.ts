import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import {
  generateInvitationToken,
  hashInvitationToken,
} from "@/features/invitations/server/invitation-token";
import { AppError } from "@/lib/errors";

/**
 * Workspace 초대.
 *
 * ```
 * 발행  OWNER -> Token 생성 -> Hash 저장 -> 링크 1회 표시
 * 수락  링크 -> (로그인) -> Token 검증 -> WorkspaceMember 추가 -> 초대 소진
 * ```
 *
 * 🔴 **초대는 이미 회원인 사람에게도, 아직 아닌 사람에게도 같은 흐름이다**(스펙 8·9).
 * 회원이면 로그인 즉시 수락되고, 아니면 GitHub 로그인 → Personal Workspace 생성 →
 * 그 다음에 이 초대가 소진된다. **어느 쪽이든 User 를 새로 만들거나 기존 소속을 건드리지 않는다.**
 */

/** 기본 유효 기간. 링크가 영원히 사는 것을 막는다. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreatedInvitation {
  /** 🔴 **이 한 번만 존재한다.** 저장되지 않으므로 화면을 떠나면 다시 볼 수 없다. */
  token: string;
  email: string;
  expiresAt: Date;
}

/**
 * 초대를 발행한다.
 *
 * @throws {AppError} 이미 그 Workspace 의 Member 인 이메일이면 `CONFLICT`.
 */
export async function createInvitation(
  input: {
    workspaceId: string;
    email: string;
    invitedBy: string;
  },
  executor: DbExecutor = db(),
): Promise<CreatedInvitation> {
  /**
   * 이미 Member 인 사람을 초대하지 않는다(스펙 10).
   *
   * 소속 자체는 PK 가 막아 주므로 이것은 **안내를 위한 확인**이다 — 수락하고 나서야
   * 「이미 멤버」를 알게 되는 것보다 발행 시점에 말해 주는 쪽이 낫다.
   */
  const alreadyMember = await executor
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, input.workspaceId),
        eq(users.email, input.email),
      ),
    )
    .limit(1);

  if (alreadyMember.length > 0) {
    throw new AppError("CONFLICT", "이미 이 Workspace 의 멤버입니다.");
  }

  const { token, tokenHash } = generateInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  await executor.insert(workspaceInvitations).values({
    workspaceId: input.workspaceId,
    email: input.email,
    role: "MEMBER",
    tokenHash,
    expiresAt,
    invitedBy: input.invitedBy,
  });

  return { token, email: input.email, expiresAt };
}

export interface InvitationPreview {
  workspaceName: string;
  workspaceSlug: string;
  email: string;
}

/**
 * 수락 화면이 보여 줄 최소 정보.
 *
 * 🔴 **초대한 사람·다른 멤버·Workspace 내부를 보여 주지 않는다.** 링크를 주운 사람이 볼 수 있는
 * 화면이므로 「어느 Workspace 로의 초대인가」까지만 알린다.
 */
export async function findInvitationPreview(
  token: string,
  executor: DbExecutor = db(),
): Promise<InvitationPreview | null> {
  const rows = await executor
    .select({
      email: workspaceInvitations.email,
      expiresAt: workspaceInvitations.expiresAt,
      acceptedAt: workspaceInvitations.acceptedAt,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
    .where(eq(workspaceInvitations.tokenHash, hashInvitationToken(token)))
    .limit(1);

  const row = rows[0];
  if (row === undefined || row.acceptedAt !== null) {
    return null;
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return {
    workspaceName: row.workspaceName,
    workspaceSlug: row.workspaceSlug,
    email: row.email,
  };
}

/**
 * 초대를 수락한다.
 *
 * 검증하는 것(스펙 10):
 *
 * - 유효한 초대인가 (Token Hash 로 찾는다)
 * - 만료되지 않았는가
 * - 이미 수락되지 않았는가
 * - 대상 Workspace 가 존재하는가 (Join 이 그것을 보장한다)
 * - 이미 Member 인가
 *
 * 🔴 **중복 수락이 소속을 둘로 만들지 않는다.** 두 겹으로 막는다 —
 * `accepted_at IS NULL` 조건이 붙은 UPDATE 가 **한 번만** 행을 잡고,
 * 그마저 뚫려도 `workspace_members` 의 PK 가 두 번째 INSERT 를 막는다.
 *
 * @returns 들어간 Workspace 의 slug.
 * @throws {AppError} 쓸 수 없는 초대면 `NOT_FOUND`.
 */
export async function acceptInvitation(
  input: { token: string; userId: string },
  executor: DbExecutor = db(),
): Promise<string> {
  const tokenHash = hashInvitationToken(input.token);

  return executor.transaction(async (tx) => {
    /**
     * 🔴 **잡는 것과 확인하는 것을 한 문장으로 한다.**
     *
     * 「찾아서 확인하고 그 다음에 UPDATE」로 나누면 두 요청이 같은 초대를 함께 통과한다.
     * `WHERE accepted_at IS NULL` 을 UPDATE 자체에 붙이면 **행을 돌려받은 쪽만** 수락한 것이다.
     */
    const claimed = await tx
      .update(workspaceInvitations)
      .set({ acceptedAt: new Date(), acceptedBy: input.userId })
      .where(
        and(
          eq(workspaceInvitations.tokenHash, tokenHash),
          isNull(workspaceInvitations.acceptedAt),
        ),
      )
      .returning({
        workspaceId: workspaceInvitations.workspaceId,
        email: workspaceInvitations.email,
        role: workspaceInvitations.role,
        expiresAt: workspaceInvitations.expiresAt,
      });

    const invitation = claimed[0];
    if (invitation === undefined) {
      // 없거나 이미 수락됐다. 둘을 구분해 알려 주지 않는다.
      throw new AppError("NOT_FOUND", "사용할 수 없는 초대입니다.");
    }

    if (invitation.expiresAt.getTime() <= Date.now()) {
      // 만료된 초대를 방금 소진해 버렸으므로 Transaction 을 통째로 되돌린다.
      throw new AppError("NOT_FOUND", "사용할 수 없는 초대입니다.");
    }

    const workspace = await tx
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, invitation.workspaceId))
      .limit(1);

    const slug = workspace[0]?.slug;
    if (slug === undefined) {
      throw new AppError("NOT_FOUND", "사용할 수 없는 초대입니다.");
    }

    /**
     * 🔴 **기존 소속을 건드리지 않는다**(스펙 8). Personal Workspace 의 OWNER 자리는 그대로 두고
     * 이 Workspace 의 MEMBER 행 하나만 더한다.
     *
     * 이미 Member 면 아무것도 하지 않는다 — 초대를 소진한 것으로 충분하다.
     */
    await tx
      .insert(workspaceMembers)
      .values({
        workspaceId: invitation.workspaceId,
        userId: input.userId,
        role: invitation.role,
      })
      .onConflictDoNothing();

    return slug;
  });
}

export interface PendingInvitation {
  id: string;
  email: string;
  expiresAt: Date;
}

/** Workspace 설정 화면의 「보낸 초대」 목록. 🔴 Token Hash 는 내보내지 않는다. */
export async function listPendingInvitations(
  workspaceId: string,
  executor: DbExecutor = db(),
): Promise<PendingInvitation[]> {
  return executor
    .select({
      id: workspaceInvitations.id,
      email: workspaceInvitations.email,
      expiresAt: workspaceInvitations.expiresAt,
    })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        isNull(workspaceInvitations.acceptedAt),
      ),
    )
    .orderBy(workspaceInvitations.createdAt);
}

export interface WorkspaceMemberRow {
  name: string | null;
  role: "OWNER" | "MEMBER";
}

/** Workspace 설정 화면의 멤버 목록. 🔴 이메일은 내보내지 않는다 — 화면이 그리지 않는다. */
export async function listWorkspaceMembers(
  workspaceId: string,
  executor: DbExecutor = db(),
): Promise<WorkspaceMemberRow[]> {
  return executor
    .select({ name: users.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(workspaceMembers.createdAt);
}
