import { randomUUID } from "node:crypto";

import { z } from "zod";

import { ApiError } from "./client.mjs";
import { GitError, readRepositoryContext, repositoryFromFullName } from "./git.mjs";

/**
 * ReviewTrace MCP Tool 집합(스펙 5·6·16).
 *
 * ## 🔴 Tool 개수보다 「실수하기 어려운 흐름」을 먼저 본다
 *
 * ```
 * create_review -> add_issue* -> add_fix_attempt -> review_again -> resolve_issue
 *                     ^                                                  |
 *                     +----- get_issue · search_issues · get_knowledge ---+
 * ```
 *
 * **Evidence 를 붙이는 Tool 을 따로 만들지 않았다.** 근거는 언제나 「무언가를 기록하는
 * 순간」에 생긴다 — 따로 두면 Agent 가 기록하고 근거 붙이기를 **잊는다.** 그래서
 * `add_issue` · `add_fix_attempt` · `resolve_issue` 가 각자 `evidence` 를 함께 받는다.
 *
 * 🔴 **내부 ID 를 사람에게 묻지 않는다**(스펙 6). Repository 는 git remote 에서 나오고,
 * `reviewId` 는 방금 만든 것을 이 프로세스가 기억한다.
 *
 * 🔴 **업무 규칙이 여기 없다.** Tenant 판정·검증·Evidence 확인은 전부 Agent API 가 한다.
 */

const severity = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
const category = z.enum([
  "ARCHITECTURE",
  "SECURITY",
  "PERFORMANCE",
  "DATABASE",
  "TRANSACTION",
  "CONCURRENCY",
  "API",
  "VALIDATION",
  "EXCEPTION_HANDLING",
  "TESTING",
  "CLEAN_CODE",
  "RELIABILITY",
]);

const evidenceItem = z.object({
  kind: z
    .enum(["BEFORE", "AFTER"])
    .describe("BEFORE = 문제가 있던 코드, AFTER = 고친 뒤의 코드"),
  commitSha: z.string().describe("이 코드가 존재하는 commit SHA"),
  filePath: z.string().describe("저장소 루트 기준 경로"),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  snapshot: z
    .string()
    .optional()
    .describe(
      "그 줄 범위의 실제 코드. 서버가 GitHub 에서 대조해 확인 여부를 따로 기록한다.",
    ),
});

const decision = {
  solution: z.string().optional().describe("무엇을 했는가"),
  decisionReason: z.string().optional().describe("왜 그것을 골랐는가"),
  alternatives: z.string().optional().describe("무엇을 함께 검토했고 왜 버렸는가"),
  tradeOff: z.string().optional().describe("그 선택으로 무엇을 내주었는가"),
  verification: z.string().optional().describe("고쳐졌음을 어떻게 확인했는가"),
  regressionTest: z.string().optional().describe("다시 무너지는 것을 무엇이 막는가"),
  residualRisk: z.string().optional().describe("그래도 남아 있는 위험"),
};

/** Tool 인자의 판단 칸을 API 계약의 이름으로 옮긴다. 전부 비면 보내지 않는다. */
function toDecision(args) {
  const record = {
    solution: args.solution,
    decisionReason: args.decisionReason,
    alternativesConsidered: args.alternatives,
    tradeOff: args.tradeOff,
    verification: args.verification,
    regressionTest: args.regressionTest,
    residualRisk: args.residualRisk,
  };
  return Object.values(record).some((v) => v !== undefined) ? record : undefined;
}

function toEvidence(args) {
  return (args.evidence ?? []).map((item) => ({
    kind: item.kind,
    commitSha: item.commitSha,
    filePath: item.filePath,
    startLine: item.startLine ?? null,
    endLine: item.endLine ?? null,
    snapshot: item.snapshot ?? null,
  }));
}

