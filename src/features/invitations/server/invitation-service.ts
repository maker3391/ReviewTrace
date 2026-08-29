import "server-only";

import { and, eq, isNull, lte, sql } from "drizzle-orm";

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
import { normalizeEmail } from "@/lib/validation/email";

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
 * # 🔴 살아 있는 초대는 (Workspace, Email) 당 하나뿐이다
 *
 * 같은 사람에게 링크가 여러 개 살아 있으면 **취소가 뜻을 잃는다** — 하나를 죽여도 나머지가
 * 그대로 살아 있어, 새어 나간 것이 어느 것인지 모르는 채 전부를 뒤져야 한다.
 * 살아 있는 것이 언제나 하나뿐이라 「이 초대를 취소한다」가 곧 「이 주소로 나간 링크를
 * 전부 죽인다」와 같은 뜻이 된다(`revokeInvitation`).
 *
 * ```
 * 요청 A ─┐
 *         ├─ 조회 단계는 «둘 다» 통과할 수 있다
 * 요청 B ─┘
 *         ↓  workspace_invitations_live_email_unique
 *      한 쪽만 행을 얻는다
 * ```
 *
 * 🔴 **그래서 「조회해 보고 없으면 INSERT」로 나누지 않는다.** 나누는 순간 두 문장 사이에
 * 다른 요청이 들어올 틈이 생긴다. 넣어 «보고» 거절당하는 쪽이 정본이다 — 판정을 응용 코드가
 * 아니라 index 가 한다(`acceptInvitation` 의 조건부 UPDATE 와 같은 방식).
 *
 * # 만료된 초대는 «회전»한다
 *
 * 만료돼도 행은 그대로 남고 `accepted_at` 은 여전히 `NULL` 이라 index 안에 있다. 그대로
 * 두면 7일 뒤 그 주소를 **영영 다시 초대할 수 없다.** 그래서 거절당했을 때 **만료된 행에만**
 * 새 Token·새 기한을 덮어쓴다 — 그 조건이 UPDATE 자체에 붙어 있어, 두 요청이 함께 회전을
 * 시도해도 **먼저 commit 한 쪽만** 행을 잡는다(진 쪽은 기한이 미래로 바뀐 행을 보고 0행을
 * 돌려받는다). 사용자에게 보이는 결과는 「새 링크를 받았다」로 이전과 같고, 만료된 옛 Token 은
 * 어차피 쓸 수 없던 것이라 잃는 것이 없다.
 *
 * 수락된 행과 **취소된 행**은 index 밖이므로 History 로 남고, 그 위에 새 초대가 따로 생긴다.
 *
 * 🔴 **취소된 초대는 회전하지 않는다.** 만료는 시간이 지나 저절로 된 것이라 같은 행을
 * 되살려도 사용자가 잃는 것이 없지만, 취소는 사람이 「이 링크를 죽여라」라고 말한 것이다 —
 * 그 행을 되살리면 취소가 없던 일이 되고, 무엇보다 **취소 기록이 지워진다.**
 * 취소된 뒤의 재초대는 위 INSERT 가 그대로 성공해 **새 행**으로 선다.
 *
 * @throws {AppError} 이미 그 Workspace 의 Member 인 이메일이면 `CONFLICT`.
 * @throws {AppError} 아직 살아 있는 초대가 그 주소로 이미 있으면 `CONFLICT`.
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
   * 🔴 **비교하기 전에 정규화한다.** Schema 가 이미 정규화하지만 그것은 **폼 경로 하나**의
   * 이야기다 — Application Service 는 Server Action 말고도 시험·다른 서버 경로에서 불린다.
   * 여기서 다시 맞추지 않으면 `Guest@Example.com` 이 그대로 내려와 아래 비교가 빗나가고,
   * **이미 멤버인 사람에게 초대가 다시 발행된다**(CLAUDE.md 11 「최종 판단은 서버가 한다」).
   *
   * 저장도 이 값으로 한다 — 저장한 형태와 비교하는 형태가 갈리면 같은 버그가 되돌아온다.
   */
  const email = normalizeEmail(input.email);

  /**
   * 이미 Member 인 사람을 초대하지 않는다(스펙 10).
   *
   * 소속 자체는 PK 가 막아 주므로 이것은 **안내를 위한 확인**이다 — 수락하고 나서야
   * 「이미 멤버」를 알게 되는 것보다 발행 시점에 말해 주는 쪽이 낫다.
   *
   * 🔴 **`lower(users.email)` 을 쓰지 않는다.** `users.email` 은 저장 시점에 이미 정규화된
   * 값이고(`lib/auth/github-profile.ts`), Column 에 함수를 씌우면 `users_email_unique`
   * 를 타지 못한다(CLAUDE.md 10).
   */
  const alreadyMember = await executor
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, input.workspaceId),
        eq(users.email, email),
      ),
    )
    .limit(1);

  if (alreadyMember.length > 0) {
    throw new AppError("WORKSPACE_MEMBER_ALREADY");
  }

  const { token, tokenHash } = generateInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  /**
   * 넣어 «본다». 🔴 이 자리에서 중복을 거절하는 것은 응용 코드가 아니라
   * `workspace_invitations_live_email_unique` 다.
   *
   * 🔴 **`on conflict do nothing` 에 대상을 «적지 않는다».** 적는 순간 PostgreSQL 이 중재할
   * index 를 계획 단계에서 찾아야 하고, 그 index 가 아직 없는 Database 에서는 문장 자체가
   * `42P10` 으로 터져 **초대 발행이 통째로 멈춘다** — Migration 보다 코드가 먼저 나가는
   * 순간이 실제로 있다. 대상을 적지 않으면 index 가 없는 동안은 이 변경 이전과 «똑같이»
   * 동작할 뿐이다(그동안은 중복이 막히지 않는다 — 보장은 Migration 이 적용돼야 선다).
   *
   * 🔴 **거절을 오류로 받지 않는다.** unique 위반을 예외로 받으면 Driver 오류 message(쿼리와
   * 값이 실려 있다)를 우리가 삼켜야 하고(CLAUDE.md 19), 그보다 나쁘게 — 열려 있는
   * Transaction 안에서 불렸을 때 그 Transaction 을 통째로 **abort 상태로 만든다.**
   * 행이 비어서 돌아오는 쪽이 다루기도 안전하기도 하다.
   */
  const inserted = await executor
    .insert(workspaceInvitations)
    .values({
      workspaceId: input.workspaceId,
      email,
      role: "MEMBER",
      tokenHash,
      expiresAt,
      invitedBy: input.invitedBy,
    })
    .onConflictDoNothing()
    .returning({ id: workspaceInvitations.id });

  if (inserted.length > 0) {
    return { token, email, expiresAt };
  }

  /**
   * 이미 소진되지 않은 초대가 그 주소로 있다. **만료된 것이면** 그 행을 회전시킨다.
   *
   * 🔴 **조건을 UPDATE 자체에 붙인다.** 「만료됐는지 조회해 보고 그 다음에 UPDATE」로 나누면
   * 두 요청이 함께 통과한다 — `acceptInvitation` 이 `accepted_at IS NULL` 을 UPDATE 에
   * 붙여 둔 것과 같은 이유다. 한 행도 잡지 못하면 **아직 살아 있는 초대**라는 뜻이다.
   */
  const rotated = await executor
    .update(workspaceInvitations)
    .set({
      role: "MEMBER",
      tokenHash,
      expiresAt,
      invitedBy: input.invitedBy,
      // 회전한 행은 «방금 발행된» 초대다. 목록의 정렬(`createdAt`)도 그것을 따른다.
      createdAt: new Date(),
    })
    .where(
      and(
        eq(workspaceInvitations.workspaceId, input.workspaceId),
        eq(workspaceInvitations.email, email),
        isNull(workspaceInvitations.acceptedAt),
        /**
         * 🔴 **취소된 행은 회전 대상이 아니다.** 취소된 행은 index 밖이라 여기까지 오지도
         * 않지만(위 INSERT 가 성공한다), 조건을 빼면 「만료 + 취소」인 행까지 함께 잡혀
         * **한 UPDATE 가 두 행에 같은 `token_hash` 를 쓴다** —
         * `workspace_invitations_token_hash_unique` 가 `23505` 로 터뜨린다.
         * 그보다 나쁘게, 사람이 죽인 초대가 새 기한을 얻어 되살아난다.
         */
        isNull(workspaceInvitations.revokedAt),
        lte(workspaceInvitations.expiresAt, sql`now()`),
      ),
    )
    .returning({ id: workspaceInvitations.id });

  if (rotated.length === 0) {
    throw new AppError("INVITATION_ALREADY_PENDING");
  }

  return { token, email, expiresAt };
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
      revokedAt: workspaceInvitations.revokedAt,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
    .where(eq(workspaceInvitations.tokenHash, hashInvitationToken(token)))
    .limit(1);

  const row = rows[0];
  /**
   * 🔴 취소된 초대는 **없는 초대와 구분되지 않는다.** 「취소됐습니다」라고 말해 주면 그것만으로
   * 「이 Token 은 실재했다」가 새어 나간다(CLAUDE.md 13 과 같은 판단).
   */
  if (row === undefined || row.acceptedAt !== null || row.revokedAt !== null) {
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
          /**
           * 🔴 **취소된 초대는 수락되지 않는다.** 이 조건이 없으면 취소가 목록에서 행을
           * 감추기만 할 뿐, 이미 새어 나간 Token 은 그대로 살아 있다 — 그러면 취소 기능이
           * 하는 일이 아무것도 없다.
           *
           * 🔴 조건을 UPDATE 자체에 붙이는 이유는 `accepted_at` 과 같다 — 「조회해서 확인하고
           * 그 다음에 UPDATE」로 나누면 **동시에 들어온 취소와 수락이 둘 다 통과한다.**
           * 붙여 두면 나중에 온 쪽은 잠금이 풀린 뒤 조건을 다시 보고 0행을 돌려받는다.
           */
          isNull(workspaceInvitations.revokedAt),
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
      // 없거나 이미 수락됐거나 취소됐다. 🔴 셋을 구분해 알려 주지 않는다.
      throw new AppError("INVITATION_UNUSABLE");
    }

    if (invitation.expiresAt.getTime() <= Date.now()) {
      // 만료된 초대를 방금 소진해 버렸으므로 Transaction 을 통째로 되돌린다.
      throw new AppError("INVITATION_UNUSABLE");
    }

    const workspace = await tx
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, invitation.workspaceId))
      .limit(1);

    const slug = workspace[0]?.slug;
    if (slug === undefined) {
      throw new AppError("INVITATION_UNUSABLE");
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

/**
 * Workspace 설정 화면의 「수락 대기」 목록. 🔴 Token Hash 는 내보내지 않는다.
 *
 * 🔴 **취소된 초대는 목록에 없다.** 행은 History 로 남지만 「기다리는 중」이 아니다 —
 * 여기 남겨 두면 취소한 사람이 취소되지 않았다고 읽는다.
 */
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
        isNull(workspaceInvitations.revokedAt),
      ),
    )
    .orderBy(workspaceInvitations.createdAt);
}

