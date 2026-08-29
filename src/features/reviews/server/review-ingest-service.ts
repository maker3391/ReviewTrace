import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  issueActivities,
  issueTags,
  reviewIssues,
  reviewSessions,
  tags,
} from "@/db/schema";
import type {
  ReviewIngestInput,
  ReviewIssueInput,
} from "@/features/reviews/schemas/review-ingest";
import { insertCodeEvidence } from "@/features/issues/server/code-evidence-service";
import { resolveIngestProject } from "@/features/projects/server/project-service";
import { resolveIngestRepository } from "@/features/repositories/server/repository-upsert";
import {
  normalizeTagList,
  type NormalizedTag,
} from "@/features/reviews/utils/tag-name";
import { AppError } from "@/lib/errors";
import type {
  IssueCategory,
  IssueSeverity,
  IssueStatus,
  ReviewerType,
} from "@/types/review";

/**
 * Agent Review 저장(스펙 30).
 *
 * ```
 * Repository Upsert -> [Idempotency 확인] -> ReviewSession INSERT
 *   -> ReviewIssue Batch INSERT -> Tag 조회/생성 -> IssueTag Batch INSERT
 *   -> Activity Batch INSERT -> Commit
 * ```
 *
 * 🔴 **하나의 Transaction 이다.** 중간에 실패하면 ReviewSession 도 남지 않는다 —
 * Issue 없는 Session, Session 없는 Issue 같은 반쪽 상태를 만들지 않는다.
 *
 * 🔴 **Issue 개수만큼 Round Trip 을 만들지 않는다.** Issue 가 1개든 500개든 문장 수는 같다.
 *
 * ## Idempotency — 왜 `Idempotency-Key` 인가
 *
 * 스펙 31 은 `Idempotency-Key` 와 `source + externalId` 중 하나를 고르라고 한다.
 * **둘 다 쓰되 맡는 일이 다르다.**
 *
 * | | 무엇의 동일성인가 | 무엇을 막는가 |
 * |---|---|---|
 * | `Idempotency-Key` | **요청** 하나 | 재전송이 ReviewSession 을 늘리는 것 |
 * | `source + externalId` | **Issue** 하나 | 같은 문제가 매 Review 마다 새 행이 되는 것 |
 * |
 *
 * 스펙 31 이 말하는 문제는 「동일 Request 가 ReviewSession 을 무한 생성」이다. 그것은
 * **요청의 동일성**이고, `source + externalId` 로는 답할 수 없다 — 그것은 Issue 의 신원이라
 * Issue 를 하나도 담지 않은 Review(깨끗한 Commit)나 `summary` 같은 Session 값에는 아무 말도
 * 못 한다. 반대로 「같은 문제가 매번 새 행이 되는 것」은 Session 열쇠로 막을 수 없다.
 *
 * 그래서 **Session 은 `Idempotency-Key`, Issue 는 `source + externalId`** 로 나눴다.
 * 열쇠는 `review_sessions.idempotency_key` 한 Column 이고 Unique 는 Repository 안에서다 —
 * **별도의 Idempotency 표·응답 Cache·TTL 을 만들지 않는다**(스펙 31 · CLAUDE.md 18).
 *
 * 헤더를 보내지 않으면 Dedup 하지 않는다. 「같은 Commit 을 두 번 Review 했다」는 정상이고,
 * 우리가 마음대로 접으면 두 번째 Review 의 결과가 사라진다.
 */

export interface IngestedIssue {
  id: string;
  title: string;
  severity: IssueSeverity;
  category: IssueCategory;
  status: IssueStatus;
  /** 이미 알고 있던 Issue 인가. `source + externalId` 로 같은 행을 다시 찾은 경우다. */
  alreadyKnown: boolean;
}

export interface IngestedReview {
  repositoryId: string;
  reviewSessionId: string;
  issues: IngestedIssue[];
  /** 같은 `Idempotency-Key` 가 이미 저장돼 아무것도 새로 쓰지 않았다. */
  idempotentReplay: boolean;
  /**
   * 방금 넣은 Code Evidence 의 id.
   *
   * 🔴 **GitHub 확인은 Transaction 이 끝난 뒤에 한다**(`code-evidence-service.ts`).
   * Network 왕복을 Transaction 안에 넣으면 그동안 행 잠금이 잡혀, 같은 Repository 로
   * 들어오는 다른 Review 가 줄을 선다. 그래서 「무엇을 확인해야 하는지」만 밖으로 넘긴다.
   */
  evidenceIds: string[];
}

