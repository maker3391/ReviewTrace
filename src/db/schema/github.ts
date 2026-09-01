import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { projects } from "@/db/schema/project";
import { users, workspaces } from "@/db/schema/workspace";

/** Workspace가 사용할 수 있는 GitHub App installation. Token은 저장하지 않는다. */
export const githubInstallations = pgTable(
  "github_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    installationId: text("installation_id").notNull(),
    accountId: text("account_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull(),
    repositorySelection: text("repository_selection").notNull(),
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
    // 한 installation을 다른 Tenant에 다시 연결할 수 없게 하는 최종 경계다.
    uniqueIndex("github_installations_installation_unique").on(
      table.installationId,
    ),
    index("github_installations_workspace_idx").on(table.workspaceId),
  ],
);

/** GitHub 설치 시작과 callback을 잇는, 사용자·Workspace·Project에 묶인 일회용 state. */
export const githubInstallationRequests = pgTable(
  "github_installation_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stateHash: text("state_hash").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("github_installation_requests_state_unique").on(
      table.stateHash,
    ),
    index("github_installation_requests_workspace_idx").on(
      table.workspaceId,
      table.expiresAt,
    ),
  ],
);
