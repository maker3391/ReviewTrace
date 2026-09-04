import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  issueActivities,
  issueCodeEvidences,
  issueTags,
  repositories,
  reviewIssues,
  reviewSessions,
  tags,
} from "@/db/schema";
import { ACTIVITY_TIMELINE_ORDER } from "@/features/issues/server/issue-activity-ordinal";
import {
  OPEN_ISSUE_STATUSES,
  type CodeEvidenceKind,
  type EvidenceSourceState,
  type EvidenceVerification,
  type IssueActivityType,
  type IssueCategory,
  type IssueSeverity,
  type IssueStatus,
  type ReviewerType,
} from "@/types/review";
import type { ProjectScope } from "@/types/tenant";

/**
 * ReviewIssue 상세.
 *
 * **가장 중요한 Domain 이다**. 이 화면이 답해야 하는 것은 「무슨 문제인가」가
 * 아니라 **「어떻게 여기까지 왔는가」** 다:
 *
 * ```
 * Codex DETECTED -> Claude FIX_ATTEMPTED -> Codex REVIEWED_AGAIN
 * -> Claude FIX_ATTEMPTED -> Codex RESOLVED
 * ```
 *
 * 🔴 `resolved = true` 만 보여 주지 않는다. **어떻게 해결했는가가 Knowledge 의 핵심**이다.
 *
 * 🔴 범위 밖이면 `null` 이다 — 「없는 Issue」와 「남의 Issue」를 구분해 알려 주지 않는다.
 * Activity·Tag 는 Issue 를 찾은 «뒤에» 읽는다. 못 찾으면 질의를 던지지도 않는다.
 */

export interface IssueActivityEntry {
  id: string;
  type: IssueActivityType;
  actorType: ReviewerType;
  actorName: string;
  description: string | null;
  commitSha: string | null;
  createdAt: Date;
  solution: string | null;
  decisionReason: string | null;
  alternativesConsidered: string | null;
  tradeOff: string | null;
  verification: string | null;
  regressionTest: string | null;
  residualRisk: string | null;
  evidence: IssueEvidenceEntry[];
}

export interface IssueEvidenceEntry {
  id: string;
  kind: CodeEvidenceKind;
  commitSha: string;
  /** `commitSha` 가 이 snapshot 자체를 가리키는가, 이 작업의 바탕을 가리키는가. */
  sourceState: EvidenceSourceState;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  snapshot: string | null;
  verification: EvidenceVerification;
  verifiedAt: Date | null;
}

export interface IssueDetail {
  id: string;
  title: string;
  description: string | null;
  rootCause: string | null;
  failurePath: string | null;
  severity: IssueSeverity;
  category: IssueCategory;
  status: IssueStatus;
  patternKey: string | null;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  suggestion: string | null;
  /** 보낸 쪽의 식별자. 같은 문제를 다시 보고해도 한 행으로 유지하는 열쇠다. */
  source: string | null;
  externalId: string | null;
  /** 🔴 「했다」의 기록. Agent 가 제안한 `suggestion`(「해 보라」)과 다르다. */
  resolutionSummary: string | null;
  firstDetectedAt: Date;
  resolvedAt: Date | null;
  updatedAt: Date;

  repositoryId: string;
  repositoryFullName: string;
  /** 이 Issue 를 «처음 만든» Review. 이후 Review 는 Activity 로 남는다. */
  reviewSessionId: string;
  reviewerName: string;
  reviewBranch: string | null;
  reviewCommitSha: string | null;

  tags: string[];
  /** Activity 없이 뒤늦게 붙인 Evidence. Activity 소속 Evidence 는 각 History 행에 붙는다. */
  evidence: IssueEvidenceEntry[];
  activities: IssueActivityEntry[];
}