/** Agent 이름. 무엇이 남겼는지 History 에서 갈라 보려면 이것이 필요하다(스펙 17). */
const actorName = z
  .string()
  .optional()
  .describe("이 기록을 남기는 Agent 이름 (예: claude-code, codex)");

export function registerTools(server, client, state) {
  /** 🔴 Repository 를 사람에게 묻지 않는다 — git remote 가 정본이다(스펙 7). */
  async function resolveRepository(fullName) {
    if (typeof fullName === "string" && fullName.trim() !== "") {
      return repositoryFromFullName(fullName);
    }
    return readRepositoryContext();
  }

  server.registerTool(
    "create_review",
    {
      title: "Review 시작",
      description:
        "이 저장소의 Code Review 한 번을 ReviewTrace 에 연다. " +
        "저장소와 commit 은 현재 git 저장소에서 자동으로 읽는다. " +
        "문제를 찾을 때마다 add_issue 로 이 Review 에 붙인다.",
      inputSchema: {
        summary: z
          .string()
          .optional()
          .describe("이번 Review 가 무엇을 봤는지 한두 줄"),
        reviewer: actorName,
        repository: z
          .string()
          .optional()
          .describe(
            "거의 항상 생략한다 — 현재 git 저장소의 origin 에서 자동으로 읽는다. " +
              "지금 열려 있지 않은 «다른» 저장소를 기록할 때만 owner/name 을 넣어라. 추측해서 채우지 마라.",
          ),
        commitSha: z
          .string()
          .optional()
          .describe("거의 항상 생략한다 — 현재 HEAD 를 자동으로 읽는다"),
        project: z
          .string()
          .optional()
          .describe(
            "이 Review 가 들어갈 Project 의 slug. 생략하면 default Project 로 들어간다. " +
              "한 Workspace 에서 여러 제품을 다룬다면 넣어라 (없으면 만들어진다).",
          ),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    (args) =>
      guard(async () => {
        const repo = await resolveRepository(args.repository);
        const commitSha = args.commitSha ?? repo.commitSha;

        const result = await client.createReview(
          {
            /**
             * 🔴 Project 를 안 보내면 `default` 로 들어간다.
             *
             * 보내는 자리를 열어 두는 이유는, 한 Workspace 가 여러 제품을 다룰 때
             * **MCP 로 들어온 것만 전부 `default` 에 쌓이는** 것을 막기 위해서다.
             * Workspace 자리는 여기에도 없다 — 그것은 API Key 가 정한다.
             */
            project:
              typeof args.project === "string" && args.project.trim() !== ""
                ? { slug: args.project.trim(), name: null }
                : null,
            repository: {
              provider: repo.provider,
              owner: repo.owner,
              name: repo.name,
              fullName: repo.fullName,
              defaultBranch: repo.defaultBranch,
              htmlUrl: repo.htmlUrl,
            },
            target: {
              type: commitSha === null ? "REPOSITORY" : "COMMIT",
              branch: repo.branch,
              commitSha,
            },
            reviewer: { type: "AGENT", name: args.reviewer ?? "unknown-agent" },
            summary: args.summary ?? null,
            issues: [],
          },
          /**
           * 같은 Review 를 두 번 열지 않게 하는 열쇠.
           *
           * 🔴 **성공할 때까지 같은 열쇠를 든다.** 서버가 저장한 뒤 응답만 잃으면 이 Tool 은
           * 실패로 끝나는데, 다음 호출에서 열쇠를 새로 만들면 **같은 Review 가 하나 더**
           * 저장된다. 실패가 확정돼도 열쇠를 버리지 않고, 한 번 성공했을 때만 비운다.
           */
          (state.pendingReviewKey ??= randomUUID()),
        );

        /**
         * 🔴 방금 연 Review 를 기억한다 — Agent 가 id 를 들고 다니지 않게(스펙 6).
         *
         * 🔴 **`lastIssueId` 를 반드시 비운다.** 안 비우면 Review A 에서 다루던 Issue 가
         * Review B 를 연 뒤에도 남아, `issueId` 를 생략한 `resolve_issue` 가
         * **엉뚱한 Issue 를 닫는다.** 「생략하면 마지막으로 다룬 것」이라는 편의가
         * 바로 그 자리에서 사고가 된다.
         */
        state.reviewId = result.reviewSessionId;
        state.commitSha = commitSha;
        state.lastIssueId = null;
        // 열쇠는 «성공한 뒤에만» 비운다.
        state.pendingReviewKey = null;

        return {
          reviewId: result.reviewSessionId,
          repository: repo.fullName,
          commitSha,
          branch: repo.branch,
          다음: "문제를 찾을 때마다 add_issue 를 부른다. reviewId 는 생략해도 된다.",
        };
      }),
  );

  server.registerTool(
    "add_issue",
    {
      title: "발견한 문제 기록",
      description:
        "Review 에서 찾은 문제 하나를 기록한다. " +
        "중요한 문제라면 rootCause 와 Evidence(BEFORE) 를 함께 남긴다 — " +
        "증상만 쌓이면 다음 Review 에서 다시 쓸 것이 없다.",
      inputSchema: {
        reviewId: z
          .string()
          .optional()
          .describe("생략하면 이 세션에서 마지막으로 연 Review"),
        severity,
        category,
        title: z.string().describe("한 줄 제목"),
        problem: z.string().optional().describe("무엇이 문제인가"),
        rootCause: z.string().optional().describe("왜 그렇게 됐는가"),
        failurePath: z
          .string()
          .optional()
          .describe("이 문제가 실제로 터지는 경로 (보안이면 공격 경로)"),
        patternKey: z
          .string()
          .optional()
          .describe("반복되는 문제의 정규화된 이름 (예: N_PLUS_ONE)"),
        filePath: z.string().optional(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
        suggestion: z.string().optional().describe("이렇게 고치라는 제안"),
        tags: z.array(z.string()).optional(),
        externalId: z
          .string()
          .optional()
          .describe(
            "같은 문제를 다시 보고할 때 쓰는 너의 식별자. 넣으면 행이 늘지 않고 History 가 이어진다.",
          ),
        evidence: z.array(evidenceItem).optional(),
        ...decision,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    (args) =>
      guard(async () => {
        const reviewId = args.reviewId ?? state.reviewId;
        if (reviewId === null || reviewId === undefined) {
          throw new ToolError(
            "열려 있는 Review 가 없다. 먼저 create_review 를 부르거나 reviewId 를 넣어라.",
          );
        }

        const result = await client.appendIssues(reviewId, [
          {
            severity: args.severity,
            category: args.category,
            title: args.title,
            description: args.problem ?? null,
            rootCause: args.rootCause ?? null,
            failurePath: args.failurePath ?? null,
            patternKey: args.patternKey ?? null,
            filePath: args.filePath ?? null,
            startLine: args.startLine ?? null,
            endLine: args.endLine ?? null,
            suggestion: args.suggestion ?? null,
            tags: args.tags ?? [],
            source: "mcp",
            externalId: args.externalId ?? null,
            decision: toDecision(args),
            evidence: toEvidence(args),
          },
        ]);

        const issue = result.issues[0];
        state.lastIssueId = issue?.id ?? state.lastIssueId;

        return {
          issueId: issue?.id ?? null,
          alreadyKnown: issue?.alreadyKnown ?? false,
          안내:
            issue?.alreadyKnown === true
              ? "이미 알고 있던 문제다. 새 행을 만들지 않고 History 에 다시 만났다고 남겼다."
              : "새 문제로 기록했다.",
        };
      }),
  );

  server.registerTool(
    "add_fix_attempt",
    {
      title: "고침 시도 기록",
      description:
        "이 문제를 이렇게 고쳐 봤다는 기록을 남긴다. " +
        "무엇을 왜 골랐는지와 AFTER Evidence 를 함께 남긴다 — " +
        "다음 시도가 이 판단을 덮어쓰지 않고 나란히 쌓인다.",
      inputSchema: {
        issueId: z.string().optional().describe("생략하면 마지막으로 다룬 Issue"),
        summary: z.string().optional().describe("한 줄 요약"),
        commitSha: z.string().optional().describe("고친 commit"),
        actor: actorName,
        evidence: z.array(evidenceItem).optional(),
        ...decision,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    (args) =>
      guard(() =>
        activity(client, state, args, "FIX_ATTEMPTED", "고침 시도를 기록했다."),
      ),
  );

  server.registerTool(
    "review_again",
    {
      title: "다시 검토한 결과 기록",
      description:
        "고쳐졌다고 한 것을 다시 봤다는 기록을 남긴다. " +
        "문제가 아직 남아 있으면 stillPresent 를 true 로 준다 — 닫혀 있던 Issue 가 다시 열린다. " +
        "검증까지 통과했으면 resolve_issue 를 부른다.",
      inputSchema: {
        issueId: z.string().optional(),
        summary: z.string().optional().describe("다시 본 결과"),
        stillPresent: z
          .boolean()
          .optional()
          .describe(
            "다시 봤더니 문제가 그대로 있는가. true 면 Issue 를 REOPENED 로 되돌린다.",
          ),
        commitSha: z.string().optional(),
        actor: actorName,
        evidence: z.array(evidenceItem).optional(),
        ...decision,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    (args) =>
      guard(async () => {
        const result = await activity(
          client,
          state,
          args,
          "REVIEWED_AGAIN",
          "재검토를 기록했다.",
        );

        /**
         * 🔴 **「아직 남아 있다」를 History 에만 적고 상태를 두면 그 회귀가 사라진다.**
         *
         * 닫혀 있던 Issue 는 `RESOLVED` 인 채로 남아, 미해결을 찾는 조회에 걸리지 않는다 —
         * 다시 무너진 것을 아무도 못 본다. 상태와 History 는 함께 움직여야 한다.
         */
        if (args.stillPresent !== true) {
          return result;
        }

        await client.updateStatus(result.issueId, {
          status: "REOPENED",
          commitSha: args.commitSha ?? null,
          actor: { type: "AGENT", name: args.actor ?? "unknown-agent" },
        });

        return { ...result, 안내: "재검토를 기록하고 Issue 를 다시 열었다." };
      }),
  );

  server.registerTool(
    "resolve_issue",
    {
      title: "해결로 닫기",
      description:
        "검증까지 끝난 문제를 닫는다. 어떻게 해결했는지(resolution)는 반드시 적는다 — " +
        "그것이 다음 Review 에서 다시 쓰이는 값이다.",
      inputSchema: {
        issueId: z.string().optional(),
        resolution: z.string().describe("어떻게 해결했는가 (필수)"),
        commitSha: z.string().optional(),
        actor: actorName,
        evidence: z.array(evidenceItem).optional(),
        ...decision,
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    (args) =>
      guard(async () => {
        const issueId = requireIssue(state, args.issueId);
        const result = await client.updateStatus(issueId, {
          status: "RESOLVED",
          resolutionSummary: args.resolution,
          commitSha: args.commitSha ?? null,
          actor: { type: "AGENT", name: args.actor ?? "unknown-agent" },
          decision: toDecision(args),
          evidence: toEvidence(args),
        });
        return { issueId, status: result.issue.status, 안내: "해결로 닫았다." };
      }),
  );

  server.registerTool(
    "get_issue",
    {
      title: "Issue 하나 읽기",
      description:
        "문제 하나를 History 까지 읽는다. 언제 발견됐고, 무엇을 해 봤고, 왜 그것을 골랐고, " +
        "무엇이 남았는지가 시간 순서로 나온다.",
      inputSchema: { issueId: z.string() },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    (args) =>
      guard(async () => {
        const result = await client.getIssue(args.issueId);
        state.lastIssueId = args.issueId;
        return result.issue;
      }),
  );

  server.registerTool(
    "search_issues",
    {
      title: "Issue 찾기",
      description:
        "이 저장소에 지금 무엇이 열려 있는지, 또는 같은 Pattern 이 과거에 있었는지 찾는다. " +
        "코드를 고치기 전에 먼저 부르면 같은 문제를 두 번 만들지 않는다.",
      inputSchema: {
        repository: z
          .string()
          .optional()
          .describe("owner/name. 생략하면 현재 git 저장소"),
        status: z
          .enum(["OPEN", "IN_PROGRESS", "RESOLVED", "IGNORED", "FALSE_POSITIVE", "REOPENED"])
          .optional(),
        severity: severity.optional(),
        category: category.optional(),
        patternKey: z.string().optional(),
        q: z.string().optional().describe("제목·파일 경로·Pattern 을 훑는 낱말"),
        limit: z.number().int().positive().max(50).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    (args) =>
      guard(async () => {
        const repository =
          args.repository ?? (await safeFullName());
        const result = await client.searchIssues({
          repository,
          status: args.status,
          severity: args.severity,
          category: args.category,
          patternKey: args.patternKey,
          q: args.q,
          limit: args.limit,
        });
        return { repository: repository ?? "(전체)", issues: result.issues };
      }),
  );

  server.registerTool(
    "get_repository_knowledge",
    {
      title: "이 저장소의 과거 Knowledge",
      description:
        "작업을 시작하기 전에 읽는다. 이 저장소에서 반복되는 Pattern, 아직 안 닫힌 문제, " +
        "과거에 어떻게 해결했는지가 나온다.",
      inputSchema: {
        repository: z.string().optional().describe("owner/name. 생략하면 현재 git 저장소"),
        limit: z.number().int().positive().max(50).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    (args) =>
      guard(async () => {
        const repository = args.repository ?? (await safeFullName());
        return client.knowledgeContext({ repository, limit: args.limit });
      }),
  );
}

/** git 을 못 읽어도 조회는 막지 않는다 — 저장소를 안 좁히면 Workspace 전체를 본다. */
async function safeFullName() {
  try {
    const repo = await readRepositoryContext();
    return repo.fullName;
  } catch {
    return undefined;
  }
}

async function activity(client, state, args, type, done) {
  const issueId = requireIssue(state, args.issueId);
  await client.addActivity(issueId, {
    type,
    actor: { type: "AGENT", name: args.actor ?? "unknown-agent" },
    description: args.summary ?? null,
    commitSha: args.commitSha ?? null,
    decision: toDecision(args),
    evidence: toEvidence(args),
  });
  return { issueId, 안내: done };
}

function requireIssue(state, issueId) {
  const resolved = issueId ?? state.lastIssueId;
  if (resolved === null || resolved === undefined) {
    throw new ToolError(
      "대상 Issue 가 없다. issueId 를 넣거나 먼저 add_issue · get_issue 로 하나를 다뤄라.",
    );
  }
  return resolved;
}

export class ToolError extends Error {}

/**
 * 실패를 Agent 가 읽을 수 있는 Tool 결과로 바꾼다(스펙 18).
 *
 * 🔴 **Stack 을 Tool 결과로 내보내지 않는다.** 우리가 뜻을 아는 오류만 문장으로 옮기고,
 * 모르는 것은 한 줄로 줄인다 — 원문은 stderr 로만 남는다(CLAUDE.md 19).
 */
async function guard(run) {
  try {
    const value = await run();
    return {
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    };
  } catch (error) {
    const known =
      error instanceof ApiError ||
      error instanceof GitError ||
      error instanceof ToolError;

    if (!known) {
      console.error("[reviewtrace-mcp] 처리하지 못한 오류", error);
    }

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: known
            ? error.message
            : "ReviewTrace MCP 가 요청을 처리하지 못했다.",
        },
      ],
    };
  }
}
