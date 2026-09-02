import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  like,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { asCount, asDate } from "@/db/raw-value";
import {
  issueActivities,
  repositories,
  reviewIssues,
} from "@/db/schema";
import { findFrequentPatterns } from "@/features/issues/server/pattern-query";
import {
  ISSUE_SEVERITIES,
  OPEN_ISSUE_STATUSES,
  type IssueCategory,
  type IssueSeverity,
  type IssueStatus,
} from "@/types/review";

const PREFLIGHT_SECTION_LIMIT = 5;
const CANDIDATE_POOL_LIMIT = 200;
const RESOLUTION_EXCERPT_LENGTH = 500;
const RECENT_RECURRENCE_DAYS = 90;

/**
 * relevance 계산에 실제로 쓰는 경로 수.
 *
 * API 가 받아들이는 상한(`MAX_CHANGED_FILES_ACCEPTED`)보다 작다 — 경로가 늘수록 SQL 의
 * `IN` 목록과 directory `LIKE` 가 함께 늘어나는데, 그 앞쪽 몇십 개를 넘어서면 순위에
 * 주는 영향이 거의 없다.
 *
 * 🔴 **줄였다는 사실을 응답에 적는다.** 조용히 자르면 Agent 는 이 순위가 «바뀐 파일
 * 전부»를 보고 나온 것이라고 읽는다 — 후보에 없는 것을 「과거에 문제가 없던 파일」로
 * 오해하게 만드는 쪽이, 아무것도 못 주는 쪽보다 나쁘다.
 */
export const KNOWLEDGE_CHANGED_FILE_LIMIT = 100;

/** relevance 계산이 실제로 본 경로의 범위. */
export interface ChangedFileScope {
  /** 정규화·중복 제거 뒤 받은 경로 수. */
  total: number;
  /** 그중 순위 계산에 실제로 쓴 경로 수. */
  considered: number;
  /** `considered < total` 이면 이 순위는 부분 집합에서 나왔다. */
  truncated: boolean;
}

export const KNOWLEDGE_RELEVANCE_REASONS = [
  "SAME_FILE",
  "SAME_DIRECTORY",
  "REPEATED_PATTERN",
  "HIGH_SEVERITY",
  "RECENTLY_RECURRED",
  "UNRESOLVED",
  "RESOLVED_PRECEDENT",
] as const;

export type KnowledgeRelevanceReason =
  (typeof KNOWLEDGE_RELEVANCE_REASONS)[number];

export interface KnowledgeCandidate {
  issueId: string;
  title: string;
  status: IssueStatus;
  severity: IssueSeverity;
  category: IssueCategory;
  patternKey: string | null;
  filePath: string | null;
  repositoryFullName: string;
  resolutionSummary: string | null;
  encounters: number;
  lastEncounterAt: Date;
  relevanceReasons: KnowledgeRelevanceReason[];
}

export interface ReviewKnowledgePreflight {
  available: boolean;
  /** 🔴 이 순위가 무엇을 보고 나왔는가. 「전부 봤다」로 읽히지 않게 함께 보낸다. */
  changedFiles: ChangedFileScope;
  frequentPatterns: Awaited<ReturnType<typeof findFrequentPatterns>>;
  relevantPastIssues: KnowledgeCandidate[];
  unresolvedIssues: KnowledgeCandidate[];
  guidance: string[];
}

type CandidateRow = Omit<KnowledgeCandidate, "relevanceReasons">;

/**
 * Review 생성은 이미 성공했는데 Knowledge 보조 조회가 실패한 경우의 additive 응답.
 * 빈 배열을 정상 Knowledge로 오해하지 않도록 `available`을 분리한다.
 */
export function unavailableKnowledgePreflight(): ReviewKnowledgePreflight {
  return {
    available: false,
    changedFiles: { total: 0, considered: 0, truncated: false },
    frequentPatterns: [],
    relevantPastIssues: [],
    unresolvedIssues: [],
    guidance: [
      "Review는 생성됐지만 Knowledge preflight를 읽지 못했습니다. get_repository_knowledge를 다시 호출하세요.",
    ],
  };
}

