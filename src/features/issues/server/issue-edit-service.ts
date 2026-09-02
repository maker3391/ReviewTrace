import "server-only";

import { and, eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { reviewIssues } from "@/db/schema";
import type { IssueEditInput } from "@/features/issues/schemas/issue-edit";
import {
  issueInScope,
  type IssueScope,
} from "@/features/issues/server/issue-scope";
import { AppError } from "@/lib/errors";

/**
 * Issue 의 **서술**을 고친다.
 *
 * ## 🔴 상태 전이가 아니다
 *
 * `updateIssueStatus` 는 `status` · `resolvedAt` · `resolutionSummary` · `IssueActivity`
 * 넷을 한 Transaction 안에서 함께 움직인다. 이 함수는 그 넷을 **하나도 건드리지 않는다** —
 * 사람이 문장을 다듬는 일과 Issue 가 lifecycle 위를 움직이는 일은 다른 사건이다.
 *
 * ```
 * updateIssueStatus 상태 · 시각 · 해결 요약 · History 를 함께 움직인다
 * updateIssueContent 서술 다섯 칸만. History 는 그대로 쌓여 있다
 * ```
 *
 * 🔴 **History 에 한 줄을 남기지 않는다.** `IssueActivity` 의 Type 일곱은 전부
 * 「Review 에서 벌어진 일」이고(스펙 4) 「누가 오타를 고쳤다」에 해당하는 것이 없다.
 * 없는 뜻을 기존 Type 에 얹으면 Pattern·Resolution 통계가 그 행까지 세어 거짓이 된다.
 * 새 Type 을 만드는 것은 enum Migration 이라 이 변경의 범위 밖이다 —
 * 바뀐 흔적은 `updatedAt` 하나로 남는다.
 *
 * ## 🔴 무엇을 쓰지 «않는가»
 *
 * `.set()` 에 들어가는 Column 은 다섯 + `updatedAt` 뿐이다. `status` · `severity` ·
 * `category` · `patternKey` · `source` · `externalId` · `firstDetectedAt` ·
 * `reviewSessionId` · `repositoryId` 는 이 문장에 이름조차 나오지 않는다 —
 * 왜 그런지는 `schemas/issue-edit.ts` 에 적혀 있다.
 *
 * ## 범위
 *
 * 🔴 **`issueInScope` 를 지난다**(`issue-scope.ts`). ID 로 Issue 를 다루는 다른 경로들과
 * 같은 조건이다 — 화면에서 온 요청은 Workspace 와 Project 를 **겹쳐서** 걸고, 조건은
 * `UPDATE` 문장 자체에 붙는다. 「조회해서 확인하고 → 수정한다」로 나누면 조건이 두 문장으로
 * 갈라져 한쪽을 빠뜨릴 자리가 생긴다.
 *
 * @throws {AppError} 범위 안에서 찾지 못하면 `RESOURCE_NOT_FOUND`.
 * 🔴 없는 Issue 와 남의 Issue 를 구분해 알려 주지 않는다.
 */
export interface EditedIssue {
  id: string;
  title: string;
  description: string | null;
  rootCause: string | null;
  failurePath: string | null;
  suggestion: string | null;
  updatedAt: Date;
}

export async function updateIssueContent(
  input: {
    /** 🔴 인가로 «확인된» 값이어야 한다. 요청 본문에서 온 값을 그대로 넣지 않는다. */
    scope: IssueScope;
    issueId: string;
    update: IssueEditInput;
  },
  executor: DbExecutor = db(),
): Promise<EditedIssue> {
  const { update } = input;

  const updatedRows = await executor
    .update(reviewIssues)
    .set({
      title: update.title,
      description: update.description,
      rootCause: update.rootCause,
      failurePath: update.failurePath,
      suggestion: update.suggestion,
      updatedAt: new Date(),
    })
    .where(and(eq(reviewIssues.id, input.issueId), issueInScope(input.scope)))
    .returning({
      id: reviewIssues.id,
      title: reviewIssues.title,
      description: reviewIssues.description,
      rootCause: reviewIssues.rootCause,
      failurePath: reviewIssues.failurePath,
      suggestion: reviewIssues.suggestion,
      updatedAt: reviewIssues.updatedAt,
    });

  const updated = updatedRows[0];
  if (updated === undefined) {
    throw new AppError("RESOURCE_NOT_FOUND");
  }

  return updated;
}
