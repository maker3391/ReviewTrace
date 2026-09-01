import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { projects, repositories, reviewIssues, users } from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import { knowledgeContextQuerySchema } from "@/features/knowledge/schemas/knowledge-context-query";
import { findKnowledgeContext } from "@/features/knowledge/server/knowledge-context-query";
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
): Promise<void> {
  const [project] = await tx
    .insert(projects)
    .values({
      workspaceId,
      name: "Knowledge Context",
      slug: unique("project-"),
    })
    .returning({ id: projects.id });
  if (project === undefined) throw new Error("시험용 Project를 만들지 못했다");

  await tx.insert(repositories).values({
    workspaceId,
    projectId: project.id,
    provider: "GITHUB",
    externalRepositoryId,
    owner: "acme",
    name: externalRepositoryId,
    fullName: `acme/${externalRepositoryId}`,
    defaultBranch: "main",
  });
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
  },
);