export async function findReviewKnowledgePreflight(
  input: {
    workspaceId: string;
    repositoryId: string;
    changedFiles: readonly string[];
    now?: Date;
  },
  executor: DbExecutor = db(),
): Promise<ReviewKnowledgePreflight> {
  const received = normalizeChangedFiles(input.changedFiles);
  const changedFiles = received.slice(0, KNOWLEDGE_CHANGED_FILE_LIMIT);
  const changedFileScope: ChangedFileScope = {
    total: received.length,
    considered: changedFiles.length,
    truncated: changedFiles.length < received.length,
  };
  const [frequentPatterns, rows] = await Promise.all([
    findFrequentPatterns(
      {
        scope: { workspaceId: input.workspaceId },
        repositoryId: input.repositoryId,
        limit: PREFLIGHT_SECTION_LIMIT,
      },
      executor,
    ),
    findCandidateRows(
      {
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
        changedFiles,
      },
      executor,
    ),
  ]);

  const ranked = rankKnowledgeCandidates(
    rows,
    changedFiles,
    input.now ?? new Date(),
  );

  return {
    available: true,
    changedFiles: changedFileScope,
    frequentPatterns,
    relevantPastIssues: ranked
      .filter(
        (candidate) =>
          candidate.status === "RESOLVED" &&
          candidate.resolutionSummary !== null,
      )
      .slice(0, PREFLIGHT_SECTION_LIMIT),
    unresolvedIssues: ranked
      .filter((candidate) =>
        OPEN_ISSUE_STATUSES.includes(candidate.status),
      )
      .slice(0, PREFLIGHT_SECTION_LIMIT),
    guidance: [
      "후보의 과거 해결책은 historical precedent입니다. 현재 코드에 적용하기 전에 get_issue(issueId)로 전체 이력을 읽으세요.",
      "current HEAD·코드 구조·dependency/version·failure condition을 과거 Evidence commit과 비교하고, 조건이 다르면 해결책을 그대로 복사하지 마세요.",
      ...(changedFileScope.truncated
        ? [
            `바뀐 파일 ${changedFileScope.total}개 중 ${changedFileScope.considered}개만 relevance 계산에 썼습니다. 이 순위를 «바뀐 파일 전부»를 본 결과로 읽지 마세요.`,
          ]
        : []),
    ],
  };
}

async function findCandidateRows(
  input: {
    workspaceId: string;
    repositoryId: string;
    changedFiles: readonly string[];
  },
  executor: DbExecutor,
): Promise<CandidateRow[]> {
  const repeatedEncounters = sql<number>`count(${issueActivities.id}) filter (where ${issueActivities.type} = 'REVIEWED_AGAIN')::int`;
  const encounters = sql<number>`(1 + ${repeatedEncounters})::int`;
  const lastEncounterAt = sql<Date>`greatest(
    ${reviewIssues.firstDetectedAt},
    coalesce(
      max(${issueActivities.createdAt}) filter (where ${issueActivities.type} = 'REVIEWED_AGAIN'),
      ${reviewIssues.firstDetectedAt}
    )
  )`;
  const filePriority = buildFilePriority(input.changedFiles);
  const statusPriority = sql<number>`case when ${reviewIssues.status} in ('OPEN', 'IN_PROGRESS', 'REOPENED') then 0 else 1 end`;

  const rows = await executor
    .select({
      issueId: reviewIssues.id,
      title: reviewIssues.title,
      status: reviewIssues.status,
      severity: reviewIssues.severity,
      category: reviewIssues.category,
      patternKey: reviewIssues.patternKey,
      filePath: reviewIssues.filePath,
      repositoryFullName: repositories.fullName,
      resolutionSummary: reviewIssues.resolutionSummary,
      encounters,
      lastEncounterAt,
    })
    .from(reviewIssues)
    .innerJoin(
      repositories,
      and(
        eq(repositories.id, reviewIssues.repositoryId),
        eq(repositories.workspaceId, reviewIssues.workspaceId),
      ),
    )
    .leftJoin(
      issueActivities,
      and(
        eq(issueActivities.reviewIssueId, reviewIssues.id),
        eq(issueActivities.workspaceId, reviewIssues.workspaceId),
        // 🔴 `pattern-query.ts` 와 같은 이유다 — 결과는 그대로이고
        // `issue_activities_reviewed_again_idx`(partial)가 쓰일 수 있게 된다.
        eq(issueActivities.type, "REVIEWED_AGAIN"),
      ),
    )
    .where(
      and(
        eq(reviewIssues.workspaceId, input.workspaceId),
        eq(reviewIssues.repositoryId, input.repositoryId),
        inArray(reviewIssues.status, [...OPEN_ISSUE_STATUSES, "RESOLVED"]),
      ),
    )
    .groupBy(
      reviewIssues.id,
      reviewIssues.title,
      reviewIssues.status,
      reviewIssues.severity,
      reviewIssues.category,
      reviewIssues.patternKey,
      reviewIssues.filePath,
      reviewIssues.resolutionSummary,
      reviewIssues.firstDetectedAt,
      repositories.fullName,
    )
    .orderBy(
      desc(filePriority),
      asc(statusPriority),
      asc(reviewIssues.severity),
      desc(lastEncounterAt),
      asc(reviewIssues.id),
    )
    .limit(CANDIDATE_POOL_LIMIT);

  return rows.map((row) => ({
    ...row,
    resolutionSummary: compactResolution(row.resolutionSummary),
    encounters: asCount(row.encounters),
    lastEncounterAt: asDate(row.lastEncounterAt),
  }));
}

/**
 * 점수를 감추지 않는다. 같은 file/directory를 가장 먼저 두고, 그 안에서 unresolved,
 * severity, recurrence, 최근 encounter 순으로 비교하는 안정적인 tuple 정렬이다.
 */