export interface IngestReviewInput {
  /** 🔴 API Key 가 정한 값이다. Payload 에서 오지 않는다(스펙 19). */
  workspaceId: string;
  idempotencyKey: string | null;
  payload: ReviewIngestInput;
}

interface PreparedIssue {
  /**
   * 미리 만든 행 ID.
   *
   * 🔴 Batch INSERT 의 결과를 입력과 다시 맞추기 위한 것이다. Database 가 ID 를 만들면
   * `RETURNING` 이 돌려주는 순서가 입력 순서라는 보장이 없고, 충돌로 빠진 행은 아예
   * 돌아오지 않아 **무엇이 들어갔는지 알 수 없다.**
   */
  localId: string;
  /** 정규화·Dedup 을 통과한 입력 그대로. 순서가 아니라 값으로 들고 다닌다. */
  input: ReviewIssueInput;
  source: string | null;
  externalId: string | null;
  tags: NormalizedTag[];
}

export async function ingestReview(
  input: IngestReviewInput,
  executor: DbExecutor = db(),
): Promise<IngestedReview> {
  const { workspaceId, idempotencyKey, payload } = input;

  return executor.transaction(async (tx) => {
    /**
     * 0. Project 확인 / 생성.
     *
     * 🔴 Repository 보다 «먼저» 한다 — Repository 가 Project 에 속하기 때문이다(스펙 1).
     * Transaction 안에서 돌므로, 뒤가 실패하면 여기서 만든 Project 도 남지 않는다.
     */
    const projectId = await resolveIngestProject(
      { workspaceId, project: payload.project },
      tx,
    );

    // 1. Repository 확인 / Upsert(`repository-upsert.ts`).
    //    이름은 GitHub 에서 바뀐다 — 매 Review 마다 최신 표기로 맞춘다.
    const repositoryId = await resolveIngestRepository(
      tx,
      workspaceId,
      projectId,
      payload.repository,
    );

    // 2. 같은 요청을 이미 저장했는가.
    if (idempotencyKey !== null) {
      const replay = await findSessionByIdempotencyKey(
        tx,
        workspaceId,
        repositoryId,
        idempotencyKey,
      );
      if (replay !== null) {
        return replay;
      }
    }

    // 3. ReviewSession.
    //    🔴 `onConflictDoNothing` 이다 — 같은 Key 두 요청이 동시에 여기 닿으면 진 쪽은
    //    예외로 Transaction 을 깨는 대신 「이미 있다」로 받아 아래에서 다시 읽는다.
    const sessionRows = await tx
      .insert(reviewSessions)
      .values({
        workspaceId,
        repositoryId,
        targetType: payload.target.type,
        branch: payload.target.branch,
        commitSha: payload.target.commitSha,
        pullRequestNumber: payload.target.pullRequestNumber,
        reviewerType: payload.reviewer.type,
        reviewerName: payload.reviewer.name,
        reviewerVersion: payload.reviewer.version,
        summary: payload.summary,
        idempotencyKey,
        /**
         * 검증을 통과한 Payload 를 남긴다.
         *
         * 받은 본문 그대로가 아니다 — 우리가 모르는 Key 까지 담으면 크기에 상한이 없고,
         * Agent 가 실수로 넣은 값(Token 등)을 우리가 대신 보관하게 된다(CLAUDE.md 19).
         */
        rawPayload: payload,
        startedAt: payload.startedAt ?? undefined,
        completedAt: payload.completedAt,
      })
      .onConflictDoNothing({
        target: [reviewSessions.repositoryId, reviewSessions.idempotencyKey],
      })
      .returning({ id: reviewSessions.id });

    const reviewSessionId = sessionRows[0]?.id;
    if (reviewSessionId === undefined) {
      // 경쟁에서 졌다. 이긴 쪽이 저장한 것을 그대로 돌려준다.
      const replay =
        idempotencyKey === null
          ? null
          : await findSessionByIdempotencyKey(
              tx,
              workspaceId,
              repositoryId,
              idempotencyKey,
            );

      if (replay === null) {
        throw new AppError("INTERNAL_ERROR");
      }
      return replay;
    }

    // 4~8. Issue · Tag · Activity · Evidence.
    const inserted = await insertSessionIssues(tx, {
      workspaceId,
      repositoryId,
      reviewSessionId,
      context: {
        reviewerType: payload.reviewer.type,
        reviewerName: payload.reviewer.name,
        summary: payload.summary,
        commitSha: payload.target.commitSha,
      },
      issues: payload.issues,
    });

    return {
      repositoryId,
      reviewSessionId,
      idempotentReplay: false,
      ...inserted,
    };
  });
}

