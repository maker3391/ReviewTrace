# reviewtrace-mcp

MCP server for [ReviewTrace](https://github.com/maker3391/ReviewTrace) — record what a code
review found, how it was fixed, and why, so the next review can pick up where the last one
left off.

It speaks **stdio**, which is what Claude Code and Codex both support, and it talks to a
ReviewTrace instance over its Agent API. Your API key never leaves your machine.

## Requirements

- Node.js **20.11+**
- A ReviewTrace instance you can reach over HTTP

## Setup

### 1. Sign in to ReviewTrace

Open your ReviewTrace instance and sign in with GitHub. First sign-in is sign-up: you get a
personal Workspace and become its `OWNER`. A Workspace is the tenant boundary — every review,
issue and wiki page you record belongs to exactly one.

### 2. Create a Workspace API key

Go to **`/w/{your-workspace}/settings` → API Keys → 발급 (Issue)**. Only a Workspace `OWNER`
can issue one.

The key looks like `ci_…` and is **shown exactly once** — ReviewTrace stores only its
SHA-256 hash and can never show it again. Copy it now; if you lose it, revoke it and issue
a new one.

The key is what selects the Workspace. There is no workspace id or slug anywhere in this
server's configuration or in any tool argument — a key can only ever reach its own
Workspace's data.

### 3. Register the server with your agent

Nothing to install ahead of time: `npx` fetches the package on first run.

**Claude Code**

```bash
claude mcp add reviewtrace -s user \
  -e "REVIEWTRACE_API_URL=https://reviewtrace.app" \
  -e "REVIEWTRACE_API_KEY=ci_your_key" \
  -- npx -y reviewtrace-mcp
```

**Codex**

```bash
codex mcp add reviewtrace \
  --env "REVIEWTRACE_API_URL=https://reviewtrace.app" \
  --env "REVIEWTRACE_API_KEY=ci_your_key" \
  -- npx -y reviewtrace-mcp
```

Any other MCP client works the same way — run `npx -y reviewtrace-mcp` as the command and
pass the two variables as the process env.

### 4. Verify

`claude mcp list` or `codex mcp get reviewtrace` should show the server connected.

To check it by hand, run it directly:

```bash
REVIEWTRACE_API_URL=https://reviewtrace.app \
REVIEWTRACE_API_KEY=ci_your_key \
npx -y reviewtrace-mcp
```

It prints one line to **stderr** — `[reviewtrace-mcp] 연결됨 (…)` — and then waits on stdin
for JSON-RPC. That line on stderr means it started. A bad or missing key exits immediately
with a message instead, rather than starting a server that cannot authenticate.

## Configuration

| Variable              | Required |
| --------------------- | -------- |
| `REVIEWTRACE_API_KEY` | **yes**  |
| `REVIEWTRACE_API_URL` | **yes**  |

**Both are required. There is no default URL.** `REVIEWTRACE_API_URL` is the origin of your
instance — the server appends `/api/v1` itself.

The URL must use HTTPS. Plain HTTP is accepted only for explicit loopback development addresses:
`localhost`, `127.0.0.1`, and `::1`. Paths, embedded credentials, query strings, fragments, and
authenticated redirects are rejected before a key can be sent.

> Earlier versions fell back to `http://localhost:3000`. That default is gone: a server that
> starts without a URL would send `Authorization: Bearer ci_…` to whatever happens to listen on
> your port 3000, and it would fail silently until the first tool call. Missing either variable
> now stops the server at startup with a message naming what is missing.

Running your own instance? Point it at your own origin — for local development, say so explicitly:

```bash
REVIEWTRACE_API_URL=http://localhost:3000
```

Instead of environment variables you may write `~/.reviewtrace/config.json`:

```json
{ "apiUrl": "https://reviewtrace.app", "apiKey": "ci_your_key" }
```

Environment variables win over the file. Put the key in one of those two places — not in
your project's `.env`, which lives inside a repository and eventually gets committed.

## Tools

The repository and commit come from the **current git repository** (`origin` remote and
`HEAD`), so no tool asks you for a repository id. `reviewId` and `issueId` may be omitted —
the server remembers the review you just opened and the issue you last touched.

Before the first review, connect the repository from the Project's **Repositories** page. Once
connected, the current git remote resolves Repository → Project → Workspace without a Project
argument. For a first connection through MCP, pass an existing `project` slug; ReviewTrace verifies
the Repository against that Workspace's GitHub App installation. Without either a registration or
`project`, `create_review` fails instead of creating a Default Project.

| Tool                       | What it does                                                                                          | Key arguments                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `get_repository_knowledge` | Past patterns, open issues and past resolutions for this repository. Read this _before_ changing code | `repository`, `limit`                                                                                                                  |
| `search_issues`            | Find issues by status, severity, category, pattern or keyword                                         | `status`, `severity`, `category`, `patternKey`, `q`, `limit`                                                                           |
| `create_review`            | Open one review for this repository and commit                                                        | `summary`, `reviewer`, `project`                                                                                                       |
| `add_issue`                | Record one finding on the open review                                                                 | `severity`, `category`, `title`, `problem`, `rootCause`, `filePath`, `startLine`, `patternKey`, `suggestion`, `externalId`, `evidence` |
| `add_fix_attempt`          | Record that this was fixed this way, and why                                                          | `issueId`, `summary`, `commitSha`, `solution`, `decisionReason`, `evidence`                                                            |
| `review_again`             | Record a re-review. `stillPresent: true` reopens a closed issue                                       | `issueId`, `summary`, `stillPresent`                                                                                                   |
| `resolve_issue`            | Close a verified issue. `resolution` is required                                                      | `issueId`, `resolution`, `verification`, `commitSha`                                                                                   |

Evidence snapshots should contain the problem or changed lines plus only the context
needed to understand them. Send exact `startLine`/`endLine` values; do not include an
entire function or component by default.

All Issue and Decision Record narrative fields are Review Knowledge Markdown documents. Separate
meaning units into paragraphs; use bullets for multiple causes/actions/checks/alternatives/risks and
an ordered list for a failure path of two or more steps. Put technical identifiers in inline code,
use fenced blocks only for an actual source snippet, do not force a one-sentence value into a list,
and do not repeat the UI's field heading inside the field.
| `get_issue` | Read one issue with its full history | `issueId` |

`severity` is `CRITICAL · HIGH · MEDIUM · LOW · INFO`.
`category` is `ARCHITECTURE · SECURITY · PERFORMANCE · DATABASE · TRANSACTION · CONCURRENCY ·
API · VALIDATION · EXCEPTION_HANDLING · TESTING · CLEAN_CODE · RELIABILITY`.

### Example

A review round, as the agent actually calls it:

```jsonc
// 1. Before touching anything — what does this repository keep getting wrong?
get_repository_knowledge { }
// -> frequentPatterns: [{ patternKey: "EXTERNAL_IO_IN_TRANSACTION", occurrences: 4 }, …]
//    unresolvedIssues, pastResolutions, wiki

// 2. Open a review. Repository and commit are read from git.
create_review {
  "reviewer": "claude-code",
  "summary": "결제 취소 경로 리뷰"
}
// -> { reviewId: "…", repository: "acme/billing", commitSha: "a81f3c2" }

// 3. Record what you found. reviewId omitted — the open one is used.
add_issue {
  "severity": "HIGH",
  "category": "TRANSACTION",
  "title": "환불 트랜잭션 안에서 PG 사 API 를 호출한다",
  "problem": "PG 응답이 늦으면 커넥션을 잡은 채 트랜잭션이 열려 있다.\n\n영향:\n\n- 취소 요청이 몰리면 pool이 고갈된다\n- 다른 결제 요청까지 대기한다",
  "rootCause": "결제 취소와 원장 기록을 한 메서드에 묶었다.\n\n그 결과 `requestRefund()` 외부 호출이 transaction 안으로 들어왔다.",
  "patternKey": "EXTERNAL_IO_IN_TRANSACTION",
  "filePath": "src/billing/refund-service.ts",
  "startLine": 82,
  "externalId": "refund-service-82-ext-io",
  "suggestion": "PG 호출을 트랜잭션 밖으로 뺀다.\n\n- 외부 응답을 먼저 받는다\n- 원장 기록만 별도 transaction으로 커밋한다"
}
// -> { issueId: "…", alreadyKnown: false }

// 4. After fixing it. issueId omitted — the last issue is used.
add_fix_attempt {
  "summary": "PG 호출을 트랜잭션 밖으로 옮겼다",
  "commitSha": "9d2b71e",
  "solution": "트랜잭션 경계를 원장 기록만으로 좁히고 PG 호출을 그 앞으로 뺐다",
  "decisionReason": "보상 트랜잭션보다 경계 축소가 되돌릴 것이 적다"
}

// 5. Once it is actually verified.
resolve_issue {
  "resolution": "트랜잭션 경계 축소로 외부 호출이 밖으로 나갔다",
  "verification": "다음 검증을 통과했다.\n\n- 동시 취소 20건에서 pool 고갈이 재현되지 않음\n- 실패 응답에서 원장 변경이 rollback됨",
  "commitSha": "9d2b71e"
}
```

`externalId` is worth setting: report the same problem again with the same `externalId` and
ReviewTrace appends to that issue's history instead of creating a second row.

## Notes

- Diagnostics go to **stderr**. stdout carries JSON-RPC only.
- The key is read at startup; a missing or malformed key exits with a message rather than
  starting a server that cannot authenticate.
- The key is sent only as an `Authorization` header. It is never logged, never put in a URL,
  and never returned in a tool result.
- Requests that carry no idempotency key are never retried automatically — a failure is
  reported rather than risking a duplicate row. Use `get_issue` or `search_issues` to check
  what actually landed.

## License

Apache-2.0
