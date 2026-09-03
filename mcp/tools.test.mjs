import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./git.mjs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readRepositoryContext: vi.fn() };
});

const { readRepositoryContext } = await import("./git.mjs");
const {
  HISTORICAL_PRECEDENT_SAFETY,
  EVIDENCE_COMMIT_CONTRACT,
  NARRATIVE_FIELD_HINT,
  NARRATIVE_MARKDOWN,
  STANDALONE_FIELD_HINT,
  SUMMARY_FIELD_HINT,
  registerTools,
  reviewLanguageInstruction,
} = await import("./tools.mjs");

beforeEach(() => {
  vi.clearAllMocks();
});

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
function captureTools(client, options) {
  const handlers = new Map();
  const metadata = new Map();
  const server = {
    registerTool(name, meta, handler) {
      handlers.set(name, handler);
      metadata.set(name, meta);
    },
  };
  registerTools(server, client, { pendingReviewKey: null }, options);
  handlers.metadata = metadata;
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

    expect(result.requestedRepository).toBe("acme/app");
    // spread 가 칸을 잃지 않았는가
    expect(Object.keys(result).sort()).toEqual(
      [
        "frequentPatterns",
        "pastResolutions",
        "recentHighSeverityIssues",
        "requestedRepository",
        "scope",
        "unresolvedIssues",
        "wiki",
      ].sort(),
    );
    expect(result.wiki).toHaveLength(1);
    expect(result.frequentPatterns[0].patternKey).toBe("n-plus-one");
  });

  it("🔴 git 을 못 읽으면 Workspace 전체로 확대하지 않고 실패한다", async () => {
    readRepositoryContext.mockRejectedValueOnce(
      new Error("not a git repository"),
    );
    const client = {
      knowledgeContext: vi.fn(async () => knowledgeContextResponse()),
    };
    const handlers = captureTools(client);

    const result = await handlers.get("get_repository_knowledge")({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("repository에 owner/name");
    expect(client.knowledgeContext).not.toHaveBeenCalled();
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
    expect(result.requestedRepository).toBe("acme/app");
  });
});

describe("create_review source context", () => {
  it.each(["develop", "feature/source-context", null])(
    "sends current branch=%s and immutable HEAD without substituting defaultBranch",
    async (branch) => {
      readRepositoryContext.mockResolvedValueOnce({
        provider: "GITHUB",
        owner: "acme",
        name: "app",
        fullName: "acme/app",
        htmlUrl: "https://github.com/acme/app",
        defaultBranch: "main",
        commitSha: "a".repeat(40),
        branch,
        workspaceSlug: null,
        changedFiles: ["src/app.ts"],
      });
      const createReview = vi.fn(async () => ({
        reviewSessionId: "review-1",
        knowledgePreflight: {
          available: true,
          relevantPastIssues: [{ issueId: "past-1" }],
        },
      }));
      const handlers = captureTools({ createReview });

      const result = resultOf(await handlers.get("create_review")({}));

      expect(createReview.mock.calls[0][0]).toMatchObject({
        repository: { defaultBranch: "main" },
        target: {
          type: "COMMIT",
          branch,
          commitSha: "a".repeat(40),
          changedFiles: ["src/app.ts"],
        },
      });
      expect(result.knowledgePreflight.relevantPastIssues[0].issueId).toBe(
        "past-1",
      );
    },
  );
});

describe("resolved Issue recurrence lifecycle", () => {
  it("returns currentStatus and explicitly requires review_again before reopening", async () => {
    const appendIssues = vi.fn(async () => ({
      issues: [
        {
          id: "issue-1",
          alreadyKnown: true,
          status: "RESOLVED",
          currentStatus: "RESOLVED",
        },
      ],
    }));
    const updateStatus = vi.fn(async () => ({ issue: { status: "REOPENED" } }));
    const addActivity = vi.fn(async () => ({}));
    const handlers = captureTools({ appendIssues, updateStatus, addActivity });

    const added = resultOf(
      await handlers.get("add_issue")({
        reviewId: "review-1",
        severity: "HIGH",
        category: "RELIABILITY",
        title: "재발",
        externalId: "stable-1",
      }),
    );

    expect(added).toMatchObject({
      issueId: "issue-1",
      alreadyKnown: true,
      currentStatus: "RESOLVED",
    });
    expect(added.안내).toContain("review_again(stillPresent=true)");

    const reviewed = resultOf(
      await handlers.get("review_again")({
        stillPresent: true,
        summary: "현재 HEAD에서도 재현된다.",
      }),
    );
    expect(updateStatus).toHaveBeenCalledWith(
      "issue-1",
      expect.objectContaining({
        status: "REOPENED",
        resolutionSummary: "현재 HEAD에서도 재현된다.",
      }),
    );
    expect(addActivity).not.toHaveBeenCalled();
    expect(reviewed.currentStatus).toBe("REOPENED");
  });

  it("records the encounter when review_again reopens an Issue add_issue never touched", async () => {
    const updateStatus = vi.fn(async () => ({ issue: { status: "REOPENED" } }));
    const addActivity = vi.fn(async () => ({}));
    const handlers = captureTools({ updateStatus, addActivity });

    const reviewed = resultOf(
      await handlers.get("review_again")({
        issueId: "issue-9",
        stillPresent: true,
        summary: "get_issue 로 찾아 바로 다시 열었다.",
      }),
    );

    expect(updateStatus).toHaveBeenCalledWith(
      "issue-9",
      expect.objectContaining({ status: "REOPENED" }),
    );
    // 🔴 add_issue 를 거치지 않은 재발도 encounter 다 — 아무도 남기지 않으면 통째로 빠진다.
    expect(addActivity).toHaveBeenCalledWith(
      "issue-9",
      expect.objectContaining({ type: "REVIEWED_AGAIN" }),
    );
    expect(reviewed.issueId).toBe("issue-9");
  });

  it("counts one encounter per Review no matter how often review_again retries", async () => {
    const updateStatus = vi.fn(async () => ({ issue: { status: "REOPENED" } }));
    const addActivity = vi.fn(async () => ({}));
    const handlers = captureTools({ updateStatus, addActivity });

    await handlers.get("review_again")({ issueId: "issue-9", stillPresent: true });
    await handlers.get("review_again")({ issueId: "issue-9", stillPresent: true });

    expect(updateStatus).toHaveBeenCalledTimes(2);
    expect(addActivity).toHaveBeenCalledTimes(1);
  });

  it("does not add a second encounter when a plain review_again already recorded one", async () => {
    const updateStatus = vi.fn(async () => ({ issue: { status: "REOPENED" } }));
    const addActivity = vi.fn(async () => ({}));
    const handlers = captureTools({ updateStatus, addActivity });

    await handlers.get("review_again")({ issueId: "issue-9" });
    expect(addActivity).toHaveBeenCalledTimes(1);

    await handlers.get("review_again")({ issueId: "issue-9", stillPresent: true });
    expect(addActivity).toHaveBeenCalledTimes(1);
    expect(updateStatus).toHaveBeenCalledTimes(1);
  });
});

