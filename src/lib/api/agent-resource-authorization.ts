import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { reviewIssues, reviewSessions } from "@/db/schema";
import type { AgentAuthorization } from "@/lib/api/api-key-auth";
import { AppError } from "@/lib/errors";

async function requireAuthorizedResourceWorkspace(
  authorization: AgentAuthorization,
  resource: "ISSUE" | "REVIEW",
  resourceId: string,
  executor: DbExecutor,
): Promise<string> {
  const ids = [...authorization.authorizedWorkspaceIds];
  if (ids.length === 0) {
    throw new AppError("RESOURCE_NOT_FOUND");
  }

  const rows =
    resource === "ISSUE"
      ? await executor
          .select({ workspaceId: reviewIssues.workspaceId })
          .from(reviewIssues)
          .where(
            and(
              eq(reviewIssues.id, resourceId),
              inArray(reviewIssues.workspaceId, ids),
            ),
          )
          .limit(1)
      : await executor
          .select({ workspaceId: reviewSessions.workspaceId })
          .from(reviewSessions)
          .where(
            and(
              eq(reviewSessions.id, resourceId),
              inArray(reviewSessions.workspaceId, ids),
            ),
          )
          .limit(1);

  const workspaceId = rows[0]?.workspaceId;
  if (workspaceId === undefined) {
    throw new AppError("RESOURCE_NOT_FOUND");
  }
  return workspaceId;
}

export function requireAuthorizedIssueWorkspace(
  authorization: AgentAuthorization,
  issueId: string,
  executor: DbExecutor = db(),
): Promise<string> {
  return requireAuthorizedResourceWorkspace(
    authorization,
    "ISSUE",
    issueId,
    executor,
  );
}

export function requireAuthorizedReviewWorkspace(
  authorization: AgentAuthorization,
  reviewId: string,
  executor: DbExecutor = db(),
): Promise<string> {
  return requireAuthorizedResourceWorkspace(
    authorization,
    "REVIEW",
    reviewId,
    executor,
  );
}
