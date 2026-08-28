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
 * Tenant Boundary 는 Workspace 다(CLAUDE.md 11).
 * 개인용으로 시작하더라도 모든 업무 데이터가 Workspace 아래에 매달린다.
 */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 로그인 식별자. 정규화(공백 제거·소문자화)는 저장 전에 끝난 값이 들어온다는 전제다.
    email: text("email").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // URL 에 노출되는 식별자. 내부 UUID 를 주소창에 그대로 쓰지 않기 위한 것이다.
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("workspaces_slug_unique").on(table.slug)],
);

/**
 * 접근 권한의 정본.
 *
 * 🔴 Client 가 보낸 `workspaceId` 를 믿지 않는다. 이 표를 거쳐 실제 소속을 확인한 것만
 * 권한 있는 Workspace 다(CLAUDE.md 11).
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
    // 한 사용자가 같은 Workspace 에 두 번 속할 수 없다.
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    // 「내가 속한 Workspace 목록」 조회.
    index("workspace_members_user_idx").on(table.userId),
  ],
);

/**
 * Agent 가 쓰는 자격 증명.
 *
 * 🔴 원문을 저장하지 않는다. 발급 시 1회만 보여 주고 Hash 만 남긴다(CLAUDE.md 12).
 * `keyPrefix` 는 사용자가 목록에서 어느 키인지 알아보기 위한 표시용이다.
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