describe("get_issue Repository context", () => {
  it("warns without denying an authorized Issue from another local Repository", async () => {
    readRepositoryContext.mockResolvedValueOnce({ fullName: "acme/current" });
    const handlers = captureTools({
      getIssue: vi.fn(async () => ({
        issue: { id: "issue-1", repositoryFullName: "acme/other" },
      })),
    });

    const issue = resultOf(
      await handlers.get("get_issue")({ issueId: "issue-1" }),
    );
    expect(issue.repositoryFullName).toBe("acme/other");
    expect(issue.repositoryContextWarning).toContain("acme/current");
    expect(issue.repositoryContextWarning).toContain("acme/other");
  });

  it("makes historical precedent safety an explicit tool contract", () => {
    const handlers = captureTools({});
    expect(HISTORICAL_PRECEDENT_SAFETY).toContain("historical precedent");
    expect(HISTORICAL_PRECEDENT_SAFETY).toContain("dependency/version");
    expect(handlers.metadata.get("get_issue").description).toContain(
      "Evidence commit",
    );
  });
});

describe("Review Knowledge Markdown authoring contract", () => {
  it("paragraph/list/ordered list/inline code 원문을 add_issue payload에 그대로 보존한다", async () => {
    const appendIssues = vi.fn(async () => ({
      issues: [{ id: "issue-1", alreadyKnown: false }],
    }));
    const handlers = captureTools({ appendIssues });
    const problem = "첫 문단입니다.\n\n- 영향 A\n- 영향 B와 `HTTP 409`";
    const failurePath =
      "1. `POST /api/v1/reviews`를 호출한다.\n2. `projectSlug` 없이 resolution한다.";
    await handlers.get("add_issue")({
      reviewId: "review-1",
      severity: "HIGH",
      category: "API",
      title: "범위 오류",
      problem,
      failurePath,
      suggestion:
        "- `RepositoryContextResolver`를 사용한다.\n- tenant를 검증한다.",
    });
    const stored = appendIssues.mock.calls[0][1][0];
    expect(stored.description).toBe(problem);
    expect(stored.failurePath).toBe(failurePath);
    expect(stored.suggestion).toContain("- `RepositoryContextResolver`");
  });

  it("계약이 쓸 수 있는 구조를 «전부» 말한다", () => {
    for (const structure of [
      "문단",
      "subheading",
      "bold",
      "bullet",
      "ordered list",
      "nested list",
      "inline code",
      "fenced code block",
    ]) {
      expect(NARRATIVE_MARKDOWN).toContain(structure);
    }
  });

  /**
   * 🔴 **계약이 한 번 반대로 기울어 실제 결함을 냈다.**
   *
   * 「억지로 구조를 만들지 않는다」를 앞세웠더니 실제 Agent 가 서로 다른 논점 셋을
   * 긴 문단 셋으로 이어 붙여 블로그 글처럼 썼다(실제 MCP 로 만든 Issue 에서 확인).
   * 그래서 계약은 **information hierarchy 를 우선순위에 명시**하고 **paragraph wall 을
   * 이름으로 금지**해야 한다.
   */
  it("계약이 information hierarchy 를 우선순위와 금지로 못 박는다", () => {
    expect(NARRATIVE_MARKDOWN).toContain("information hierarchy");
    expect(NARRATIVE_MARKDOWN).toContain("paragraph wall");
    // 🔴 목표는 «스캔»이 아니라 «다시 쓸 수 있는 문서»다 — 훑히는 것은 읽는 방식일 뿐이다.
    expect(NARRATIVE_MARKDOWN).toContain("하나의 기술 문서");
    expect(NARRATIVE_MARKDOWN).toContain("읽는 방식이지 목표가 아니다");
    // 논점이 둘 이상이면 나눈다.
    expect(NARRATIVE_MARKDOWN).toContain("논점이 둘 이상");
  });

  /**
   * 🔴 **쓸 수 있는 것만 알려주면 Agent 는 전부 쓴다.**
   *
   * 목표는 Markdown 을 많이 쓰는 것이 아니라 읽히는 technical narrative 다 — 그래서
   * 계약은 「무엇을 쓰지 않는가」와 「무엇이 먼저인가」를 함께 말해야 한다.
   */
  it("계약이 남용 금지와 우선순위를 함께 말한다", () => {
    expect(NARRATIVE_MARKDOWN).toContain("금지");
    expect(NARRATIVE_MARKDOWN).toContain("모든 문장을 bullet");
    expect(NARRATIVE_MARKDOWN).toContain("장식");
    expect(NARRATIVE_MARKDOWN).toContain("raw HTML");
    // 짧은 내용은 문단 하나로 끝낼 수 있어야 한다 — 양쪽으로 기울지 않는다.
    expect(NARRATIVE_MARKDOWN).toContain("억지로");
    expect(NARRATIVE_MARKDOWN).toContain("ceremony");
    // 🔴 heading 을 field 이름으로 되풀이하지 않는다(UI 가 이미 그린다).
    expect(NARRATIVE_MARKDOWN).toContain("field 이름을 heading으로");
  });

  /**
   * 🔴 **heading level 을 말하지 않으면 Agent 는 한 층만 쓴다.**
   *
   * 계약은 「큰 topic 변화는 heading」이라고만 말했지 `##` 인지 `###` 인지 정하지
   * 않았다. 그 결과 저장된 38행 전수 조회에서 **`##` 가 0건**이고 쓰인 heading 은
   * `###` 하나뿐이었다 — 화면의 heading 계단은 두 칸인데 데이터가 한 칸만 쓰니
   * 층이 생기지 않았다.
   *
   * 이 시험은 계약이 **level 을 실제로 지정하는지**를 붙든다.
   */
  it("계약이 heading level 을 지정한다 — `##` 에서 시작해 `###` 로 내려간다", () => {
    expect(NARRATIVE_MARKDOWN).toContain("`##`에서 시작하고 그 아래 세부가 `###`다");
    expect(NARRATIVE_MARKDOWN).toContain("`#`은 쓰지 않는다");
    /*
 🔴 **「`###` 하나만 쓰지 마라」는 지웠다.** 층 «개수»를 지시하니 Agent 가 내용과 무관하게
 `##` 두 개를 세워 「긴 prose + heading 두 개」로 수렴했다. 층은 이제 관계가 정한다 —
 독립된 semantic topic 이 있으면 heading 이고, 없으면 만들지 않는다.
    */
    expect(NARRATIVE_MARKDOWN).not.toContain("`###` 하나로만 쓰지 않는다");
    expect(NARRATIVE_MARKDOWN).toContain("독립된 semantic topic은 heading");
  });

  /**
   * 🔴 **계약이 「어떻게 쓰는가」만 말하고 「무엇을 주어로 삼는가」를 말하지 않았다.**
   *
   * 위의 시험들은 전부 Markdown 구조에 관한 것이다. 그래서 계약을 **완벽히 지키면서도**
   * `<h4>` · `className` · DOM tag 를 주어로 삼은 「JSX debugging note」가 나올 수 있었다 —
   * 실제로 그렇게 쌓였다(2026-09-03). 형식은 옳고 추상화 수준이 틀린 경우다.
   *
   * 이 시험은 계약이 **추상화 수준**을 실제로 지정하는지를 붙든다.
   */
  it("계약이 narrative 의 서술 순서를 지정한다 — 현상 다음에 구체적인 technical cause 다", () => {
    expect(NARRATIVE_MARKDOWN).toContain(
      "technical cause와 그 cause가 현상을 만드는 이유",
    );
    // 🔴 숨기는 대상은 identifier 가 아니라 «source dump» 다. 둘을 갈라 말해야 한다.
    expect(NARRATIVE_MARKDOWN).toContain("숨기는 것은 identifier가 아니라");
    expect(NARRATIVE_MARKDOWN).toContain("그 자리는 Code Evidence다");
  });

  /**
   * 🔴 **추상화 규칙이 곧바로 반대편으로 넘어갔다.**
   *
   * 「identifier 는 최소한만」이 «정확도를 깎는» 쪽으로 작동해, 원인을 짚는 데 필요한
   * 이름까지 지운 은유적인 문장이 나왔다 — 「그런 통로가 없다」·「그 자리에 적힌 값이다」.
   * 읽는 사람이 다시 해석해야 하면 abstraction 이 아니라 **vagueness** 다.
   *
   * 이 시험은 계약이 **둘을 함께** 말하는지 붙든다 — 세부는 숨기되 문장은 직접적으로.
   */
  it("계약이 identifier 를 적극적으로 쓰라고 말한다 — 추상적 대체 표현을 이름으로 금지한다", () => {
    // 🔴 identifier 는 «허용» 이 아니라 «적극적으로 쓰라» 여야 한다 — 소극적 허용은 금지문을 못 이긴다.
    expect(NARRATIVE_MARKDOWN).toContain("«적극적으로» 쓴다");
    expect(NARRATIVE_MARKDOWN).toContain("은유·수사·돌려 말하기 금지");
    // 🔴 실제로 나왔던 추상 표현을 이름으로 금지한다.
    expect(NARRATIVE_MARKDOWN).toContain("«특정한 맥락»");
    // 🔴 heading 도 원인을 지목해야 한다 — 개념 라벨을 늘어놓으면 다시 기운다.
    expect(NARRATIVE_MARKDOWN).toContain("heading은 개념 라벨이 아니라");
  });

  /**
   * 🔴 **형식 규칙이 field 의 «목적»을 덮지 않는다.**
   *
   * 예전에는 이 문단 전체가 narrative field 마다 통째로 붙었다 — 목적은 여섯 글자인데
   * 형식 규칙이 그 열 배라, Agent 가 받는 신호에서 형식이 내용을 눌렀다. 전문은 server
   * instructions 가 한 번 말하고 field 설명에는 한 줄만 남는다.
   */
  it("field 설명이 형식 규칙 전문으로 덮이지 않는다", () => {
    const handlers = captureTools({});
    const rootCause =
      handlers.metadata.get("add_issue").inputSchema.rootCause.description;

    expect(rootCause).not.toContain(NARRATIVE_MARKDOWN);
    expect(rootCause).toContain(NARRATIVE_FIELD_HINT);
    // 그 칸이 무엇을 담는지가 설명의 절반 이상이어야 한다.
    expect(rootCause.indexOf(NARRATIVE_FIELD_HINT)).toBeGreaterThan(
      rootCause.length / 2,
    );
  });

  /**
   * 🔴 **field 설명은 «역할»만 말한다 — 형식은 말하지 않는다.**
   *
   * 예전에는 여섯 칸이 각자 형식을 지시했다(`failurePath` 는 「ordered list 로 쓴다」,
   * `tradeOff` 는 「여럿이면 bullet」…). field 설명은 작성 시점에 가장 가까이 붙어
   * **전역 규칙을 이긴다** — 그래서 계약의 관계->구조 대응표를 아무리 넓혀도 그 칸들은
   * 계속 자기 template 을 따랐다. 형식의 정본은 `NARRATIVE_MARKDOWN` 한 곳뿐이다.
   */
  it("field 설명은 형식이 아니라 그 칸의 역할을 말한다", () => {
    const handlers = captureTools({});
    const issue = handlers.metadata.get("add_issue").inputSchema;
    const fix = handlers.metadata.get("add_fix_attempt").inputSchema;

    // rootCause 는 cause 와 그것이 작동하는 이유만 담는다.
    expect(issue.rootCause.description).toContain("technical cause");
    expect(issue.rootCause.description).toContain("현상을 만드는 이유");
    // failurePath 는 순서·상태 변화·재현 과정이다 — 「무엇을」이지 「어떤 list 로」가 아니다.
    expect(issue.failurePath.description).toContain("순서·상태 변화·재현 과정");
    // tradeOff 는 장점 목록이 아니다.
    expect(fix.tradeOff.description).toContain("장점 목록이 아니라");
    // decisionReason 과 alternativesConsidered 는 겹쳐 적지 않는다.
    expect(fix.decisionReason.description).toContain("겹쳐 적지 않는다");
    // residualRisk 는 없는 위험을 만들지 않는다.
    expect(fix.residualRisk.description).toContain("없는 위험을 만들지 않는다");

    /*
 🔴 **형식 낱말이 field 설명에 «없어야» 한다.** 여기서 되돌아오면 대응표가 다시 무력해진다.
 `NARRATIVE_FIELD_HINT` 는 형식어를 담지 않으므로 설명 전체를 그대로 본다.
    */
    for (const description of [
      issue.failurePath.description,
      issue.suggestion.description,
      fix.solution.description,
      fix.tradeOff.description,
      fix.verification.description,
      fix.alternatives.description,
      fix.residualRisk.description,
    ]) {
      for (const format of [
        "ordered list",
        "bullet",
        "subheading",
        "inline code",
      ]) {
        expect(description).not.toContain(format);
      }
    }
    expect(fix.residualRisk.description).toContain("없는 위험을 만들지 않는다");
  });

  it.each([
    ["ko", "MUST be authored in Korean"],
    ["en", "MUST be authored in English"],
  ])("reviewLanguage=%s를 모든 narrative field 계약에 반영한다", (reviewLanguage, expected) => {
    const handlers = captureTools({}, { reviewLanguage });
    const addIssue = handlers.metadata.get("add_issue");
    const addFixAttempt = handlers.metadata.get("add_fix_attempt");
    const createReview = handlers.metadata.get("create_review");

    expect(createReview.inputSchema.summary.description).toContain(expected);
    expect(addIssue.inputSchema.title.description).toContain(expected);
    expect(addIssue.inputSchema.problem.description).toContain(expected);
    expect(addIssue.inputSchema.rootCause.description).toContain(expected);
    expect(addIssue.inputSchema.failurePath.description).toContain(expected);
    expect(addIssue.inputSchema.solution.description).toContain(expected);
    expect(addFixAttempt.inputSchema.summary.description).toContain(expected);
    expect(addFixAttempt.inputSchema.verification.description).toContain(
      expected,
    );
    /**
     * 🔴 형식 규칙 «전문»은 server instructions 가 한 번만 말한다. field 설명에는
     * 한 줄 요약만 붙어야 목적이 묻히지 않는다 — `problem` 은 그 한 줄이
     * `SUMMARY_FIELD_HINT` 다(아래 「요약 칸」 시험).
     */
    expect(addIssue.inputSchema.problem.description).not.toContain(
      NARRATIVE_MARKDOWN,
    );
    expect(addIssue.inputSchema.problem.description).toContain(
      SUMMARY_FIELD_HINT,
    );
  });

  /**
   * 🔴 **`description`(= `problem`) 은 다른 narrative field 와 규칙이 다르다.**
   *
   * 다른 칸은 「논점이 갈리면 나눠라」가 맞다. 이 칸은 Issue Detail 에서 **가장 먼저
   * 읽히는 자리**라, 그 뒤에 올 `rootCause`·`failurePath`·`suggestion` 을 미리 요약하면
   * 사용자가 같은 이야기를 두 번 읽는다 — 실제로 생성된 `description` 의 둘째 문단이
   * `rootCause` 의 「구조적 문제」와 겹쳤다.
   *
   * 그래서 이 칸에는 구조를 «권하는» 한 줄(`NARRATIVE_FIELD_HINT`)이 붙으면 안 된다.
   */
  it("요약 칸(problem)은 구조 강제 대신 «먼저 읽히는 요약» 규칙을 받는다", () => {
    const handlers = captureTools({});
    const problem =
      handlers.metadata.get("add_issue").inputSchema.problem.description;

    // 🔴 구조를 권하는 일반 한 줄이 붙으면 요약 칸이 다시 분석 칸이 된다.
    expect(problem).not.toContain(NARRATIVE_FIELD_HINT);
    expect(problem).toContain(SUMMARY_FIELD_HINT);

    /*
 🔴 이 칸은 «짧게 쓰는 칸»이 아니라 **문서의 입구**다. 「짧게」만 말하면 Jira 티켓의
 한 줄 요약으로 줄어든다 — 독자가 문제를 처음 이해하는 데 필요한 만큼은 있어야 하고,
 넘기는 것은 «분량»이 아니라 «원인 분석»이다.
    */
    expect(SUMMARY_FIELD_HINT).toContain("처음 이해하는");
    expect(SUMMARY_FIELD_HINT).toContain("왜 문제인지");
    expect(SUMMARY_FIELD_HINT).toContain("뒤 field로 넘긴다");
    // 🔴 형식 지시를 넣지 않는다 — 이 칸에 heading·bullet 규칙을 적으면 요약이 다시 분석이 된다.
    for (const forbidden of ["subheading", "bullet", "heading", "문단"]) {
      expect(SUMMARY_FIELD_HINT).not.toContain(forbidden);
    }

    /**
     * 🔴 다른 칸은 「목적이 설명의 절반 이상」으로 재지만 이 칸은 그렇게 잴 수 없다 —
     * `SUMMARY_FIELD_HINT` 자체가 형식 규칙이 아니라 **이 칸의 역할 정의**라 길다.
     * 대신 **역할 문장이 맨 앞에 오는지**를 본다.
     */
    expect(problem.startsWith("관찰되는 현상과 그것이 왜 문제인가")).toBe(true);
    expect(problem.indexOf(SUMMARY_FIELD_HINT)).toBeGreaterThan(0);
    // 상세를 어디로 넘기는지 말한다.
    expect(problem).toContain("원인 분석·발생 순서·조치는 뒤 field로 넘긴다");
  });

  /**
   * 🔴 **예외를 한 칸에만 적용한다.** 요약 규칙이 분석 칸까지 번지면 이 계약이
   * 반대 방향으로 다시 기울어 `rootCause` 가 짧은 문단 하나로 돌아간다.
   */
  it("요약 규칙이 다른 narrative field로 번지지 않는다", () => {
    const handlers = captureTools({});
    const issue = handlers.metadata.get("add_issue").inputSchema;
    const fix = handlers.metadata.get("add_fix_attempt").inputSchema;

    for (const description of [
      issue.rootCause.description,
      issue.failurePath.description,
      issue.suggestion.description,
      fix.solution.description,
      fix.tradeOff.description,
    ]) {
      expect(description).toContain(NARRATIVE_FIELD_HINT);
      expect(description).not.toContain(SUMMARY_FIELD_HINT);
    }
  });

  /**
   * 🔴 **`description` 의 자리는 이제 «예외»가 아니라 chapter 흐름의 첫 칸이다.**
   *
   * 예전에는 「description 만 예외다」라는 독립 문장이었다. 그것은 나머지 field 를
   * 서로 무관한 답으로 두는 전제 위에 있었다 — 지금 계약은 field 를 한 문서의 chapter 로
   * 보고, `description` 은 그 문서를 «여는» 자리로 흐름 안에 들어가 있다.
   */
  it("전체 계약이 description 을 문서를 여는 chapter 로 배치한다", () => {
    expect(NARRATIVE_MARKDOWN).toContain(
      "description은 관찰되는 현상과 왜 문제인지로 문서를 열고",
    );
    // 🔴 뒤 chapter 가 앞을 되풀이하지 않는다는 것이 이 배치의 요점이다.
    expect(NARRATIVE_MARKDOWN).toContain("그것을 되풀이하지 말고");
    expect(NARRATIVE_MARKDOWN).not.toContain("Issue의 description(요약)만 예외다");
  });

  /**
   * 🔴 **계약이 heading·bullet·nested·ordered 만 말하고 «문단의 기준»을 말하지 않았다.**
   *
   * 그래서 한 문단에 증상·판단 근거·반전·증거가 그대로 뭉치는 일이 남았다. 기준은
   * **semantic role** 이다 — 한 문단에 핵심 역할 하나. 글자 수·줄 길이·화면 폭이 아니고,
   * 접속사를 봤다고 나누는 것도 아니다.
   */
  it("전체 계약이 문단을 나누는 «기준»을 semantic role 로 못 박는다", () => {
    // 무엇으로 나누는가 — 역할이다.
    expect(NARRATIVE_MARKDOWN).toContain("semantic role");
    expect(NARRATIVE_MARKDOWN).toContain("한 문단에 핵심 역할 하나");
    // 🔴 무엇으로 나누지 «않는가» — 분량 기준이 아니다.
    expect(NARRATIVE_MARKDOWN).toContain("글자 수");
    expect(NARRATIVE_MARKDOWN).toContain("화면 폭");
    // 전환 신호는 신호일 뿐 규칙이 아니다.
    expect(NARRATIVE_MARKDOWN).toContain("논리 전환 신호");
    expect(NARRATIVE_MARKDOWN).toContain("실제로 역할이나 관점이 바뀔 때만");
    // 🔴 반대 방향도 함께 — 이어지는 인과를 억지로 쪼개지 않는다.
    expect(NARRATIVE_MARKDOWN).toContain("쪼개지 말고 문단으로 두고");
  });

  /**
   * 🔴 **대응표에 칸이 없으면 그 구조는 «존재하지 않는다».**
   *
   * 예전 표는 heading·문단·bullet·nested·ordered 다섯뿐이었다. `table` 과 `blockquote` 는
   * 계약 전문에 **한 번도 등장하지 않았고** fenced code block 은 「근거일 때만」이라는
   * 제한으로만 등장했다. 그래서 여러 대상의 같은 속성을 비교하는 내용이 prose 로
   * 흘러내렸다 — 규칙을 어겨서가 아니라 **쓸 구조가 목록에 없어서**다.
   *
   * 🔴 **표를 넓히는 것과 「많이 쓰라」는 다르다.** 아래 두 번째 묶음이 그 경계를 지킨다.
   */
  it("전체 계약이 관계 -> 구조 대응을 «전부» 말한다", () => {
    for (const rule of [
      "독립된 semantic topic은 heading",
      "설명·원인·인과는 paragraph",
      "병렬적인 사실·조건·영향·선택지는 unordered list",
      "상태 전이 순서는 ordered list",
      "상위 항목과 세부의 관계는 nested list",
      "«같은 속성» 비교는 table",
      "핵심 판단·제약·주의는 blockquote",
      "identifier는 inline code",
      "메커니즘을 보여 줄 때는 fenced code block",
    ]) {
      expect(NARRATIVE_MARKDOWN).toContain(rule);
    }

    // 구조를 고르는 것은 «관계»이지 Markdown 문법을 쓰겠다는 의지가 아니다.
    expect(NARRATIVE_MARKDOWN).toContain("관계를 먼저 판단하고");

    /*
 🔴 **사용 «횟수»를 요구하는 규칙을 만들지 않는다.** 그러면 장식이 는다 — 실제로
 한 번 겪은 실패의 거울상이다. 계약은 양쪽을 함께 말해야 한다: 억지로 넣지도,
 전부 paragraph 로만 쓰지도 않는다.
    */
    expect(NARRATIVE_MARKDOWN).toContain("전부 쓸 필요는 없다");
    expect(NARRATIVE_MARKDOWN).toContain("억지로 넣지 않는다");
    expect(NARRATIVE_MARKDOWN).toContain("전부 paragraph로만 쓰지도 않는다");
  });

  /**
   * 🔴 **field 를 서로 겹치지 않게 만드는 것과 «이어지게» 만드는 것은 다르다.**
   *
   * 예전 계약의 field 간 규칙은 「되풀이하지 마라」뿐이었다. 중복 금지만 있으면 각 field 가
   * 자기 문맥을 새로 세운 **독립된 미니 보고서**가 된다 — 원하던 「한 문서」의 반대다.
   */
  it("전체 계약이 Issue 를 하나의 문서로, field 를 chapter 로 선언한다", () => {
    expect(NARRATIVE_MARKDOWN).toContain("각 field는 그 문서 안의 chapter다");
    expect(NARRATIVE_MARKDOWN).toContain(
      "앞 field가 세운 사실을 전제로 다음 논리 단계로 나아가는 자리",
    );
    // 🔴 그러나 고정 순서가 아니다 — 필요 없는 단계는 생략한다.
    expect(NARRATIVE_MARKDOWN).toContain("이 흐름은 고정 template이 아니다");
    expect(NARRATIVE_MARKDOWN).toContain("필요 없는 단계는 생략한다");
  });

  /**
   * 🔴 **「판단을 바꾸지 않는 실측값은 생략」이 table 의 재료를 지웠다.**
   *
   * 그 문장은 분량을 줄이려고 넣었는데, 실제로는 **결론을 이해하게 해 주는 비교**
   * (화면별 heading 상태 · 폭별 측정)까지 잘라 냈다. 지금 계약은 반대로 말한다 —
   * 비교는 남기고, 판단을 뒷받침하지 않는 **증명용 source dump** 만 Evidence 로 보낸다.
   */
  it("전체 계약이 «비교 데이터»를 Evidence 로 밀어내지 않는다", () => {
    expect(NARRATIVE_MARKDOWN).toContain("검증된 값은 문서에 남긴다");
    expect(NARRATIVE_MARKDOWN).toContain("Evidence로 밀어내지 않는다");
    expect(NARRATIVE_MARKDOWN).toContain(
      "증명용 source detail만 Evidence의 몫이다",
    );
    // 되돌아가지 않았는지 — 옛 문장이 남아 있으면 둘이 서로를 무효화한다.
    expect(NARRATIVE_MARKDOWN).not.toContain("실측값·내부 단계는 생략한다");
  });

  /**
   * 🔴 **heading 자리에 bold 한 줄을 세우는 것을 이름으로 막는다.**
   *
   * 계약은 「논점이 갈리면 heading」과 「핵심 판단에 bold」를 각각 말했지만 **둘의 경계**를
   * 말하지 않았다. 그 틈에서 Agent 는 `**소제목**` 한 줄로 문단을 가르는 쪽으로 기울 수 있고,
   * 그러면 굵은 글자만 남고 문서 구조는 생기지 않는다 — 목차로 잡히지 않고 훑는 눈에 층도
   * 생기지 않는다. 규칙과 «왜»가 함께 계약에 있어야 한다.
   */
  it("전체 계약이 bold 를 heading 대신 쓰는 것을 금지한다", () => {
    // 규칙 자체.
    expect(NARRATIVE_MARKDOWN).toContain("bold를 heading 대신 쓰지 않는다");
    // 🔴 왜 안 되는가 — 굵은 글자는 구조가 아니다.
    expect(NARRATIVE_MARKDOWN).toContain("굵은 글자일 뿐 문서 구조가 아니라서");
    // 경계를 못 박는다 — heading 은 topic, bold 는 그 안의 강조다.
    expect(NARRATIVE_MARKDOWN).toContain(
      "topic이 갈리는 자리는 heading이고 bold는 그 안의 강조다",
    );
    // 금지 목록에도 이름으로 선다 — 훑을 때 걸리는 자리는 거기다.
    expect(NARRATIVE_MARKDOWN).toContain(
      "bold 한 줄을 heading 대신 세우는 것",
    );
    // 🔴 기존 bold 규칙을 약화시키지 않았다.
    expect(NARRATIVE_MARKDOWN).toContain("핵심 판단·중요한 구분에는 bold를 쓴다");
    expect(NARRATIVE_MARKDOWN).toContain("과도한 bold");
  });

  /**
   * 🔴 **field 설명에도 한 줄이 있어야 한다.** server instructions 는 한 번 지나가지만
   * field description 은 그 칸을 채우는 «순간»에 읽힌다 — 구조를 권하는 자리 바로 옆에
   * 「bold 로 대신하지 마라」가 없으면 그 권유가 bold 로 흘러간다.
   */
  it("narrative field hint 는 앞 field 로부터의 «연속성»을 말한다", () => {
    /*
 🔴 **「되풀이하지 마라」만 열한 번 실려 있었다.** 중복 금지는 field 를 서로 겹치지 않게
 만들 뿐 이어지게 만들지 않아, 각 칸이 자기 문맥을 새로 세운 독립 보고서가 됐다.
 지금 한 줄은 금지가 아니라 **「어디서 이어받는가」**를 말한다.
    */
    expect(NARRATIVE_FIELD_HINT).toContain("앞 field가 세운 사실을 전제로");
    expect(NARRATIVE_FIELD_HINT).toContain("이 자리의 논리 단계만");
    // 🔴 형식 규칙을 여기 다시 적지 않는다 — 전체 규칙은 server instructions 가 한 번 말한다.
    for (const format of ["heading", "bullet", "table", "bold", "문단"]) {
      expect(NARRATIVE_FIELD_HINT).not.toContain(format);
    }

    // 🔴 11개 field 설명에 실제로 실려 나간다.
    const handlers = captureTools({});
    const issue = handlers.metadata.get("add_issue").inputSchema;
    const fix = handlers.metadata.get("add_fix_attempt").inputSchema;
    for (const description of [
      issue.rootCause.description,
      issue.failurePath.description,
      issue.suggestion.description,
      fix.solution.description,
      fix.tradeOff.description,
      fix.residualRisk.description,
    ]) {
      expect(description).toContain("앞 field가 세운 사실을 전제로");
    }
  });

  /** 🔴 금지도 이름으로 못 박는다 — 없으면 Agent 가 기계적 개행으로 되돌아간다. */
  it("전체 계약이 기계적 개행을 이름으로 금지한다", () => {
    expect(NARRATIVE_MARKDOWN).toContain("글자 수 N자마다 강제로 개행하는 것");
    expect(NARRATIVE_MARKDOWN).toContain("화면 폭을 예상해 줄을 끊는 것");
    expect(NARRATIVE_MARKDOWN).toContain("문장 중간의 `<br>`");
    expect(NARRATIVE_MARKDOWN).toContain("모든 문장을 각각 문단으로 만드는 것");
    expect(NARRATIVE_MARKDOWN).toContain("접속사마다 기계적으로 문단을 나누는 것");
  });

  /**
   * 🔴 **공통 규칙은 «한 곳»에만 산다.**
   *
   * 11개 narrative field 설명에 같은 장문을 복사하면 이 계약의 «첫 번째» 실패가 그대로
   * 되돌아온다 — 형식 규칙이 field 의 목적을 덮는다. server instructions 가 한 번 말하고,
   * field 설명은 그 칸의 역할만 갖는다.
   */
  it("문단 구성 규칙이 11개 field 설명으로 번지지 않는다", () => {
    const handlers = captureTools({});
    const issue = handlers.metadata.get("add_issue").inputSchema;
    const fix = handlers.metadata.get("add_fix_attempt").inputSchema;
    const resolve = handlers.metadata.get("resolve_issue").inputSchema;

    const descriptions = [
      issue.problem.description,
      issue.rootCause.description,
      issue.failurePath.description,
      issue.suggestion.description,
      resolve.resolution.description,
      fix.solution.description,
      fix.decisionReason.description,
      fix.alternatives.description,
      fix.tradeOff.description,
      fix.verification.description,
      fix.regressionTest.description,
      fix.residualRisk.description,
    ];

    for (const description of descriptions) {
      for (const leaked of [
        "semantic role",
        "핵심 역할만",
        "글자 수",
        "화면 폭",
        "논리 전환 신호",
        "문단만 잘게 나누는 것",
      ]) {
        expect(description).not.toContain(leaked);
      }
    }

    // 🔴 두 field hint 자체도 «역할»만 담는다 — 여기 새면 12칸 전부에 실린다.
    for (const hint of [NARRATIVE_FIELD_HINT, SUMMARY_FIELD_HINT]) {
      expect(hint).not.toContain("semantic role");
      expect(hint).not.toContain("핵심 역할만");
      expect(hint).not.toContain("글자 수");
    }
  });

  /**
   * 🔴 **field 별 역할 지시는 하나도 지우지 않는다.** 공통 규칙을 더하면서 field 설명을
   * 「형식은 위에서 말했으니」로 깎으면 rootCause 와 tradeOff 가 다시 같은 지시를 받는다.
   */
  it("공통 규칙을 더한 뒤에도 field별 역할 지시가 그대로 있다", () => {
    const handlers = captureTools({});
    const issue = handlers.metadata.get("add_issue").inputSchema;
    const fix = handlers.metadata.get("add_fix_attempt").inputSchema;

    expect(issue.problem.description).toContain("관찰되는 현상과 그것이 왜 문제인가");
    expect(issue.rootCause.description).toContain("technical cause");
    expect(issue.failurePath.description).toContain("순서·상태 변화·재현 과정");
    expect(issue.suggestion.description).toContain("앞서 확립된 원인을 전제로");
    expect(fix.solution.description).toContain("실제로 무엇을 적용했는가");
    expect(fix.decisionReason.description).toContain("겹쳐 적지 않는다");
    expect(fix.alternatives.description).toContain("왜 버렸는가");
    expect(fix.tradeOff.description).toContain("장점 목록이 아니라");
    expect(fix.verification.description).toContain("어떻게 확인했는가");
    expect(fix.regressionTest.description).toContain("다시 무너지는 것을");
    expect(fix.residualRisk.description).toContain("없는 위험을 만들지 않는다");
  });

  it("technical identifier를 번역하지 않는 언어 계약을 명시한다", () => {
    expect(reviewLanguageInstruction("ko")).toContain(
      "Technical identifiers and code names remain unchanged",
    );
    expect(reviewLanguageInstruction("en")).toContain(
      "Technical identifiers and code names remain unchanged",
    );
  });
});

