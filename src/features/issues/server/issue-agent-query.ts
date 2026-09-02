import "server-only";

import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { issueInScope } from "@/features/issues/server/issue-scope";
import {
  issueActivities,
  issueCodeEvidences,
  repositories,
  reviewIssues,
  reviewSessions,
} from "@/db/schema";
import type { IssueSearchQuery } from "@/features/issues/schemas/issue-search-query";
import type {
  CodeEvidenceKind,
  EvidenceVerification,
  IssueActivityType,
  IssueCategory,
  IssueSeverity,
  IssueStatus,
  ReviewerType,
} from "@/types/review";

/**
 * Agent 가 읽는 Issue(스펙 5 — `get_issue` · `search_issues`).
 *
 * ## 🔴 화면용 조회를 그대로 쓰지 않는 이유
 *
 * 화면 조회(`issue-detail-query.ts`)는 **Project 범위**다 — 사람은 주소로 Project 를
 * 고르고 들어온다. Agent 에게는 그 주소가 없다. **Key 가 곧 Workspace** 이고 그 안에서
 * `owner/name` 으로 좁힌다(스펙 19).
 *
 * 담는 것도 다르다. 화면은 사람이 읽을 것을, 여기는 **다음 판단에 쓸 것**을 담는다 —
 * Decision Record 와 Code Evidence 가 그래서 여기에만 있다.
 *
 * 🔴 **범위 밖이면 `null` 이다.** 「없다」와 「남의 것이다」를 구분해 알려 주지 않는다.
 */

export interface AgentDecisionRecord {
  solution: string | null;
  decisionReason: string | null;
  alternativesConsidered: string | null;
  tradeOff: string | null;
  verification: string | null;
  regressionTest: string | null;
  residualRisk: string | null;
}

export interface AgentEvidence {
  kind: CodeEvidenceKind;
  commitSha: string;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  snapshot: string | null;
  /** 🔴 「Agent 가 보냈다」와 「GitHub 에 그렇게 있다」를 가르는 값이다. */
  verification: EvidenceVerification;
}

export interface AgentActivity extends AgentDecisionRecord {
  id: string;
  type: IssueActivityType;
  actorType: ReviewerType;
  actorName: string;
  description: string | null;
  commitSha: string | null;
  createdAt: Date;
  evidence: AgentEvidence[];
}

export interface AgentIssueSummary {
  id: string;
  title: string;
  severity: IssueSeverity;
  category: IssueCategory;
  status: IssueStatus;
  patternKey: string | null;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  repositoryFullName: string;
  firstDetectedAt: Date;
  resolvedAt: Date | null;
}

export interface AgentIssueDetail extends AgentIssueSummary {
  description: string | null;
  rootCause: string | null;
  failurePath: string | null;
  suggestion: string | null;
  resolutionSummary: string | null;
  source: string | null;
  externalId: string | null;
  reviewerName: string;
  updatedAt: Date;
  /** 오래된 것부터. 「어떻게 여기까지 왔는가」는 순서가 곧 뜻이다. */
  activities: AgentActivity[];
}

export async function findAgentIssue(
  workspaceId: string,
  issueId: string,
  executor: DbExecutor = db(),
): Promise<AgentIssueDetail | null> {
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
      resolutionSummary: reviewIssues.resolutionSummary,
      source: reviewIssues.source,
      externalId: reviewIssues.externalId,
      firstDetectedAt: reviewIssues.firstDetectedAt,
      resolvedAt: reviewIssues.resolvedAt,
      updatedAt: reviewIssues.updatedAt,
      repositoryFullName: repositories.fullName,
      reviewerName: reviewSessions.reviewerName,
    })
    .from(reviewIssues)
    .innerJoin(
      repositories,
      and(
        eq(repositories.id, reviewIssues.repositoryId),
        // 🔴 Join 에도 Workspace 를 겹쳐 건다 — 조건 하나가 빠진 질의가 곧 유출이다.
        eq(repositories.workspaceId, reviewIssues.workspaceId),
      ),
    )
    .innerJoin(
      reviewSessions,
      and(
        eq(reviewSessions.id, reviewIssues.reviewSessionId),
        eq(reviewSessions.workspaceId, reviewIssues.workspaceId),
      ),
    )
    // 🔴 ID 만으로 끝내지 않는다 — 범위 조건은 `issueInScope` 한 곳에서 받는다.
    // Agent 요청에는 Project 가 없으므로 Workspace 범위다.
    .where(and(eq(reviewIssues.id, issueId), issueInScope({ workspaceId })))
    .limit(1);

  const issue = rows[0];
  if (issue === undefined) {
    return null;
  }

  // 찾은 «뒤에» 읽는다. 못 찾으면 질의를 던지지도 않는다.
  const activities = await findActivities(executor, workspaceId, issue.id);

  return { ...issue, activities };
}