export async function findIssueDetail(
  scope: ProjectScope,
  issueId: string,
  executor: DbExecutor = db(),
): Promise<IssueDetail | null> {
  const rows = await executor
    .select({
      id: reviewIssues.id,
      title: reviewIssues.title,
      description: reviewIssues.description,
      rootCause: reviewIssues.rootCause,
      failurePath: reviewIssues.failurePath,
      severity: reviewIssues.severity,
      category: reviewIssues.category,
      status: reviewIssues.status,
      patternKey: reviewIssues.patternKey,
      filePath: reviewIssues.filePath,
      startLine: reviewIssues.startLine,
      endLine: reviewIssues.endLine,
      suggestion: reviewIssues.suggestion,
      source: reviewIssues.source,
      externalId: reviewIssues.externalId,
      resolutionSummary: reviewIssues.resolutionSummary,
      firstDetectedAt: reviewIssues.firstDetectedAt,
      resolvedAt: reviewIssues.resolvedAt,
      updatedAt: reviewIssues.updatedAt,
      repositoryId: reviewIssues.repositoryId,
      repositoryFullName: repositories.fullName,
      reviewSessionId: reviewIssues.reviewSessionId,
      reviewerName: reviewSessions.reviewerName,
      reviewBranch: reviewSessions.branch,
      reviewCommitSha: reviewSessions.commitSha,
    })
    .from(reviewIssues)
    .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
    .innerJoin(
      reviewSessions,
      eq(reviewSessions.id, reviewIssues.reviewSessionId),
    )
    .where(
      and(
        eq(reviewIssues.id, issueId),
        eq(reviewIssues.workspaceId, scope.workspaceId),
        eq(repositories.projectId, scope.projectId),
      ),
    )
    .limit(1);

  const issue = rows[0];
  if (issue === undefined) {
    return null;
  }

  const [activities, tagRows, evidenceRows] = await Promise.all([
    executor
      .select({
        id: issueActivities.id,
        type: issueActivities.type,
        actorType: issueActivities.actorType,
        actorName: issueActivities.actorName,
        description: issueActivities.description,
        commitSha: issueActivities.commitSha,
        createdAt: issueActivities.createdAt,
        solution: issueActivities.solution,
        decisionReason: issueActivities.decisionReason,
        alternativesConsidered: issueActivities.alternativesConsidered,
        tradeOff: issueActivities.tradeOff,
        verification: issueActivities.verification,
        regressionTest: issueActivities.regressionTest,
        residualRisk: issueActivities.residualRisk,
      })
      .from(issueActivities)
      .where(
        and(
          eq(issueActivities.reviewIssueId, issue.id),
          eq(issueActivities.workspaceId, scope.workspaceId),
        ),
      )
      /**
       * 🔴 오래된 것부터다. History 는 「어떻게 여기까지 왔는가」라 순서대로 읽힌다.
       * 정렬의 정본은 `ordinal` 이다 — `createdAt` 은 **보여 주는 시각**이라 한 Transaction
       * 안에서 만들어진 행들이 같은 값을 갖는다(`issue-activity-ordinal.ts`).
       */
      .orderBy(...ACTIVITY_TIMELINE_ORDER),

    executor
      .select({ name: tags.name })
      .from(issueTags)
      .innerJoin(tags, eq(tags.id, issueTags.tagId))
      .where(
        and(
          eq(issueTags.reviewIssueId, issue.id),
          eq(tags.workspaceId, scope.workspaceId),
        ),
      )
      .orderBy(asc(tags.normalizedName)),

    executor
      .select({
        id: issueCodeEvidences.id,
        issueActivityId: issueCodeEvidences.issueActivityId,
        kind: issueCodeEvidences.kind,
        commitSha: issueCodeEvidences.commitSha,
        sourceState: issueCodeEvidences.sourceState,
        filePath: issueCodeEvidences.filePath,
        startLine: issueCodeEvidences.startLine,
        endLine: issueCodeEvidences.endLine,
        snapshot: issueCodeEvidences.snapshot,
        verification: issueCodeEvidences.verification,
        verifiedAt: issueCodeEvidences.verifiedAt,
      })
      .from(issueCodeEvidences)
      .where(
        and(
          eq(issueCodeEvidences.reviewIssueId, issue.id),
          eq(issueCodeEvidences.workspaceId, scope.workspaceId),
        ),
      )
      .orderBy(asc(issueCodeEvidences.createdAt), asc(issueCodeEvidences.id)),
  ]);

  /**
   * 🔴 Activity 마다 Evidence 를 다시 조회하지 않는다. Issue 것 전부를 한 번에 읽고
   * 메모리에서 소속별로 묶는다. `issueActivityId = NULL` 도 버리지 않고 Issue 에 남긴다.
   */
  const evidenceByActivity = new Map<string, IssueEvidenceEntry[]>();
  const issueEvidence: IssueEvidenceEntry[] = [];
  for (const { issueActivityId, ...evidence } of evidenceRows) {
    if (issueActivityId === null) {
      issueEvidence.push(evidence);
      continue;
    }

    const entries = evidenceByActivity.get(issueActivityId) ?? [];
    entries.push(evidence);
    evidenceByActivity.set(issueActivityId, entries);
  }

  return {
    ...issue,
    tags: tagRows.map((row) => row.name),
    evidence: issueEvidence,
    activities: activities.map((activity) => ({
      ...activity,
      evidence: evidenceByActivity.get(activity.id) ?? [],
    })),
  };
}

/** Repository 상세가 보여 주는 「이 저장소에서 열려 있는 것」. */
export interface RepositoryIssueRow {
  id: string;
  title: string;
  severity: IssueSeverity;
  category: IssueCategory;
  status: IssueStatus;
  filePath: string | null;
  firstDetectedAt: Date;
}

export async function listRepositoryOpenIssues(
  scope: ProjectScope,
  repositoryId: string,
  limit: number,
  executor: DbExecutor = db(),
): Promise<RepositoryIssueRow[]> {
  return (
    executor
      .select({
        id: reviewIssues.id,
        title: reviewIssues.title,
        severity: reviewIssues.severity,
        category: reviewIssues.category,
        status: reviewIssues.status,
        filePath: reviewIssues.filePath,
        firstDetectedAt: reviewIssues.firstDetectedAt,
      })
      .from(reviewIssues)
      .innerJoin(repositories, eq(repositories.id, reviewIssues.repositoryId))
      .where(
        and(
          eq(reviewIssues.repositoryId, repositoryId),
          eq(reviewIssues.workspaceId, scope.workspaceId),
          eq(repositories.projectId, scope.projectId),
          inArray(reviewIssues.status, OPEN_ISSUE_STATUSES),
        ),
      )
      // 급한 것부터, 같은 등급 안에서는 오래된 것부터(enum 선언 순서 = 심각도 순서).
      .orderBy(asc(reviewIssues.severity), asc(reviewIssues.firstDetectedAt))
      .limit(limit)
  );
}