/**
 * 🔴 **읽기가 「다음에 쓸 대상」을 옮기면 계약이 스스로를 무는다.**
 *
 * `HISTORICAL_PRECEDENT_SAFETY` 는 과거 Issue 를 `get_issue` 로 읽으라고 권한다.
 * 그런데 그 읽기가 `lastIssueId` 를 덮으면, 이번 문제를 고친 뒤 `issueId` 를 생략한
 * `resolve_issue` 가 **참고로 읽었을 뿐인 과거 Issue 를 닫는다.**
 */
describe("읽기는 쓰기 대상을 옮기지 않는다", () => {
  it("get_issue 로 과거 Issue 를 읽어도 resolve_issue 는 이번 Issue 를 닫는다", async () => {
    const appendIssues = vi.fn(async () => ({
      issues: [{ id: "issue-current", alreadyKnown: false, status: "OPEN" }],
    }));
    const getIssue = vi.fn(async () => ({
      issue: { id: "issue-past", repositoryFullName: "acme/app" },
    }));
    const updateStatus = vi.fn(async () => ({ issue: { status: "RESOLVED" } }));
    const handlers = captureTools({ appendIssues, getIssue, updateStatus });

    await handlers.get("add_issue")({
      reviewId: "review-1",
      severity: "HIGH",
      category: "RELIABILITY",
      title: "이번에 찾은 문제",
    });
    // 계약이 권하는 대로 과거 Issue 를 참고로 읽는다.
    await handlers.get("get_issue")({ issueId: "issue-past" });
    await handlers.get("resolve_issue")({ resolution: "고쳤다" });

    // 🔴 닫히는 것은 이번 Issue 다.
    expect(updateStatus).toHaveBeenCalledWith(
      "issue-current",
      expect.objectContaining({ status: "RESOLVED" }),
    );
    expect(updateStatus).not.toHaveBeenCalledWith(
      "issue-past",
      expect.anything(),
    );
  });

  it("읽기만 한 상태에서는 대상이 없다고 알린다", async () => {
    const getIssue = vi.fn(async () => ({
      issue: { id: "issue-past", repositoryFullName: "acme/app" },
    }));
    const updateStatus = vi.fn(async () => ({ issue: { status: "RESOLVED" } }));
    const handlers = captureTools({ getIssue, updateStatus });

    await handlers.get("get_issue")({ issueId: "issue-past" });
    const result = await handlers.get("resolve_issue")({ resolution: "고쳤다" });

    expect(result.isError).toBe(true);
    // 🔴 조용히 엉뚱한 것을 닫지 않고 멈춘다.
    expect(updateStatus).not.toHaveBeenCalled();
  });
});