/**
 * Agent 검색의 `where`.
 *
 * 🔴 **Workspace 조건을 «맨 먼저, 무조건» 넣는다.** 나머지는 요청이 보낸 Filter 라 있을
 * 수도 없을 수도 있지만 이 하나는 어떤 조합에서도 빠지지 않는다 — 빠지는 순간 아무 API Key
 * 하나로 **모든 Tenant 의 Issue 목록**이 돌아온다.
 *
 * 질의를 돌리지 않고도 「무엇으로 좁히는가」를 확인할 수 있게 따로 뽑았다
 * (`issue-agent-query.test.ts`). 화면 조회(`issue-query.ts`)와 같은 방식이다.
 */
export function buildAgentIssueSearchConditions(
  workspaceId: string,
  query: IssueSearchQuery,
): SQL[] {
  const conditions: SQL[] = [eq(reviewIssues.workspaceId, workspaceId)];

  if (query.repository !== null) {
    // GitHub 의 `owner/name` 은 대소문자를 가리지 않는다.
    conditions.push(
      sql`lower(${repositories.fullName}) = lower(${query.repository})`,
    );
  }
  if (query.status !== null) {
    conditions.push(eq(reviewIssues.status, query.status));
  }
  if (query.severity !== null) {
    conditions.push(eq(reviewIssues.severity, query.severity));
  }
  if (query.category !== null) {
    conditions.push(eq(reviewIssues.category, query.category));
  }
  if (query.patternKey !== null) {
    conditions.push(eq(reviewIssues.patternKey, query.patternKey));
  }
  if (query.q !== null) {
    // Drizzle 이 값을 파라미터로 바인딩한다. 문자열을 이어 붙여 쿼리를 만들지 않는다.
    const keyword = `%${escapeLikePattern(query.q)}%`;
    const match = or(
      ilike(reviewIssues.title, keyword),
      ilike(reviewIssues.filePath, keyword),
      ilike(reviewIssues.patternKey, keyword),
    );
    if (match !== undefined) {
      conditions.push(match);
    }
  }

  return conditions;
}

export async function searchAgentIssues(
  workspaceId: string,
  query: IssueSearchQuery,
  executor: DbExecutor = db(),
): Promise<AgentIssueSummary[]> {
  const conditions = buildAgentIssueSearchConditions(workspaceId, query);

  return executor
    .select({
      id: reviewIssues.id,
      title: reviewIssues.title,
      severity: reviewIssues.severity,
      category: reviewIssues.category,
      status: reviewIssues.status,
      patternKey: reviewIssues.patternKey,
      filePath: reviewIssues.filePath,
      startLine: reviewIssues.startLine,
      endLine: reviewIssues.endLine,
      repositoryFullName: repositories.fullName,
      firstDetectedAt: reviewIssues.firstDetectedAt,
      resolvedAt: reviewIssues.resolvedAt,
    })
    .from(reviewIssues)
    .innerJoin(
      repositories,
      and(
        eq(repositories.id, reviewIssues.repositoryId),
        eq(repositories.workspaceId, reviewIssues.workspaceId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(reviewIssues.firstDetectedAt))
    .limit(query.limit);
}

/**
 * `q` 안의 LIKE 와일드카드를 글자 그대로 만든다.
 *
 * 🔴 이것이 없으면 `?q=%` 하나로 **Workspace 의 Issue 전체가 돌아온다.** 계약상 `q` 는
 * 「제목·경로·Pattern 을 훑는 낱말」이지 패턴이 아니다 — SQL Injection 은 아니지만
 * (값은 파라미터로 바인딩된다) 보낸 사람이 뜻하지 않은 결과를 받는다.
 *
 * PostgreSQL `LIKE` 의 기본 escape 문자가 백슬래시라, 백슬래시 자신을 먼저 두 배로 만든다.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

async function findActivities(
  executor: DbExecutor,
  workspaceId: string,
  issueId: string,
): Promise<AgentActivity[]> {
  const rows = await executor
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
        eq(issueActivities.reviewIssueId, issueId),
        eq(issueActivities.workspaceId, workspaceId),
      ),
    )
    .orderBy(asc(issueActivities.createdAt));

  // 🔴 Activity 마다 왕복하지 않는다 — 한 번에 읽어 메모리에서 묶는다.
  const evidenceRows = await executor
    .select({
      issueActivityId: issueCodeEvidences.issueActivityId,
      kind: issueCodeEvidences.kind,
      commitSha: issueCodeEvidences.commitSha,
      sourceState: issueCodeEvidences.sourceState,
      filePath: issueCodeEvidences.filePath,
      startLine: issueCodeEvidences.startLine,
      endLine: issueCodeEvidences.endLine,
      snapshot: issueCodeEvidences.snapshot,
      verification: issueCodeEvidences.verification,
    })
    .from(issueCodeEvidences)
    .where(
      and(
        eq(issueCodeEvidences.reviewIssueId, issueId),
        eq(issueCodeEvidences.workspaceId, workspaceId),
      ),
    )
    .orderBy(asc(issueCodeEvidences.createdAt));

  const byActivity = new Map<string, AgentEvidence[]>();
  for (const { issueActivityId, ...evidence } of evidenceRows) {
    if (issueActivityId === null) {
      continue;
    }
    const list = byActivity.get(issueActivityId) ?? [];
    list.push(evidence);
    byActivity.set(issueActivityId, list);
  }

  return rows.map((row) => ({
    ...row,
    evidence: byActivity.get(row.id) ?? [],
  }));
}
