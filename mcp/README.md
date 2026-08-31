# reviewtrace-mcp

MCP server for [ReviewTrace](https://github.com/maker3391/ReviewTrace) — record what a code
review found, how it was fixed, and why, so the next review can pick up where the last one
left off.

It speaks **stdio**, which is what Claude Code and Codex both support, and it talks to a
ReviewTrace instance over its Agent API. Your API key never leaves your machine.

## Requirements

- Node.js **20.11+**
- A ReviewTrace instance and an API key from **Workspace Settings → API Keys**

## Claude Code

```bash
claude mcp add reviewtrace -s user \
  -e "REVIEWTRACE_API_URL=https://your-reviewtrace-instance" \
  -e "REVIEWTRACE_API_KEY=ci_your_key" \
  -- npx -y reviewtrace-mcp
```

Verify with `claude mcp list`.

## Codex

```bash
codex mcp add reviewtrace \
  --env "REVIEWTRACE_API_URL=https://your-reviewtrace-instance" \
  --env "REVIEWTRACE_API_KEY=ci_your_key" \
  -- npx -y reviewtrace-mcp
```

Verify with `codex mcp get reviewtrace`.

## Configuration

| Variable | Required | Default |
|---|---|---|
| `REVIEWTRACE_API_KEY` | yes | — |
| `REVIEWTRACE_API_URL` | no | `http://localhost:3000` |

Instead of environment variables you may write `~/.reviewtrace/config.json`:

```json
{ "apiUrl": "https://your-reviewtrace-instance", "apiKey": "ci_your_key" }
```

Environment variables win over the file.

## Tools

`create_review` · `add_issue` · `add_fix_attempt` · `review_again` · `resolve_issue` ·
`get_issue` · `search_issues` · `get_repository_knowledge`

## Notes

- Diagnostics go to **stderr**. stdout carries JSON-RPC only.
- The key is read at startup; a missing or malformed key exits with a message rather than
  starting a server that cannot authenticate.

## License

Apache-2.0