/**
 * 🔴 **「바뀐 파일이 없다」와 「못 읽었다」는 다른 사실이다.**
 *
 * `readChangedFiles` 가 실패하면 빈 목록이 나가고 서버는 그것을 0개로 받는다. 그 사실이
 * Agent 에게 닿지 않으면, 무관한 Knowledge 후보를 「관련 이력 없음」으로 읽는다.
 */
describe("changedFiles 를 못 읽으면 그 사실을 알린다", () => {
  it("읽기가 끊겼으면 create_review 응답이 경고를 싣는다", async () => {
    readRepositoryContext.mockResolvedValueOnce({
      provider: "GITHUB",
      owner: "acme",
      name: "app",
      fullName: "acme/app",
      defaultBranch: "main",
      htmlUrl: null,
      commitSha: "a".repeat(40),
      branch: "main",
      workspaceSlug: null,
      changedFiles: [],
      changedFilesAvailable: false,
    });
    const createReview = vi.fn(async () => ({ reviewSessionId: "review-1" }));
    const handlers = captureTools({ createReview });

    const result = resultOf(await handlers.get("create_review")({}));

    expect(result.changedFiles경고).toContain("읽지 못했다");
    // 🔴 그래도 Review 자체는 열린다 — 보조 정보 때문에 기록을 막지 않는다.
    expect(result.reviewId).toBe("review-1");
  });

  it("정상적으로 읽었으면 경고를 붙이지 않는다", async () => {
    readRepositoryContext.mockResolvedValueOnce({
      provider: "GITHUB",
      owner: "acme",
      name: "app",
      fullName: "acme/app",
      defaultBranch: "main",
      htmlUrl: null,
      commitSha: "a".repeat(40),
      branch: "main",
      workspaceSlug: null,
      changedFiles: [],
      changedFilesAvailable: true,
    });
    const createReview = vi.fn(async () => ({ reviewSessionId: "review-2" }));
    const handlers = captureTools({ createReview });

    const result = resultOf(await handlers.get("create_review")({}));

    // 🔴 「정말 0개」일 때 경고를 붙이면 그것도 거짓말이다.
    expect(result).not.toHaveProperty("changedFiles경고");
  });
});