/**
 * 이미 있는 ReviewSession 에 Issue 를 붙인다(스펙 5 — MCP `add_issue`).
 *
 * ## 🔴 왜 이것을 따로 뽑았는가
 *
 * Agent 는 문제를 **한 번에 다 알지 못한다.** Review 를 시작하고, 읽으면서 하나씩
 * 찾는다 — MCP 의 `create_review` -> `add_issue` -> `add_issue` 가 그 모양이다.
 * 그런데 `add_issue` 마다 새 ReviewSession 을 만들면 **한 번의 Review 가 세션 열 개로
 * 흩어져** 「이 Commit 을 한 번 봤다」가 사라진다.
 *
 * 그래서 REST 에 세션에 덧붙이는 자리를 만들고, 한 번에 다 보내는 길(`ingestReview`)과
 * 하나씩 붙이는 길(`appendReviewIssues`)이 **같은 이 함수**를 지난다 —
 * 두 통로가 서로 다른 규칙을 갖게 만들지 않는다(스펙 1).
 */
interface SessionIssueContext {
  reviewerType: ReviewerType;
  reviewerName: string;
  summary: string | null;
  commitSha: string | null;
}

async function insertSessionIssues(
  tx: DbExecutor,
  args: {
    workspaceId: string;
    repositoryId: string;
    reviewSessionId: string;
    context: SessionIssueContext;
    issues: readonly ReviewIssueInput[];
  },
): Promise<{ issues: IngestedIssue[]; evidenceIds: string[] }> {
  const { workspaceId, repositoryId, reviewSessionId, context } = args;

  {
    const prepared = prepareIssues(args.issues);

  if (prepared.length === 0) {
    return { issues: [], evidenceIds: [] };
  }

  const insertedRows = await tx
    .insert(reviewIssues)
    .values(
      prepared.map((item) => ({
        id: item.localId,
        workspaceId,
        repositoryId,
        reviewSessionId,
        title: item.input.title,
        description: item.input.description,
        rootCause: item.input.rootCause,
        failurePath: item.input.failurePath,
        severity: item.input.severity,
        category: item.input.category,
        patternKey: item.input.patternKey,
        filePath: item.input.filePath,
        startLine: item.input.startLine,
        endLine: item.input.endLine,
        suggestion: item.input.suggestion,
        source: item.input.source,
        externalId: item.input.externalId,
      })),
    )
    /**
     * 🔴 같은 `source + externalId` 를 다시 보고해도 **행을 새로 만들지 않는다.**
     * 행이 하나로 유지돼야 IssueActivity 가 한 줄기 History 로 쌓인다(CLAUDE.md 2).
     */
    .onConflictDoNothing({
      target: [reviewIssues.repositoryId, reviewIssues.source, reviewIssues.externalId],
    })
    .returning({ id: reviewIssues.id });

  const insertedIds = new Set(insertedRows.map((row) => row.id));

  const created = prepared.filter((item) => insertedIds.has(item.localId));
  const alreadyKnown = prepared.filter((item) => !insertedIds.has(item.localId));

  // 5. 이미 있던 Issue 의 실제 행을 찾는다. Dedup 을 통과하지 못한 것은
  //    `source`·`externalId` 가 둘 다 있는 것뿐이라 한 번의 조회로 끝난다.
  const knownByKey = await findExistingIssues(
    tx,
    workspaceId,
    repositoryId,
    alreadyKnown,
  );

  const resolved: {
    issue: PreparedIssue;
    id: string;
    alreadyKnown: boolean;
    view: Omit<IngestedIssue, "id" | "alreadyKnown">;
  }[] = created.map((issue) => ({
    issue,
    id: issue.localId,
    alreadyKnown: false,
    view: {
      title: issue.input.title,
      severity: issue.input.severity,
      category: issue.input.category,
      // 새로 만든 행의 상태는 Column 기본값이다.
      status: "OPEN" as IssueStatus,
    },
  }));

  for (const issue of alreadyKnown) {
    const existing = knownByKey.get(externalKeyOf(issue));
    if (existing !== undefined) {
      // 🔴 이미 있던 행은 **저장된 값**을 돌려준다. 방금 받은 Payload 로 덮어 쓰면
      // 「RESOLVED 인데 응답은 OPEN」 같은 거짓말이 나간다.
      resolved.push({
        issue,
        id: existing.id,
        alreadyKnown: true,
        view: {
          title: existing.title,
          severity: existing.severity,
          category: existing.category,
          status: existing.status,
        },
      });
    }
  }

  // 6. Tag 조회 / 생성 -> IssueTag Batch INSERT.
  await linkTags(tx, workspaceId, resolved);

  // 7. Activity Batch INSERT.
  //    새로 안 것은 DETECTED, 다시 만난 것은 REVIEWED_AGAIN 이다 —
  //    「이번 Review 도 이 문제를 봤다」가 History 에 남아야 반복 여부를 셀 수 있다.
  const activityIds = new Map<string, string>();
  const activityRows = await tx
    .insert(issueActivities)
    .values(
      resolved.map((entry) => ({
        workspaceId,
        reviewIssueId: entry.id,
        type: entry.alreadyKnown ? ("REVIEWED_AGAIN" as const) : ("DETECTED" as const),
        actorType: context.reviewerType,
        actorName: context.reviewerName,
        description: context.summary,
        commitSha: context.commitSha,
        /**
         * 🔴 판단은 **Issue 가 아니라 이 행위에** 붙는다(스펙 4).
         * 같은 Issue 를 나중에 다시 고치면 그때의 판단이 따로 남아야 하기 때문이다 —
         * Issue 에 두면 두 번째 시도가 첫 번째 시도의 판단을 덮어쓴다.
         */
        ...(entry.issue.input.decision ?? {}),
      })),
    )
    .returning({
      id: issueActivities.id,
      reviewIssueId: issueActivities.reviewIssueId,
    });

  for (const row of activityRows) {
    activityIds.set(row.reviewIssueId, row.id);
  }

  /**
   * 8. Code Evidence Batch INSERT — 근거는 Issue 가 갖고, 출처는 방금 만든 행위다.
   *
   * 🔴 **Issue 마다 왕복하지 않는다**(CLAUDE.md 10). Issue 500개짜리 Review 를 받으면
   * 그 방식은 Transaction 안에서 INSERT 를 500번 돌려, 이 함수가 약속한 「고정된 문장 수」를
   * 깬다. 모든 근거를 한 배열로 모아 **한 문장**으로 넣는다.
   */
  const evidenceIds = await insertCodeEvidence(
    tx,
    workspaceId,
    resolved.flatMap((entry) =>
      entry.issue.input.evidence.map((evidence) => ({
        reviewIssueId: entry.id,
        issueActivityId: activityIds.get(entry.id) ?? null,
        evidence,
      })),
    ),
  );

    return {
      issues: resolved.map((entry) => ({
        id: entry.id,
        ...entry.view,
        alreadyKnown: entry.alreadyKnown,
      })),
      evidenceIds,
    };
  }
}