/**
 * 발급된 초대를 **명시적으로 무효화한다.**
 *
 * 새어 나간 링크를 죽이는 유일한 길이 「만료를 기다린다」였다 — 기본 유효 기간이 7일이라
 * 그동안 그 Token 을 주운 누구나 Workspace 에 들어올 수 있었다.
 *
 * ```
 * 취소 전   Token 유효 · 목록에 보임 · index 안(재초대 막힘)
 * 취소 후   Token 무효 · 목록에서 사라짐 · index 밖(재초대 가능) · 행은 남는다
 * ```
 *
 * 🔴 **행을 지우지 않는다**(`revokeApiKey` 와 같은 판단 — CLAUDE.md 12). 지우면 누구를
 * 초대했다가 거둬들였는지가 함께 사라지고, `accepted_by`·`invited_by` 도 함께 날아간다.
 *
 * 🔴 **Tenant 조건이 `id` 와 «겹쳐서» 걸린다**(CLAUDE.md 10). `id` 만으로 UPDATE 하면
 * 다른 Workspace 의 OWNER 가 uuid 하나로 남의 초대를 죽인다.
 *
 * 🔴 **못 찾은 이유를 구분해 알려 주지 않는다.** 없는 id · 남의 초대 · 이미 수락됨 ·
 * 이미 취소됨이 전부 `NOT_FOUND` 다 — `FORBIDDEN` 으로 답하면 그것만으로 「그 id 는
 * 실재한다」가 새어 나간다(CLAUDE.md 13).
 *
 * 🔴 **판정을 조회와 UPDATE 로 나누지 않는다.** 조건이 UPDATE 자체에 붙어 있어,
 * 취소와 수락이 동시에 들어와도 **행을 돌려받은 쪽 하나만** 성공한다.
 *
 * @throws {AppError} 그 Workspace 의 «살아 있는» 초대가 아니면 `NOT_FOUND`.
 */
export async function revokeInvitation(
  input: { workspaceId: string; invitationId: string },
  executor: DbExecutor = db(),
): Promise<void> {
  const revoked = await executor
    .update(workspaceInvitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(workspaceInvitations.id, input.invitationId),
        eq(workspaceInvitations.workspaceId, input.workspaceId),
        // 이미 수락된 초대는 취소 대상이 아니다 — 소속은 이미 생겼고, 그것을 되돌리는
        // 일은 「초대 취소」가 아니라 「멤버 내보내기」다.
        isNull(workspaceInvitations.acceptedAt),
        isNull(workspaceInvitations.revokedAt),
      ),
    )
    .returning({ id: workspaceInvitations.id });

  if (revoked.length === 0) {
    throw new AppError("INVITATION_NOT_CANCELABLE");
  }
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
