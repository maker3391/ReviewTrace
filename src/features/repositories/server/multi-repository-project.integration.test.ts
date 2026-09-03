import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
  users,
  workspaces,
} from "@/db/schema";
import { loadIntegrationDbEnv } from "@/db/testing/integration-env";
import {
  parseIssueFilter,
  type IssueFilter,
} from "@/features/issues/schemas/issue-filter";
import { findIssues } from "@/features/issues/server/issue-query";
import {
  listRepositoryOptions,
  listRepositoryStatuses,
} from "@/features/repositories/server/repository-query";
import { findProjectReviewPage } from "@/features/reviews/server/review-query";

const enabled = process.env.DB_INTEGRATION === "true";
beforeAll(() => {
  if (enabled) loadIntegrationDbEnv();
});

class Rollback extends Error {}

/** 아무 조건도 걸지 않은 Issue Filter. 🔴 여기서 손으로 적지 않고 Schema 가 만든다. */
function allIssues(): IssueFilter {
  return parseIssueFilter({});
}

describe.skipIf(!enabled)("multi-Repository Project source and counts", () => {
  it("keeps Review/Issue source and per-Repository aggregates independent", async () => {
    await expect(
      db().transaction(async (tx) => {
        const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const [user] = await tx
          .insert(users)
          .values({ email: `multi-repo-${suffix}@example.test` })
          .returning({ id: users.id });
        const [workspace] = await tx
          .insert(workspaces)
          .values({
            slug: `multi-repo-${suffix}`,
            name: "Multi Repository",
            createdBy: user!.id,
          })
          .returning({ id: workspaces.id });
        const [project] = await tx
          .insert(projects)
          .values({
            workspaceId: workspace!.id,
            slug: "product",
            name: "Product",
            createdBy: user!.id,
          })
          .returning({ id: projects.id });
        const connected = await tx
          .insert(repositories)
          .values([
            {
              workspaceId: workspace!.id,
              projectId: project!.id,
              provider: "GITHUB",
              externalRepositoryId: `${suffix}-a`,
              owner: "acme",
              name: "repo-a",
              fullName: "acme/repo-a",
              defaultBranch: "main",
            },
            {
              workspaceId: workspace!.id,
              projectId: project!.id,
              provider: "GITHUB",
              externalRepositoryId: `${suffix}-b`,
              owner: "acme",
              name: "repo-b",
              fullName: "acme/repo-b",
              defaultBranch: "main",
            },
          ])
          .returning({ id: repositories.id, fullName: repositories.fullName });
        const repoA = connected.find((row) => row.fullName === "acme/repo-a")!;
        const repoB = connected.find((row) => row.fullName === "acme/repo-b")!;
        const reviews = await tx
          .insert(reviewSessions)
          .values([
            {
              workspaceId: workspace!.id,
              repositoryId: repoA.id,
              targetType: "COMMIT",
              branch: "develop",
              commitSha: "aaaaaaaa",
              reviewerType: "AGENT",
              reviewerName: "Agent A",
            },
            {
              workspaceId: workspace!.id,
              repositoryId: repoB.id,
              targetType: "COMMIT",
              branch: "feature/b",
              commitSha: "bbbbbbbb",
              reviewerType: "AGENT",
              reviewerName: "Agent B",
            },
          ])
          .returning({ id: reviewSessions.id, repositoryId: reviewSessions.repositoryId });
        const reviewA = reviews.find((row) => row.repositoryId === repoA.id)!;
        const reviewB = reviews.find((row) => row.repositoryId === repoB.id)!;
        await tx.insert(reviewIssues).values([
          {
            workspaceId: workspace!.id,
            repositoryId: repoA.id,
            reviewSessionId: reviewA.id,
            title: "Issue A1",
            severity: "HIGH",
            category: "RELIABILITY",
            status: "OPEN",
          },
          {
            workspaceId: workspace!.id,
            repositoryId: repoB.id,
            reviewSessionId: reviewB.id,
            title: "Issue B1",
            severity: "MEDIUM",
            category: "CLEAN_CODE",
            status: "RESOLVED",
            resolvedAt: new Date(),
          },
        ]);

        const scope = { workspaceId: workspace!.id, projectId: project!.id };
        const [reviewPage, issuePage, statuses] = await Promise.all([
          findProjectReviewPage(scope, { page: 1, pageSize: 25 }, tx),
          findIssues(scope, allIssues(), tx),
          listRepositoryStatuses(scope, tx),
        ]);

        expect(
          reviewPage.items.map((review) => review.repositoryFullName).sort(),
        ).toEqual(["acme/repo-a", "acme/repo-b"]);
        expect(
          issuePage.items.map((issue) => issue.repositoryFullName).sort(),
        ).toEqual(["acme/repo-a", "acme/repo-b"]);
        expect(statuses).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              fullName: "acme/repo-a",
              reviewCount: 1,
              openIssueCount: 1,
              lastReviewAt: expect.any(Date),
            }),
            expect.objectContaining({
              fullName: "acme/repo-b",
              reviewCount: 1,
              openIssueCount: 0,
              lastReviewAt: expect.any(Date),
            }),
          ]),
        );

        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  /**
   * Issue 목록의 **저장소 Filter**.
   *
   * 🔴 **화면에서 걸러 그리는 것이 아니라 질의가 좁힌다** — 그래서 `items` 만 보지 않고
   * `total` 도 함께 본다. UI 로만 걸러 내면 목록은 그럴듯하지만 건수와 쪽 수가 전체
   * 기준으로 남아, 2쪽을 눌렀을 때 빈 표가 나온다.
   *
   * 🔴 **인가는 조건의 겹침이 한다**(스펙 11). 남의 Project·Workspace 의 저장소 UUID 를
   * 주소로 밀어 넣어도 `workspace_id`·`project_id` 가 함께 걸려 0건이다.
   *
   * ## 되돌림 확인
   *
   * - `issue-query.ts` 의 `repositoryId` 조건을 지우면 「저장소 A 만」·「B 만」·복합 Filter ·
   *   쪽 나누기 · 남의 저장소 주입이 **전부 실패한다**.
   * - `repository-query.ts` 의 `listRepositoryOptions` 에서 `projectId` 조건을 빼면
   *   「선택지는 이 Project 것뿐이다」가 실패한다.
   */
  it("filters issues by repository inside the current Project only", async () => {
    await expect(
      db().transaction(async (tx) => {
        const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const [user] = await tx
          .insert(users)
          .values({ email: `repo-filter-${suffix}@example.test` })
          .returning({ id: users.id });
        const inserted = await tx
          .insert(workspaces)
          .values([
            {
              slug: `repo-filter-${suffix}`,
              name: "Repo Filter",
              createdBy: user!.id,
            },
            {
              slug: `repo-filter-other-${suffix}`,
              name: "Repo Filter Other",
              createdBy: user!.id,
            },
          ])
          .returning({ id: workspaces.id, slug: workspaces.slug });
        const workspace = inserted.find(
          (row) => row.slug === `repo-filter-${suffix}`,
        )!;
        const otherWorkspace = inserted.find(
          (row) => row.slug === `repo-filter-other-${suffix}`,
        )!;

        const insertedProjects = await tx
          .insert(projects)
          .values([
            {
              workspaceId: workspace.id,
              slug: "product",
              name: "Product",
              createdBy: user!.id,
            },
            {
              workspaceId: workspace.id,
              slug: "sibling",
              name: "Sibling",
              createdBy: user!.id,
            },
            {
              workspaceId: otherWorkspace.id,
              slug: "product",
              name: "Other Product",
              createdBy: user!.id,
            },
          ])
          .returning({
            id: projects.id,
            slug: projects.slug,
            workspaceId: projects.workspaceId,
          });
        const project = insertedProjects.find(
          (row) => row.workspaceId === workspace.id && row.slug === "product",
        )!;
        const siblingProject = insertedProjects.find(
          (row) => row.slug === "sibling",
        )!;
        const otherProject = insertedProjects.find(
          (row) => row.workspaceId === otherWorkspace.id,
        )!;

        const repositoryRows = await tx
          .insert(repositories)
          .values([
            {
              workspaceId: workspace.id,
              projectId: project.id,
              provider: "GITHUB" as const,
              externalRepositoryId: `${suffix}-a`,
              owner: "acme",
              name: "repo-a",
              fullName: "acme/repo-a",
              defaultBranch: "main",
            },
            {
              workspaceId: workspace.id,
              projectId: project.id,
              provider: "GITHUB" as const,
              externalRepositoryId: `${suffix}-b`,
              owner: "acme",
              name: "repo-b",
              fullName: "acme/repo-b",
              defaultBranch: "main",
            },
            // 같은 Workspace 의 «다른 Project» — 선택지에도 결과에도 들어오면 안 된다.
            {
              workspaceId: workspace.id,
              projectId: siblingProject.id,
              provider: "GITHUB" as const,
              externalRepositoryId: `${suffix}-c`,
              owner: "acme",
              name: "repo-c",
              fullName: "acme/repo-c",
              defaultBranch: "main",
            },
            // 아예 다른 Workspace.
            {
              workspaceId: otherWorkspace.id,
              projectId: otherProject.id,
              provider: "GITHUB" as const,
              externalRepositoryId: `${suffix}-d`,
              owner: "other",
              name: "repo-d",
              fullName: "other/repo-d",
              defaultBranch: "main",
            },
          ])
          .returning({ id: repositories.id, fullName: repositories.fullName });
        const repoOf = (fullName: string) =>
          repositoryRows.find((row) => row.fullName === fullName)!.id;
        const repoA = repoOf("acme/repo-a");
        const repoB = repoOf("acme/repo-b");
        const repoC = repoOf("acme/repo-c");
        const repoD = repoOf("other/repo-d");

        const sessionRows = await tx
          .insert(reviewSessions)
          .values(
            [repoA, repoB, repoC, repoD].map((repositoryId, index) => ({
              workspaceId:
                repositoryId === repoD ? otherWorkspace.id : workspace.id,
              repositoryId,
              targetType: "COMMIT" as const,
              branch: "develop",
              commitSha: `sha${index}`,
              reviewerType: "AGENT" as const,
              reviewerName: "codex",
            })),
          )
          .returning({
            id: reviewSessions.id,
            repositoryId: reviewSessions.repositoryId,
          });
        const sessionOf = (repositoryId: string) =>
          sessionRows.find((row) => row.repositoryId === repositoryId)!.id;

        await tx.insert(reviewIssues).values([
          {
            workspaceId: workspace.id,
            repositoryId: repoA,
            reviewSessionId: sessionOf(repoA),
            title: "Refresh token race condition",
            severity: "HIGH" as const,
            category: "CONCURRENCY" as const,
            status: "OPEN" as const,
          },
          {
            workspaceId: workspace.id,
            repositoryId: repoA,
            reviewSessionId: sessionOf(repoA),
            title: "N plus one query",
            severity: "MEDIUM" as const,
            category: "PERFORMANCE" as const,
            status: "RESOLVED" as const,
            resolvedAt: new Date(),
            resolutionSummary: "fetch join 으로 한 번에 읽는다",
          },
          {
            workspaceId: workspace.id,
            repositoryId: repoA,
            reviewSessionId: sessionOf(repoA),
            title: "Missing validation",
            severity: "LOW" as const,
            category: "VALIDATION" as const,
            status: "OPEN" as const,
          },
          {
            workspaceId: workspace.id,
            repositoryId: repoB,
            reviewSessionId: sessionOf(repoB),
            title: "Refresh token race condition",
            severity: "HIGH" as const,
            category: "CONCURRENCY" as const,
            status: "OPEN" as const,
          },
          {
            workspaceId: workspace.id,
            repositoryId: repoB,
            reviewSessionId: sessionOf(repoB),
            title: "Transaction boundary too wide",
            severity: "CRITICAL" as const,
            category: "TRANSACTION" as const,
            status: "RESOLVED" as const,
            resolvedAt: new Date(),
            resolutionSummary: "외부 호출을 Transaction 밖으로 옮겼다",
          },
          // 다른 Project 의 Issue — 이 Project 의 목록에 절대 섞이지 않는다.
          {
            workspaceId: workspace.id,
            repositoryId: repoC,
            reviewSessionId: sessionOf(repoC),
            title: "Sibling project issue",
            severity: "HIGH" as const,
            category: "SECURITY" as const,
            status: "OPEN" as const,
          },
          {
            workspaceId: otherWorkspace.id,
            repositoryId: repoD,
            reviewSessionId: sessionOf(repoD),
            title: "Other workspace issue",
            severity: "HIGH" as const,
            category: "SECURITY" as const,
            status: "OPEN" as const,
          },
        ]);

        const scope = { workspaceId: workspace.id, projectId: project.id };
        const listWith = (filter: Partial<IssueFilter>) =>
          findIssues(scope, { ...allIssues(), ...filter }, tx);

        // ① 선택지는 이 Project 의 저장소뿐이다 — 형제 Project 도 다른 Workspace 도 없다.
        const options = await listRepositoryOptions(scope, tx);
        expect(options.map((option) => option.fullName)).toEqual([
          "acme/repo-a",
          "acme/repo-b",
        ]);
        expect(options.map((option) => option.id).sort()).toEqual(
          [repoA, repoB].sort(),
        );

        // ② 전체 저장소 = Filter 를 걸지 않은 기존 결과 그대로.
        const all = await listWith({});
        expect(all.total).toBe(5);
        expect(
          all.items.map((issue) => issue.repositoryFullName).sort(),
        ).toEqual([
          "acme/repo-a",
          "acme/repo-a",
          "acme/repo-a",
          "acme/repo-b",
          "acme/repo-b",
        ]);

        // ③ 저장소 A 만.
        const onlyA = await listWith({ repositoryId: repoA });
        expect(onlyA.total).toBe(3);
        expect(
          onlyA.items.every(
            (issue) => issue.repositoryFullName === "acme/repo-a",
          ),
        ).toBe(true);

        // ④ 저장소 B 만.
        const onlyB = await listWith({ repositoryId: repoB });
        expect(onlyB.total).toBe(2);
        expect(
          onlyB.items.every(
            (issue) => issue.repositoryFullName === "acme/repo-b",
          ),
        ).toBe(true);

        // ⑤ 저장소 + 심각도 — HIGH 는 A·B 에 하나씩 있으므로 AND 가 아니면 2건이 된다.
        const highInA = await listWith({
          repositoryId: repoA,
          severity: "HIGH",
        });
        expect(highInA.total).toBe(1);
        expect(highInA.items[0]?.title).toBe("Refresh token race condition");

        // ⑥ 저장소 + 분류.
        const validationInA = await listWith({
          repositoryId: repoA,
          category: "VALIDATION",
        });
        expect(validationInA.items.map((issue) => issue.title)).toEqual([
          "Missing validation",
        ]);
        expect(
          (await listWith({ repositoryId: repoB, category: "VALIDATION" }))
            .total,
        ).toBe(0);

        // ⑦ 저장소 + 상태.
        const resolvedInA = await listWith({
          repositoryId: repoA,
          status: "RESOLVED",
        });
        expect(resolvedInA.items.map((issue) => issue.title)).toEqual([
          "N plus one query",
        ]);

        // ⑧ 저장소 + 검색어 — 같은 제목이 두 저장소에 있어 저장소를 바꾸면 결과가 갈린다.
        const searchAll = await listWith({ q: "Refresh token" });
        expect(searchAll.total).toBe(2);
        expect(
          (await listWith({ repositoryId: repoA, q: "Refresh token" })).total,
        ).toBe(1);
        expect(
          (await listWith({ repositoryId: repoB, q: "Refresh token" })).total,
        ).toBe(1);

        /*
 ⑨ 쪽 나누기와 건수가 Filter 를 따라간다.

 🔴 **`total` 이 5(전체)가 아니라 3(저장소 A)이어야 한다** — 세는 질의에 같은 조건이
 걸리지 않으면 2쪽이 있다고 그려 놓고 빈 표가 나온다.
 */
        const pageOne = await listWith({
          repositoryId: repoA,
          pageSize: 25,
          page: 1,
        });
        expect(pageOne.total).toBe(3);

        const smallPageOne = await listWith({
          repositoryId: repoA,
          pageSize: 2,
          page: 1,
        });
        expect(smallPageOne.total).toBe(3);
        expect(smallPageOne.items).toHaveLength(2);

        const smallPageTwo = await listWith({
          repositoryId: repoA,
          pageSize: 2,
          page: 2,
        });
        expect(smallPageTwo.total).toBe(3);
        expect(smallPageTwo.items).toHaveLength(1);
        expect(smallPageTwo.page).toBe(2);
        // 쪽이 갈려도 같은 Issue 를 두 번 그리지 않는다.
        expect(
          new Set(
            [...smallPageOne.items, ...smallPageTwo.items].map(
              (issue) => issue.id,
            ),
          ).size,
        ).toBe(3);

        // ⑩ 초기화 = 전체 저장소. 좁혔던 것이 그대로 되돌아온다.
        expect((await listWith({})).total).toBe(all.total);

        /*
 ⑪ 🔴 **남의 저장소 식별자를 주소로 밀어 넣어도 아무것도 새지 않는다.**

 형제 Project 의 것도, 다른 Workspace 의 것도 0건이다 — 「전체」로 넓어지지도 않는다.
 */
        for (const foreign of [repoC, repoD]) {
          const injected = await listWith({ repositoryId: foreign });
          expect(injected.items).toEqual([]);
          expect(injected.total).toBe(0);
        }

        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