/** `source + externalId` 둘 다 있을 때만 Issue 의 신원이 된다. 하나만으로는 특정되지 않는다. */
function externalKeyOf(issue: {
  source: string | null;
  externalId: string | null;
}): string {
  return `${issue.source ?? ""} ${issue.externalId ?? ""}`;
}

/**
 * 같은 요청 안의 중복을 먼저 접는다.
 *
 * 한 Payload 가 같은 `source + externalId` 를 두 번 담아 오면 Database 에 맡기기 전에
 * 여기서 하나로 만든다 — 무엇이 남았는지 우리가 알아야 Tag·Activity 를 붙일 수 있다.
 */
function prepareIssues(issues: readonly ReviewIssueInput[]): PreparedIssue[] {
  const seen = new Set<string>();
  const prepared: PreparedIssue[] = [];

  for (const issue of issues) {
    if (issue.source !== null && issue.externalId !== null) {
      const key = externalKeyOf(issue);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }

    prepared.push({
      localId: randomUUID(),
      input: issue,
      source: issue.source,
      externalId: issue.externalId,
      tags: normalizeTagList(issue.tags),
    });
  }

  return prepared;
}

interface ExistingIssueRow {
  id: string;
  source: string | null;
  externalId: string | null;
  title: string;
  severity: IssueSeverity;
  category: IssueCategory;
  status: IssueStatus;
}

