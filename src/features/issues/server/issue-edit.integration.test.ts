import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db, type DbExecutor } from "@/db";
import {
  issueActivities,
  issueCodeEvidences,
  issueTags,
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
  tags,
  users,
} from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import { updateIssueContent } from "@/features/issues/server/issue-edit-service";
import { isAppError } from "@/lib/errors";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

/**
 * 실제 PostgreSQL 을 쓰는 시험 — **서술 수정이 무엇을 바꾸고 무엇을 그대로 두는가**.
 *
 * # 🔴 이 파일은 기본 `pnpm test` 에서 «돌지 않는다»
 *
 * ```bash
 * pnpm test # 이 파일 전체를 건너뛴다
 * DB_INTEGRATION=true pnpm test # PostgreSQL 이 떠 있고 DATABASE_URL 이 있어야 한다
 * ```
 *
 * # 왜 단위 시험만으로는 부족한가
 *
 * `issue-edit-service.test.ts` 는 **만들어진 문장**을 본다 — 조건이 실려 나갔다는 것까지다.
 * 「그 조건으로 PostgreSQL 이 실제로 남의 행을 걸러 내는가」와 「`.set()` 에 없는 Column 이
 * 정말로 그대로 남는가」는 진짜 Database 만 답할 수 있다. Activity·Evidence·Tag 가
 * 보존되는 것도 마찬가지다 — 그것들은 `review_issues` 의 자식이라
 * `ON DELETE CASCADE` 로 묶여 있어, 이 기능이 행을 지우는 방향으로 잘못 구현되면
 * 조용히 함께 사라진다.
 *
 * 🔴 **데이터를 남기지 않는다.** 모든 시험이 자기 Transaction 안에서 돌고 끝에서 되돌린다.
 */
const enabled = process.env.DB_INTEGRATION === "true";

beforeAll(() => {
  if (enabled) {
    loadIntegrationDbEnv();
  }
});

/** 시험 하나를 되돌리기 위한 표식. 실제 실패와 구분하려고 전용 타입을 쓴다. */
class Rollback extends Error {}

