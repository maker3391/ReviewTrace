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
import { findIssues } from "@/features/issues/server/issue-query";
import { listRepositoryStatuses } from "@/features/repositories/server/repository-query";
import { findProjectReviewPage } from "@/features/reviews/server/review-query";

const enabled = process.env.DB_INTEGRATION === "true";
beforeAll(() => {
  if (enabled) loadIntegrationDbEnv();
});

class Rollback extends Error {}

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
          findIssues(
            scope,
            {
              q: "",
              severity: "ALL",
              category: "ALL",
              status: "ALL",
              page: 1,
              pageSize: 25,
            },
            tx,
          ),
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
});
