import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { projects, repositories, reviewIssues, users } from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import { reviewIngestSchema } from "@/features/reviews/schemas/review-ingest";
import { ingestReview } from "@/features/reviews/server/review-ingest-service";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

/**
 * 실제 PostgreSQL 을 쓰는 시험 — **Review 재전송(`Idempotency-Key`)의 계약**.
 *
 * # 🔴 이 파일은 기본 `pnpm test` 에서 «돌지 않는다»
 *
 * ```bash
 * pnpm test                       # 이 파일 전체를 건너뛴다
 * DB_INTEGRATION=true pnpm test   # PostgreSQL 이 떠 있고 DATABASE_URL 이 있어야 한다
 * ```
 *
 * # 왜 Fake 로는 안 되는가
 *
 * `review-ingest-service.test.ts` 의 Fake 는 **`where` 를 해석하지 않는다.** 미리 적어 둔
 * 행을 그대로 돌려줄 뿐이라, 「조회 조건이 그 행을 실제로 데려오는가」는 그쪽에서 영원히
 * 초록이다 — 아래 두 결함이 정확히 그 틈에 있었다.
 *
 * | 무엇 | Fake 가 못 보는 이유 |
 * |---|---|
 * | 재전송 응답이 **다시 보고된 Issue 를 잃는다** | `review_session_id` 조건이 무엇을 거르는지 Fake 는 모른다 |
 * | 재전송이 **Project·Repository 를 건드리지 않는다** | 저장 여부는 실제 행을 다시 읽어야 안다 |
 *
 * 🔴 **데이터를 남기지 않는다.** 모든 시험이 자기 Transaction 안에서 돌고 끝에서 되돌린다.
 * 있는 데이터를 지우거나 바꾸지 않으며 `TRUNCATE` 도 쓰지 않는다.
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
/** 시험끼리 unique 제약으로 부딪히지 않게 매번 다른 값을 만든다. */
function unique(prefix: string): string {
  seq += 1;
  return `fixrp-${prefix}${Date.now().toString(36)}${seq}`;
}

async function makeWorkspace(tx: DbExecutor): Promise<string> {
  const created = await tx
    .insert(users)
    .values({ email: `${unique("u")}@example.test`, name: "fixrp" })
    .returning({ id: users.id });

  const userId = created[0]?.id;
  if (userId === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }

  return ensurePersonalWorkspace(
    { userId, displayName: "fixrp", slugSource: unique("ws-") },
    tx,
  );
}

/** 실제 Route 가 넘기는 것과 같은 형태 — Schema 를 통과시킨 값이다. */
function payload(input: {
  projectSlug: string;
  externalRepositoryId: string;
  defaultBranch?: string;
  issues?: { source: string; externalId: string; title: string }[];
}) {
  return reviewIngestSchema.parse({
    project: { slug: input.projectSlug },
    repository: {
      provider: "GITHUB",
      externalRepositoryId: input.externalRepositoryId,
      owner: "acme",
      // 🔴 `fullName` 은 `owner/name` 과 일치해야 한다(Schema 가 막는다).
      name: input.externalRepositoryId,
      fullName: `acme/${input.externalRepositoryId}`,
      defaultBranch: input.defaultBranch ?? "develop",
    },
    target: { type: "COMMIT", commitSha: "a81f3c2" },
    reviewer: { type: "AGENT", name: "codex" },
    summary: "요약",
    issues: (input.issues ?? []).map((issue) => ({
      severity: "HIGH",
      category: "TRANSACTION",
      title: issue.title,
      source: issue.source,
      externalId: issue.externalId,
    })),
  });
}