async function findExistingIssues(
  tx: DbExecutor,
  workspaceId: string,
  repositoryId: string,
  candidates: readonly PreparedIssue[],
): Promise<Map<string, ExistingIssueRow>> {
  const found = new Map<string, ExistingIssueRow>();
  const externalIds = candidates
    .map((item) => item.externalId)
    .filter((value): value is string => value !== null);

  if (externalIds.length === 0) {
    return found;
  }

  const rows = await tx
    .select({
      id: reviewIssues.id,
      source: reviewIssues.source,
      externalId: reviewIssues.externalId,
      title: reviewIssues.title,
      severity: reviewIssues.severity,
      category: reviewIssues.category,
      status: reviewIssues.status,
    })
    .from(reviewIssues)
    .where(
      and(
        /*
          🔴 Workspace 와 Repository 를 «겹쳐서» 건다(CLAUDE.md 10).

          `repositoryId` 만으로도 지금은 맞는다 — 그 값은 바로 위 Upsert 가
          `(workspaceId, provider, externalRepositoryId)` 로 얻은 것이라 이 Key 의 Workspace
          안에 있다. 하지만 그것은 **다른 함수의 동작에 기대는 안전**이라 그 함수를 고치면
          여기서는 아무 신호도 나지 않는다. `review_issues.review_session_id` 는 단일 Column
          FK 라 Database 도 「Issue 와 Repository 의 Workspace 가 같다」를 강제하지 않는다.

          겹쳐 두면 어느 한쪽을 틀려도 결과가 비어서 돌아온다. 이 조회는 **Issue 제목·상태를
          그대로 돌려주므로** 틀렸을 때 새는 것이 숫자가 아니라 내용이다.
        */
        eq(reviewIssues.workspaceId, workspaceId),
        eq(reviewIssues.repositoryId, repositoryId),
        inArray(reviewIssues.externalId, externalIds),
      ),
    );

  for (const row of rows) {
    found.set(externalKeyOf(row), row);
  }

  return found;
}

async function linkTags(
  tx: DbExecutor,
  workspaceId: string,
  resolved: readonly { issue: PreparedIssue; id: string }[],
): Promise<void> {
  const byNormalized = new Map<string, NormalizedTag>();
  for (const entry of resolved) {
    for (const tag of entry.issue.tags) {
      if (!byNormalized.has(tag.normalizedName)) {
        byNormalized.set(tag.normalizedName, tag);
      }
    }
  }

  if (byNormalized.size === 0) {
    return;
  }

  const unique = [...byNormalized.values()];

  // 없는 것만 만든다. 있는 것의 표시용 이름은 덮어쓰지 않는다 — 먼저 붙인 표기를 유지한다.
  await tx
    .insert(tags)
    .values(
      unique.map((tag) => ({
        workspaceId,
        name: tag.name,
        normalizedName: tag.normalizedName,
      })),
    )
    .onConflictDoNothing({ target: [tags.workspaceId, tags.normalizedName] });

  const tagRows = await tx
    .select({ id: tags.id, normalizedName: tags.normalizedName })
    .from(tags)
    .where(
      and(
        eq(tags.workspaceId, workspaceId),
        inArray(
          tags.normalizedName,
          unique.map((tag) => tag.normalizedName),
        ),
      ),
    );

  const idByNormalized = new Map(
    tagRows.map((row) => [row.normalizedName, row.id]),
  );

  const links: { reviewIssueId: string; tagId: string }[] = [];
  for (const entry of resolved) {
    for (const tag of entry.issue.tags) {
      const tagId = idByNormalized.get(tag.normalizedName);
      if (tagId !== undefined) {
        links.push({ reviewIssueId: entry.id, tagId });
      }
    }
  }

  if (links.length === 0) {
    return;
  }

  // 이미 알던 Issue 에 같은 Tag 가 다시 오면 PK 가 막는다.
  await tx.insert(issueTags).values(links).onConflictDoNothing();
}