export function rankKnowledgeCandidates(
  rows: readonly CandidateRow[],
  changedFiles: readonly string[],
  now: Date,
): KnowledgeCandidate[] {
  const normalized = normalizeChangedFiles(changedFiles);
  const withReasons = rows.map((row) => ({
    ...row,
    relevanceReasons: relevanceReasons(row, normalized, now),
  }));

  return withReasons.sort((left, right) => {
    const leftFile = fileRank(left.relevanceReasons);
    const rightFile = fileRank(right.relevanceReasons);
    if (leftFile !== rightFile) return rightFile - leftFile;

    const leftOpen = OPEN_ISSUE_STATUSES.includes(left.status) ? 1 : 0;
    const rightOpen = OPEN_ISSUE_STATUSES.includes(right.status) ? 1 : 0;
    if (leftOpen !== rightOpen) return rightOpen - leftOpen;

    const severity =
      ISSUE_SEVERITIES.indexOf(left.severity) -
      ISSUE_SEVERITIES.indexOf(right.severity);
    if (severity !== 0) return severity;

    if (left.encounters !== right.encounters) {
      return right.encounters - left.encounters;
    }
    const recency =
      right.lastEncounterAt.getTime() - left.lastEncounterAt.getTime();
    if (recency !== 0) return recency;
    return left.issueId.localeCompare(right.issueId);
  });
}

function relevanceReasons(
  row: CandidateRow,
  changedFiles: readonly string[],
  now: Date,
): KnowledgeRelevanceReason[] {
  const reasons: KnowledgeRelevanceReason[] = [];
  const path = normalizePath(row.filePath);
  if (path !== null && changedFiles.includes(path)) {
    reasons.push("SAME_FILE");
  } else if (path !== null) {
    const directory = directoryOf(path);
    if (
      directory !== "" &&
      changedFiles.some((changed) => directoryOf(changed) === directory)
    ) {
      reasons.push("SAME_DIRECTORY");
    }
  }
  if (row.patternKey !== null && row.encounters > 1) {
    reasons.push("REPEATED_PATTERN");
  }
  if (row.severity === "CRITICAL" || row.severity === "HIGH") {
    reasons.push("HIGH_SEVERITY");
  }
  const recentBoundary =
    now.getTime() - RECENT_RECURRENCE_DAYS * 24 * 60 * 60 * 1_000;
  if (
    row.encounters > 1 &&
    row.lastEncounterAt.getTime() >= recentBoundary
  ) {
    reasons.push("RECENTLY_RECURRED");
  }
  if (OPEN_ISSUE_STATUSES.includes(row.status)) {
    reasons.push("UNRESOLVED");
  }
  if (row.status === "RESOLVED" && row.resolutionSummary !== null) {
    reasons.push("RESOLVED_PRECEDENT");
  }
  return reasons;
}

function buildFilePriority(changedFiles: readonly string[]): SQL<number> {
  /**
   * 🔴 **`0` 이 아니라 `0::int` 다 — 여기서 실제로 터졌다.**
   *
   * 이 식은 `ORDER BY` 에 그대로 들어가는데, PostgreSQL 은 `ORDER BY` 의 «맨몸 정수
   * 리터럴»을 값이 아니라 **select list 의 순번**으로 읽는다. 바뀐 파일이 하나도 없으면
   * `ORDER BY 0 DESC` 가 나가고, 0 번 열은 없으므로
   * `42P10: ORDER BY position 0 is not in select list` 로 질의가 통째로 실패했다 —
   * 즉 **changedFiles 를 보내지 않는 모든 Review 에서 preflight 가 조용히 죽어**
   * `available: false` 만 돌아왔다. cast 를 붙이면 순번이 아니라 식이 된다.
   *
   * 🔴 단위·통합 시험이 늘 changedFiles 를 채워 넣어서 이 경로를 한 번도 밟지 않았다.
   * 실제 HTTP 왕복(`scripts/agent-api-e2e.sh` 3-b)과 서버 Log 가 함께 잡아냈다.
   */
  if (changedFiles.length === 0) return sql<number>`0::int`;
  const exact = inArray(reviewIssues.filePath, [...changedFiles]);
  const directoryConditions = [...new Set(changedFiles.map(directoryOf))]
    .filter((directory) => directory !== "")
    .map((directory) =>
      like(reviewIssues.filePath, `${escapeLike(directory)}/%`),
    );
  const sameDirectory = or(...directoryConditions);
  return sameDirectory === undefined
    ? sql<number>`case when ${exact} then 2 else 0 end`
    : sql<number>`case when ${exact} then 2 when ${sameDirectory} then 1 else 0 end`;
}

function normalizeChangedFiles(paths: readonly string[]): string[] {
  return [
    ...new Set(
      paths
        .map(normalizePath)
        .filter((path): path is string => path !== null),
    ),
  ].sort();
}

function normalizePath(path: string | null): string | null {
  if (path === null) return null;
  const normalized = path.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    normalized === "" ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    return null;
  }
  return normalized;
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function fileRank(reasons: readonly KnowledgeRelevanceReason[]): number {
  if (reasons.includes("SAME_FILE")) return 2;
  if (reasons.includes("SAME_DIRECTORY")) return 1;
  return 0;
}

function compactResolution(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length <= RESOLUTION_EXCERPT_LENGTH) return trimmed;
  return `${trimmed.slice(0, RESOLUTION_EXCERPT_LENGTH - 1)}…`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}
