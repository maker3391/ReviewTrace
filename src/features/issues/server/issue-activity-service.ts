import "server-only";

import { and, eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { issueActivities, reviewIssues } from "@/db/schema";
import type { IssueActivityInput } from "@/features/issues/schemas/issue-activity";
import { AppError } from "@/lib/errors";
import type { IssueActivityType, ReviewerType } from "@/types/review";

/**
 * Issue History 에 한 줄 남긴다(스펙 32).
 *
 * 🔴 **Tenant 격리가 이 함수의 핵심이다.** `WHERE issue.id = ?` 만으로 끝내지 않는다 —
 * 그 Issue 가 **이 API Key 의 Workspace 것인지** 함께 확인한다(스펙 15).
 *
 * 🔴 남의 Workspace 의 Issue 는 `FORBIDDEN` 이 아니라 **`NOT_FOUND`** 다.
 * 「권한이 없다」와 「없다」를 구분해 주면 그것만으로 **그 ID 가 존재한다**가 새어 나가고,
 * ID 를 훑어 다른 Tenant 의 Issue 수를 셀 수 있게 된다.
 *
 * 상태는 바꾸지 않는다. Activity 는 History 이고, 상태 전이는
 * `PATCH /api/v1/issues/{issueId}`(`issue-status-service.ts`)가 맡는다.
 */
export interface CreatedIssueActivity {
  id: string;
  reviewIssueId: string;
  type: IssueActivityType;
  actorType: ReviewerType;
  actorName: string;
  description: string | null;
  commitSha: string | null;
  createdAt: Date;
}

export async function addIssueActivity(
  input: {
    workspaceId: string;
    issueId: string;
    activity: IssueActivityInput;
  },
  executor: DbExecutor = db(),
): Promise<CreatedIssueActivity> {
  const issue = await findIssueInWorkspace(
    executor,
    input.workspaceId,
    input.issueId,
  );

  const rows = await executor
    .insert(issueActivities)
    .values({
      // 🔴 조회로 확인한 값을 쓴다. 요청이 보낸 것을 그대로 믿지 않는다.
      workspaceId: issue.workspaceId,
      reviewIssueId: issue.id,
      type: input.activity.type,
      actorType: input.activity.actor.type,
      actorName: input.activity.actor.name,
      description: input.activity.description,
      commitSha: input.activity.commitSha,
    })
    .returning({
      id: issueActivities.id,
      reviewIssueId: issueActivities.reviewIssueId,
      type: issueActivities.type,
      actorType: issueActivities.actorType,
      actorName: issueActivities.actorName,
      description: issueActivities.description,
      commitSha: issueActivities.commitSha,
      createdAt: issueActivities.createdAt,
    });

  const created = rows[0];
  if (created === undefined) {
    throw new AppError("INTERNAL_ERROR");
  }

  return created;
}

/**
 * Workspace 안에서 Issue 를 찾는다.
 *
 * 🔴 이 저장소에서 Issue 를 ID 로 다루는 모든 경로가 이것을 지난다. 조건 두 개를 함께
 * 거는 자리를 **한 곳**으로 모아 두는 것이 목적이다 — 흩어지면 하나가 빠진다.
 *
 * @throws AppError `NOT_FOUND`
 */
export async function findIssueInWorkspace(
  executor: DbExecutor,
  workspaceId: string,
  issueId: string,
): Promise<{ id: string; workspaceId: string; status: string }> {
  const rows = await executor
    .select({
      id: reviewIssues.id,
      workspaceId: reviewIssues.workspaceId,
      status: reviewIssues.status,
    })
    .from(reviewIssues)
    .where(
      and(eq(reviewIssues.id, issueId), eq(reviewIssues.workspaceId, workspaceId)),
    )
    .limit(1);

  const issue = rows[0];
  if (issue === undefined) {
    throw new AppError("NOT_FOUND");
  }

  return issue;
}