async function findSessionByIdempotencyKey(
  tx: DbExecutor,
  workspaceId: string,
  repositoryId: string,
  idempotencyKey: string,
): Promise<IngestedReview | null> {
  const rows = await tx
    .select({ id: reviewSessions.id })
    .from(reviewSessions)
    .where(
      and(
        // 🔴 Workspace 를 겹쳐 건다 — 아래 Issue 조회가 이 `session.id` 를 그대로 쓴다.
        eq(reviewSessions.workspaceId, workspaceId),
        eq(reviewSessions.repositoryId, repositoryId),
        eq(reviewSessions.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  const session = rows[0];
  if (session === undefined) {
    return null;
  }

  const issues = await tx
    .select({
      id: reviewIssues.id,
      title: reviewIssues.title,
      severity: reviewIssues.severity,
      category: reviewIssues.category,
      status: reviewIssues.status,
    })
    .from(reviewIssues)
    .where(
      and(
        /*
          🔴 재전송 응답은 **Issue 제목·심각도·상태를 그대로 되돌려 준다.**
          `reviewSessionId` 하나로 좁히면 「그 Session 이 이 Key 의 것이다」에만 기대는
          셈인데, 그 보증은 위 조회가 갖고 있고 이 문장은 갖고 있지 않다.
          두 문장에 나뉜 조건은 한쪽만 고쳐질 수 있다 — 그래서 여기에도 함께 건다.
        */
        eq(reviewIssues.workspaceId, workspaceId),
        eq(reviewIssues.reviewSessionId, session.id),
      ),
    );

  return {
    repositoryId,
    reviewSessionId: session.id,
    issues: issues.map((issue) => ({ ...issue, alreadyKnown: true })),
    idempotentReplay: true,
    // 재전송은 아무것도 새로 쓰지 않았다 — 확인할 새 근거도 없다.
    evidenceIds: [],
  };
}

/**
 * 이미 있는 ReviewSession 에 Issue 를 덧붙인다(스펙 5 — `add_issue`).
 *
 * 🔴 **Session 이 이 Workspace 것인지 먼저 확인한다.** 남의 Session id 를 넣으면
 * `FORBIDDEN` 이 아니라 **`NOT_FOUND`** 다 — 구분해 주면 그것만으로 그 id 가
 * 존재한다는 사실이 새어 나간다(스펙 15).
 *
 * 🔴 **Reviewer 를 다시 받지 않는다.** 그것은 Session 이 이미 정한 값이다 —
 * 매번 받으면 한 Review 안에서 행위자가 갈라진다.
 */
export interface AppendedIssues {
  reviewSessionId: string;
  issues: IngestedIssue[];
  evidenceIds: string[];
}

export async function appendReviewIssues(
  input: {
    /** 🔴 API Key 가 정한 값이다. Payload 에서 오지 않는다(스펙 19). */
    workspaceId: string;
    reviewSessionId: string;
    issues: readonly ReviewIssueInput[];
  },
  executor: DbExecutor = db(),
): Promise<AppendedIssues> {
  return executor.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: reviewSessions.id,
        repositoryId: reviewSessions.repositoryId,
        reviewerType: reviewSessions.reviewerType,
        reviewerName: reviewSessions.reviewerName,
        summary: reviewSessions.summary,
        commitSha: reviewSessions.commitSha,
      })
      .from(reviewSessions)
      .where(
        and(
          eq(reviewSessions.id, input.reviewSessionId),
          eq(reviewSessions.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);

    const session = rows[0];
    if (session === undefined) {
      throw new AppError("NOT_FOUND");
    }

    const inserted = await insertSessionIssues(tx, {
      workspaceId: input.workspaceId,
      repositoryId: session.repositoryId,
      reviewSessionId: session.id,
      context: {
        reviewerType: session.reviewerType,
        reviewerName: session.reviewerName,
        summary: session.summary,
        commitSha: session.commitSha,
      },
      issues: input.issues,
    });

    return { reviewSessionId: session.id, ...inserted };
  });
}