/**
 * 🔴 **근거의 `commitSha` 는 「지금 HEAD」가 아니라 「그 코드가 실제로 있는 commit」이다.**
 *
 * 아직 커밋하지 않은 코드를 snapshot 으로 보내면서 HEAD 를 적으면 서버의 GitHub 대조가
 * 정직하게 실패해 `MISMATCH` 로 남는다 — 실제로 그렇게 쌓인 근거가 있었다(BEFORE 8 · AFTER 5).
 * 계약이 그 함정을 이름으로 말해야 Agent 가 피할 수 있다.
 */
it("Evidence 계약이 커밋 전 코드를 근거로 보내지 말라고 말한다", () => {
  const evidence = EVIDENCE_COMMIT_CONTRACT;

  expect(evidence).toContain("실제로 존재하는");
  expect(evidence).toContain("아직 커밋하지 않은");
  expect(evidence).toContain("MISMATCH");
});

/**
 * 🔴 **연속성 hint 는 앞 field 가 있는 칸에만 붙어야 한다.**
 *
 * `NARRATIVE_FIELD_HINT` 가 「앞 field 가 세운 사실을 전제로」로 바뀌면서, 그 문장이
 * 앞 field 가 없는 칸(`create_review.summary` 와 Activity 요약 둘)에도 실렸다. Agent 는
 * 있지도 않은 앞 문맥을 전제해 배경을 생략하고, 그 요약만 보이는 화면에서 문서가 자립하지
 * 못한다. 경계를 **양쪽으로** 못 박는다 — 붙어야 할 칸과 붙으면 안 되는 칸을 함께 본다.
 */
