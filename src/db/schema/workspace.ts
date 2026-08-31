import { sql } from "drizzle-orm";
import {
 index,
 pgTable,
 primaryKey,
 text,
 timestamp,
 uniqueIndex,
 uuid,
} from "drizzle-orm/pg-core";

import { workspaceRoleEnum } from "@/db/schema/enums";

/**
 * Identity 와 Tenant.
 *
 * ```
 * User ── WorkspaceMember ── Workspace
 * (N) (M)
 * ```
 *
 * 🔴 **User : Workspace 는 1:1 이 아니다.** 한 사람이 자기 Personal Workspace 의 OWNER 이면서
 * 동시에 회사 Workspace 의 MEMBER 일 수 있다. 소속의 정본은 `workspace_members` 하나뿐이다.
 *
 * ## Cascade 방침
 *
 * - **Workspace 아래로는 Cascade** — Tenant 를 지우면 그 안의 것이 남을 이유가 없다
 * - **User 로는 Cascade 하지 않는다** — 사람이 지워졌다고 그가 만든 Workspace 와 Review
 * Knowledge 가 날아가면 안 된다(`created_by`·`invited_by` 는 `SET NULL`)
 * - 예외는 `workspace_members` 다. 사람이 없어진 소속 행은 뜻이 없다
 */

/**
 * 계정.
 *
 * Auth.js Drizzle Adapter 가 이 표를 그대로 쓴다(`src/db/schema/auth.ts` 참고).
 * Adapter 는 `id` `name` `email` `emailVerified` `image` 다섯 Column 을 요구하므로
 * 뒤의 둘을 여기에 둔다 — 별도의 「인증용 users」를 따로 만들면 같은 사람이 두 표에 생긴다.
 *
 * `createdAt`/`updatedAt` 는 우리 것이다. Adapter 는 이 둘을 모르고, 기본값이 채운다.
 */
