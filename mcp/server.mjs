#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createClient } from "./client.mjs";
import { ConfigError, loadConfig } from "./config.mjs";
import { registerTools } from "./tools.mjs";

/**
 * ReviewTrace MCP Server (스펙 1·9·10).
 *
 * ```
 * Claude Code / Codex -> [이 프로세스] -> ReviewTrace Agent API -> Application -> Database
 * ```
 *
 * ## 🔴 왜 stdio 인가
 *
 * Claude Code 와 Codex 가 **둘 다 확실히 지원하는 유일한 방식**이다. Codex 의
 * `~/.codex/config.toml` 은 `[mcp_servers.<이름>]` 에 `command`·`args`·`env` 를 적어
 * 프로세스를 띄우는 모양이고, Claude Code 의 `mcpServers` 도 같은 모양을 받는다.
 * HTTP/SSE 를 고르면 **서버를 따로 띄워 두고 그 주소를 관리하는 일**이 사용자 몫으로
 * 늘어난다 — 지금 목표는 「설정 한 번 붙여넣고 끝」이다(스펙 27).
 *
 * ## 🔴 왜 Local 인가
 *
 * Key 가 사용자 컴퓨터 밖으로 나가지 않고, ReviewTrace Backend 의 배포 주기와 이 프로세스의
 * 수명이 분리된다. Hosted MCP 는 **여러 사용자를 한 프로세스가 받는** 구조라 그 자체가
 * 새로운 Tenant 경계가 되는데, 지금 그 경계를 하나 더 만들 이유가 없다(스펙 25).
 *
 * ## 🔴 stdout 은 통신 채널이다
 *
 * `console.log` 한 줄이 섞이면 Client 가 JSON-RPC 를 못 읽고 연결이 끊긴다.
 * 이 프로세스의 진단은 **전부 stderr** 로 간다.
 */

const NAME = "reviewtrace";
const VERSION = "0.1.0";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // 🔴 stderr 다. Client 가 이 줄을 로그로 보여 준다.
      console.error(`[reviewtrace-mcp] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const server = new McpServer(
    { name: NAME, version: VERSION },
    {
      instructions:
        "ReviewTrace 는 Code Review 결과를 오래 쌓아 다시 쓰는 곳이다. " +
        "리뷰를 시작할 때 create_review, 문제를 찾을 때마다 add_issue 를 부른다. " +
        "고쳤으면 add_fix_attempt, 다시 봤으면 review_again, 검증까지 끝났으면 resolve_issue 다. " +
        "코드를 고치기 전에 get_repository_knowledge 나 search_issues 로 과거에 같은 문제가 있었는지 먼저 본다. " +
        "중요한 문제에는 Root Cause, 선택한 해결책, 선택 이유, 대안, Trade-off, Evidence 를 함께 남긴다.",
    },
  );

  /**
   * 이 연결 동안의 기억.
   *
   * 🔴 Agent 에게 내부 ID 를 들고 다니게 하지 않기 위한 것이다(스펙 6) —
   * 방금 연 Review 와 방금 다룬 Issue 를 여기서 기억한다. 프로세스가 곧 한 세션이라
   * 다른 사용자와 섞이지 않는다.
   */
  const state = { reviewId: null, lastIssueId: null, commitSha: null };

  registerTools(server, createClient(config), state);

  await server.connect(new StdioServerTransport());
  console.error(`[reviewtrace-mcp] 연결됨 (${config.apiUrl})`);
}

main().catch((error) => {
  console.error("[reviewtrace-mcp] 시작하지 못했다", error);
  process.exit(1);
});
