import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import {
  issueActivities,
  projects,
  repositories,
  reviewIssues,
  users,
} from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import { knowledgeContextQuerySchema } from "@/features/knowledge/schemas/knowledge-context-query";
import { findKnowledgeContext } from "@/features/knowledge/server/knowledge-context-query";
import {
  findReviewKnowledgePreflight,
  KNOWLEDGE_CHANGED_FILE_LIMIT,
} from "@/features/knowledge/server/review-knowledge-preflight";
import { reviewIngestSchema } from "@/features/reviews/schemas/review-ingest";
import { ingestReview } from "@/features/reviews/server/review-ingest-service";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

/**
 * 실제 PostgreSQL 을 쓰는 시험 — **`GET /api/v1/knowledge/context` 의 날짜 타입**.
 *
 * # 🔴 이 파일은 기본 `pnpm test` 에서 «돌지 않는다»
 *
 * ```bash
 * pnpm test                       # 건너뛴다
 * DB_INTEGRATION=true pnpm test   # PostgreSQL 이 떠 있고 DATABASE_URL 이 있어야 한다
 * ```
 *
 * # 무엇을 붙드는가
 *
 * 🔴 **`sql<Date>` 는 «검사되지 않는 타입 단언»이다**(`src/db/raw-value.ts`). Drizzle 은
 * Column 을 통해 조회할 때만 Driver 값을 변환하고, node-postgres 는 timestamp 파서가
 * 꺼져 있어 원시 조각에는 **문자열**을 준다. 그래서 이 응답 안에서
 *
 * ```
 * recentHighSeverityIssues[].firstDetectedAt   Column 경로  -> Date  -> "…T10:00:00.000Z"
 * frequentPatterns[].lastDetectedAt            max(...)     -> 문자열 -> "… 10:00:00+00"
 * pastResolutions[].resolvedAt                 원시 조각     -> 문자열 -> "… 10:00:00+00"
 * ```
 *
 * **같은 계약 안의 같은 종류 값이 두 형식으로 나갔다.** Agent 는 그 둘을 다르게 해석한다.
 *
 * 🔴 **`typecheck` 도 `build` 도 이것을 잡지 못한다** — TypeScript 는 단언을 믿는다.
 * 잡으려면 실제 Driver 값을 받아 봐야 한다. 그래서 이 시험은 Fake 를 쓰지 않는다.
 *
 * 🔴 **데이터를 남기지 않는다.** 시험은 자기 Transaction 안에서 돌고 끝에서 되돌린다.
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
  return `fixkc-${prefix}${Date.now().toString(36)}${seq}`;
}

async function makeWorkspace(tx: DbExecutor): Promise<string> {
  const created = await tx
    .insert(users)
    .values({ email: `${unique("u")}@example.test`, name: "fixkc" })
    .returning({ id: users.id });

  const userId = created[0]?.id;
  if (userId === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }

  return ensurePersonalWorkspace(
    { userId, displayName: "fixkc", slugSource: unique("ws-") },
    tx,
  );
}

/** 새 ingestion 계약에 맞춰 Repository → Project 연결을 먼저 만든다. */
async function connectRepository(
  tx: DbExecutor,
  workspaceId: string,
  externalRepositoryId: string,
): Promise<string> {
  const [project] = await tx
    .insert(projects)
    .values({
      workspaceId,
      name: "Knowledge Context",
      slug: unique("project-"),
    })
    .returning({ id: projects.id });
  if (project === undefined) throw new Error("시험용 Project를 만들지 못했다");

  const [repository] = await tx
    .insert(repositories)
    .values({
      workspaceId,
      projectId: project.id,
      provider: "GITHUB",
      externalRepositoryId,
      owner: "acme",
      name: externalRepositoryId,
      fullName: `acme/${externalRepositoryId}`,
      defaultBranch: "main",
    })
    .returning({ id: repositories.id });
  if (repository === undefined) {
    throw new Error("테스트 Repository를 만들지 못했다");
  }
  return repository.id;
}

const QUERY = knowledgeContextQuerySchema.parse({});