export const users = pgTable(
 "users",
 {
 id: uuid("id").primaryKey().defaultRandom(),
 // 로그인 식별자. 정규화(공백 제거·소문자화)는 저장 전에 끝난 값이 들어온다는 전제다.
 email: text("email").notNull(),
 name: text("name"),
 /**
 * Adapter 계약상 필요한 Column.
 *
 * GitHub OAuth 만 쓰는 지금은 아무도 채우지 않는다 — 이메일 소유 확인은 GitHub 이 이미 했다.
 * 값이 없다고 로그인이 막히지 않는다.
 */
 emailVerified: timestamp("email_verified", {
 withTimezone: true,
 mode: "date",
 }),
 /** 프로필 이미지 URL. 상단 바·Switcher 에 그리는 용도다. */
 image: text("image"),
 createdAt: timestamp("created_at", { withTimezone: true })
.notNull()
.defaultNow(),
 updatedAt: timestamp("updated_at", { withTimezone: true })
.notNull()
.defaultNow(),
 },
 (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

/**
 * Tenant Boundary.
 *
 * Personal Workspace 도 **같은 표**를 쓴다. 개인용을 위한 별도 시스템을 만들지 않는다.
 */
export const workspaces = pgTable(
 "workspaces",
 {
 id: uuid("id").primaryKey().defaultRandom(),
 /**
 * URL 에 그대로 나가는 식별자(`/w/{slug}/issues`).
 *
 * 🔴 slug 는 **Context 표시일 뿐 권한 증명이 아니다**. 주소를 바꿔 다른 Workspace 를 적어도
 * 서버가 소속을 다시 확인한다.
 */
 slug: text("slug").notNull(),
 name: text("name").notNull(),

 /**
 * 이 Workspace 가 **누구의 Personal Workspace 인가**. 일반 Workspace 는 `NULL` 이다.
 *
 * 🔴 **이 Column 의 unique 가 「가입할 때마다 Personal Workspace 가 하나만 생긴다」를
 * Database 수준에서 보장한다.** 같은 사람이 두 창에서 동시에 로그인해도 두 번째 INSERT 는
 * 통과하지 못한다 — 응용 코드의 「있는지 보고 없으면 만든다」만으로는 그 틈이 막히지 않는다.
 * PostgreSQL 은 NULL 을 서로 다른 값으로 보므로 일반 Workspace 는 몇 개든 만들 수 있다.
 */
 personalOwnerId: uuid("personal_owner_id").references(() => users.id, {
 onDelete: "set null",
 }),

 /** 만든 사람. 사람이 지워져도 Workspace 는 남는다. */
 createdBy: uuid("created_by").references(() => users.id, {
 onDelete: "set null",
 }),

 createdAt: timestamp("created_at", { withTimezone: true })
.notNull()
.defaultNow(),
 updatedAt: timestamp("updated_at", { withTimezone: true })
.notNull()
.defaultNow(),
 },
 (table) => [
 // 주소로 Workspace 를 찾는 경로이자 중복 방지다.
 uniqueIndex("workspaces_slug_unique").on(table.slug),
 uniqueIndex("workspaces_personal_owner_unique").on(table.personalOwnerId),
 ],
);

/**
 * 소속. **접근 권한의 정본이다.**
 *
 * 🔴 Client 가 보낸 `workspaceId`·URL 의 `workspaceSlug` 를 믿지 않는다. 이 표를 거쳐
 * 실제 소속을 확인한 것만 권한 있는 Workspace 다.
 */
export const workspaceMembers = pgTable(
 "workspace_members",
 {
 workspaceId: uuid("workspace_id")
.notNull()
.references(() => workspaces.id, { onDelete: "cascade" }),
 userId: uuid("user_id")
.notNull()
.references(() => users.id, { onDelete: "cascade" }),
 role: workspaceRoleEnum("role").notNull().default("MEMBER"),
 createdAt: timestamp("created_at", { withTimezone: true })
.notNull()
.defaultNow(),
 },
 (table) => [
 /**
 * UNIQUE(workspaceId, userId).
 *
 * 🔴 초대를 두 번 수락해도 소속이 둘로 늘지 않는 것은 이 제약 덕분이다.
 * 응용 코드의 「이미 멤버인지 확인」은 그 앞의 편의일 뿐이다.
 */
 primaryKey({ columns: [table.workspaceId, table.userId] }),
 // Workspace Switcher: 「내가 속한 Workspace 목록」. 위 PK 는 앞 Column 이 달라 쓰이지 않는다.
 index("workspace_members_user_workspace_idx").on(
 table.userId,
 table.workspaceId,
),
 ],
);

/**
 * Workspace 초대.
 *
 * 🔴 **Token 원문을 저장하지 않는다.** 발급할 때 한 번 보여 주고 Hash 만 남긴다 —
 * Database 가 유출돼도 그것으로 초대를 수락할 수 없다. API Key 를 Hash 로만 두는 것과
 * 같은 원칙이다.
 *
 * 아직 회원이 아닌 사람도 초대할 수 있어야 하므로 대상은 `userId` 가 아니라 **이메일**이다.
 */
export const workspaceInvitations = pgTable(
 "workspace_invitations",
 {
 id: uuid("id").primaryKey().defaultRandom(),
 workspaceId: uuid("workspace_id")
.notNull()
.references(() => workspaces.id, { onDelete: "cascade" }),

 /** 소문자·공백 제거로 정규화한 값이 들어온다. 비교가 한쪽만 정규화되면 갈린다. */
 email: text("email").notNull(),
 role: workspaceRoleEnum("role").notNull().default("MEMBER"),

 tokenHash: text("token_hash").notNull(),

 expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
 /** 수락된 시각. `NULL` 이면 아직 소진되지 않은 초대다. */
 acceptedAt: timestamp("accepted_at", { withTimezone: true }),
 /** 실제로 소속이 생긴 사용자. 누가 수락했는지 남긴다. */
 acceptedBy: uuid("accepted_by").references(() => users.id, {
 onDelete: "set null",
 }),

 /**
 * 사람이 **명시적으로 무효화한** 시각. `NULL` 이면 취소되지 않은 초대다.
 *
 * 🔴 **행을 지우지 않는다** — `api_keys.revoked_at` 과 같은 판단이다.
 * 지우면 「누구를 초대했다가 거둬들였는가」가 함께 사라지고, 같은 주소로 다시 초대할 때
 * 그 이력이 있었다는 사실조차 남지 않는다. 사라지는 것은 **그 Token 의 자격**뿐이다.
 *
 * 🔴 **만료와 취소는 다른 상태다.** 만료는 시간이 지나 저절로 된 것이라 재초대가 그 행을
 * **회전**시켜 되살리지만(아래 index 설명), 취소는 사람이 「이 링크를 죽여라」라고 말한
 * 것이라 **되살아나지 않는다.** 재초대는 그 옆에 새 행으로 선다.
 */
 revokedAt: timestamp("revoked_at", { withTimezone: true }),

 invitedBy: uuid("invited_by").references(() => users.id, {
 onDelete: "set null",
 }),

 createdAt: timestamp("created_at", { withTimezone: true })
.notNull()
.defaultNow(),
 },
 (table) => [
 // 수락 경로는 Token Hash 하나로 초대를 찾는다. 조회 경로이자 중복 방지다.
 uniqueIndex("workspace_invitations_token_hash_unique").on(table.tokenHash),
 // Workspace 설정 화면의 초대 목록.
 index("workspace_invitations_workspace_idx").on(table.workspaceId),
 // 로그인한 사람에게 「나를 기다리는 초대」를 보여 주는 경로.
 index("workspace_invitations_email_idx").on(table.email),

 /**
 * 🔴 **살아 있는 초대는 (Workspace, Email) 당 하나뿐이다.**
 *
 * 이것이 없으면 「초대 전에 한 번 조회해 본다」로는 **동시 요청 둘이 그대로 뚫는다** —
 * 같은 사람에게 살아 있는 링크가 여러 개 생기고, 그중 하나를 취소해도 나머지가 남는다.
 * 중복을 막는 주체는 응용 코드가 아니라 **이 index** 다
 * (`workspaces_personal_owner_unique` · `workspace_members` PK 와 같은 판단).
 *
 * ## predicate 의 뜻 — 「살아 있다」가 무엇인가
 *
 * ```
 * accepted_at IS NULL AND revoked_at IS NULL <- 살아 있다 (index 안)
 * accepted_at 있음 <- 소진됐다 (History)
 * revoked_at 있음 <- 사람이 죽였다 (History)
 * ```
 *
 * 🔴 **수락된 행을 막으면 나갔던 사람을 다시 초대할 수 없다.** 그래서 index 밖이다.
 * 🔴 **취소된 행도 마찬가지다.** 새어 나간 링크를 죽이는 것이 그 주소를 영영 초대하지
 * 못하게 만드는 일이 되어서는 안 된다 — 취소는 「이 Token 을 무효로」이지
 * 「이 사람을 차단」이 아니다. `revoked_at` 을 predicate 에 넣지 않으면 그 행이
 * index 안에 남아 **재초대를 자기가 막아 버린다.**
 *
 * 🔴 **`expires_at > now()` 를 predicate 에 넣지 않는다.** partial index 의 predicate 는
 * IMMUTABLE 이어야 해 `now()` 는 애초에 받아들여지지 않고, 받아들여진들 **시간이 흐르면
 * 저절로 뜻이 바뀌는 제약**은 제약이 아니다. 만료된 초대는 index 안에 그대로 남고,
 * 재초대는 그 행을 **회전**시킨다(`invitation-service.ts` 의 upsert).
 * **취소와 만료가 갈리는 자리가 여기다** — 만료는 회전으로 되살아나고, 취소는 index
 * 밖으로 나가 그 옆에 새 행이 선다.
 */
 uniqueIndex("workspace_invitations_live_email_unique")
.on(table.workspaceId, table.email)
.where(sql`${table.acceptedAt} is null and ${table.revokedAt} is null`),
 ],
);

/**
 * Agent 가 쓰는 자격 증명.
 *
 * 🔴 원문을 저장하지 않는다. 발급 시 1회만 보여 주고 Hash 만 남긴다.
 * `keyPrefix` 는 사용자가 목록에서 어느 키인지 알아보기 위한 표시용이다.
 *
 * 🔴 **API Key 가 Workspace 를 결정한다.** Agent 요청에는 `workspaceSlug` 를 쓰지 않는다.
 */
export const apiKeys = pgTable(
 "api_keys",
 {
 id: uuid("id").primaryKey().defaultRandom(),
 workspaceId: uuid("workspace_id")
.notNull()
.references(() => workspaces.id, { onDelete: "cascade" }),
 name: text("name").notNull(),
 keyPrefix: text("key_prefix").notNull(),
 keyHash: text("key_hash").notNull(),
 lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
 expiresAt: timestamp("expires_at", { withTimezone: true }),
 revokedAt: timestamp("revoked_at", { withTimezone: true }),
 createdAt: timestamp("created_at", { withTimezone: true })
.notNull()
.defaultNow(),
 },
 (table) => [
 // 요청마다 Hash 로 Workspace 를 찾는다 — 조회 경로이자 중복 방지다.
 uniqueIndex("api_keys_key_hash_unique").on(table.keyHash),
 // Workspace 설정 화면의 키 목록.
 index("api_keys_workspace_idx").on(table.workspaceId),
 ],
);