describe.skipIf(!enabled)("재전송 응답 — 그 Review 가 «본» Issue", () => {
  /**
   * # 🔴 재전송이 Issue 배열을 잃지 않는다
   *
   * ## 무엇이 깨져 있었는가
   *
   * ```
   * SK1  같은 문제를 처음 보고        -> 201 · issues [I]
   * SK2  같은 문제를 다시 보고        -> 201 · issues [I] (alreadyKnown — 행은 새로 안 만든다)
   * SK2  그 요청을 «그대로» 재전송     -> 200 · issues []   ← 같은 열쇠인데 본문이 다르다
   * ```
   *
   * 다시 보고된 Issue 행은 **처음 만든 Session(SK1)에 그대로 남고** SK2 에는
   * `REVIEWED_AGAIN` Activity 만 붙는다. 그런데 재전송 조회가 Issue 를
   * `review_session_id = SK2 의 Session` 으로만 찾아 **하나도 나오지 않았다.**
   *
   * `Idempotency-Key` 의 존재 이유가 「Timeout 뒤 안전한 재시도」인데, 재시도한 Agent 만
   * Issue ID 를 잃어 `FIX_ATTEMPTED` 를 붙이려면 `GET /issues` 를 따로 불러야 했다.
   */
  it("🔴 다시 보고된 Issue 도 재전송 응답에 그대로 있다", async () => {
    await inRollback(async (tx) => {
      const workspaceId = await makeWorkspace(tx);
      const externalRepositoryId = unique("ext-");
      const body = payload({
        projectSlug: unique("proj-"),
        externalRepositoryId,
        issues: [
          { source: "codex", externalId: "SEQ-0", title: "재전송 대상 문제" },
        ],
      });

      // 1. 처음 보고 — 행이 생기고 그 Session 이 주인이다.
      const firstKey = unique("SK1-");
      const first = await ingestReview(
        { workspaceId, idempotencyKey: firstKey, payload: body },
        tx,
      );
      const issueId = first.issues[0]?.id;

      expect(first.idempotentReplay).toBe(false);
      expect(issueId).toBeDefined();

      // 2. 같은 문제를 «다른» 열쇠로 다시 보고 — 행은 새로 만들지 않는다.
      const secondKey = unique("SK2-");
      const second = await ingestReview(
        { workspaceId, idempotencyKey: secondKey, payload: body },
        tx,
      );

      expect(second.idempotentReplay).toBe(false);
      expect(second.reviewSessionId).not.toBe(first.reviewSessionId);
      expect(second.issues.map((issue) => issue.id)).toEqual([issueId]);
      expect(second.issues[0]?.alreadyKnown).toBe(true);

      /**
       * 🔴 **결함의 원인을 행으로 확인한다** — 그 Issue 는 여전히 SK1 의 Session 것이다.
       * 이 사실이 참인 한 `review_session_id` 하나로 좁힌 조회는 SK2 재전송에서
       * 아무것도 찾지 못한다.
       */
      const owner = await tx
        .select({ reviewSessionId: reviewIssues.reviewSessionId })
        .from(reviewIssues)
        .where(eq(reviewIssues.id, issueId ?? ""));
      expect(owner[0]?.reviewSessionId).toBe(first.reviewSessionId);

      // 3. 그 요청을 그대로 재전송 — 200 이고, 응답은 2번과 «같아야» 한다.
      const replay = await ingestReview(
        { workspaceId, idempotencyKey: secondKey, payload: body },
        tx,
      );

      expect(replay.idempotentReplay).toBe(true);
      expect(replay.reviewSessionId).toBe(second.reviewSessionId);
      // 🔴 고치기 전에는 이것이 `[]` 였다.
      expect(replay.issues.map((issue) => issue.id)).toEqual([issueId]);
      expect(replay.issues[0]).toEqual({
        ...second.issues[0],
        alreadyKnown: true,
      });
      expect(replay.evidenceIds).toEqual([]);

      // 4. 그 Session 이 «만든» Issue 도 그대로다 — 조건을 넓히면서 잃지 않았다.
      const replayFirst = await ingestReview(
        { workspaceId, idempotencyKey: firstKey, payload: body },
        tx,
      );
      expect(replayFirst.idempotentReplay).toBe(true);
      expect(replayFirst.reviewSessionId).toBe(first.reviewSessionId);
      expect(replayFirst.issues.map((issue) => issue.id)).toEqual([issueId]);
    });
  });

  /**
   * 🔴 **다른 Repository 의 같은 `externalId` 가 딸려 오지 않는다.**
   *
   * `source + externalId` 의 unique 범위는 **Repository 안**이다. 재전송 조회가
   * `externalId` 로도 찾게 되면서, Repository 조건을 빼면 같은 Workspace 의 다른
   * 저장소 행이 남의 Review 응답에 섞여 나간다.
   */
  it("🔴 같은 Workspace 의 다른 저장소 Issue 는 섞이지 않는다", async () => {
    await inRollback(async (tx) => {
      const workspaceId = await makeWorkspace(tx);
      const projectSlug = unique("proj-");
      const shared = [
        { source: "codex", externalId: "SEQ-SAME", title: "같은 식별자" },
      ];

      const here = payload({
        projectSlug,
        externalRepositoryId: unique("ext-a-"),
        issues: shared,
      });
      const elsewhere = payload({
        projectSlug,
        externalRepositoryId: unique("ext-b-"),
        issues: shared,
      });

      const key = unique("SK-");
      const mine = await ingestReview(
        { workspaceId, idempotencyKey: key, payload: here },
        tx,
      );
      const theirs = await ingestReview(
        {
          workspaceId,
          idempotencyKey: unique("SK-other-"),
          payload: elsewhere,
        },
        tx,
      );

      // 같은 식별자인데 저장소가 다르므로 **서로 다른 행**이다.
      expect(theirs.issues[0]?.id).not.toBe(mine.issues[0]?.id);

      const replay = await ingestReview(
        { workspaceId, idempotencyKey: key, payload: here },
        tx,
      );

      expect(replay.idempotentReplay).toBe(true);
      expect(replay.issues.map((issue) => issue.id)).toEqual([
        mine.issues[0]?.id,
      ]);
    });
  });
});

