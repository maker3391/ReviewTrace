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
import { AGENT_PRINCIPAL_TYPES } from "@/types/agent";

export const agentPrincipalTypeEnum = pgEnum(
  "agent_principal_type",
  AGENT_PRINCIPAL_TYPES,
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

/** Explicit Workspace access. Revocation is retained as authorization history. */
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
