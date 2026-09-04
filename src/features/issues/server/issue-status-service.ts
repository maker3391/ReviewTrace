import "server-only";

import { and, eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { issueActivities, reviewIssues } from "@/db/schema";
import { insertCodeEvidence } from "@/features/issues/server/code-evidence-service";
import { nextActivityOrdinal } from "@/features/issues/server/issue-activity-ordinal";
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

  return executor.transaction(async (tx) => {
    /**
     * 🔴 **행을 «먼저» 잠근다 — 시각을 그 뒤에 만들기 위해서다.**
     *
     * `resolvedAt` 은 「이 문제가 해결된 시각」이다. 예전에는 그 값을 `executor`
     * 를 부르기도 «전»에 만들어 두었고, 그래서 connection pool 대기와 행 잠금
     * 대기만큼 낡은 채 저장됐다 — 실제 잠금을 400ms 붙들고 재 보니 저장된 값이
     * 부르기 직전의 시각 그대로였다(`issue-status.integration.test.ts`).
     *
     * 그러면 나중에 commit 된 `RESOLVED` 의 `resolvedAt` 이 **그 직전에 일어난
     * `REOPENED` 보다 이른** 조합이 나온다 — Issue 는 「해결됨」인데 해결 시각이
     * 마지막 재개보다 앞선다.
     *
     * 🔴 **`clock_timestamp()` 를 `SET` 절에 넣는 것으로 대신하지 않는다.**
     * 새 tuple 은 outer plan 이 «먼저» 만들고, 최신 tuple 을 잠근 뒤 다시 만드는
     * 것은 concurrent update 로 `TM_Updated` 가 났을 때뿐이다(`nodeModifyTable.c`
     * 의 EPQ 경로). 「잠근 뒤에 평가된다」는 일반적인 보증이 아니다.
     *
     * 🔴 **범위 조건을 여기서도 «그대로» 건다.** 이 SELECT 는 시각을 위한 것이지
     * 인가를 위한 것이 아니다 — 아래 UPDATE 의 조건은 하나도 덜어 내지 않는다.
     */
    const locked = await tx
      .select({ id: reviewIssues.id })
      .from(reviewIssues)
      .where(and(eq(reviewIssues.id, issueId), issueInScope(scope)))
      .for("update")
      .limit(1);

    if (locked.length === 0) {
      // 없는 Issue 와 범위 밖의 Issue 를 구분해 알려주지 않는다.
      throw new AppError("RESOURCE_NOT_FOUND");
    }

    /** 🔴 잠근 뒤의 «한» 시각. Issue 와 Activity 가 같은 값을 쓴다. */
    const now = new Date();

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

    /**
     * 🔴 위에서 **이미 잠근** Issue 행이라 그 사이에 순번이 늘지 않는다.
     * 잠금을 여기서 다시 잡지 않는 것을 인자로 밝힌다.
     */
    const ordinal = await nextActivityOrdinal(tx, updated.id, {
      alreadyLocked: true,
    });

    // 같은 Transaction 이다 — 상태만 바뀌고 History 가 없는 순간을 만들지 않는다.
    const activityRows = await tx
      .insert(issueActivities)
      .values({
        workspaceId,
        reviewIssueId: updated.id,
        type: ACTIVITY_TYPE_BY_STATUS[update.status],
        /** 🔴 순서의 정본. 아래 `createdAt` 은 «보여 주는 시각»이고 역할이 다르다. */
        ordinal,
        /**
         * 🔴 **`now()` 기본값에 맡기지 않는다.** PostgreSQL 의 `now()` 는
         * **transaction 시작 시각**이라 잠금을 얻은 순서가 아니라 `BEGIN` 순서를
         * 남긴다. 두 전이가 겹치면 마지막에 commit 된 쪽이 더 이른 시각을 갖고,
         * `createdAt` 만으로 정렬하는 History 의 «마지막 줄»이 실제 상태와
         * 반대로 보인다. 잠근 뒤의 같은 시각을 명시해 그 창을 닫는다.
         */
        createdAt: now,
        actorType: update.actor?.type ?? "AGENT",
        actorName: update.actor?.name ?? input.fallbackActorName,
        description: update.resolutionSummary,
        commitSha: update.commitSha,
        /**
         * 🔴 `resolutionSummary` 와 겹치지 않는다. 저것은 Issue 에 남는 최종 해결 요약 문서이고
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
