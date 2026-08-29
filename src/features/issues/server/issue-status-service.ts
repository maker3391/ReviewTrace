import "server-only";

import { and, eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { issueActivities, reviewIssues } from "@/db/schema";
import { insertCodeEvidence } from "@/features/issues/server/code-evidence-service";
import {
  issueInScope,
  type IssueScope,
} from "@/features/issues/server/issue-scope";
import {
  ACTIVITY_TYPE_BY_STATUS,
  type IssueStatusUpdateInput,
} from "@/features/issues/schemas/issue-status-update";
import { AppError } from "@/lib/errors";
import type { IssueStatus } from "@/types/review";

/**
 * Issue 상태 전이(스펙 33).
 *
 * 🔴 **상태와 History 가 서로 모순되지 않게 한다.** 그래서 이 함수는 Column 하나를 바꾸지
 * 않고 **네 가지를 한 Transaction 안에서 함께 움직인다.**
 *
 * ```
 * status  ·  resolvedAt  ·  resolutionSummary  ·  IssueActivity
 * ```
 *
 * | 전이 | resolvedAt | resolutionSummary | Activity |
 * |---|---|---|---|
 * | `RESOLVED` | 지금 | 저장 (필수) | `RESOLVED` |
 * | `REOPENED` · 그 밖 | `NULL` | `NULL` | 상태별 대응(`ACTIVITY_TYPE_BY_STATUS`) |
 *
 * 🔴 **RESOLVED 가 아닌 상태에 해결 요약을 남겨 두지 않는다.** 「다시 열렸는데 어떻게
 * 해결했는지가 적혀 있는」 행은 그 자체로 모순이다. 지난 요약이 사라지지는 않는다 —
 * RESOLVED 로 갈 때 그 요약을 **Activity 의 `description` 에 함께 남기기** 때문에
 * History 를 보면 「그때는 이렇게 고쳤다고 했다」가 그대로 있다.
 */
export interface UpdatedIssue {
  id: string;
  status: IssueStatus;
  resolutionSummary: string | null;
  resolvedAt: Date | null;
  updatedAt: Date;
  /** 🔴 확인은 Transaction 밖에서 한다 — 무엇을 확인할지만 밖으로 넘긴다. */
  evidenceIds: string[];
}

export async function updateIssueStatus(
  input: {
    /**
     * 🔴 **부르는 쪽이 «아는 만큼» 좁힌다**(`issue-scope.ts`).
     *
     * 화면은 주소에 Project 가 있으므로 `ProjectScope` 를 준다 — Project A 를 보면서
     * 주소만 바꿔 Project B 의 Issue 를 움직이지 못한다. Agent 는 API Key 가 Workspace 만
     * 정하므로 `WorkspaceScope` 다.
     */
    scope: IssueScope;
    issueId: string;
    update: IssueStatusUpdateInput;
    /** `actor` 를 생략했을 때 쓸 이름. API Key 의 이름이 들어온다. */
    fallbackActorName: string;
  },
  executor: DbExecutor = db(),
): Promise<UpdatedIssue> {
  const { scope, issueId, update } = input;
  const workspaceId = scope.workspaceId;
  const resolving = update.status === "RESOLVED";
  const now = new Date();

  return executor.transaction(async (tx) => {
    /**
     * 🔴 범위 조건을 UPDATE 자체에 건다.
     *
     * 「조회해서 확인하고 → 수정한다」로 나누면 그 사이에 다른 요청이 끼어들 수 있고,
     * 무엇보다 조건이 두 문장으로 갈라진다. 한 문장이면 빠뜨릴 자리가 없다(스펙 15).
     */
    const updatedRows = await tx
      .update(reviewIssues)
      .set({
        status: update.status,
        resolvedAt: resolving ? now : null,
        resolutionSummary: resolving ? update.resolutionSummary : null,
        updatedAt: now,
      })
      .where(and(eq(reviewIssues.id, issueId), issueInScope(scope)))
      .returning({
        id: reviewIssues.id,
        status: reviewIssues.status,
        resolutionSummary: reviewIssues.resolutionSummary,
        resolvedAt: reviewIssues.resolvedAt,
        updatedAt: reviewIssues.updatedAt,
      });

    const updated = updatedRows[0];
    if (updated === undefined) {
      // 없는 Issue 와 범위 밖의 Issue(남의 Workspace · 다른 Project)를 구분해 알려주지 않는다.
      throw new AppError("RESOURCE_NOT_FOUND");
    }

    // 같은 Transaction 이다 — 상태만 바뀌고 History 가 없는 순간을 만들지 않는다.
    const activityRows = await tx
      .insert(issueActivities)
      .values({
        workspaceId,
        reviewIssueId: updated.id,
        type: ACTIVITY_TYPE_BY_STATUS[update.status],
        actorType: update.actor?.type ?? "AGENT",
        actorName: update.actor?.name ?? input.fallbackActorName,
        description: update.resolutionSummary,
        commitSha: update.commitSha,
        /**
         * 🔴 `resolutionSummary` 와 겹치지 않는다. 저것은 Issue 에 남는 최종 한 줄이고
         * 이것은 그 결론에 이른 이번 판단이라 여기 남는다 — REOPENED 되어도 지워지지 않는다.
         */
        ...(update.decision ?? {}),
      })
      .returning({ id: issueActivities.id });

    const evidenceIds = await insertCodeEvidence(
      tx,
      workspaceId,
      update.evidence.map((evidence) => ({
        reviewIssueId: updated.id,
        issueActivityId: activityRows[0]?.id ?? null,
        evidence,
      })),
    );

    return { ...updated, evidenceIds };
  });
}
