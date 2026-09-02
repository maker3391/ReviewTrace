import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./git.mjs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readRepositoryContext: vi.fn() };
});

const { readRepositoryContext } = await import("./git.mjs");
const { registerTools } = await import("./tools.mjs");

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * 🔴 **한 세션의 기억이 다른 세션으로 새면 안 된다.**
 *
 * Claude Code 는 stdio MCP Server 를 **client(세션)마다 하나씩** 띄운다 — 그래서 지금은
 * `server.mjs` 의 `state` 객체 하나가 곧 한 세션이고, 서로 다른 세션은 서로 다른
 * 프로세스라 섞이지 않는다(실측: 2026-09-02, `claude.exe` 두 개 → `mcp/server.mjs` 두 개).
 *
 * 그 안전은 **「`registerTools` 가 module scope 에 변경 가능한 값을 두지 않는다」** 하나에
 * 걸려 있다. 편의를 위해 `lastReviewId`·`lastIssueId`·`encounteredIssueIds` 중 하나라도
 * module 최상위 `let` 으로 올리는 순간, 한 프로세스가 두 맥락을 받는 자리
 * (subagent · 추가 작업 디렉터리 · worktree · 언젠가의 HTTP transport)에서
 * **A 가 B 의 Issue 를 닫는다.** 이 시험이 그 자리를 지킨다.
 *
 * 두 세션을 흉내 내는 방법은 실제 구조 그대로다 — `registerTools(server, client, state)` 를
 * **서로 다른 `state` 로 두 번** 부른다. module scope 로 올라간 값은 이 시험에서
 * 두 번째 세션이 첫 번째를 덮는 형태로 드러난다.
 */

/** `registerTool(name, meta, handler)` 를 받아 두었다가 핸들러를 직접 부른다. */
function session(client, state = { pendingReviewKey: null }) {
  const handlers = new Map();
  const server = {
    registerTool(name, meta, handler) {
      handlers.set(name, handler);
    },
  };
  registerTools(server, client, state, { reviewLanguage: "ko" });
  handlers.state = state;
  return handlers;
}

function resultOf(toolResult) {
  return JSON.parse(toolResult.content[0].text);
}

function repositoryContext(fullName, commitSha) {
  const [owner, name] = fullName.split("/");
  return {
    provider: "GITHUB",
    owner,
    name,
    fullName,
    htmlUrl: `https://github.com/${fullName}`,
    defaultBranch: "main",
    commitSha,
    branch: "main",
    workspaceSlug: null,
    changedFiles: [],
    changedFilesAvailable: true,
  };
}