describe("연속성 hint 의 적용 범위", () => {
  const descriptionsOf = () => {
    const meta = new Map();
    registerTools(
      { registerTool: (name, m) => meta.set(name, m) },
      {},
      { pendingReviewKey: null },
      { reviewLanguage: "ko" },
    );
    return (tool, field) => meta.get(tool).inputSchema[field].description;
  };

  it("🔴 앞 field 가 없는 칸은 연속성 대신 «단독으로 읽힌다»를 받는다", () => {
    const describe_ = descriptionsOf();
    for (const [tool, field] of [
      ["create_review", "summary"],
      ["add_fix_attempt", "summary"],
      ["review_again", "summary"],
    ]) {
      const d = describe_(tool, field);
      expect(d).not.toContain(NARRATIVE_FIELD_HINT);
      expect(d).toContain(STANDALONE_FIELD_HINT);
    }
  });

  it("한 Issue 안의 chapter 는 연속성 hint 를 그대로 받는다", () => {
    const describe_ = descriptionsOf();
    for (const [tool, field] of [
      ["add_issue", "rootCause"],
      ["add_issue", "failurePath"],
      ["add_issue", "suggestion"],
      ["add_fix_attempt", "solution"],
      ["resolve_issue", "resolution"],
    ]) {
      const d = describe_(tool, field);
      expect(d).toContain(NARRATIVE_FIELD_HINT);
      expect(d).not.toContain(STANDALONE_FIELD_HINT);
    }
  });
});
