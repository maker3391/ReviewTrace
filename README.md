# ReviewTrace

**Engineering memory for coding agents.**

Your agent fixes the bug. ReviewTrace remembers why.

ReviewTrace captures what coding agents learn while reviewing and
fixing code — the problem, the root cause, the alternatives they weighed, the solution they chose,
the trade-off they accepted, and the exact lines of code involved — and makes it searchable by the
next agent, months later.

It connects to **Claude Code** and **Codex** over MCP.

Run it against the hosted instance at **https://reviewtrace.app**, or host it yourself — the
setup below covers both.

> **Status:** pre-1.0, actively developed. A hosted instance runs at https://reviewtrace.app,
> self-hosting is supported, and the MCP server ships on npm as
> [`reviewtrace-mcp`](https://www.npmjs.com/package/reviewtrace-mcp).

<!--
  DEMO SLOT — 15–20s GIF: Claude Code finds an issue -> records it in ReviewTrace ->
  applies a fix -> resolve_issue -> the issue shows RESOLVED with BEFORE/AFTER evidence.
  Insert here once recorded:  ![ReviewTrace demo](docs/assets/demo.gif)
-->

---

## Why

Coding agents are sharp inside a session and amnesiac between them.

An agent that fixed a transaction-boundary bug in your repo three months ago cannot tell you:

- what the problem actually was
- why it happened
- what other approaches were considered and rejected
- why *this* fix was chosen
- which lines changed
- how it was verified, and what test keeps it from breaking again

That context existed. It lived in a chat transcript and then it was gone. The next agent — or the
next you — rediscovers the same problem and re-derives the same answer, or worse, picks the option
that was already tried and rejected.

ReviewTrace is not a place to dump review output. It stores **engineering decision history**:
findings, attempts, decisions, verification, and resolution, tied to immutable commits.

---

## How it works in practice

**Day 1.** Claude Code reviews a pull request and finds an external HTTP call inside a database
transaction. Through the ReviewTrace MCP server it records:

```
Issue          External API call inside DB transaction
Severity       HIGH          Category  TRANSACTION
Pattern        EXTERNAL_IO_IN_TRANSACTION
Root cause     Retry wrapper was added around the service method, which already had @Transactional
Evidence       BEFORE  a81f3c2  OrderService.java:82-95
Solution       Moved the outbound call after commit, kept the retry outside the boundary
Alternatives   Shorter tx timeout (rejected: hides the problem), async outbox (rejected: too early)
Trade-off      One extra round trip on the happy path
Verification   Re-reviewed at 4b1d0e9; connection-pool saturation test no longer reproduces
Regression     OrderServiceTx test asserts no external client is called inside the boundary
Evidence       AFTER   4b1d0e9  OrderService.java:78-91
```

**Months later.** Codex is touching payment code in the same repo. Before writing anything it calls
`get_repository_knowledge` and `search_issues`, and gets back the recurring patterns in this
repository, the issues still open, and the past resolutions — with the reasoning and the commits
attached. It does not re-litigate a decision that was already made.

Search today is exact and structured: filter by repository, status, severity, category, pattern
key, or a substring over title / file path / pattern. Semantic and vector search are **not**
implemented and are deliberately not on the near-term roadmap.

---

## Quick start

**Requirements:** Node.js 20.9+ · pnpm 11 · Docker (for PostgreSQL 17) · a GitHub OAuth App.

```bash
git clone https://github.com/maker3391/ReviewTrace.git
cd ReviewTrace
pnpm install
cp .env.example .env
```

Fill in `.env`. There are no defaults for these — the app fails at startup rather than running
half-configured (`src/lib/env.schema.ts`):

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | `postgres://…` connection string |
| `AUTH_SECRET` | 32+ chars — `openssl rand -base64 32` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth App credentials |
| `POSTGRES_PASSWORD` | used by `docker-compose.yml`; must match `DATABASE_URL` |
| `APP_URL` | optional, defaults to `http://localhost:3000` |
| `GITHUB_API_TOKEN` | optional, server-side token used to verify code evidence |

Create the OAuth App at **GitHub → Settings → Developer settings → OAuth Apps**, with callback URL
`http://localhost:3000/api/auth/callback/github`. The path is fixed by Auth.js; if you run on a
different port, register that port too.

> One OAuth App holds one callback URL, so production needs its own:
> `https://reviewtrace.app/api/auth/callback/github`. Auth.js derives it from the request host
> (`trustHost: true`) — nothing in the code hardcodes the domain.

```bash
docker compose up -d   # PostgreSQL 17
pnpm db:migrate        # apply migrations
pnpm dev               # http://localhost:3000
```

Then:

1. **Sign in with GitHub.** The first sign-in *is* sign-up. A personal workspace is created and you
   own it.
2. **Issue an API key** at `/w/{workspace}/settings` → API Keys (owner only). The token starts with
   `ci_` and is **shown exactly once** — only its SHA-256 hash is stored.
3. **Connect your agent** (below).

You do **not** register repositories or create projects by hand. The first review from an agent
upserts the repository from its git remote, and reviews land in the workspace's `default` project
unless the agent names another one.

---

## Connect Claude Code

The MCP server runs over stdio and ships on npm as `reviewtrace-mcp`. `npx` fetches it on demand —
no clone required.

The examples below point at a local instance. Using the hosted one? Set
`REVIEWTRACE_API_URL=https://reviewtrace.app` instead — everything else is the same.

> Working on ReviewTrace itself? Point the client at your checkout instead:
> replace `npx -y reviewtrace-mcp` with `node /absolute/path/to/ReviewTrace/mcp/server.mjs`.

```bash
claude mcp add reviewtrace -s user \
  -e "REVIEWTRACE_API_URL=http://localhost:3000" \
  -e "REVIEWTRACE_API_KEY=<your-api-key>" \
  -- npx -y reviewtrace-mcp
```

Verify:

```bash
claude mcp list
# reviewtrace  ✔ Connected
```

Verified end to end in this repository: connection plus real tool calls that wrote rows to
PostgreSQL.

`-s user` installs it for every project, which is what you want — the memory is not scoped to one
checkout. Avoid a project-scoped `.mcp.json`: it lives inside a repository and is one careless
commit away from leaking your key.

## Connect Codex

Codex uses a different CLI shape. Use `codex mcp add` — hand-editing `[mcp_servers.*]` into
`~/.codex/config.toml` was **not** picked up in our testing.

```bash
codex mcp add reviewtrace \
  --env "REVIEWTRACE_API_URL=http://localhost:3000" \
  --env "REVIEWTRACE_API_KEY=<your-api-key>" \
  -- npx -y reviewtrace-mcp
```

Verify:

```bash
codex mcp get reviewtrace
# enabled: true   transport: stdio
```

Registration, transport, and read tool calls are confirmed — Codex invoked
`get_repository_knowledge` against a running ReviewTrace and got a real answer back.

One thing to expect: Codex asks for approval before it runs a **write** tool. ReviewTrace
declares `create_review`, `add_issue`, `add_fix_attempt`, `review_again`, and `resolve_issue`
as non-read-only, because they are — they change what your team will read later. You approve
once in the interactive TUI. Non-interactive `codex exec` refuses them outright, so Codex
writes have not been exercised end to end yet; the same tools are verified through Claude Code
and through `scripts/mcp-e2e.mjs`.

### Keeping the key out of your repository

The server reads `REVIEWTRACE_API_KEY` from the environment your MCP client passes in, or from
`~/.reviewtrace/config.json`:

```json
{ "apiUrl": "http://localhost:3000", "apiKey": "<your-api-key>" }
```

Never put it in your project's `.env` — that file is inside a repository.

### Further reading

- [Agent integration guide](docs/agent-integration.md) — which tool to call when, and what makes a
  record worth keeping. Written for the agent, not for you.
- [Agent API reference](docs/agent-api.md) — the HTTP contract the MCP server sits on.

---

## Telling your agent to use it

No prompt engineering ritual required. The MCP server ships its own instructions, so a sentence is
usually enough.

```
Review the changes on this branch. Before you start, check ReviewTrace for past issues in this
repo. Record what you find, and when you fix something record why you chose that fix.
```

```
이 브랜치를 리뷰해라. 시작 전에 ReviewTrace 에서 이 저장소의 과거 문제를 먼저 확인하고,
찾은 문제와 고친 이유를 ReviewTrace 에 기록해라.
```

**Tools exposed:** `create_review` · `add_issue` · `add_fix_attempt` · `review_again` ·
`resolve_issue` · `get_issue` · `search_issues` · `get_repository_knowledge`.

---

## What gets remembered

Three tables carry the knowledge. Every field below exists in `src/db/schema/review.ts`.

**Issue** — what was found. Stable across repeated reports.

`title` · `description` · `severity` · `category` · `status` · `rootCause` · `failurePath` ·
`patternKey` · `filePath` · `startLine` · `endLine` · `suggestion` · `resolutionSummary` ·
`firstDetectedAt` · `resolvedAt` · `source` + `externalId` (dedup key)

`rootCause` answers a different question than `description`. Symptoms alone are not reusable;
causes are.

**Activity** — one step in the history, with the decision record attached to it.

`type` · `actorType` · `actorName` · `description` · `commitSha` · `solution` ·
`decisionReason` · `alternativesConsidered` · `tradeOff` · `verification` · `regressionTest` ·
`residualRisk`

The decision record lives on the *activity*, not the issue. An issue is usually fixed more than
once — putting the reasoning on the issue means the second attempt silently overwrites why the
first one failed, which is exactly the part worth keeping. Every decision field is optional: a
blank field beats a field an agent invented to satisfy a validator.

**Code evidence** — the lines themselves.

`kind` (`BEFORE` / `AFTER`) · `commitSha` · `filePath` · `startLine` · `endLine` · `snapshot` ·
`verification` · `verifiedAt`

Issues also carry free-form `tags`, separate from `category` (a fixed technical area) and
`patternKey` (a normalized name for a recurring problem, e.g. `N_PLUS_ONE`).

---

## Review lifecycle

```
DETECTED ──▶ FIX_ATTEMPTED ──▶ REVIEWED_AGAIN ──▶ RESOLVED ──▶ REOPENED
                  ▲                    │
                  └────────────────────┘
```

| Activity | Meaning |
| --- | --- |
| `DETECTED` | An agent or a human found the issue |
| `FIX_ATTEMPTED` | Someone tried a fix — solution and reasoning recorded here |
| `REVIEWED_AGAIN` | The fix was re-reviewed; what is still wrong, if anything |
| `RESOLVED` | Verified fixed; a resolution summary is **required** |
| `REOPENED` | It came back; `resolvedAt` and the summary are cleared |
| `IGNORED` | Won't fix, or a false positive |
| `COMMENT` | A note that changes nothing |

Statuses: `OPEN` · `IN_PROGRESS` · `RESOLVED` · `IGNORED` · `FALSE_POSITIVE` · `REOPENED`.

Status and history move together in one transaction. `RESOLVED` without a `resolutionSummary` is
rejected — storing `resolved = true` and nothing else throws away the only part that gets reused.
`FALSE_POSITIVE` is deliberately separate from `RESOLVED`; merging them would make the pattern
statistics lie.

---

## Code evidence

An issue that says "line 82 is wrong" is worthless once the branch moves. Evidence is pinned to an
**immutable commit**, never to a branch head:

```
repository + commitSha + filePath + startLine..endLine  →  snapshot
```

The snapshot is what the agent claims it read. Whether GitHub agrees is recorded separately:

| `verification` | Meaning |
| --- | --- |
| `UNVERIFIED` | Not checked yet |
| `VERIFIED` | Matches GitHub at that commit |
| `MISMATCH` | Present at that commit, but different |
| `UNAVAILABLE` | Couldn't look — private repo, missing commit, rate limit, GitHub down |

Keeping "the agent sent this" apart from "GitHub confirms this" is the point. The verification pass
runs *outside* the write transaction, so a slow or unreachable GitHub never blocks a recording, and
the snapshot fallback means the UI still shows something for private or deleted repositories.

**Only public repositories are ever read.** The server asks GitHub whether the repository is public
before fetching anything, and stops if it is not — even with a token configured. Registering a
repository in a workspace is not proof that the workspace may read it: anyone can put
`someone-else/private` in a payload, and without that check a shared server token would pull other
people's code into their evidence.

`GITHUB_API_TOKEN` is optional and only raises the anonymous rate limit. Verification never uses
your login token: sign-in requests only `read:user` and `user:email`, and asking every user for
`repo` scope to check a code snippet is not a trade worth making.

---

## Real examples

Both of these are bugs found in ReviewTrace itself.

**1. A UUID is not an authorization boundary.**
`verifyCodeEvidence` looked up evidence rows by id alone. The ids were server-generated inside the
same transaction, so nothing was exploitable — but this repository's rule is that *every* id-based
lookup also carries a workspace condition, and one exception becomes the precedent for the next
one. A `workspaceId` condition was added to the select, the join, and the update.
→ `src/features/issues/server/code-evidence-service.ts`

**2. Claude Code found a ReviewTrace bug through ReviewTrace's own MCP server.**
When evidence was submitted without a line range, `readGithubLines` returned the *whole file*, and
`decideVerification` compared the agent's snippet to it with `===`. Every rangeless piece of
evidence was therefore marked `MISMATCH` — the UI was effectively accusing the agent of lying, when
the server had asked the wrong question. The read now reports whether it returned a whole file, and
verification asks "is it *contained*?" for whole files and "is it *equal*?" for line ranges.
Normalization trims line endings and trailing whitespace but never indentation, because in code
indentation is meaning.
→ `src/lib/github/content.ts`, `src/features/issues/server/code-evidence-service.ts`,
regression test in `src/features/issues/server/code-evidence-service.test.ts`

---

## What ReviewTrace is not

Not an AI code reviewer — your agent does the reviewing. Not an LLM wrapper: there is no model call
anywhere in the core path. Not an IDE, and not an agent orchestration engine.

---

## Architecture

```
Claude Code / Codex
        │  MCP (stdio)
        ▼
mcp/server.mjs ─────────► POST   /api/v1/reviews
  no business logic       POST   /api/v1/reviews/{reviewId}/issues
                          POST   /api/v1/issues/{issueId}/activities
                          PATCH  /api/v1/issues/{issueId}
                          GET    /api/v1/issues
                          GET    /api/v1/issues/{issueId}
                          GET    /api/v1/knowledge/context
                                   │
                                   ▼
                          API key auth → Zod → Application service
                                   │
                          ┌────────┴────────┐
                          ▼                 ▼
                     PostgreSQL      GitHub adapter
                                   (evidence verification)
```

**The MCP adapter is not a security boundary.** It holds no business rules: tenant resolution,
validation, repository ownership and evidence verification all happen behind the REST API. If MCP
filtered anything itself, the two entry points would drift apart, and that gap would become the
bypass. Anything MCP can do, an HTTP client with the same key can do — deliberately, because the
API is the canonical contract and MCP is one client of it.

The web app is a modular monolith: Next.js App Router, server components for reads, server actions
for writes, application services in `src/features/{domain}/server`, Drizzle over PostgreSQL. No
message queue, no cache layer, no vector database.

---

## Security model

- **The API key *is* the tenant.** There is no workspace field in any payload or query; a client
  cannot name a workspace. Every agent query is scoped by the key's workspace.
- **Keys are stored as SHA-256 hashes.** The plaintext exists only in the issuing response and is
  shown once. Malformed tokens are rejected before touching the database.
- **Rejections are indistinguishable.** Missing, malformed, unknown, revoked, and expired keys all
  return the same `UNAUTHORIZED`. Distinguishing them leaks the existence of a key.
- **Someone else's resource is `404`, not `403`.** A `403` confirms the id exists and lets you
  enumerate other tenants.
- **Revocation does not delete.** Revoked keys keep their row so their history survives.
- **GitHub tokens stay server-side.** Sign-in uses GitHub OAuth with database sessions; the access
  token lives in the `accounts` table and never reaches the session object or the browser.
- **Security headers** are set for every response — `frame-ancestors 'none'`, `nosniff`,
  `strict-origin-when-cross-origin` (workspace and project names are in the URL path), and HSTS in
  production only (`next.config.ts`).
- **No secrets in the repository.** `.env` is ignored; `.env.example` has placeholders only.

---

## Why setup is simple

Agents never have to be told internal identifiers.

| You'd expect to supply | Where it actually comes from |
| --- | --- |
| Workspace id | The API key |
| Project | Optional `slug`; falls back to `default` |
| Repository | `git remote` in the current checkout |
| Commit | `git HEAD` |
| Review id | Remembered by the MCP process for the session |
| Issue id | Defaults to the last issue the session touched |

You paste a key once. You never paste a UUID.

---

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript strict · PostgreSQL 17 · Drizzle ORM · Auth.js
(GitHub OAuth, database sessions) · Zod 4 · React Hook Form · Tailwind CSS 4 · shadcn/ui ·
`@modelcontextprotocol/sdk` · Vitest · pnpm.

---

## Local development

```bash
pnpm install
docker compose up -d      # PostgreSQL 17 (container: code-intelligence-postgres)
pnpm db:migrate
pnpm dev                  # http://localhost:3000
```

```bash
pnpm lint
pnpm typecheck            # next typegen && tsc --noEmit
pnpm test
pnpm build
```

Schema changes: edit `src/db/schema/**`, run `pnpm db:generate`, read the generated SQL, then
`pnpm db:migrate`. Both the schema and the generated migration are committed. `drizzle-kit push` is
not used — migrations are reviewed by a human before they run.

`docker compose down` stops the database and keeps the volume; `down -v` deletes the data.

## Testing

```bash
pnpm test                          # unit tests, no database required
DB_INTEGRATION=true pnpm test      # tenant-isolation tests against real PostgreSQL
bash scripts/agent-api-e2e.sh      # Agent REST API end to end (needs a dev server + database)
node scripts/mcp-e2e.mjs           # MCP → REST → PostgreSQL end to end
node scripts/evidence-github-e2e.mjs   # evidence verified against real GitHub (needs network)
bash scripts/dashboard-explain.sh  # EXPLAIN ANALYZE on dashboard queries at volume
```

Integration tests run inside transactions that are rolled back, so they leave no rows behind. The
end-to-end scripts drive a real dev server against a real database and read the resulting rows back
with `psql` — "it returned 200" is not accepted as proof that something was stored.

### A green `pnpm test` is not proof of tenant safety

`pnpm test` skips two whole files, because they need a live PostgreSQL:

- `src/lib/workspace/workspace.integration.test.ts` — sign-up, membership, invitations
- `src/features/projects/server/project.integration.test.ts` — projects, dashboards, wiki scope,
  detail lookups

Until you pass `DB_INTEGRATION=true`, **none of the following is checked**:

| Not checked by `pnpm test` | Who actually enforces it |
| --- | --- |
| Overlapping `workspaceId` + `projectId` conditions really do exclude another tenant | the SQL `WHERE` clause |
| `UNIQUE(workspace_id, slug)`, `workspaces.personal_owner_id`, the two partial unique indexes on `knowledge_pages` | database constraints |
| `ON DELETE CASCADE` removes repositories, reviews and issues with a project | foreign keys |
| `count(*) filter (...)` and correlated subqueries count the right rows | the query itself |
| A single-shot `UPDATE … WHERE accepted_at IS NULL` claims an invitation exactly once | transaction semantics |
| `FOR UPDATE` locks the other owner rows while the last-owner rule is evaluated | row locks |

The *decision rules* that sit above those queries — reject an explicitly chosen slug instead of
silently renaming it, map a unique violation to `CONFLICT` without leaking the driver message,
refuse to demote the last owner, store only the SHA-256 hash of an invitation token, keep every
rejection reason indistinguishable — are covered by ordinary unit tests that run on every
`pnpm test`. They use a fake executor (`src/db/testing/fake-executor.ts`), which does **not**
interpret `WHERE`. It can prove what the code decides; it cannot prove what the database enforces.

These files are skipped by default on purpose: a test that fails on a fresh clone, or in a CI job
without a database, stops being read as a test. The point is that the split is explicit, not that
the skipped half matters less.

### Running the database tests in CI

Not wired up — this is the recipe, not a description of an existing workflow. On GitHub Actions,
add a `services.postgres` container to the job, point `DATABASE_URL` at it, run `pnpm db:migrate`,
and run the suite with `DB_INTEGRATION=true`:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    env:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: reviewtrace
    ports: ["5432:5432"]
    options: >-
      --health-cmd pg_isready --health-interval 10s
      --health-timeout 5s --health-retries 5
```

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/reviewtrace
pnpm db:migrate
DB_INTEGRATION=true pnpm test
```

Two details that will bite otherwise: the tests call `process.loadEnvFile(".env")`, so CI needs a
`.env` containing at least `DATABASE_URL` (write it in a step, do not commit it); and this must be
a throwaway database — the tests roll back, but `db:migrate` does not.

The evidence script is the one that proves `VERIFIED` is reachable at all: it reads real lines from
a public repository at a real commit, sends them back as evidence, and checks that matching content
verifies, altered content mismatches, out-of-range lines and missing files stay unavailable, and a
genuinely blank line is not mistaken for out-of-range. It needs network, so it is not part of
`pnpm test` — a test that fails offline stops being read as a test.

Do not run `pnpm build` while `pnpm dev` is up. They share `.next`, and the build leaves the dev
server alive but serving 500s on some routes.

---

## Roadmap

**Working today**

- GitHub OAuth sign-in, database-backed sessions, workspaces, invitations, roles
- Projects → repositories → reviews → issues → activities → evidence
- Agent REST API (7 endpoints) with API-key auth and tenant isolation
- MCP server with 8 tools, verified against Claude Code
- Code evidence with GitHub verification and snapshot fallback
- Decision records on every activity
- Workspace and project dashboards, issue / review / repository detail pages, markdown wiki
- API key issue and revoke UI
- Deleting a project or a workspace, with the impact counted before you confirm
- A hosted instance at https://reviewtrace.app
- The MCP server on npm as `reviewtrace-mcp`, installed with `npx -y reviewtrace-mcp`

**In progress**

- Exercising Codex write tools outside the interactive TUI (they need approval, by design)
- Screenshots and a demo recording

**Planned**

- Removing members; renaming a workspace
- Deeper GitHub integration (pull request context)
- LLM- or embedding-based features are explicitly deferred until the structured data justifies them

---

## Contributing

Issues and pull requests are welcome. Work branches from `develop`; pull requests target `develop`,
never `main`. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` before opening one.

Project conventions — the domain model, architecture boundaries, database rules and security
rules — are described throughout this README and in [`docs/`](./docs). The code carries the rest:
modules state the reasoning behind their constraints in comments, so read the file you are about to
change before changing it.

## License

Licensed under the [Apache License 2.0](LICENSE).