describe.skipIf(!enabled)("재전송은 아무것도 새로 쓰지 않는다", () => {
  /**
   * # 🔴 다른 Payload 를 실은 재전송이 Project·Repository 를 바꾸지 않는다
   *
   * `scripts/agent-api-e2e.sh` 는 재전송을 **같은 Payload** 로 보낸다. 그래서
   * 「재전송에 다른 `project.slug` 를 실으면 Project 가 새로 생긴다」는 결함을
   * **구조적으로 못 잡는다 — 영원히 초록이다.**
   *
   * 여기서는 **다른 `project.slug` · 다른 `defaultBranch`** 를 실어 재전송하고,
   * `projects`·`repositories` 를 다시 읽어 한 칸도 바뀌지 않았음을 확인한다.
   * 「200 이면 아무것도 새로 쓰지 않았다」가 Agent API 가 밖에 내건 계약이다(스펙 31).
   */
  it("🔴 다른 project.slug·defaultBranch 를 실어 재전송해도 행이 그대로다", async () => {
    await inRollback(async (tx) => {
      const workspaceId = await makeWorkspace(tx);
      const externalRepositoryId = unique("ext-");
      const projectSlug = unique("proj-");
      const key = unique("SK-");

      const stored = await ingestReview(
        {
          workspaceId,
          idempotencyKey: key,
          payload: payload({
            projectSlug,
            externalRepositoryId,
            defaultBranch: "develop",
            issues: [{ source: "codex", externalId: "SEQ-0", title: "문제" }],
          }),
        },
        tx,
      );

      const before = await snapshot(tx, workspaceId);
      expect(before.projects).toHaveLength(1);
      expect(before.repositories[0]?.defaultBranch).toBe("develop");

      // 🔴 처음 보낸 것과 «다른» Project·branch 다.
      const replay = await ingestReview(
        {
          workspaceId,
          idempotencyKey: key,
          payload: payload({
            projectSlug: unique("ghost-"),
            externalRepositoryId,
            defaultBranch: "main",
            issues: [{ source: "codex", externalId: "SEQ-0", title: "문제" }],
          }),
        },
        tx,
      );

      expect(replay.idempotentReplay).toBe(true);
      expect(replay.reviewSessionId).toBe(stored.reviewSessionId);
      expect(replay.repositoryId).toBe(stored.repositoryId);

      const after = await snapshot(tx, workspaceId);

      // 🔴 Project 가 늘지 않았고 이름도 그대로다 — 「ghost」는 만들어지지 않았다.
      expect(after.projects).toEqual(before.projects);
      expect(after.projects.map((project) => project.slug)).toEqual([
        projectSlug,
      ]);
      // 🔴 Repository metadata 도 그대로다 — `defaultBranch` 가 main 으로 바뀌지 않았다.
      expect(after.repositories).toEqual(before.repositories);
    });
  });
});

/** 재전송 앞뒤로 대조할 두 표의 상태. 값으로 통째로 비교한다. */
async function snapshot(
  tx: DbExecutor,
  workspaceId: string,
): Promise<{
  projects: { id: string; slug: string }[];
  repositories: {
    id: string;
    projectId: string;
    defaultBranch: string;
    fullName: string;
  }[];
}> {
  const projectRows = await tx
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(projects.slug);

  const repositoryRows = await tx
    .select({
      id: repositories.id,
      projectId: repositories.projectId,
      defaultBranch: repositories.defaultBranch,
      fullName: repositories.fullName,
    })
    .from(repositories)
    .where(eq(repositories.workspaceId, workspaceId))
    .orderBy(repositories.fullName);

  return { projects: projectRows, repositories: repositoryRows };
}
