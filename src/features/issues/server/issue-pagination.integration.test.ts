import { beforeAll, describe, expect, it } from "vitest";

import { db, type DbExecutor } from "@/db";
import {
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
  users,
} from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import {
  FILTER_ALL,
  type IssueFilter,
} from "@/features/issues/schemas/issue-filter";
import { findIssues } from "@/features/issues/server/issue-query";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { ensurePersonalWorkspace } from "@/lib/workspace/personal-workspace";

/**
 * 실제 PostgreSQL 을 쓰는 시험 — **Issue 목록이 정말로 쪽으로 잘리는가**.
 *
 * # 🔴 이 파일은 기본 `pnpm test` 에서 «돌지 않는다»
 *
 * ```bash
 * pnpm test                      # 이 파일 전체를 건너뛴다
 * DB_INTEGRATION=true pnpm test  # PostgreSQL 이 떠 있고 DATABASE_URL 이 있어야 한다
 * ```
 *
 * # 왜 단위 시험만으로는 부족한가
 *
 * `lib/pagination.test.ts` 가 보는 것은 **셈**이다 — 몇 쪽이고 어떤 `limit`/`offset` 을
 * 넘기는지까지. 「그 `limit` 이 실제 SQL 에 실려 나가는가」와 「같은 시각의 행이 쪽마다
 * 뒤바뀌지 않는가」는 진짜 Database 만 답할 수 있다. 시각이 같은 행들의 순서는
 * `ORDER BY` 에 적힌 것이 없으면 **Planner 가 고른 scan 순서**가 되고, 그때 같은 Issue 가
 * 두 쪽에 나오거나 아예 빠진다.
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
  return `ispage-${prefix}${Date.now().toString(36)}${seq}`;
}

/** 화면이 아무 Filter 도 걸지 않은 상태. 쪽만 바꿔 가며 쓴다. */
function filterFor(repositoryId: string, page: number): IssueFilter {
  return {
    q: "",
    repositoryId,
    severity: FILTER_ALL,
    category: FILTER_ALL,
    status: FILTER_ALL,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

interface Fixture {
  workspaceId: string;
  projectId: string;
  repositoryId: string;
  reviewSessionId: string;
}

/** Workspace -> Project -> Repository -> ReviewSession 한 벌. */
async function seed(tx: DbExecutor): Promise<Fixture> {
  const created = await tx
    .insert(users)
    .values({ email: `${unique("u")}@example.test`, name: "ispage" })
    .returning({ id: users.id });

  const userId = created[0]?.id;
  if (userId === undefined) {
    throw new Error("시험용 사용자를 만들지 못했다");
  }

  const workspaceId = await ensurePersonalWorkspace(
    { userId, displayName: "ispage", slugSource: unique("ws-") },
    tx,
  );

  const projectRows = await tx
    .insert(projects)
    .values({ workspaceId, name: "ispage", slug: unique("p-") })
    .returning({ id: projects.id });
  const projectId = projectRows[0]?.id;
  if (projectId === undefined) {
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
      commitSha: "a81f3c2",
      reviewerType: "AGENT",
      reviewerName: "codex",
    })
    .returning({ id: reviewSessions.id });
  const reviewSessionId = sessionRows[0]?.id;
  if (reviewSessionId === undefined) {
    throw new Error("시험용 ReviewSession 을 만들지 못했다");
  }

  return { workspaceId, projectId, repositoryId, reviewSessionId };
}

/**
 * Issue 를 `count` 건 넣는다.
 *
 * 🔴 **`firstDetectedAt` 을 «전부 같은 시각»으로 둔다.** 그것이 이 시험의 요점이다 —
 * 정렬 첫 열이 전부 같으면 순서를 정하는 것은 두 번째 열뿐이고, 그것이 없으면
 * 쪽 나누기가 우연에 기댄다.
 */
async function insertIssues(
  tx: DbExecutor,
  fixture: Fixture,
  count: number,
  detectedAt: Date,
): Promise<void> {
  await tx.insert(reviewIssues).values(
    Array.from({ length: count }, (_, index) => ({
      workspaceId: fixture.workspaceId,
      repositoryId: fixture.repositoryId,
      reviewSessionId: fixture.reviewSessionId,
      title: `쪽 나누기 시험 ${String(index + 1).padStart(3, "0")}`,
      description: "본문",
      severity: "HIGH" as const,
      category: "CONCURRENCY" as const,
      firstDetectedAt: detectedAt,
    })),
  );
}

describe.skipIf(!enabled)("Issue 목록의 쪽 나누기 (실제 PostgreSQL)", () => {
  /**
   * 🔴 **보고된 「23건이 한 쪽에 전부」가 결함인지 정상인지 판정하는 자리다.**
   *
   * 기본 크기가 25 이므로 23·24·25건은 **한 쪽이 맞다.** 20 이었다면 23건부터 두 쪽이
   * 나와야 하므로, 이 표는 기본값이 바뀌면 그대로 빨개진다.
   *
   * 🔴 **경계를 기본값에 맞춘다.** 19·20·21 은 25 기준으로 셋 다 「한 쪽」이라 아무 경계도
   * 넘지 않는다. 실제로 갈리는 자리는 `24 | 25 | 26`(1쪽↔2쪽)과 `49 | 50 | 51`(2쪽↔3쪽)이다.
   */
  it.each([
    [23, 1, 23],
    [24, 1, 24],
    [25, 1, 25],
    [26, 2, 25],
    [49, 2, 25],
    [50, 2, 25],
    [51, 3, 25],
  ])(
    "%i건이면 총 %i쪽이고 첫 쪽에 %i건만 실려 온다",
    async (total, pages, firstCount) => {
      await inRollback(async (tx) => {
        const fixture = await seed(tx);
        await insertIssues(tx, fixture, total, new Date("2026-09-01T00:00:00Z"));

        const scope = {
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
        };

        const first = await findIssues(
          scope,
          filterFor(fixture.repositoryId, 1),
          tx,
        );

        expect(first.total).toBe(total);
        expect(first.pageSize).toBe(25);
        expect(first.items).toHaveLength(firstCount);
        expect(Math.ceil(first.total / first.pageSize)).toBe(pages);

        const second = await findIssues(
          scope,
          filterFor(fixture.repositoryId, 2),
          tx,
        );

        // 한 쪽뿐이면 두 번째 쪽 요청은 첫 쪽으로 끌려온다 — 빈 표가 아니다.
        expect(second.page).toBe(pages === 1 ? 1 : 2);
        expect(second.items).toHaveLength(
          pages === 1 ? total : Math.min(25, total - 25),
        );
      });
    },
  );

  /**
   * 🔴 **같은 시각의 41건을 두 쪽으로 나눠도 겹치거나 빠지지 않는다.**
   *
   * ## 되돌림 확인
   *
   * `issue-query.ts` 의 `.orderBy(desc(firstDetectedAt), desc(id))` 에서 `desc(id)` 를
   * 지우면 **이 시험이 실패한다.** 시각이 전부 같아 남는 정렬 기준이 없어지고, 두 쪽이
   * 각각 별개의 정렬을 거쳐 같은 행이 겹치거나 빠진다.
   */
  it("🔴 시각이 같아도 쪽 사이에 겹치거나 빠지는 Issue 가 없다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);
      await insertIssues(tx, fixture, 41, new Date("2026-09-01T00:00:00Z"));

      const scope = {
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
      };

      const first = await findIssues(
        scope,
        filterFor(fixture.repositoryId, 1),
        tx,
      );
      const second = await findIssues(
        scope,
        filterFor(fixture.repositoryId, 2),
        tx,
      );

      const ids = [
        ...first.items.map((issue) => issue.id),
        ...second.items.map((issue) => issue.id),
      ];

      expect(ids).toHaveLength(41);
      expect(new Set(ids).size).toBe(41);

      /*
 🔴 **순서까지 본다.** 겹침·누락만 보면 두 쪽이 «우연히» 같은 scan 순서로 돌 때
 초록으로 남는다 — 시각이 전부 같으므로 실제 순서는 `id` 내림차순이어야 한다.
 uuid 는 PostgreSQL 에서 바이트 순으로 비교되고, 그것은 소문자 hex 표기의
 사전 순과 같다.
 */
      const descending = [...ids].sort().reverse();
      expect(ids).toEqual(descending);
    });
  });

  /**
   * 쪽 크기를 키우면 한 쪽에 다 담긴다 — 41건은 25개씩이면 두 쪽, 50개씩이면 한 쪽이다.
   */
  it("쪽 크기를 50 으로 올리면 41건이 한 쪽에 담긴다", async () => {
    await inRollback(async (tx) => {
      const fixture = await seed(tx);
      await insertIssues(tx, fixture, 41, new Date("2026-09-01T00:00:00Z"));

      const result = await findIssues(
        { workspaceId: fixture.workspaceId, projectId: fixture.projectId },
        { ...filterFor(fixture.repositoryId, 1), pageSize: 50 },
        tx,
      );

      expect(result.total).toBe(41);
      expect(result.items).toHaveLength(41);
    });
  });
});
