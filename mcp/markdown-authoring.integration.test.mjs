import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { renderMarkdownViewMarkup } from "../src/components/molecules/markdown-view-testing.ts";
import { db } from "../src/db/index.ts";
import {
  projects,
  repositories,
  issueActivities,
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

/**
 * 시험용 Workspace -> Project -> Repository -> ReviewSession 과, 그 위에 붙은 MCP handler.
 *
 * 🔴 **제품과 «같은» Application Service 를 통과시킨다** — handler 가 부르는 것은
 * `appendReviewIssues` 다. mock 을 끼우면 「MCP 가 보낸 문자열이 DB 에 그대로 남는가」를
 * 증명하지 못한다.
 */
async function makeFixture(tx) {
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
    .values({ workspaceId: workspace.id, slug: "markdown", name: "Markdown" })
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
  return { workspace, project, repository, review, handlers };
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
        "저장소 자동 인식 검증 — 개발 브랜치에서 생성한 리뷰\n\n- 원인 A\n- `project_id` 불일치";
      const failurePath =
        "1. `git remote`를 읽는다.\n2. Repository 없이 Workspace 전체를 조회한다.";
      await handlers.get("add_issue")({
        severity: "HIGH",
        category: "API",
        title: "Markdown contract",
        problem: description,
        failurePath,
        suggestion: "- 공통 resolver를 쓴다.\n- `workspace_id`를 검증한다.",
        solution: "공통 `RepositoryContextResolver`를 적용했다.",
        decisionReason: "Credential 회전과 독립적인 Principal 설정을 유지한다.",
        verification:
          "- 한글 paragraph를 확인했다.\n- `ci_agent_` identifier를 유지했다.",
        regressionTest: "UTF-8 JSON round-trip test가 재발을 막는다.",
      });

      const [stored] = await tx
        .select({
          id: reviewIssues.id,
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
      const [activity] = await tx
        .select({
          solution: issueActivities.solution,
          decisionReason: issueActivities.decisionReason,
          verification: issueActivities.verification,
          regressionTest: issueActivities.regressionTest,
        })
        .from(issueActivities)
        .where(eq(issueActivities.reviewIssueId, stored.id));
      expect(activity).toEqual({
        solution: "공통 `RepositoryContextResolver`를 적용했다.",
        decisionReason:
          "Credential 회전과 독립적인 Principal 설정을 유지한다.",
        verification:
          "- 한글 paragraph를 확인했다.\n- `ci_agent_` identifier를 유지했다.",
        regressionTest: "UTF-8 JSON round-trip test가 재발을 막는다.",
      });
      const markup = renderMarkdownViewMarkup(
        `${stored.description}\n\n${stored.failurePath}`,
      );
      expect(markup).toContain("<p ");
      expect(markup).toContain("<ul");
      expect(markup).toContain("<ol");
      expect(markup).toContain("<code");
      expect(markup).toContain("저장소 자동 인식 검증 — 개발 브랜치");
    });
  });
});

/**
 * 🔴 **계약이 「써도 된다」고 말한 구조를 renderer 가 실제로 그리는가.**
 *
 * authoring contract 는 heading · bold · nested list · fenced code block 까지 허용한다.
 * 그런데 Agent 가 그렇게 썼을 때 화면이 그리지 못하면, 계약이 Agent 를 잘못된 곳으로
 * 이끄는 셈이다. 여기서는 **renderer 를 고치기 전에** 그 구조들이 실제로 살아 나오는지
 * 부터 확인한다 — screenshot 만 보고 CSS 를 먼저 손대지 않는다.
 *
 * 🔴 **Markdown 원문이 정본이다.** DB 에는 Agent 가 쓴 문자열이 한 글자도 바뀌지 않고
 * 남아야 하고, 화면은 그것을 읽어 그릴 뿐이다.
 */
