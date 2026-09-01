# Agent API

`/api/v1/**`. This is the canonical integration surface. The MCP server is an adapter on
top of it — anything MCP can do, an HTTP client can do, and the rules are enforced here,
not there.

## Authentication

```
Authorization: Bearer ci_xxxxxxxx
```

The key determines the workspace. There is no `workspaceId` field in any request body or
query string, and one sent anyway is stripped before validation.

Bad format, unknown key, revoked key, and expired key all return the same `401`. The
distinction would itself leak whether a key exists.

## Error format

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

| Code                | Status |
| ------------------- | ------ |
| `VALIDATION_ERROR`  | 400    |
| `PAYLOAD_TOO_LARGE` | 413    |
| `UNAUTHORIZED`      | 401    |
| `FORBIDDEN`         | 403    |
| `NOT_FOUND`         | 404    |
| `INTERNAL_ERROR`    | 500    |

Objects outside your workspace return `404`, never `403`.

Responses never contain stack traces, SQL, or internal paths.

Request bodies are limited to 4,000,000 bytes. The server counts bytes while reading the
stream and returns `413 PAYLOAD_TOO_LARGE` before JSON parsing when the limit is exceeded.

---

## `POST /api/v1/reviews`

Records one review session, with zero or more issues, in a single transaction.

**Headers** — `Idempotency-Key` (optional, ≤200 chars). Resending the same key against
the same repository returns `200` and writes nothing. Omit it and the same commit can be
reviewed twice, which is legitimate. A key longer than 200 characters is rejected with
`400 VALIDATION_ERROR`; it is never ignored silently, because a dropped key would leave
the request un-deduplicated while the caller believed it was protected.

**Body**

| Field                                               | Required    | Notes                                                                                                  |
| --------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `project.slug`                                      | conditional | Existing Repository: omit or match its Project. Unregistered Repository: required and must exist       |
| `project.name`                                      | no          | Compatibility field; ingestion does not create a Project implicitly                                    |
| `repository.provider`                               | yes         | `GITHUB`                                                                                               |
| `repository.owner` / `name` / `fullName`            | yes         |                                                                                                        |
| `repository.externalRepositoryId`                   | no          | GitHub's numeric id. Send it and renames keep one row; omit it and identity falls back to `owner/name` |
| `repository.defaultBranch`                          | no          | Defaults to `main`                                                                                     |
| `repository.htmlUrl`                                | no          | `http`/`https` only                                                                                    |
| `target.type`                                       | yes         | `PULL_REQUEST` · `COMMIT` · `BRANCH` · `REPOSITORY` · `MANUAL`                                         |
| `target.branch` / `commitSha` / `pullRequestNumber` | no          |                                                                                                        |
| `reviewer.type`                                     | yes         | `AGENT` · `HUMAN` · `SYSTEM`                                                                           |
| `reviewer.name` / `version`                         | yes / no    |                                                                                                        |
| `summary`                                           | no          |                                                                                                        |
| `startedAt` / `completedAt`                         | no          | ISO-8601 with offset                                                                                   |
| `issues[]`                                          | no          | Max 500. An empty review is a valid record — "this commit was clean"                                   |

**Issue fields**

Narrative fields (`description`, `rootCause`, `failurePath`, `suggestion`, resolution
summaries, activity descriptions, and decision-record fields) accept Markdown source.
Use blank lines between concepts, ordered lists for multi-step failure paths, and bullet
lists for multiple changes or checks. Raw HTML is not part of the supported content model.
The API preserves the submitted text rather than heuristically reformatting legacy prose.
An existing Repository's `project_id` is the source of truth. A different `project.slug` returns
`409`; it never moves the row. An unregistered Repository is connected only after the Workspace's
GitHub App installation verifies access. With no `project.slug`, the API returns `400` and creates
neither a Repository nor a Default Project.

