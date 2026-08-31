import {
 index,
 integer,
 pgTable,
 primaryKey,
 text,
 timestamp,
 uuid,
} from "drizzle-orm/pg-core";

import { users } from "@/db/schema/workspace";

/**
 * Auth.js(Drizzle Adapter)가 요구하는 표.
 *
 * 계정 자체는 `users` 다(`src/db/schema/workspace.ts`). 여기에는 **인증 수단과 세션**만 둔다.
 *
 * 🔴 **세션은 서버에 있다.** 브라우저에는 `sessions.session_token` 을 담은 HttpOnly 쿠키
 * 하나만 가고, 사용자 프로필·Provider Token 은 전부 이 표에 남는다.
 *
 * 🔴 **Column 이름은 snake_case 로 우리가 정한다.** Adapter 는 TypeScript 속성 이름
 * (`providerAccountId` 등)만 보므로 Database 쪽 이름은 이 저장소의 규칙을 따른다.
 *
 * WebAuthn(`authenticators`)은 만들지 않는다 — 로그인 방식은 GitHub OAuth 하나뿐이고,
 * 그 표는 `@simplewebauthn/*` 를 추가로 깔아야 쓸 수 있다.
 */

/**
 * 외부 Provider 계정 ↔ `users` 연결.
 *
 * 🔴 `access_token`·`refresh_token`·`id_token` 은 **Server-only** 다. 세션에 담지 않는다
 * — 세션 조회로 브라우저에 새어 나간다.
 */
export const accounts = pgTable(
 "accounts",
 {
 userId: uuid("user_id")
.notNull()
.references(() => users.id, { onDelete: "cascade" }),
 type: text("type").notNull(),
 provider: text("provider").notNull(),
 // GitHub 의 숫자 user id. 사용자가 login(아이디)을 바꿔도 이 값은 그대로다.
 providerAccountId: text("provider_account_id").notNull(),
 refresh_token: text("refresh_token"),
 access_token: text("access_token"),
 expires_at: integer("expires_at"),
 token_type: text("token_type"),
 scope: text("scope"),
 id_token: text("id_token"),
 session_state: text("session_state"),
 },
 (table) => [
 // 로그인마다 (provider, providerAccountId) 로 사용자를 찾는다. 조회 경로이자 중복 방지다.
 primaryKey({ columns: [table.provider, table.providerAccountId] }),
 index("accounts_user_idx").on(table.userId),
 ],
);

/**
 * 서버 측 세션.
 *
 * JWT 세션을 쓰지 않는 이유는 하나다 — **끊을 수 있어야** 하기 때문이다.
 * 행을 지우면 그 순간 세션이 죽는다. JWT 는 만료 전까지 살아남는다.
 */
export const sessions = pgTable(
 "sessions",
 {
 sessionToken: text("session_token").primaryKey(),
 userId: uuid("user_id")
.notNull()
.references(() => users.id, { onDelete: "cascade" }),
 expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
 },
 // 「이 사용자의 세션 전부」를 끊을 때 쓴다.
 (table) => [index("sessions_user_idx").on(table.userId)],
);

/**
 * Adapter 계약에 있는 표.
 *
 * 지금 쓰는 Provider 는 GitHub OAuth 하나뿐이라 **아무도 이 표를 채우지 않는다.**
 * 그래도 두는 이유는 Adapter 가 이 표를 전제로 만들어져 있어, 없는 채로 두면
 * 나중에 Email/Magic Link 를 붙이는 순간 「표만 없는」 실패를 만나기 때문이다.
 */
export const verificationTokens = pgTable(
 "verification_tokens",
 {
 identifier: text("identifier").notNull(),
 token: text("token").notNull(),
 expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
 },
 (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);