async function inRollback(
  run: (tx: DbExecutor) => Promise<void>,
): Promise<void> {
  try {
    await db().transaction(async (tx) => {
      await run(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) {
      throw error;
    }
  }
}

let seq = 0;
function unique(prefix: string): string {
  seq += 1;
  return `isedit-${prefix}${Date.now().toString(36)}${seq}`;
}

const COMMIT = "a81f3c2";

/**
 * 저장되는 Markdown 원문.
 *
 * 🔴 **문단·목록·코드블록·표가 그대로 왕복해야 한다.** plain text 로 접히면 Agent 가
 * 다시 읽어 갈 Knowledge 가 형태를 잃는다.
 */
const MARKDOWN = [
  "`RefreshTokenService.java` 의 rotation 이 경쟁한다.",
  "",
  "1. 두 요청이 같은 token 을 읽는다",
  "2. 둘 다 새 token 을 쓴다",
  "",
  "```java",
  "  if (token.isUsed()) {",
  "      throw new IllegalStateException();",
  "  }",
  "```",
  "",
  "| 조건 | 결과 |",
  "|---|---|",
  "| 순차 | 정상 |",
  "| 동시 | 유실 |",
].join("\n");

const EDIT = {
  title: "Refresh token rotation 경쟁 조건",
  description: MARKDOWN,
  rootCause: "읽기와 쓰기 사이가 잠기지 않는다.",
  failurePath: null,
  suggestion: null,
};

interface Fixture {
  workspaceId: string;
  projectId: string;
  otherProjectId: string;
  issueId: string;
  activityId: string;
  evidenceId: string;
  tagId: string;
}

/**
 * Workspace -> Project 둘 -> Repository -> Session -> Issue 한 벌.
 *
 * Issue 에는 Activity · Code Evidence · Tag 를 하나씩 달아 둔다 — 수정 뒤에도
 * 그것들이 그대로 있는지 세기 위해서다.
 */
async function seed(tx: DbExecutor): Promise<Fixture> {
  const created = await tx
    .insert(users)
    .values({ email: `${unique("u")}@example.test`, name: "isedit" })
    .returning({ id: users.id });

  const userId = created[0]?.id;
  if (userId === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }

  const workspaceId = await ensurePersonalWorkspace(
    { userId, displayName: "isedit", slugSource: unique("ws-") },
    tx,
  );

  const projectRows = await tx
    .insert(projects)
    .values([
      { workspaceId, name: "isedit", slug: unique("p-") },
      { workspaceId, name: "isedit-other", slug: unique("p-") },
    ])
    .returning({ id: projects.id });

  const projectId = projectRows[0]?.id;
  const otherProjectId = projectRows[1]?.id;
  if (projectId === undefined || otherProjectId === undefined) {
    throw new Error("시험용 Project 를 만들지 못했다");
  }

  const name = unique("repo-");
  const repositoryRows = await tx
    .insert(repositories)
    .values({
      workspaceId,
      projectId,
      provider: "GITHUB",
      externalRepositoryId: unique("ext-"),
      owner: "acme",
      name,
      fullName: `acme/${name}`,
    })
    .returning({ id: repositories.id });
  const repositoryId = repositoryRows[0]?.id;
  if (repositoryId === undefined) {
    throw new Error("시험용 Repository 를 만들지 못했다");
  }

  const sessionRows = await tx
    .insert(reviewSessions)
    .values({
      workspaceId,
      repositoryId,
      targetType: "COMMIT",
      commitSha: COMMIT,
      reviewerType: "AGENT",
      reviewerName: "codex",
    })
    .returning({ id: reviewSessions.id });
  const reviewSessionId = sessionRows[0]?.id;
  if (reviewSessionId === undefined) {
    throw new Error("시험용 ReviewSession 을 만들지 못했다");
  }

  const issueRows = await tx
    .insert(reviewIssues)
    .values({
      workspaceId,
      repositoryId,
      reviewSessionId,
      title: "처음 제목",
      description: "처음 설명",
      severity: "HIGH",
      category: "CONCURRENCY",
      patternKey: "REFRESH_TOKEN_RACE_CONDITION",
      filePath: "src/auth/refresh.ts",
      startLine: 82,
      endLine: 90,
      source: "codex",
      externalId: "codex-1",
    })
    .returning({ id: reviewIssues.id });
  const issueId = issueRows[0]?.id;
  if (issueId === undefined) {
    throw new Error("시험용 ReviewIssue 를 만들지 못했다");
  }

  const activityRows = await tx
    .insert(issueActivities)
    .values({
      workspaceId,
      reviewIssueId: issueId,
      type: "DETECTED",
      actorType: "AGENT",
      actorName: "codex",
      description: "처음 발견했다",
      solution: "잠금을 건다",
    })
    .returning({ id: issueActivities.id });
  const activityId = activityRows[0]?.id;
  if (activityId === undefined) {
    throw new Error("시험용 IssueActivity 를 만들지 못했다");
  }

  const evidenceRows = await tx
    .insert(issueCodeEvidences)
    .values({
      workspaceId,
      reviewIssueId: issueId,
      issueActivityId: activityId,
      kind: "BEFORE",
      commitSha: COMMIT,
      filePath: "src/auth/refresh.ts",
      startLine: 82,
      endLine: 82,
      snapshot: "const token = await read(id);",
    })
    .returning({ id: issueCodeEvidences.id });
  const evidenceId = evidenceRows[0]?.id;
  if (evidenceId === undefined) {
    throw new Error("시험용 Code Evidence 를 만들지 못했다");
  }

  const tagRows = await tx
    .insert(tags)
    .values({
      workspaceId,
      name: "race-condition",
      normalizedName: unique("t-"),
    })
    .returning({ id: tags.id });
  const tagId = tagRows[0]?.id;
  if (tagId === undefined) {
    throw new Error("시험용 Tag 를 만들지 못했다");
  }
  await tx.insert(issueTags).values({ reviewIssueId: issueId, tagId });

  return {
    workspaceId,
    projectId,
    otherProjectId,
    issueId,
    activityId,
    evidenceId,
    tagId,
  };
}

async function readIssue(tx: DbExecutor, issueId: string) {
  const rows = await tx
    .select()
    .from(reviewIssues)
    .where(eq(reviewIssues.id, issueId))
    .limit(1);

  const issue = rows[0];
  if (issue === undefined) {
    throw new Error("Issue 가 사라졌다");
  }
  return issue;
}

/** Issue 에 매달린 것들이 그대로 있는지. 🔴 수정이 History 를 건드리면 여기가 빨개진다. */
async function readChildren(tx: DbExecutor, issueId: string) {
  const [activityRows, evidenceRows, tagRows] = await Promise.all([
    tx
      .select({
        id: issueActivities.id,
        type: issueActivities.type,
        description: issueActivities.description,
        solution: issueActivities.solution,
      })
      .from(issueActivities)
      .where(eq(issueActivities.reviewIssueId, issueId)),
    tx
      .select({
        id: issueCodeEvidences.id,
        snapshot: issueCodeEvidences.snapshot,
        commitSha: issueCodeEvidences.commitSha,
      })
      .from(issueCodeEvidences)
      .where(eq(issueCodeEvidences.reviewIssueId, issueId)),
    tx
      .select({ tagId: issueTags.tagId })
      .from(issueTags)
      .where(eq(issueTags.reviewIssueId, issueId)),
  ]);

  return { activityRows, evidenceRows, tagRows };
}

describe.skipIf(!enabled)("서술 수정 — 실제 PostgreSQL", () => {
  it("서술 다섯 칸이 저장되고 Markdown 원문이 문자 단위로 왕복한다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);

      await updateIssueContent(
        {
          scope: {
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
          },
          issueId: fixture.issueId,
          update: EDIT,
        },
        tx,
      );

      const issue = await readIssue(tx, fixture.issueId);

      expect(issue.title).toBe(EDIT.title);
      // 🔴 plain text 로 접히면 여기가 빨개진다.
      expect(issue.description).toBe(MARKDOWN);
      expect(issue.rootCause).toBe(EDIT.rootCause);
      expect(issue.failurePath).toBeNull();
      expect(issue.suggestion).toBeNull();
    });
  });

  it("🔴 상태·집계 축·신원·provenance 를 그대로 둔다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);
      const before = await readIssue(tx, fixture.issueId);

      await updateIssueContent(
        {
          scope: {
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
          },
          issueId: fixture.issueId,
          update: EDIT,
        },
        tx,
      );

      const after = await readIssue(tx, fixture.issueId);

      expect(after.status).toBe(before.status);
      expect(after.resolvedAt).toEqual(before.resolvedAt);
      expect(after.resolutionSummary).toEqual(before.resolutionSummary);
      expect(after.severity).toBe(before.severity);
      expect(after.category).toBe(before.category);
      expect(after.patternKey).toBe(before.patternKey);
      expect(after.filePath).toBe(before.filePath);
      expect(after.startLine).toBe(before.startLine);
      expect(after.endLine).toBe(before.endLine);
      expect(after.source).toBe(before.source);
      expect(after.externalId).toBe(before.externalId);
      expect(after.repositoryId).toBe(before.repositoryId);
      expect(after.reviewSessionId).toBe(before.reviewSessionId);
      expect(after.firstDetectedAt).toEqual(before.firstDetectedAt);

      // 바뀐 흔적은 이것 하나다.
      expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(
        before.updatedAt.getTime(),
      );
    });
  });

  it("🔴 Activity · Code Evidence · Tag 가 한 행도 사라지지 않는다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);

      await updateIssueContent(
        {
          scope: {
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
          },
          issueId: fixture.issueId,
          update: EDIT,
        },
        tx,
      );

      const { activityRows, evidenceRows, tagRows } = await readChildren(
        tx,
        fixture.issueId,
      );

      expect(activityRows).toHaveLength(1);
      expect(activityRows[0]?.id).toBe(fixture.activityId);
      // 판단 기록도 그대로다 — 서술 수정이 History 를 덮어쓰지 않는다.
      expect(activityRows[0]?.description).toBe("처음 발견했다");
      expect(activityRows[0]?.solution).toBe("잠금을 건다");

      expect(evidenceRows).toHaveLength(1);
      expect(evidenceRows[0]?.id).toBe(fixture.evidenceId);
      expect(evidenceRows[0]?.snapshot).toBe("const token = await read(id);");

      expect(tagRows).toHaveLength(1);
      expect(tagRows[0]?.tagId).toBe(fixture.tagId);
    });
  });

  it("RESOLVED 인 Issue 를 고쳐도 해결 요약·해결 시각이 남는다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);

      const resolvedAt = new Date("2026-08-01T00:00:00.000Z");
      await tx
        .update(reviewIssues)
        .set({
          status: "RESOLVED",
          resolvedAt,
          resolutionSummary: "Transaction 밖으로 옮겼다",
        })
        .where(eq(reviewIssues.id, fixture.issueId));

      await updateIssueContent(
        {
          scope: {
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
          },
          issueId: fixture.issueId,
          update: EDIT,
        },
        tx,
      );

      const issue = await readIssue(tx, fixture.issueId);

      /*
 🔴 「RESOLVED 인데 해결 요약이 없다」도 「RESOLVED 가 아닌데 남아 있다」도
 만들지 않는다 — 서술 수정은 그 셋을 아예 건드리지 않기 때문이다.
 */
      expect(issue.status).toBe("RESOLVED");
      expect(issue.resolvedAt).toEqual(resolvedAt);
      expect(issue.resolutionSummary).toBe("Transaction 밖으로 옮겼다");
      expect(issue.title).toBe(EDIT.title);
    });
  });

  it("REOPENED 인 Issue 를 고쳐도 해결 요약이 되살아나지 않는다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);

      await tx
        .update(reviewIssues)
        .set({ status: "REOPENED", resolvedAt: null, resolutionSummary: null })
        .where(eq(reviewIssues.id, fixture.issueId));

      await updateIssueContent(
        {
          scope: {
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
          },
          issueId: fixture.issueId,
          update: EDIT,
        },
        tx,
      );

      const issue = await readIssue(tx, fixture.issueId);

      expect(issue.status).toBe("REOPENED");
      expect(issue.resolvedAt).toBeNull();
      expect(issue.resolutionSummary).toBeNull();
    });
  });
});