| Field                                | Required | Notes                                                                                                                                                                             |
| ------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `severity`                           | yes      | `CRITICAL` · `HIGH` · `MEDIUM` · `LOW` · `INFO`                                                                                                                                   |
| `category`                           | yes      | `ARCHITECTURE` · `SECURITY` · `PERFORMANCE` · `DATABASE` · `TRANSACTION` · `CONCURRENCY` · `API` · `VALIDATION` · `EXCEPTION_HANDLING` · `TESTING` · `CLEAN_CODE` · `RELIABILITY` |
| `title`                              | yes      | ≤500                                                                                                                                                                              |
| `description`                        | no       | What is wrong                                                                                                                                                                     |
| `rootCause`                          | no       | Why it ended up this way                                                                                                                                                          |
| `failurePath`                        | no       | How it actually breaks; attack path for security findings                                                                                                                         |
| `patternKey`                         | no       | Normalised name of a recurring problem, e.g. `N_PLUS_ONE`                                                                                                                         |
| `filePath` / `startLine` / `endLine` | no       | `endLine` must be ≥ `startLine`                                                                                                                                                   |
| `suggestion`                         | no       | Proposed fix. Distinct from what was actually done                                                                                                                                |
| `source` + `externalId`              | no       | Together they identify the issue. Resending both keeps one row and appends `REVIEWED_AGAIN` to its history                                                                        |
| `tags[]`                             | no       | Max 20                                                                                                                                                                            |
| `decision`                           | no       | See [Decision record](#decision-record)                                                                                                                                           |
| `evidence[]`                         | no       | Max 20. See [Code evidence](#code-evidence)                                                                                                                                       |

**Response** — `201` (or `200` on an idempotent replay)

```json
{
  "repositoryId": "…",
  "reviewSessionId": "…",
  "issues": [
    {
      "id": "…",
      "title": "…",
      "severity": "HIGH",
      "category": "TRANSACTION",
      "status": "OPEN",
      "alreadyKnown": false
    }
  ],
  "idempotentReplay": false
}
```

---

## `POST /api/v1/reviews/{reviewId}/issues`

Appends issues to an open session. Exists so an agent that finds problems one at a time
does not create one session per finding.

**Body** — `{ "issues": [ … ] }`, same issue shape as above, 1–500 entries. Repository and
reviewer are not accepted here; the session already fixed them.

**Response** — `201` with `reviewSessionId` and `issues[]`.

---

## `PATCH /api/v1/issues/{issueId}`

A state transition, not a column update. Status, `resolvedAt`, `resolutionSummary`, and a
new activity row move together in one transaction.

| Field                       | Required        | Notes                                                                           |
| --------------------------- | --------------- | ------------------------------------------------------------------------------- |
| `status`                    | yes             | `OPEN` · `IN_PROGRESS` · `RESOLVED` · `IGNORED` · `FALSE_POSITIVE` · `REOPENED` |
| `resolutionSummary`         | when `RESOLVED` |                                                                                 |
| `actor.type` / `actor.name` | no              | Defaults to the API key's name                                                  |
| `commitSha`                 | no              |                                                                                 |
| `decision`                  | no              |                                                                                 |
| `evidence[]`                | no              |                                                                                 |

Each status maps to one activity type: `RESOLVED` → `RESOLVED`, `IN_PROGRESS` →
`FIX_ATTEMPTED`, `IGNORED`/`FALSE_POSITIVE` → `IGNORED`, `OPEN`/`REOPENED` → `REOPENED`.

Moving away from `RESOLVED` clears `resolvedAt` and `resolutionSummary` — a reopened
issue that still carries a resolution is a contradiction. The summary is not lost: it was
written into the `RESOLVED` activity when the transition happened.

**Response** — `200` with `{ "issue": { id, status, resolutionSummary, resolvedAt, updatedAt } }`.

---

## `POST /api/v1/issues/{issueId}/activities`

Appends one line of history. Does not change status.

| Field                       | Required | Notes                                                                                             |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `type`                      | yes      | `DETECTED` · `FIX_ATTEMPTED` · `REVIEWED_AGAIN` · `RESOLVED` · `REOPENED` · `IGNORED` · `COMMENT` |
| `actor.type` / `actor.name` | yes      |                                                                                                   |
| `description`               | no       |                                                                                                   |
| `commitSha`                 | no       |                                                                                                   |
| `decision`                  | no       |                                                                                                   |
| `evidence[]`                | no       |                                                                                                   |

**Response** — `201` with `{ "activity": { … } }`.

---

## `GET /api/v1/issues/{issueId}`

One issue with its full history. Every activity carries its own decision record and its
own evidence, oldest first — the second fix attempt does not overwrite the first.

**Response** — `200` with `{ "issue": { …, "activities": [ { …, "evidence": [ … ] } ] } }`.

---

## `GET /api/v1/issues`

| Query                              | Notes                                                                |
| ---------------------------------- | -------------------------------------------------------------------- |
| `repository`                       | `owner/name`, case-insensitive. A filter, not an authorisation grant |
| `status` · `severity` · `category` | Exact match                                                          |
| `patternKey`                       | Exact match                                                          |
| `q`                                | Substring over title, file path, pattern key                         |
| `limit`                            | 1–50, default 20                                                     |

**Response** — `200` with `{ "issues": [ … ] }`, newest first.

---

## `GET /api/v1/knowledge/context`

What a repository has learned. Read this before starting work.

| Query                               | Notes                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `repository`                        | `owner/name`                                                                      |
| `repositoryId`                      | UUID. Kept for existing clients; prefer `repository`                              |
| `projectSlug`                       | Narrows review knowledge to one project; wiki still includes workspace-wide pages |
| `category` · `severity` · `pattern` |                                                                                   |
| `limit`                             | 1–100, default 20                                                                 |

**Response** — `200` with `scope`, `wiki`, `frequentPatterns`,
`recentHighSeverityIssues`, `unresolvedIssues`, `pastResolutions`.

When `repository` is present and `projectSlug` is absent, scope is resolved as
Repository → `project_id` → Project → Workspace. `scope.repository.requested` and
`scope.repository.resolved` distinguish a git-remote string from a DB row;
`scope.project.resolutionSource` is `REPOSITORY`, `PROJECT_SLUG`, or `null`. An unknown Repository
returns empty Knowledge with `resolved=false`; it is never widened to Workspace scope.

---

## Decision record

Attaches to the **activity**, not to the issue. A second fix attempt records its own
reasoning instead of overwriting the first — that history is the reusable part.

`solution` · `decisionReason` · `alternativesConsidered` · `tradeOff` · `verification` ·
`regressionTest` · `residualRisk`. All optional, each ≤10,000 chars. Sending seven empty
strings stores nothing.

These values are Markdown source. Put separate ideas in separate paragraphs; use bullet
lists for multiple verification steps, alternatives, trade-offs, regression checks, or
residual risks.

`review_issues.resolutionSummary` is separate: it is the issue's final Markdown resolution
summary, while a decision record is one step on the way there.

---

## Code evidence

| Field                   | Required | Notes                                                            |
| ----------------------- | -------- | ---------------------------------------------------------------- |
| `kind`                  | yes      | `BEFORE` · `AFTER`                                               |
| `commitSha`             | yes      | A commit, never a branch                                         |
| `filePath`              | yes      |                                                                  |
| `startLine` / `endLine` | no       | Exact range of the minimal relevant snippet                      |
| `snapshot`              | no       | Problem/changed lines plus only necessary context, ≤20,000 chars |

The server checks the snapshot against GitHub at that commit **after** the response is
sent, so verification never delays your request. The result is recorded separately —
a client cannot mark its own evidence as verified.

The API stores the submitted range verbatim; it does not expand the snippet. Callers
should not submit an entire function or component when a smaller changed range is enough.

| `verification` | Meaning                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `UNVERIFIED`   | Not checked yet                                                                                                         |
| `VERIFIED`     | Matched GitHub at that commit and line range. With no line range, the snippet was found in the file                     |
| `MISMATCH`     | The file exists at that commit but the content differs                                                                  |
| `UNAVAILABLE`  | Could not look: private repo without Workspace installation access, missing commit/file, rate limit, or network failure |

If no snapshot is sent and the lines are readable, the server fills it in from GitHub so
the record survives the repository being deleted or going private. With no line range and
no snapshot it stores nothing — ReviewTrace keeps review knowledge, not a copy of your
source.

Public repositories can be read anonymously. Private repositories are read only through a
short-lived installation token whose installation belongs to the API Key's Workspace and whose
repository grant includes the stored numeric GitHub repository id. An `owner/name` string or a
client-supplied numeric id alone never authorizes a read.

`GITHUB_API_TOKEN` is optional and only raises the anonymous rate limit (60 requests per
hour). ReviewTrace never asks users to widen their OAuth scope to `repo` for this.

Paths are taken literally. A path containing `.` or `..` segments is not normalised into
something else — it is reported `UNAVAILABLE`, because verifying `a/b.ts` while the record
says `a/../b.ts` would mean the stored location and the checked location disagree.
