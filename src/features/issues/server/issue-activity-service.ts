import "server-only";

import { and, eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { issueActivities, reviewIssues } from "@/db/schema";
import { insertCodeEvidence } from "@/features/issues/server/code-evidence-service";
import { nextActivityOrdinal } from "@/features/issues/server/issue-activity-ordinal";
import type { IssueActivityInput } from "@/features/issues/schemas/issue-activity";
import {
  issueInScope,
  type IssueScope,
} from "@/features/issues/server/issue-scope";
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
  /** 🔴 확인은 Transaction 밖에서 한다 — 무엇을 확인할지만 밖으로 넘긴다. */
  evidenceIds: string[];
}

export async function addIssueActivity(
  input: {
    /**
     * 🔴 **상태 변경과 «같은» 범위 규칙을 쓴다**(`issueInScope`).
     *
     * 화면에서 온 요청은 URL 의 Project 까지 좁히고, Agent 요청은 API Key 가 정한
     * Workspace 까지만 좁힌다 — Agent 에게는 Project 가 없기 때문이다.
     * 조건을 여기서 다시 적지 않는 이유는, 읽기와 쓰기가 갈라지면 그 순간
     * 「Project A 화면에서 Project B 의 History 에 한 줄 남는」 자리가 생기기 때문이다.
     */
    scope: IssueScope;
    issueId: string;
    activity: IssueActivityInput;
  },
  executor: DbExecutor = db(),
): Promise<CreatedIssueActivity> {
  // 🔴 행위와 그 근거는 함께 남거나 함께 남지 않는다 — 반쪽 History 를 만들지 않는다.
  return executor.transaction(async (tx) => {
    // 🔴 이 조회가 Issue 행을 «잠그면서» 읽는다 — 아래 순번이 그 잠금 안에서 정해진다.
    const issue = await findIssueInScope(tx, input.scope, input.issueId);
    const ordinal = await nextActivityOrdinal(tx, issue.id, {
      alreadyLocked: true,
    });

    const rows = await tx
      .insert(issueActivities)
      .values({
        // 🔴 조회로 확인한 값을 쓴다. 요청이 보낸 것을 그대로 믿지 않는다.
        workspaceId: issue.workspaceId,
        reviewIssueId: issue.id,
        type: input.activity.type,
        /** 🔴 순서의 정본. `createdAt` 은 «보여 주는 시각»이라 역할이 다르다. */
        ordinal,
        actorType: input.activity.actor.type,
        actorName: input.activity.actor.name,
        description: input.activity.description,
        commitSha: input.activity.commitSha,
        // 이 행위가 내린 판단. 다음 시도가 이것을 덮어쓰지 않는다(스펙 4).
        ...(input.activity.decision ?? {}),
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
      throw new AppError("UNEXPECTED");
    }

    const evidenceIds = await insertCodeEvidence(
      tx,
      issue.workspaceId,
      input.activity.evidence.map((evidence) => ({
        reviewIssueId: issue.id,
        issueActivityId: created.id,
        evidence,
      })),
    );

    return { ...created, evidenceIds };
  });
}

/**
 * Workspace 안에서 Issue 를 찾는다.
 *
 * 🔴 이 저장소에서 Issue 를 ID 로 다루는 모든 경로가 이것을 지난다. 조건 두 개를 함께
 * 거는 자리를 **한 곳**으로 모아 두는 것이 목적이다 — 흩어지면 하나가 빠진다.
 *
 * @throws AppError `NOT_FOUND`
 */
export async function findIssueInScope(
  executor: DbExecutor,
  scope: IssueScope,
  issueId: string,
): Promise<{ id: string; workspaceId: string; status: string }> {
  const rows = await executor
    .select({
      id: reviewIssues.id,
      workspaceId: reviewIssues.workspaceId,
      status: reviewIssues.status,
    })
    .from(reviewIssues)
    .where(and(eq(reviewIssues.id, issueId), issueInScope(scope)))
    /**
     * 🔴 **잠그면서 읽는다.** 이 조회의 유일한 쓰임이 「이 Issue 에 Activity 를 한 줄
     * 붙인다」이고, 그 순번은 잠그지 않으면 읽는 순간 낡는다
     * (`issue-activity-ordinal.ts`). 행 하나이므로 잠금 순서 문제는 생기지 않는다.
     */
    .for("update")
    .limit(1);

  const issue = rows[0];
  if (issue === undefined) {
    throw new AppError("RESOURCE_NOT_FOUND");
  }

  return issue;
}