describe.skipIf(!enabled)("서술 수정 — 범위 밖은 손대지 못한다", () => {
  it("🔴 다른 Project 를 보고 있으면 고치지 못하고 행도 그대로다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);

      const failure = await updateIssueContent(
        {
          scope: {
            workspaceId: fixture.workspaceId,
            // 같은 Workspace 지만 이 Issue 의 Repository 가 있는 Project 가 아니다.
            projectId: fixture.otherProjectId,
          },
          issueId: fixture.issueId,
          update: EDIT,
        },
        tx,
      ).catch((error: unknown) => error);

      expect(isAppError(failure)).toBe(true);
      if (isAppError(failure)) {
        // 🔴 「남의 것이다」가 아니라 「없다」다.
        expect(failure.reason).toBe("RESOURCE_NOT_FOUND");
      }

      const issue = await readIssue(tx, fixture.issueId);
      expect(issue.title).toBe("처음 제목");
      expect(issue.description).toBe("처음 설명");
    });
  });

  it("🔴 다른 Workspace 의 키로는 고치지 못한다", async () => {
    await inRollback(async (tx) => {
      const mine = await seed(tx);
      const theirs = await seed(tx);

      const failure = await updateIssueContent(
        {
          scope: {
            workspaceId: theirs.workspaceId,
            projectId: theirs.projectId,
          },
          issueId: mine.issueId,
          update: EDIT,
        },
        tx,
      ).catch((error: unknown) => error);

      expect(isAppError(failure)).toBe(true);

      const issue = await readIssue(tx, mine.issueId);
      expect(issue.title).toBe("처음 제목");
    });
  });

  it("없는 Issue 는 같은 오류로 끝난다 — 존재 여부가 새지 않는다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);

      const failure = await updateIssueContent(
        {
          scope: {
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
          },
          issueId: "00000000-0000-4000-8000-000000000000",
          update: EDIT,
        },
        tx,
      ).catch((error: unknown) => error);

      expect(isAppError(failure)).toBe(true);
      if (isAppError(failure)) {
        expect(failure.reason).toBe("RESOURCE_NOT_FOUND");
      }
    });
  });

  /**
   * 🔴 **Agent 경로는 Project 로 좁히지 «않는다»**(`issue-scope.ts`).
   *
   * 지금 Agent API 에는 서술 수정 Endpoint 가 없지만, Service 는 두 범위를 모두 받는
   * 같은 계약 위에 서 있다 — Workspace 만으로도 Tenant 는 새지 않아야 한다.
   */
  it("Workspace 범위만으로도 남의 Workspace 는 뚫리지 않는다", async () => {
    await inRollback(async (tx) => {
      const mine = await seed(tx);
      const theirs = await seed(tx);

      const failure = await updateIssueContent(
        { scope: { workspaceId: theirs.workspaceId }, issueId: mine.issueId, update: EDIT },
        tx,
      ).catch((error: unknown) => error);

      expect(isAppError(failure)).toBe(true);

      // 같은 Workspace 라면 Project 없이도 고쳐진다.
      await updateIssueContent(
        { scope: { workspaceId: mine.workspaceId }, issueId: mine.issueId, update: EDIT },
        tx,
      );

      const issue = await readIssue(tx, mine.issueId);
      expect(issue.title).toBe(EDIT.title);
    });
  });
});

describe.skipIf(!enabled)("서술 수정 — 아무 행도 지우지 않는다", () => {
  it("🔴 `review_issues` 행이 그대로 살아 있다(hard delete 가 아니다)", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);

      await updateIssueContent(
        {
          scope: {
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
          },
          issueId: fixture.issueId,
          update: EDIT,
        },
        tx,
      );

      const rows = await tx
        .select({ id: reviewIssues.id })
        .from(reviewIssues)
        .where(
          and(
            eq(reviewIssues.id, fixture.issueId),
            eq(reviewIssues.workspaceId, fixture.workspaceId),
          ),
        );

      expect(rows).toHaveLength(1);
    });
  });
});