describe.skipIf(!enabled)("MCP Markdown 구조 전체 round-trip", () => {
  it("heading·bold·nested list·fenced code가 DB 원문과 렌더 결과에 모두 살아 있다", async () => {
    await inRollback(async (tx) => {
      const fixture = await makeFixture(tx);

      /**
       * 사람이 손으로 만든 template 이 아니라, 계약이 «그렇게 쓰라»고 말한 모양이다 —
       * 논점이 둘로 갈리는 rootCause, 순서가 있는 failurePath, 근거 snippet.
       */
      const rootCause = [
        "`buildFilePriority`가 빈 목록에서 정수 리터럴 하나를 그대로 돌려주기 때문이다.",
        "",
        "## 왜 질의가 죽는가",
        "",
        "PostgreSQL은 `ORDER BY`의 맨몸 정수를 값이 아니라 **select list의 순번**으로 읽는다.",
        "0번 열은 없으므로 `42P10`으로 질의 전체가 실패한다.",
        "",
        "## 왜 시험이 잡지 못했는가",
        "",
        "- 단위 시험은 `changedFiles`를 늘 채워 넣었다",
        "  - 빈 목록 분기를 한 번도 밟지 않았다",
        "- route 시험은 preflight 자체를 mock 했다",
      ].join("\n");
      const failurePath = [
        "1. Agent가 `changedFiles` 없이 `POST /api/v1/reviews`를 부른다.",
        "2. `buildFilePriority([])`가 `0`을 돌려준다.",
        "3. `ORDER BY 0 DESC`가 나가 `42P10`으로 실패한다.",
        "4. 응답은 `available: false`만 남아 아무도 눈치채지 못한다.",
      ].join("\n");
      const solution = [
        "cast를 붙여 순번이 아니라 **식**으로 만들었다.",
        "",
        "```ts",
        "if (changedFiles.length === 0) return sql<number>`0::int`;",
        "```",
      ].join("\n");

      await fixture.handlers.get("add_issue")({
        severity: "CRITICAL",
        category: "DATABASE",
        title: "빈 changedFiles에서 preflight가 죽는다",
        rootCause,
        failurePath,
        solution,
      });

      const [stored] = await tx
        .select({
          id: reviewIssues.id,
          rootCause: reviewIssues.rootCause,
          failurePath: reviewIssues.failurePath,
        })
        .from(reviewIssues)
        .where(
          and(
            eq(reviewIssues.workspaceId, fixture.workspace.id),
            eq(reviewIssues.repositoryId, fixture.repository.id),
          ),
        )
        .limit(1);

      // 🔴 DB 에 남는 것은 Agent 가 쓴 Markdown 원문 그대로다.
      expect(stored.rootCause).toBe(rootCause);
      expect(stored.failurePath).toBe(failurePath);

      const [activity] = await tx
        .select({ solution: issueActivities.solution })
        .from(issueActivities)
        .where(eq(issueActivities.reviewIssueId, stored.id));
      expect(activity.solution).toBe(solution);

      const markup = renderMarkdownViewMarkup(
        `${stored.rootCause}\n\n${stored.failurePath}\n\n${activity.solution}`,
      );

      /**
       * 🔴 heading 단계는 **부르는 쪽이 밝힌 자리 바로 아래**에서 시작한다.
       *
       * 예전에는 Markdown 깊이가 DOM 단계에 고정 대응했고(`h1`->`h2`, `h2`->`h3`), 그
       * 뒤에는 `baseHeadingLevel` 에 Markdown 깊이를 그대로 더했다 — 그래서 계약대로
       * `##` 로 시작한 이 문서가 `<h3>` 으로 나와 부모(`<h1>`)와의 사이에 `<h2>` 가
       * 비었다. 지금은 **문서의 첫 heading 이 그 문서의 최상위**라 `1` 을 넘긴 여기서
       * `<h2>` 다.
       *
       * 본문이 화면 제목과 «같은 급»이 되면 안 된다는 판단은 그대로다 — 그래서 `<h1>` 이
       * 나오지 않는지도 함께 본다.
       */
      expect(markup).toMatch(/<h2[ >]/);
      expect(markup).not.toMatch(/<h1[ >]/);
      /*
 🔴 **`rootCause` 의 `##` 둘은 «형제»다.** 시작 깊이를 옮기면서 형제까지 한 칸씩 내려가면
 안 된다 — 그러면 나란한 두 논점이 상하 관계로 읽힌다.
      */
      expect((markup.match(/<h2[ >]/g) ?? []).length).toBe(2);
      // bold.
      expect(markup).toMatch(/<strong[ >]/);
      // nested list — ul 안에 ul 이 있다.
      expect(markup).toMatch(/<ul[^>]*>[\s\S]*<ul[^>]*>/);
      // ordered list.
      expect(markup).toMatch(/<ol[ >]/);
      // fenced code block 은 pre > code 다(inline code 와 구분된다).
      expect(markup).toMatch(/<pre[\s\S]*<code/);
      // inline code 도 함께.
      expect(markup).toContain("buildFilePriority");
      // 🔴 raw HTML 은 렌더하지 않는다 — 계약이 금지하는 것을 renderer 도 막는다.
      const injected = renderMarkdownViewMarkup(
        "<script>alert(1)</script>\n\n일반 문단",
      );
      expect(injected).not.toContain("<script>");
      expect(injected).toContain("일반 문단");
    });
  });
});
