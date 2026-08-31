import "server-only";

import { and, eq, isNull, lte, sql, type SQL } from "drizzle-orm";

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
 * 발행 OWNER -> Token 생성 -> Hash 저장 -> 링크 1회 표시
 * 수락 링크 -> (로그인) -> Token 검증 -> WorkspaceMember 추가 -> 초대 소진
 * ```
 *
 * 🔴 **초대는 이미 회원인 사람에게도, 아직 아닌 사람에게도 같은 흐름이다**(스펙 8·9).
 * 회원이면 로그인 즉시 수락되고, 아니면 GitHub 로그인 → Personal Workspace 생성 →
 * 그 다음에 이 초대가 소진된다. **어느 쪽이든 User 를 새로 만들거나 기존 소속을 건드리지 않는다.**
 */

/** 기본 유효 기간. 링크가 영원히 사는 것을 막는다. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 「이 주소는 아직 이 Workspace 의 멤버가 아니다」 — **쓰는 문장에 그대로 붙이는 조건.**
 *
 * 🔴 **따로 조회해서 확인하면 막지 못한다.** PostgreSQL 의 기본 격리 수준(READ COMMITTED)
 * 에서 SELECT 는 **그 문장이 시작한 시점의 스냅샷**을 본다 — 조회와 INSERT 사이에 다른
 * Transaction 이 소속을 만들고 commit 하면 이쪽 조회는 그것을 보지 못한다.
 * Transaction 으로 감싸도 같다.
 *
 * 그 틈으로 들어오는 것이 단순한 중복 초대가 아니라는 것이 요점이다 — 초대는 **이메일을
 * 대조하지 않는 bearer credential** 이다(`acceptInvitation` 은 Token Hash 와 상태만 본다).
 * 새로 발행된 Token 을 쥔 **다른 계정**이 그 Workspace 에 들어온다.
 *
 * 🔴 그래서 판정을 **쓰는 문장 자체**에 싣는다. UPDATE 와 INSERT 는 스냅샷이 아니라 «지금»
 * 의 행을 보고, 충돌하면 상대가 commit 할 때까지 기다렸다가 조건을 **다시** 본다 —
 * `revokeInvitation`·`acceptInvitation` 이 조건을 UPDATE 에 붙여 둔 것과 같은 방식이다.
 */
function notAlreadyMember(workspaceId: string, email: string): SQL {
 return sql`not exists (
 select 1
 from ${workspaceMembers}
 join ${users} on ${users.id} = ${workspaceMembers.userId}
 where ${workspaceMembers.workspaceId} = ${workspaceId}::uuid
 and ${users.email} = ${email}
)`;
}

/**
 * Workspace 행을 잠근다 — **이 파일의 두 쓰기 경로가 가장 먼저 잡는 잠금이다.**
 *
 * 🔴 순서는 `@/db` 에 적힌 전역 규칙(`workspaces -> users -> 나머지`)을 따른다.
 * 계정 삭제도 같은 순서로 잡으므로 세 경로가 **같은 Workspace 행 하나**를 두고 줄을 선다.
 *
 * @returns 잠근 Workspace 의 slug. 없으면 `null`.
 */
async function lockWorkspaceRow(
 workspaceId: string,
 executor: DbExecutor,
): Promise<string | null> {
 const rows = await executor
.select({ slug: workspaces.slug })
.from(workspaces)
.where(eq(workspaces.id, workspaceId))
.for("update");

 return rows[0]?.slug ?? null;
}

/**
 * 계정 행을 잠근다 — **Workspace 다음, 초대 행을 건드리기 전이다.**
 *
 * 🔴 **이 문장이 없어도 잠금은 걸린다 — 그것이 문제였다.**
 * `workspace_invitations.accepted_by = $user` 를 쓰면 FK 검사가 `users` 행에
 * `FOR KEY SHARE` 를 건다. 즉 순서가 `초대 행 -> users` 가 되는데, 계정 삭제는
 * `users` 를 쥔 채 그 사람의 이메일이 적힌 초대 행을 지우려 한다 — 고리가 닫힌다.
 *
 * 그래서 **초대 행보다 먼저** `users` 를 명시적으로 잠가 순서를 눈에 보이게 만든다.
 * `FOR KEY SHARE` 는 FK 가 요구하는 것과 같은 세기라 수락끼리는 서로를 막지 않고,
 * 계정 삭제의 `FOR UPDATE` 하고만 부딪힌다.
 */
async function lockAccountRow(
 userId: string,
 executor: DbExecutor,
): Promise<boolean> {
 const rows = await executor
.select({ id: users.id })
.from(users)
.where(eq(users.id, userId))
.for("key share");

 return rows.length > 0;
}

export interface CreatedInvitation {
 /**
 * 발행된 초대 행의 id.
 *
 * 🔴 **Token 이 아니다.** 화면이 「방금 낸 그 초대가 «아직 살아 있는가»」를 묻는 데만
 * 쓴다 — 취소된 초대의 링크를 계속 그리지 않으려면 그 판정이 필요한데, 그것을 Token
 * 으로 하면 죽은 Token 이 화면 상태에 한 벌 더 남는다.
 */
 id: string;
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
 * ├─ 조회 단계는 «둘 다» 통과할 수 있다
 * 요청 B ─┘
 * ↓ workspace_invitations_live_email_unique
 * 한 쪽만 행을 얻는다
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
 * # 🔴 `not exists` 만으로는 수락과의 경쟁을 막지 못한다
 *
 * `INSERT... SELECT... WHERE NOT EXISTS` 도 READ COMMITTED 의 **statement snapshot** 을
 * 쓴다. 발행이 먼저 snapshot 을 잡고 부분 unique 충돌로 «기다리는» 사이에 수락이 commit 하면,
 * 옛 초대 행이 index 밖으로 빠져 INSERT 가 성공한다 — `not exists` 는 이미 옛 snapshot 으로
 * 평가된 뒤다. 실제 PostgreSQL 로 재현했다(`inserted=1, members=1, live_invitations=1`).
 * 🔴 초대는 이메일을 대조하지 않는 bearer credential 이라, 그 새 Token 을 쥔 **다른 계정**이
 * 이미 멤버가 된 사람의 자리로 들어온다.
 *
 * 🔴 **그래서 Workspace 행을 먼저 잠가 수락과 «줄을 세운다».** 수락도 같은 행을 잠그므로
 * (`acceptInvitation`) 두 Transaction 이 겹치지 않고, 뒤에 온 쪽은 잠금이 풀린 뒤 **새
 * snapshot** 으로 판정한다 — 수락이 먼저였다면 `not exists` 가 그때 소속을 보고 거절한다.
 * 잠금 순서는 `@/db` 의 전역 규칙(`workspaces -> users -> 나머지`)과 같다.
 *
 * @throws {AppError} Workspace 가 없으면 `NOT_FOUND`.
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
 * 🔴 **Transaction 이 필요하다.** 잠금은 Transaction 이 끝나면 풀린다 — 감싸지 않으면
 * 문장 하나마다 Transaction 이 열리고 닫혀, 잠금을 잡자마자 놓아 준다.
 */
 return executor.transaction((tx) => createInvitationLocked(input, tx));
}

async function createInvitationLocked(
 input: {
 workspaceId: string;
 email: string;
 invitedBy: string;
 },
 executor: DbExecutor,
): Promise<CreatedInvitation> {
 // 1. workspaces — 수락과 삭제가 잡는 것과 같은 행이다.
 if ((await lockWorkspaceRow(input.workspaceId, executor)) === null) {
 throw new AppError("RESOURCE_NOT_FOUND");
 }

 /**
 * 🔴 **비교하기 전에 정규화한다.** Schema 가 이미 정규화하지만 그것은 **폼 경로 하나**의
 * 이야기다 — Application Service 는 Server Action 말고도 시험·다른 서버 경로에서 불린다.
 * 여기서 다시 맞추지 않으면 `Guest@Example.com` 이 그대로 내려와 아래 비교가 빗나가고,
 * **이미 멤버인 사람에게 초대가 다시 발행된다.** 최종 판단은 서버가 한다.
 *
 * 저장도 이 값으로 한다 — 저장한 형태와 비교하는 형태가 갈리면 같은 버그가 되돌아온다.
 */
 const email = normalizeEmail(input.email);

 const { token, tokenHash } = generateInvitationToken();
 const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
 const notMember = notAlreadyMember(input.workspaceId, email);

 /**
 * 넣어 «본다». 🔴 이 자리에서 거절하는 것은 응용 코드가 아니라 두 가지다 —
 * 중복 초대는 `workspace_invitations_live_email_unique`, **이미 멤버인 사람**은
 * 이 문장 안의 `not exists` 다(`notAlreadyMember`).
 *
 * 🔴 **「조회해 보고 없으면 INSERT」로 나누지 않는다.** 나누는 순간 두 문장 사이가
 * 열리고, 그 사이에 기존 초대가 수락되면 옛 행이 부분 index 밖으로 빠져 **새 Token 이
 * 발행된다** — 이미 멤버가 된 사람 앞으로 살아 있는 링크가 하나 더 생긴다.
 * 판정을 문장 안에 실으면 그 틈 자체가 없다.
 *
 * 🔴 **`values(...)` 대신 `select... where` 를 쓴다.** Drizzle 의 `values` 는
 * 조건을 붙일 자리가 없고, `insert... select` 는 Column 을 **전부** 나열하게 만들어
 * 기본값(`id`·`created_at`)까지 손으로 만들어야 한다 — 그래서 이 문장만 SQL 을 직접 적는다.
 * Column 목록을 적어 두었으므로 표에 Column 이 늘어도 이 문장은 그대로 선다.
 *
 * 🔴 **`on conflict do nothing` 에 대상을 «적지 않는다».** 적는 순간 PostgreSQL 이 중재할
 * index 를 계획 단계에서 찾아야 하고, 그 index 가 아직 없는 Database 에서는 문장 자체가
 * `42P10` 으로 터져 **초대 발행이 통째로 멈춘다** — Migration 보다 코드가 먼저 나가는
 * 순간이 실제로 있다. 대상을 적지 않으면 index 가 없는 동안은 이 변경 이전과 «똑같이»
 * 동작할 뿐이다(그동안은 중복이 막히지 않는다 — 보장은 Migration 이 적용돼야 선다).
 *
 * 🔴 **거절을 오류로 받지 않는다.** unique 위반을 예외로 받으면 Driver 오류 message(쿼리와
 * 값이 실려 있다)를 우리가 삼켜야 하고, 그보다 나쁘게 — 열려 있는
 * Transaction 안에서 불렸을 때 그 Transaction 을 통째로 **abort 상태로 만든다.**
 * 행이 비어서 돌아오는 쪽이 다루기도 안전하기도 하다.
 */
 const inserted = await executor.execute<{ id: string }>(sql`
 insert into ${workspaceInvitations}
 ("workspace_id", "email", "role", "token_hash", "expires_at", "invited_by")
 select ${input.workspaceId}::uuid,
 ${email}::text,
 'MEMBER'::workspace_role,
 ${tokenHash}::text,
 ${expiresAt}::timestamptz,
 ${input.invitedBy}::uuid
 where ${notMember}
 on conflict do nothing
 returning "id"
 `);

 const insertedId = inserted.rows[0]?.id;
 if (typeof insertedId === "string") {
 return { id: insertedId, token, email, expiresAt };
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
 /**
 * 🔴 **여기에도 같은 조건이 붙는다.** 만료된 초대가 남아 있는 사이에 그 사람이
 * 다른 초대로 멤버가 됐다면, 이 회전은 **이미 멤버인 사람에게 새 Token 을
 * 발행하는 것**이 된다 — 위 INSERT 만 막아 두면 그 뒷문이 열려 있다.
 */
 notMember,
),
)
.returning({ id: workspaceInvitations.id });

 const rotatedId = rotated[0]?.id;
 if (rotatedId !== undefined) {
 return { id: rotatedId, token, email, expiresAt };
 }

 /**
 * 두 문장이 **둘 다** 행을 잡지 못했다. 막힌 이유가 「이미 멤버」인지 「살아 있는 초대」인지
 * 는 **화면에 보여 줄 말을 고르기 위해서만** 본다 — 🔴 판정은 이미 위 두 문장이 끝냈다.
 * 이 조회가 낡은 값을 보더라도 초대가 새로 발행되는 일은 없다.
 *
 * 🔴 **`lower(users.email)` 을 쓰지 않는다.** `users.email` 은 저장 시점에 이미 정규화된
 * 값이고(`lib/auth/github-profile.ts`), Column 에 함수를 씌우면 `users_email_unique`
 * 를 타지 못한다.
 */
 const member = await executor
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

 throw new AppError(
 member.length > 0 ? "WORKSPACE_MEMBER_ALREADY" : "INVITATION_ALREADY_PENDING",
);
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
 * 「이 Token 은 실재했다」가 새어 나간다. Agent API 가 남의 Workspace 것을 `FORBIDDEN` 이
 * 아니라 `NOT_FOUND` 로 답하는 것과 같은 판단이다.
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
 * 어느 Workspace 로의 초대인지 **먼저** 알아낸다. 잠글 대상을 알기 위한 조회일 뿐
 * **자격 판정이 아니다** — 만료·수락·취소 판정은 아래 조건부 UPDATE 가 한다.
 * 초대가 Workspace 를 옮겨 다니는 경로는 없으므로 이 값은 잠근 뒤에도 그대로다.
 */
 const target = await tx
.select({ workspaceId: workspaceInvitations.workspaceId })
.from(workspaceInvitations)
.where(eq(workspaceInvitations.tokenHash, tokenHash))
.limit(1);

 const targetWorkspaceId = target[0]?.workspaceId;
 if (targetWorkspaceId === undefined) {
 throw new AppError("INVITATION_UNUSABLE");
 }

 /**
 * 🔴 **Workspace 행을 잠근다 — 소속을 만들기 «전»에.**
 *
 * 계정 삭제는 「이 Workspace 에 나 말고 아무도 없다」를 확인한 뒤 Workspace 를 통째로
 * 지운다(`account-deletion-service.ts`). 그 확인은 소속 행을 `FOR UPDATE` 로 잠그지만,
 * **그 뒤에 INSERT 되는 소속은 어떤 잠금에도 걸리지 않는다** — 여기서 아무것도 잠그지
 * 않으면 방금 들어온 멤버가 Workspace 와 함께 CASCADE 로 지워진다.
 *
 * 두 경로가 **같은 Workspace 행**을 잠그므로 줄이 선다. 삭제가 먼저 끝났다면 이 조회는
 * **0행**이고, 그 초대는 더 이상 갈 곳이 없다.
 *
 * 🔴 **잠금은 초대 행보다 «먼저» 잡는다.** 순서를 뒤집으면 — 이쪽이 초대 행을 쥔 채
 * Workspace 를 기다리고, 삭제 쪽은 Workspace 를 쥔 채 CASCADE 로 그 초대 행을 기다려
 * **deadlock** 이 된다. 두 경로가 Workspace 를 먼저 잡는 한 그 고리가 생기지 않는다.
 */
 const slug = await lockWorkspaceRow(targetWorkspaceId, tx);
 if (slug === null) {
 throw new AppError("INVITATION_UNUSABLE");
 }

 /**
 * 🔴 **그 다음이 `users` 다 — 초대 행을 건드리기 «전»에.**
 *
 * 아래 UPDATE 의 `accepted_by` 가 FK 검사로 이 행에 어차피 잠금을 건다. 여기서 미리
 * 잡지 않으면 순서가 `초대 행 -> users` 가 되어, `users` 를 쥔 채 그 사람의 초대 행을
 * 지우는 계정 삭제와 고리를 만든다(`@/db` 의 전역 잠금 순서).
 */
 if (!(await lockAccountRow(input.userId, tx))) {
 // 세션은 있는데 계정이 사라졌다 — 초대의 문제가 아니다.
 throw new AppError("ACCOUNT_NOT_FOUND");
 }

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
 * 취소 전 Token 유효 · 목록에 보임 · index 안(재초대 막힘)
 * 취소 후 Token 무효 · 목록에서 사라짐 · index 밖(재초대 가능) · 행은 남는다
 * ```
 *
 * 🔴 **행을 지우지 않는다** — `revokeApiKey` 와 같은 판단이다. 지우면 누구를
 * 초대했다가 거둬들였는지가 함께 사라지고, `accepted_by`·`invited_by` 도 함께 날아간다.
 *
 * 🔴 **Tenant 조건이 `id` 와 «겹쳐서» 걸린다**. `id` 만으로 UPDATE 하면
 * 다른 Workspace 의 OWNER 가 uuid 하나로 남의 초대를 죽인다.
 *
 * 🔴 **못 찾은 이유를 구분해 알려 주지 않는다.** 없는 id · 남의 초대 · 이미 수락됨 ·
 * 이미 취소됨이 전부 `NOT_FOUND` 다 — `FORBIDDEN` 으로 답하면 그것만으로 「그 id 는
 * 실재한다」가 새어 나간다.
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
