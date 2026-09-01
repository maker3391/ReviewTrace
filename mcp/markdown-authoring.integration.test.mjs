import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { MarkdownView } from "../src/components/molecules/MarkdownView.tsx";
import { db } from "../src/db/index.ts";
import {
  projects,
  repositories,
  reviewIssues,
  reviewSessions,
  users,
  workspaces,
} from "../src/db/schema/index.ts";
import { loadIntegrationDbEnv } from "../src/db/testing/integration-env.ts";
import { appendReviewIssues } from "../src/features/reviews/server/review-ingest-service.ts";
import { registerTools } from "./tools.mjs";

const enabled = process.env.DB_INTEGRATION === "true";
beforeAll(() => {
  if (enabled) loadIntegrationDbEnv();
});
class Rollback extends Error {}

async function inRollback(run) {
  try {
    await db().transaction(async (tx) => {
      await run(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

describe.skipIf(!enabled)("MCP Markdown normal path", () => {
  it("MCP add_issue → ingestion → raw DB → Markdown renderer가 문서 구조를 보존한다", async () => {
    await inRollback(async (tx) => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const [user] = await tx
        .insert(users)
        .values({ email: `mcp-${suffix}@example.test` })
        .returning({ id: users.id });
      const [workspace] = await tx
        .insert(workspaces)
        .values({ slug: `mcp-${suffix}`, name: "MCP", createdBy: user.id })
        .returning({ id: workspaces.id });
      const [project] = await tx
        .insert(projects)
        .values({
          workspaceId: workspace.id,
          slug: "markdown",
          name: "Markdown",
        })
        .returning({ id: projects.id });
      const [repository] = await tx
        .insert(repositories)
        .values({
          workspaceId: workspace.id,
          projectId: project.id,
          provider: "GITHUB",
          externalRepositoryId: `mcp-${suffix}`,
          owner: "acme",
          name: "app",
          fullName: "acme/app",
          defaultBranch: "main",
        })
        .returning({ id: repositories.id });
      const [review] = await tx
        .insert(reviewSessions)
        .values({
          workspaceId: workspace.id,
          repositoryId: repository.id,
          targetType: "COMMIT",
          commitSha: "a81f3c2",
          reviewerType: "AGENT",
          reviewerName: "codex",
        })
        .returning({ id: reviewSessions.id });

      const handlers = new Map();
      registerTools(
        {
          registerTool(name, _meta, handler) {
            handlers.set(name, handler);
          },
        },
        {
          appendIssues: (reviewSessionId, issues) =>
            appendReviewIssues(
              { workspaceId: workspace.id, reviewSessionId, issues },
              tx,
            ),
        },
        { reviewId: review.id, lastIssueId: null, pendingReviewKey: null },
      );

      const description =
        "첫 문단은 문제를 설명한다.\n\n- 원인 A\n- `project_id` 불일치";
      const failurePath =
        "1. `git remote`를 읽는다.\n2. Repository 없이 Workspace 전체를 조회한다.";
      await handlers.get("add_issue")({
        severity: "HIGH",
        category: "API",
        title: "Markdown contract",
        problem: description,
        failurePath,
        suggestion: "- 공통 resolver를 쓴다.\n- `workspace_id`를 검증한다.",
      });

      const [stored] = await tx
        .select({
          description: reviewIssues.description,
          failurePath: reviewIssues.failurePath,
          suggestion: reviewIssues.suggestion,
        })
        .from(reviewIssues)
        .where(
          and(
            eq(reviewIssues.workspaceId, workspace.id),
            eq(reviewIssues.repositoryId, repository.id),
          ),
        )
        .limit(1);
      expect(stored.description).toBe(description);
      expect(stored.failurePath).toBe(failurePath);
      const markup = renderToStaticMarkup(
        createElement(MarkdownView, {
          content: `${stored.description}\n\n${stored.failurePath}`,
          emptyLabel: "Empty",
        }),
      );
      expect(markup).toContain("<p ");
      expect(markup).toContain("<ul");
      expect(markup).toContain("<ol");
      expect(markup).toContain("<code");
    });
  });
});
