import { describe, expect, it, vi } from "vitest";

vi.mock("./git.mjs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readRepositoryContext: vi.fn() };
});

const { readRepositoryContext } = await import("./git.mjs");
const { registerTools } = await import("./tools.mjs");

/**
 * `get_repository_knowledge` 가 **어느 범위를 본 것인지 응답에 남기는가**.
 *
 * 🔴 git 을 못 읽으면(`origin` 없음 · GitHub 이 아닌 remote · git 미설치) 저장소를 좁히지
 * 못해 서버가 **Workspace 전체**의 Pattern·미해결 문제·과거 해결을 돌려준다. Tool 이름과
 * 설명은 「이 저장소의」라서, 표시가 없으면 Agent 는 남의 저장소 이야기를 이 저장소의
 * 규칙으로 읽는다 — 오류도 경고도 없이 판단만 틀어진다.
 *
 * ## 되돌림 확인
 *
 * `tools.mjs` 에서 `repository` 표시를 지우면 「좁히지 못하면 (전체) 라고 알린다」가,
 * 표시를 spread **앞**으로 되돌리면 「서버 응답이 표시를 덮지 못한다」가 실패한다.
 */

/** 실제 서버(`knowledge-context-query.ts`)가 돌려주는 여섯 칸. `repository` 는 없다. */
function knowledgeContextResponse() {
  return {
    scope: { projectSlug: null, projectResolved: null },
    wiki: [{ slug: "rules", title: "규칙" }],
    frequentPatterns: [{ patternKey: "n-plus-one", occurrences: 3 }],
    recentHighSeverityIssues: [],
    unresolvedIssues: [{ id: "i-1" }],
    pastResolutions: [],
  };
}

/** `registerTool(name, meta, handler)` 를 받아 두었다가 핸들러를 직접 부를 수 있게 한다. */
function captureTools(client) {
  const handlers = new Map();
  const server = {
    registerTool(name, _meta, handler) {
      handlers.set(name, handler);
    },
  };
  registerTools(server, client, { pendingReviewKey: null });
  return handlers;
}

/** `guard` 가 결과를 JSON 문자열로 감싼다. 그것을 되돌려 읽는다. */
function resultOf(toolResult) {
  return JSON.parse(toolResult.content[0].text);
}

describe("get_repository_knowledge 의 범위 표시", () => {
  it("저장소를 좁혔으면 그 이름을 남기고, 서버가 준 칸을 하나도 잃지 않는다", async () => {
    const client = {
      knowledgeContext: vi.fn(async () => knowledgeContextResponse()),
    };
    const handlers = captureTools(client);

    const result = resultOf(
      await handlers.get("get_repository_knowledge")({
        repository: "acme/app",
      }),
    );

    expect(result.repository).toBe("acme/app");
    // spread 가 칸을 잃지 않았는가
    expect(Object.keys(result).sort()).toEqual(
      [
        "frequentPatterns",
        "pastResolutions",
        "recentHighSeverityIssues",
        "repository",
        "scope",
        "unresolvedIssues",
        "wiki",
      ].sort(),
    );
    expect(result.wiki).toHaveLength(1);
    expect(result.frequentPatterns[0].patternKey).toBe("n-plus-one");
  });

  it("🔴 git 을 못 읽어 좁히지 못하면 (전체) 라고 알린다", async () => {
    readRepositoryContext.mockRejectedValueOnce(
      new Error("not a git repository"),
    );
    const client = {
      knowledgeContext: vi.fn(async () => knowledgeContextResponse()),
    };
    const handlers = captureTools(client);

    const result = resultOf(await handlers.get("get_repository_knowledge")({}));

    // 되돌리면 이 칸 자체가 사라진다 — Agent 는 전체를 이 저장소 것으로 읽는다.
    expect(result.repository).toBe("(전체)");
    // 좁히지 못했으니 서버에도 저장소를 넘기지 않는다.
    expect(client.knowledgeContext).toHaveBeenCalledWith({
      repository: undefined,
      limit: undefined,
    });
  });

  it("🔴 서버 응답이 범위 표시를 덮지 못한다", async () => {
    // 서버가 나중에 repository 칸을 갖게 되는 경우다.
    const client = {
      knowledgeContext: vi.fn(async () => ({
        ...knowledgeContextResponse(),
        repository: "서버가-보낸-다른-값",
      })),
    };
    const handlers = captureTools(client);

    const result = resultOf(
      await handlers.get("get_repository_knowledge")({
        repository: "acme/app",
      }),
    );

    // 표시를 spread 앞으로 되돌리면 여기서 "서버가-보낸-다른-값" 이 된다.
    expect(result.repository).toBe("acme/app");
  });
});
