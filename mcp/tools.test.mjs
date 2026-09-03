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
    // 판단 기준이 「얼마나 썼는가」가 아니라 「훑을 수 있는가」다.
    expect(NARRATIVE_MARKDOWN).toContain("5초");
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
    expect(NARRATIVE_MARKDOWN).toContain("`##`에서 시작한다");
    expect(NARRATIVE_MARKDOWN).toContain("`#`은 쓰지 않는다");
    // 🔴 한 층만 쓰는 것을 이름으로 금지한다 — 실제로 그렇게 쌓였기 때문이다.
    expect(NARRATIVE_MARKDOWN).toContain("`###` 하나로만 쓰지 않는다");
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
   * 🔴 field 마다 «그 칸에 맞는 모양»을 말한다. 같은 문장을 열두 번 복사하면
   * rootCause 와 tradeOff 가 같은 지시를 받는다.
   */
  it("field마다 그 내용에 맞는 작성 방식을 말한다", () => {
    const handlers = captureTools({});
    const issue = handlers.metadata.get("add_issue").inputSchema;
    const fix = handlers.metadata.get("add_fix_attempt").inputSchema;

    // rootCause 는 체크리스트가 아니라 인과 설명이 먼저다.
    expect(issue.rootCause.description).toContain("문단");
    expect(issue.rootCause.description).toContain("증상이 아니라 원인");
    // failurePath 는 순서가 의미를 갖는다.
    expect(issue.failurePath.description).toContain("ordered list");
    // tradeOff 는 장점 목록이 아니다.
    expect(fix.tradeOff.description).toContain("장점 목록이 아니라");
    // decisionReason 과 alternativesConsidered 는 겹쳐 적지 않는다.
    expect(fix.decisionReason.description).toContain("겹쳐 적지 않는다");
    // residualRisk 는 여럿이면 나누고, 없으면 만들지 않는다.
    expect(fix.residualRisk.description).toContain("여럿이면 bullet");
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

    // 이 칸이 무엇인지 — 처음 읽는 요약이고, 넘어갈 시간이 정해져 있다.
    expect(SUMMARY_FIELD_HINT).toContain("가장 먼저");
    expect(SUMMARY_FIELD_HINT).toContain("3~5초");
    // 🔴 뒤 칸의 상세를 여기서 되풀이하지 않는다.
    expect(SUMMARY_FIELD_HINT).toContain("rootCause·failurePath·suggestion");
    expect(SUMMARY_FIELD_HINT).toContain("미리 되풀이하지 않는다");
    // 🔴 heading 을 «강제»하지 않는다 — 대부분은 문단 한둘이 맞다.
    expect(SUMMARY_FIELD_HINT).toContain("정말 있을 때만");
    expect(SUMMARY_FIELD_HINT).toContain("강제하지 않고");
    // 🔴 긴 문단 둘에 근거·판단·영향을 섞지 않는다(직전 실패 모양).
    expect(SUMMARY_FIELD_HINT).toContain("긴 문단 둘에 섞어 넣지 않는다");

    /**
     * 🔴 다른 칸은 「목적이 설명의 절반 이상」으로 재지만 이 칸은 그렇게 잴 수 없다 —
     * `SUMMARY_FIELD_HINT` 자체가 형식 규칙이 아니라 **이 칸의 역할 정의**라 길다.
     * 대신 **역할 문장이 맨 앞에 오는지**를 본다.
     */
    expect(problem.startsWith("무엇이 잘못됐고 어떤 영향이 있는가")).toBe(true);
    expect(problem.indexOf(SUMMARY_FIELD_HINT)).toBeGreaterThan(0);
    // 상세는 어느 칸으로 넘기는지까지 이름으로 말한다.
    expect(problem).toContain("원인 분석은 rootCause 에");
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

  /** 전체 계약도 그 예외를 한 줄로 알고 있어야 server instructions 가 갈라지지 않는다. */
  it("전체 계약이 description 예외를 한 줄로 말한다", () => {
    expect(NARRATIVE_MARKDOWN).toContain("Issue의 description(요약)만 예외다");
    expect(NARRATIVE_MARKDOWN).toContain("짧은 요약으로 연다");
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
    expect(NARRATIVE_MARKDOWN).toContain("핵심 역할만");
    // 🔴 무엇으로 나누지 «않는가» — 분량 기준이 아니다.
    expect(NARRATIVE_MARKDOWN).toContain("글자 수");
    expect(NARRATIVE_MARKDOWN).toContain("화면 폭");
    // 전환 신호는 신호일 뿐 규칙이 아니다.
    expect(NARRATIVE_MARKDOWN).toContain("논리 전환 신호");
    expect(NARRATIVE_MARKDOWN).toContain("실제로 역할이나 관점이 바뀔 때만");
    // 한 문단에 전부 넣지 않는다(직전 실패 모양).
    expect(NARRATIVE_MARKDOWN).toContain(
      "증상과 원인과 반론과 증거와 해결책을 전부 넣지 않는다",
    );
    // 🔴 문단만 잘게 나누는 것으로 복잡한 내용을 대신하지 않는다.
    expect(NARRATIVE_MARKDOWN).toContain("문단만 잘게 나누는 것");
  });

  /**
   * 🔴 **문단 기준만 알려주면 heading·bullet 과 경계가 흐려진다.** 무엇으로 가를지는
   * 「관계」가 정한다는 판단표가 계약 안에 함께 있어야 문단이 만능이 되지 않는다.
   */
  it("전체 계약이 heading·문단·bullet·nested·ordered 의 선택 기준을 함께 말한다", () => {
    for (const rule of [
      "큰 topic 변화는 heading",
      "논리 전환은 문단",
      "병렬 항목은 bullet",
      "상하 관계는 nested list",
      "순서가 있는 과정은 ordered list",
    ]) {
      expect(NARRATIVE_MARKDOWN).toContain(rule);
    }
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
  it("narrative field hint 도 bold 한 줄 소제목을 막는다", () => {
    expect(NARRATIVE_FIELD_HINT).toContain(
      "bold 한 줄로 소제목을 대신하지 않는다",
    );
    // 원래 있던 구조 권유는 그대로다.
    expect(NARRATIVE_FIELD_HINT).toContain("subheading·nested list");

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
      expect(description).toContain("bold 한 줄로 소제목을 대신하지 않는다");
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

    expect(issue.problem.description).toContain("원인 분석은 rootCause 에");
    expect(issue.rootCause.description).toContain("증상이 아니라 원인");
    expect(issue.failurePath.description).toContain("실제로 터지는 경로");
    expect(issue.suggestion.description).toContain("이렇게 고치라는 제안");
    expect(fix.solution.description).toContain("무엇을 했는가");
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