describe("세션 사이의 기억 격리", () => {
  it("두 세션이 각자 만든 Issue 를 닫는다 — issueId 를 생략해도 서로를 덮지 않는다", async () => {
    const updateStatus = vi.fn(async () => ({ issue: { status: "RESOLVED" } }));
    const appendIssuesA = vi.fn(async () => ({
      issues: [{ id: "issue-a", alreadyKnown: false, status: "OPEN" }],
    }));
    const appendIssuesB = vi.fn(async () => ({
      issues: [{ id: "issue-b", alreadyKnown: false, status: "OPEN" }],
    }));

    const a = session({ appendIssues: appendIssuesA, updateStatus });
    const b = session({ appendIssues: appendIssuesB, updateStatus });

    // A: 문제 하나 → B: 문제 하나 → B 가 닫고 → A 가 닫는다 (실제 A/B 교차 순서)
    await a.get("add_issue")({
      reviewId: "review-a",
      severity: "HIGH",
      category: "CONCURRENCY",
      title: "A 의 문제",
    });
    await b.get("add_issue")({
      reviewId: "review-b",
      severity: "LOW",
      category: "CLEAN_CODE",
      title: "B 의 문제",
    });
    await b.get("resolve_issue")({ resolution: "B 가 고쳤다" });
    await a.get("resolve_issue")({ resolution: "A 가 고쳤다" });

    expect(updateStatus.mock.calls.map(([issueId]) => issueId)).toEqual([
      "issue-b",
      "issue-a",
    ]);
    expect(a.state.lastIssueId).toBe("issue-a");
    expect(b.state.lastIssueId).toBe("issue-b");
  });

  it("한 세션의 create_review 가 다른 세션의 열린 Review 를 지우지 않는다", async () => {
    readRepositoryContext.mockResolvedValue(
      repositoryContext("acme/repo-b", "b".repeat(40)),
    );
    const appendIssues = vi.fn(async () => ({
      issues: [{ id: "issue-a", alreadyKnown: false, status: "OPEN" }],
    }));
    const createReview = vi.fn(async () => ({ reviewSessionId: "review-b" }));

    const a = session({ appendIssues });
    const b = session({ createReview });

    a.state.reviewId = "review-a";
    a.state.lastIssueId = "issue-previous";

    await b.get("create_review")({ reviewer: "session-b" });

    // 🔴 B 의 create_review 는 «자기» 세션만 비운다.
    expect(b.state.reviewId).toBe("review-b");
    expect(b.state.lastIssueId).toBeNull();
    expect(a.state.reviewId).toBe("review-a");
    expect(a.state.lastIssueId).toBe("issue-previous");

    // reviewId 를 생략한 A 의 add_issue 는 여전히 A 의 Review 로 간다.
    await a.get("add_issue")({
      severity: "HIGH",
      category: "RELIABILITY",
      title: "A 의 문제",
    });
    expect(appendIssues.mock.calls[0][0]).toBe("review-a");
  });

  it("encounter 표시가 세션을 넘지 않는다 — 다른 세션의 재발이 통째로 빠지지 않는다", async () => {
    const appendIssues = vi.fn(async () => ({
      issues: [{ id: "issue-x", alreadyKnown: true, status: "RESOLVED" }],
    }));
    const updateStatus = vi.fn(async () => ({ issue: { status: "REOPENED" } }));
    const addActivity = vi.fn(async () => ({}));

    const a = session({ appendIssues, updateStatus, addActivity });
    const b = session({ appendIssues, updateStatus, addActivity });

    // A 가 같은 Issue 를 다시 만나 서버가 이번 Review 의 REVIEWED_AGAIN 을 남겼다.
    await a.get("add_issue")({
      reviewId: "review-a",
      severity: "HIGH",
      category: "RELIABILITY",
      title: "재발",
      externalId: "stable-1",
    });
    expect(a.state.encounteredIssueIds.has("issue-x")).toBe(true);

    // B 는 그 Issue 를 곧바로 다시 열었다 — B 의 Review 에는 encounter 가 아직 없다.
    b.state.lastIssueId = "issue-x";
    const reopened = resultOf(
      await b.get("review_again")({ stillPresent: true, summary: "또 있다" }),
    );

    expect(b.state.encounteredIssueIds?.has?.("issue-x")).toBe(true);
    // 🔴 A 의 표시 때문에 B 의 재발 한 줄이 사라지면 안 된다.
    expect(addActivity).toHaveBeenCalledWith(
      "issue-x",
      expect.objectContaining({ type: "REVIEWED_AGAIN" }),
    );
    expect(reopened.안내).toContain("encounter 를 남겼다");
  });

  it("Idempotency-Key 가 세션마다 다르다 — 다른 저장소의 Review 가 replay 로 접히지 않는다", async () => {
    const createReviewA = vi.fn(async () => ({ reviewSessionId: "review-a" }));
    const createReviewB = vi.fn(async () => ({ reviewSessionId: "review-b" }));

    readRepositoryContext.mockResolvedValueOnce(
      repositoryContext("acme/repo-a", "a".repeat(40)),
    );
    const a = session({ createReview: createReviewA });
    await a.get("create_review")({ reviewer: "session-a" });

    readRepositoryContext.mockResolvedValueOnce(
      repositoryContext("acme/repo-b", "b".repeat(40)),
    );
    const b = session({ createReview: createReviewB });
    await b.get("create_review")({ reviewer: "session-b" });

    const keyA = createReviewA.mock.calls[0][1];
    const keyB = createReviewB.mock.calls[0][1];
    expect(typeof keyA).toBe("string");
    expect(typeof keyB).toBe("string");
    expect(keyA).not.toBe(keyB);
  });
});
