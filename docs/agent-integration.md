# Agent Integration Guide

This is the short version for coding agents. If you are an agent reading this: you do
not need a long prompt. The tool schemas tell you the shape; this page tells you _when_
to call what, and what makes a record worth keeping.

## What ReviewTrace is

ReviewTrace is not a reviewer. **You** are the reviewer. ReviewTrace is where the
reasoning behind a review survives after your session ends, so the next agent — maybe a
different one, months later — can read it.

That means a record is only worth writing if a future agent could act on it. "Unused
import on line 12" is not. "This transaction holds a connection across an external HTTP
call, and here is why we moved the call out instead of adding a Saga" is.

## The eight tools

| Tool                       | Call it when                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `get_repository_knowledge` | **Before you start.** Shows recurring patterns, unresolved issues, and how past problems were solved in this repo. |
| `search_issues`            | You suspect the thing you just found already exists. Search by `patternKey` or a keyword.                          |
| `create_review`            | You are about to review something. Opens one session for this commit.                                              |
| `add_issue`                | Each significant finding. Attach it to the open review.                                                            |
| `add_fix_attempt`          | You changed code to address an issue. Record what you did and why.                                                 |
| `review_again`             | You re-checked a fix. Say whether it holds.                                                                        |
| `resolve_issue`            | Verification passed. `resolution` is required — that is the part that gets reused.                                 |
| `get_issue`                | You need the full history of one issue, including every past attempt.                                              |

You almost never pass IDs. `create_review` reads the repository and commit from git.
`add_issue` attaches to the review you just opened. `add_fix_attempt`, `review_again`,
and `resolve_issue` default to the issue you last touched.

## The lifecycle

```
create_review
 |
 v
 add_issue ──────────────► DETECTED
 |
 v
add_fix_attempt ──────────► FIX_ATTEMPTED
 |
 v
 review_again ────────────► REVIEWED_AGAIN
 |
 v
 resolve_issue ───────────► RESOLVED
```

The loop between `add_fix_attempt` and `review_again` can repeat. That is the point —
each attempt keeps its own reasoning instead of overwriting the last one.

## Writing standards

These fields are all optional. An empty field is better than an invented one. But when
you _do_ know the answer, write it — this is the whole value of the record.

Knowledge fields contain Markdown source. Separate different ideas with a blank line
instead of joining them into one long paragraph. Prefer an ordered list for a multi-step
failure or attack path, and bullet lists for multiple suggestions, applied changes, or
verification commands. Use inline code for identifiers. The server stores this Markdown
source as text; it does not heuristically rewrite legacy one-line records.

**`rootCause`** — why the code ended up this way, not what is wrong with it. "The
transaction boundary was drawn around the whole service method" is a root cause.
"External call inside a transaction" is a restatement of the title. Separate the direct
cause from the structural cause when both matter.

**`failurePath`** — how this actually breaks in production. For security findings, the
attack path. Concrete: "if the payment API slows to 3s, the connection pool drains and
unrelated orders start timing out." Prefer an ordered list when the path has multiple
steps.

**`decisionReason`** — why this fix and not another. If the reason is "it was the
smallest change that worked," say that. That is a real reason.

**`alternatives`** — what you considered and dropped, with why. "Saga pattern — too much
machinery for a single external call at this scale." A future agent facing the same
choice reads this first.

**`tradeOff`** — what the fix costs. Every real fix costs something. "Orders can briefly
sit in PENDING if the payment call fails after commit."

**`verification`** — how you know it works now. A test name, a load test result, a
manual check. Not "fixed." Use a bullet list when reporting test, lint, typecheck, build,
or multiple manual checks.

**`regressionTest`** — what stops it from coming back. Usually a test name.

**`residualRisk`** — what is still not handled. Say it plainly.

## Code evidence

Attach `evidence` to `add_issue` (kind `BEFORE`) and to `add_fix_attempt` or
`resolve_issue` (kind `AFTER`). Each entry needs a `commitSha`, a `filePath`, and
ideally a line range.

Send the actual lines in `snapshot` when you have them. The server independently checks
that snapshot against GitHub at that commit and records the result separately — you
cannot mark your own evidence as verified. Only public repositories are checked; for a
private repo, a deleted commit, or a missing file, the snapshot you sent is still kept and
the record says `UNAVAILABLE` rather than pretending.

Keep each Evidence range minimal: the problem or changed lines plus only the context
needed to understand them. Do not send an entire function or component by habit. Set
`startLine` and `endLine` to the exact snapshot range. Existing wide snapshots remain
valid and are not rewritten.

Point at a commit SHA, never a branch name. Branches move; the evidence should not.

## Repository CLAUDE.md / AGENTS.md

You do not need to paste this guide into your repository. This is enough:

```markdown
Record code review results in ReviewTrace via MCP.
For significant findings, include root cause, the chosen solution and why,
alternatives considered, trade-offs, and code evidence.
```

## Errors

Tool errors are written for you to act on, not for a human to debug:

| Message                                 | What to do                                                 |
| --------------------------------------- | ---------------------------------------------------------- |
| API key is not valid                    | Stop. The user must issue a new key in Workspace Settings. |
| Could not reach the ReviewTrace server  | Stop. The server or `REVIEWTRACE_API_URL` is wrong.        |
| Not a git repository / no origin remote | Pass `repository` as `owner/name` explicitly.              |
| Could not find the target               | The issue or review is not in this API key's workspace.    |
| No open review                          | Call `create_review` first.                                |

Errors never contain stack traces, SQL, or the API key.