describe.skipIf(!enabled)(
  "Knowledge Context — 날짜는 한 형식으로 나간다",
  () => {
    it("🔴 `lastDetectedAt` 과 `resolvedAt` 이 Date 다 — Column 경로와 같은 형식", async () => {
      await inRollback(async (tx) => {
        const workspaceId = await makeWorkspace(tx);
        const repo = unique("repo");
        await connectRepository(tx, workspaceId, repo);

        const ingested = await ingestReview(
          {
            workspaceId,
            idempotencyKey: null,
            payload: reviewIngestSchema.parse({
              repository: {
                provider: "GITHUB",
                externalRepositoryId: repo,
                owner: "acme",
                name: repo,
                fullName: `acme/${repo}`,
              },
              target: { type: "COMMIT", commitSha: "a81f3c2" },
              reviewer: { type: "AGENT", name: "codex" },
              summary: "요약",
              issues: [
                {
                  severity: "HIGH",
                  category: "TRANSACTION",
                  title: "Transaction 밖으로 옮겨야 한다",
                  // Pattern 이 있어야 `frequentPatterns` 집계에 잡힌다.
                  patternKey: "EXTERNAL_IO_IN_TRANSACTION",
                  source: "codex",
                  externalId: "KC-1",
                },
              ],
            }),
          },
          tx,
        );

        const issueId = ingested.issues[0]?.id;
        expect(issueId).toBeDefined();

        /**
         * `pastResolutions` 는 「해결됐고 «어떻게» 해결했는지가 있는」 행만 본다.
         * 상태 전이 경로를 다시 시험하는 자리가 아니라, 행을 직접 그 모양으로 만든다.
         */
        await tx
          .update(reviewIssues)
          .set({
            status: "RESOLVED",
            resolvedAt: new Date(),
            resolutionSummary: "Transaction 범위를 좁혔다",
          })
          .where(eq(reviewIssues.id, issueId as string));

        const context = await findKnowledgeContext(
          { workspaceId, query: QUERY },
          tx,
        );

        // 집계가 실제로 잡혔는지 먼저 확인한다 — 빈 배열이면 아래 단언이 공회전한다.
        expect(context.frequentPatterns).toHaveLength(1);
        expect(context.pastResolutions).toHaveLength(1);

        // 🔴 여기가 이 시험의 전부다.
        expect(context.frequentPatterns[0]?.lastDetectedAt).toBeInstanceOf(
          Date,
        );
        expect(context.pastResolutions[0]?.resolvedAt).toBeInstanceOf(Date);

        // 세는 값도 문자열로 새지 않는다(`count(*)` 는 bigint 다).
        expect(context.frequentPatterns[0]?.occurrences).toBe(1);
        expect(context.frequentPatterns[0]?.resolvedCount).toBe(1);
      });
    });

    it("🔴 한 응답 안에서 날짜 형식이 갈리지 않는다 — 직렬화까지 확인한다", async () => {
      await inRollback(async (tx) => {
        const workspaceId = await makeWorkspace(tx);
        const repo = unique("repo");
        await connectRepository(tx, workspaceId, repo);

        await ingestReview(
          {
            workspaceId,
            idempotencyKey: null,
            payload: reviewIngestSchema.parse({
              repository: {
                provider: "GITHUB",
                externalRepositoryId: repo,
                owner: "acme",
                name: repo,
                fullName: `acme/${repo}`,
              },
              target: { type: "COMMIT", commitSha: "a81f3c2" },
              reviewer: { type: "AGENT", name: "codex" },
              summary: "요약",
              issues: [
                {
                  severity: "HIGH",
                  category: "CONCURRENCY",
                  title: "경쟁이 있다",
                  patternKey: "REFRESH_TOKEN_RACE_CONDITION",
                  source: "codex",
                  externalId: "KC-2",
                },
              ],
            }),
          },
          tx,
        );

        const context = await findKnowledgeContext(
          { workspaceId, query: QUERY },
          tx,
        );

        /**
         * Route 가 하는 일과 같다 — `Response.json` 을 지나면 Date 는 ISO 8601 이 되고
         * 문자열은 PostgreSQL 이 준 모양(`2026-08-30 10:00:00+00`) 그대로 나간다.
         */
        const wire = JSON.parse(JSON.stringify(context)) as {
          frequentPatterns: { lastDetectedAt: string }[];
          recentHighSeverityIssues: { firstDetectedAt: string }[];
        };

        const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

        // Column 경로 — 언제나 ISO 였다. 비교 기준이다.
        expect(wire.recentHighSeverityIssues[0]?.firstDetectedAt).toMatch(ISO);
        // 🔴 원시 조각 경로. 고치기 전에는 `2026-08-30 10:00:00+00` 이었다.
        expect(wire.frequentPatterns[0]?.lastDetectedAt).toMatch(ISO);
      });
    });

    it.each([null, "stable-a"])(
      "고유 Issue와 실제 encounter를 분리하고 externalId=%s에 의존하지 않는다",
      async (externalId) => {
        await inRollback(async (tx) => {
          const workspaceId = await makeWorkspace(tx);
          const repo = unique("encounters");
          await connectRepository(tx, workspaceId, repo);

          const ingested = await ingestReview(
            {
              workspaceId,
              idempotencyKey: null,
              payload: reviewIngestSchema.parse({
                repository: {
                  provider: "GITHUB",
                  externalRepositoryId: repo,
                  owner: "acme",
                  name: repo,
                  fullName: `acme/${repo}`,
                },
                target: { type: "COMMIT", commitSha: "a81f3c2" },
                reviewer: { type: "AGENT", name: "codex" },
                issues: [
                  {
                    severity: "HIGH",
                    category: "RELIABILITY",
                    title: "Issue A",
                    patternKey: "RECURRING_CONTEXT",
                    source: externalId === null ? null : "codex",
                    externalId,
                  },
                  {
                    severity: "MEDIUM",
                    category: "RELIABILITY",
                    title: "Issue B",
                    patternKey: "RECURRING_CONTEXT",
                  },
                ],
              }),
            },
            tx,
          );
          const issueA = ingested.issues.find(
            (issue) => issue.title === "Issue A",
          );
          if (issueA === undefined) throw new Error("Issue A가 없다");

          const initialDetection = new Date("2026-08-01T00:00:00.000Z");
          for (const issue of ingested.issues) {
            await tx
              .update(reviewIssues)
              .set({ firstDetectedAt: initialDetection })
              .where(eq(reviewIssues.id, issue.id));
          }

          const firstRecurrence = new Date("2026-08-30T10:00:00.000Z");
          const lastRecurrence = new Date("2026-09-01T12:34:56.000Z");
          await tx.insert(issueActivities).values([
            {
              workspaceId,
              reviewIssueId: issueA.id,
              type: "REVIEWED_AGAIN",
              actorType: "AGENT",
              actorName: "codex",
              createdAt: firstRecurrence,
            },
            {
              workspaceId,
              reviewIssueId: issueA.id,
              type: "REVIEWED_AGAIN",
              actorType: "AGENT",
              actorName: "codex",
              createdAt: lastRecurrence,
            },
            // 해결 시도는 encounter가 아니다.
            {
              workspaceId,
              reviewIssueId: issueA.id,
              type: "FIX_ATTEMPTED",
              actorType: "AGENT",
              actorName: "codex",
              createdAt: new Date("2026-09-02T00:00:00.000Z"),
            },
          ]);

          const context = await findKnowledgeContext(
            {
              workspaceId,
              query: knowledgeContextQuerySchema.parse({
                repository: `acme/${repo}`,
              }),
            },
            tx,
          );
          const pattern = context.frequentPatterns[0];

          expect(pattern).toMatchObject({
            uniqueIssues: 2,
            encounters: 4,
            // compatibility alias도 수정된 의미를 쓴다.
            occurrences: 4,
          });
          expect(pattern?.lastEncounterAt).toEqual(lastRecurrence);
          expect(pattern?.lastDetectedAt).toEqual(lastRecurrence);
        });
      },
    );

    it("create_review preflight는 현재 Repository 후보만 결정론적으로 반환한다", async () => {
      await inRollback(async (tx) => {
        const workspaceId = await makeWorkspace(tx);
        const repoA = unique("preflight-a");
        const repoB = unique("preflight-b");
        const repositoryAId = await connectRepository(tx, workspaceId, repoA);
        await connectRepository(tx, workspaceId, repoB);

        const ingest = async (repo: string, title: string, filePath: string) =>
          ingestReview(
            {
              workspaceId,
              idempotencyKey: null,
              payload: reviewIngestSchema.parse({
                repository: {
                  provider: "GITHUB",
                  externalRepositoryId: repo,
                  owner: "acme",
                  name: repo,
                  fullName: `acme/${repo}`,
                },
                target: { type: "COMMIT", commitSha: "a81f3c2" },
                reviewer: { type: "AGENT", name: "codex" },
                issues: [
                  {
                    severity: "HIGH",
                    category: "RELIABILITY",
                    title,
                    patternKey: "REPOSITORY_CONTEXT",
                    filePath,
                    source: "codex",
                    externalId: title,
                  },
                ],
              }),
            },
            tx,
          );

        const resolved = await ingest(
          repoA,
          "Repo A precedent",
          "src/repository/context.ts",
        );
        await ingest(repoA, "Repo A open", "src/repository/other.ts");
        await ingest(repoB, "Repo B must not leak", "src/repository/context.ts");

        await tx
          .update(reviewIssues)
          .set({
            status: "RESOLVED",
            resolvedAt: new Date("2026-08-30T00:00:00.000Z"),
            resolutionSummary: "Repository 범위를 먼저 고정했다.",
          })
          .where(eq(reviewIssues.id, resolved.issues[0]?.id ?? ""));

        const preflight = await findReviewKnowledgePreflight(
          {
            workspaceId,
            repositoryId: repositoryAId,
            changedFiles: ["src/repository/context.ts"],
            now: new Date("2026-09-02T00:00:00.000Z"),
          },
          tx,
        );

        expect(preflight.available).toBe(true);
        expect(preflight.relevantPastIssues[0]).toMatchObject({
          title: "Repo A precedent",
          repositoryFullName: `acme/${repoA}`,
          relevanceReasons: expect.arrayContaining([
            "SAME_FILE",
            "RESOLVED_PRECEDENT",
          ]),
        });
        expect(preflight.unresolvedIssues[0]).toMatchObject({
          title: "Repo A open",
          repositoryFullName: `acme/${repoA}`,
          relevanceReasons: expect.arrayContaining([
            "SAME_DIRECTORY",
            "UNRESOLVED",
          ]),
        });
        expect(
          [
            ...preflight.relevantPastIssues,
            ...preflight.unresolvedIssues,
          ].some((candidate) => candidate.title === "Repo B must not leak"),
        ).toBe(false);
        // 자르지 않았으면 자르지 않았다고 말한다.
        expect(preflight.changedFiles).toEqual({
          total: 1,
          considered: 1,
          truncated: false,
        });
      });
    });

    /**
     * 🔴 **relevance 가 «바뀐 파일 전부»를 봤다고 거짓말하지 않는다.**
     *
     * API 는 100 개를 넘겨도 Review 를 거절하지 않는다. 대신 순위 계산에 쓴 개수를 응답에
     * 적어, Agent 가 후보에 없는 파일을 「과거에 문제가 없던 파일」로 읽지 않게 한다.
     */
    /**
     * 🔴 **바뀐 파일이 하나도 없는 Review 가 가장 흔한 요청이다.**
     *
     * changedFiles 를 보내지 않는 옛 Client, merge commit, 「이 commit 은 깨끗했다」 —
     * 전부 빈 목록으로 들어온다. 그런데 그 경로에서 `ORDER BY 0` 이 나가
     * `42P10` 으로 preflight 가 통째로 죽었고, 응답에는 `available: false` 만 남아
     * **아무도 몰랐다.** 실제 HTTP 왕복과 서버 Log 로 잡았다.
     */
    it("바뀐 파일이 하나도 없어도 preflight가 살아 있다", async () => {
      await inRollback(async (tx) => {
        const workspaceId = await makeWorkspace(tx);
        const repo = unique("no-changed-files");
        const repositoryId = await connectRepository(tx, workspaceId, repo);

        const preflight = await findReviewKnowledgePreflight(
          {
            workspaceId,
            repositoryId,
            changedFiles: [],
            now: new Date("2026-09-02T00:00:00.000Z"),
          },
          tx,
        );

        expect(preflight.available).toBe(true);
        expect(preflight.changedFiles).toEqual({
          total: 0,
          considered: 0,
          truncated: false,
        });
      });
    });

    it("relevance에 쓴 경로 수를 줄였으면 그 사실을 응답에 적는다", async () => {
      await inRollback(async (tx) => {
        const workspaceId = await makeWorkspace(tx);
        const repo = unique("truncation");
        const repositoryId = await connectRepository(tx, workspaceId, repo);

        const many = Array.from(
          { length: KNOWLEDGE_CHANGED_FILE_LIMIT + 40 },
          (_, index) => `src/zone${index}/file.ts`,
        );

        const preflight = await findReviewKnowledgePreflight(
          {
            workspaceId,
            repositoryId,
            changedFiles: many,
            now: new Date("2026-09-02T00:00:00.000Z"),
          },
          tx,
        );

        expect(preflight.available).toBe(true);
        expect(preflight.changedFiles).toEqual({
          total: KNOWLEDGE_CHANGED_FILE_LIMIT + 40,
          considered: KNOWLEDGE_CHANGED_FILE_LIMIT,
          truncated: true,
        });
        expect(preflight.guidance.join(" ")).toContain(
          String(KNOWLEDGE_CHANGED_FILE_LIMIT + 40),
        );
      });
    });
  },
);
