import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users, workspaces } from "@/db/schema/workspace";
import {
  AGENT_PRINCIPAL_TYPES,
  AGENT_REVIEW_LANGUAGES,
} from "@/types/agent";

export const agentPrincipalTypeEnum = pgEnum(
  "agent_principal_type",
  AGENT_PRINCIPAL_TYPES,
);

export const agentReviewLanguageEnum = pgEnum(
  "agent_review_language",
  AGENT_REVIEW_LANGUAGES,
);

/** The actor represented by one or more rotatable Agent credentials. */
export const agentPrincipals = pgTable(
  "agent_principals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: agentPrincipalTypeEnum("type").notNull(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    displayName: text("display_name").notNull(),
    /** Agent-authored Review Knowledge language. UI locale is intentionally separate. */
    reviewLanguage: agentReviewLanguageEnum("review_language")
      .notNull()
      .default("en"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "agent_principals_owner_type_check",
      sql`(${table.type} = 'USER_AGENT' and ${table.ownerUserId} is not null) or (${table.type} = 'SERVICE_AGENT' and ${table.ownerUserId} is null)`,
    ),
    index("agent_principals_owner_idx").on(table.ownerUserId),
    uniqueIndex("agent_principals_active_user_owner_unique")
      .on(table.ownerUserId)
      .where(
        sql`${table.type} = 'USER_AGENT' and ${table.revokedAt} is null`,
      ),
  ],
);

/** A secret used to authenticate a principal. Only its SHA-256 hash is stored. */
export const agentCredentials = pgTable(
  "agent_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => agentPrincipals.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    capabilityScopes: text("capability_scopes")
      .array()
      .notNull()
      .default(sql`array['READ', 'WRITE']::text[]`),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_credentials_key_hash_unique").on(table.keyHash),
    index("agent_credentials_principal_idx").on(table.principalId),
  ],
);

/**
 * Explicit Workspace access. Revocation is retained as authorization history.
 *
 * 🔴 **접근은 Principal(사람) 단위이지 Credential 단위가 아니다.** PK 가
 * `(principal_id, workspace_id)` 이고, 한 사용자에게 살아 있는 `USER_AGENT` Principal 은
 * 하나뿐이다(`agent_principals_active_user_owner_unique`). 그래서 **한 Workspace 를 끄면
 * 그 사람의 «모든» 연결에서 함께 꺼진다** — 연결마다 다른 범위를 줄 수 없다.
 *
 * 🔴 **화면이 이것을 다르게 그리지 않게 한다.** 「이 Agent 가 쓸 수 있는 Workspace」처럼
 * 적으면 사용자는 연결별로 범위를 나눌 수 있다고 읽는다. 실제 문구는
 * `AgentCredentialPanel` 이 「Workspace 접근」으로 두고 있고, 그 이유가 여기 있다.
 */
export const agentWorkspaceGrants = pgTable(
  "agent_workspace_grants",
  {
    principalId: uuid("principal_id")
      .notNull()
      .references(() => agentPrincipals.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.principalId, table.workspaceId] }),
    index("agent_workspace_grants_workspace_idx").on(table.workspaceId),
    index("agent_workspace_grants_principal_active_idx")
      .on(table.principalId, table.workspaceId)
      .where(sql`${table.revokedAt} is null`),
  ],
);
