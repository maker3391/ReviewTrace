#!/usr/bin/env node
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { generateAgentCredential } from "../src/lib/api/api-key-token.ts";

/**
 * MCP -> Agent API -> Database 전체 E2E(스펙 9·22).
 *
 * 🔴 **「연결됐다」로 끝내지 않는다.** Tool 을 실제로 부르고, 그 결과가 PostgreSQL 에
 * 어떤 행으로 남았는지 직접 조회해 확인한다.
 *
 * 쓰는 법
 *   1) docker compose up -d
 *   2) pnpm dev -p 3910   (다른 터미널)
 *   3) MCP_E2E_PORT=3910 node scripts/mcp-e2e.mjs
 */

const run = promisify(execFile);

const PORT = process.env.MCP_E2E_PORT ?? "3910";
const API_URL = `http://localhost:${PORT}`;
const CONTAINER = process.env.E2E_PG_CONTAINER ?? "code-intelligence-postgres";
const PGUSER = process.env.E2E_PG_USER ?? "code_intelligence";
const PGDB = process.env.E2E_PG_DB ?? "code_intelligence";

const WORKSPACE_ID = "cccccccc-0000-4000-8000-000000000003";
const SLUG = "mcp-e2e";

let pass = 0;
let fail = 0;
const ok = (m) => {
  pass += 1;
  console.log(`OK   ${m}`);
};
const bad = (m) => {
  fail += 1;
  console.log(`FAIL ${m}`);
};
const check = (cond, good, badMsg) => (cond ? ok(good) : bad(badMsg));

async function psql(sql) {
  const { stdout } = await run(
    "docker",
    [
      "exec",
      "-i",
      CONTAINER,
      "psql",
      "-U",
      PGUSER,
      "-d",
      PGDB,
      "-t",
      "-A",
      "-c",
      sql,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  return stdout.trim();
}

async function cleanup() {
  await psql(`delete from workspaces where slug = '${SLUG}'`).catch(() => {});
}

/** Tool 결과의 본문을 객체로 되돌린다. 실패한 호출은 여기서 바로 드러난다. */
function body(result, name) {
  const text = result.content?.[0]?.text ?? "";
  if (result.isError === true) {
    throw new Error(`${name} 실패: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  await cleanup();

  // ── 0. 준비 — 실제 생성기로 Key 를 만들고 Hash 만 저장한다 ────────────────
  const key = generateAgentCredential();
  await psql(
    `insert into workspaces (id, slug, name) values ('${WORKSPACE_ID}','${SLUG}','MCP E2E');` +
      // 🔴 자격은 Principal 에 달리고 Workspace 접근은 grant 가 정한다.
      `insert into agent_principals (id, type, display_name, review_language) ` +
      `values ('cccccccc-4444-4000-8000-000000000001','SERVICE_AGENT','MCP E2E','ko');` +
      `insert into agent_workspace_grants (principal_id, workspace_id) ` +
      `values ('cccccccc-4444-4000-8000-000000000001','${WORKSPACE_ID}');` +
      `insert into agent_credentials (principal_id, name, key_prefix, key_hash) ` +
      `values ('cccccccc-4444-4000-8000-000000000001','mcp-agent','${key.keyPrefix}','${key.keyHash}');`,
  );

  const stored = await psql(
    `select count(*) from agent_credentials where key_hash = '${key.plainToken}'`,
  );
  check(
    stored === "0",
    "🔴 API Key 원문이 Database 에 없다",
    "원문이 저장됐다",
  );

  // ── 1. MCP Server 를 실제 프로세스로 띄우고 붙는다 ────────────────────────
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(process.cwd(), "mcp", "server.mjs")],
    env: {
      ...process.env,
      REVIEWTRACE_API_URL: API_URL,
      REVIEWTRACE_API_KEY: key.plainToken,
    },
    stderr: "pipe",
  });

  const client = new Client({ name: "mcp-e2e", version: "1.0.0" });
  await client.connect(transport);
  ok("MCP Server 에 stdio 로 붙었다");

  // ── 2. Tool Discovery ────────────────────────────────────────────────────
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  console.log(`   tools: ${names.join(", ")}`);
  check(
    names.length === 8 &&
      names.includes("create_review") &&
      names.includes("resolve_issue"),
    `Tool 8개가 보인다`,
    `Tool 목록이 예상과 다르다 (${names.length}개)`,
  );

  const noSecret = JSON.stringify(tools).includes(key.plainToken);
  check(
    !noSecret,
    "🔴 Tool 설명 어디에도 API Key 가 없다",
    "Tool 설명에 Key 가 새어 나갔다",
  );

  // ── 3. create_review — 저장소·commit 을 스스로 읽는가 ─────────────────────
  const review = body(
    await client.callTool({
      name: "create_review",
      arguments: { summary: "MCP E2E", reviewer: "mcp-e2e-agent" },
    }),
    "create_review",
  );
  check(
    typeof review.reviewId === "string" && review.repository.includes("/"),
    `git remote 에서 저장소를 스스로 읽었다 (${review.repository} @ ${String(review.commitSha).slice(0, 7)})`,
    "저장소 자동 인식이 안 됐다",
  );

  const sessionRow = await psql(
    `select count(*) from review_sessions where id='${review.reviewId}' and workspace_id='${WORKSPACE_ID}'`,
  );
  check(
    sessionRow === "1",
    "ReviewSession 이 이 Workspace 에 저장됐다",
    "Session 이 없다",
  );

  // ── 4. add_issue — reviewId 없이도 붙는가 (Agent 가 ID 를 안 들고 다닌다) ──
  const added = body(
    await client.callTool({
      name: "add_issue",
      arguments: {
        severity: "HIGH",
        category: "TRANSACTION",
        title: "Transaction 안에서 외부 API 를 부른다",
        problem: "주문 저장 Transaction 안에서 결제 API 를 호출한다.",
        rootCause: "Transaction 경계를 Service 전체로 잡았다.",
        failurePath: "결제 API 가 느려지면 Connection Pool 이 마른다.",
        patternKey: "EXTERNAL_IO_IN_TRANSACTION",
        filePath: "src/OrderService.java",
        startLine: 40,
        endLine: 52,
        externalId: "MCP-1",
        tags: ["transaction", "external-io"],
        solution: "Transaction 을 축소했다",
        decisionReason: "보상 재시도로 충분했다",
        alternatives: "Saga — 지금 규모에 과하다",
        tradeOff: "주문이 잠깐 PENDING 으로 남는다",
        residualRisk: "보상 실패가 겹치면 수동 정리",
        evidence: [
          {
            kind: "BEFORE",
            commitSha: review.commitSha,
            filePath: "src/OrderService.java",
            startLine: 40,
            endLine: 52,
            snapshot: "@Transactional\npublic void place() { pay(); }",
          },
        ],
      },
    }),
    "add_issue",
  );
  check(
    typeof added.issueId === "string",
    "reviewId 를 안 넘겨도 방금 연 Review 에 붙었다",
    "add_issue 가 Review 를 못 찾았다",
  );

  const sameSession = await psql(
    `select count(*) from review_issues where id='${added.issueId}' and review_session_id='${review.reviewId}'`,
  );
  check(
    sameSession === "1",
    "🔴 add_issue 가 새 Session 을 만들지 않고 같은 Review 에 붙었다",
    "한 번의 Review 가 여러 Session 으로 흩어졌다",
  );

  const decided = await psql(
    `select count(*) from issue_activities where review_issue_id='${added.issueId}' and type='DETECTED' and solution is not null and trade_off is not null`,
  );
  check(
    decided === "1",
    "판단이 DETECTED Activity 에 남았다",
    "Decision Record 가 없다",
  );

  const before = await psql(
    `select count(*) from issue_code_evidences where review_issue_id='${added.issueId}' and kind='BEFORE'`,
  );
  check(before === "1", "BEFORE 근거가 남았다", "BEFORE 근거가 없다");

  // ── 5. Fix -> 재검토 -> 해결 (스펙 16·23) ────────────────────────────────
  body(
    await client.callTool({
      name: "add_fix_attempt",
      arguments: {
        summary: "결제 호출을 Transaction 밖으로 뺐다",
        commitSha: "aaa1111",
        actor: "mcp-e2e-fixer",
        solution: "경계를 좁혔다",
        decisionReason: "가장 작은 변경이었다",
        evidence: [
          {
            kind: "AFTER",
            commitSha: "aaa1111",
            filePath: "src/OrderService.java",
            startLine: 40,
            endLine: 48,
            snapshot: "public void place() { save(); }\npay();",
          },
        ],
      },
    }),
    "add_fix_attempt",
  );
  ok("add_fix_attempt — issueId 없이 방금 다룬 Issue 에 붙었다");

  body(
    await client.callTool({
      name: "review_again",
      arguments: {
        summary: "부하 시험에서 Pool 고갈이 사라졌다",
        actor: "mcp-e2e-agent",
      },
    }),
    "review_again",
  );
  ok("review_again 기록");

  const resolved = body(
    await client.callTool({
      name: "resolve_issue",
      arguments: {
        resolution: "Transaction 밖으로 결제 호출을 옮겼다",
        commitSha: "aaa1111",
        actor: "mcp-e2e-agent",
        verification: "부하 시험 통과",
        regressionTest: "OrderServiceTest#외부호출은_Transaction_밖에서",
      },
    }),
    "resolve_issue",
  );
  check(
    resolved.status === "RESOLVED",
    "resolve_issue 로 닫혔다",
    "상태가 안 바뀌었다",
  );

  const consistent = await psql(
    `select count(*) from review_issues where id='${added.issueId}' and status='RESOLVED' and resolved_at is not null and resolution_summary is not null`,
  );
  check(
    consistent === "1",
    "🔴 상태·시각·요약이 서로 모순되지 않는다",
    "상태와 시각/요약이 어긋났다",
  );

  // 🔴 `solution` 만 세지 않는다 — RESOLVED 는 verification·regressionTest 만 보냈다.
  //    판단은 칸 일곱 개 중 «무엇이든» 적힌 것이다.
  const kept = await psql(
    `select count(*) from issue_activities where review_issue_id='${added.issueId}' ` +
      `and (solution is not null or decision_reason is not null or alternatives_considered is not null ` +
      `or trade_off is not null or verification is not null or regression_test is not null ` +
      `or residual_risk is not null)`,
  );
  check(
    kept === "3",
    `🔴 판단 3개가 나란히 남았다 — 뒤의 시도가 앞의 것을 덮어쓰지 않는다`,
    `판단이 ${kept}개다`,
  );

  // ── 6. 읽기 Tool ─────────────────────────────────────────────────────────
  const detail = body(
    await client.callTool({
      name: "get_issue",
      arguments: { issueId: added.issueId },
    }),
    "get_issue",
  );
  check(
    detail.activities.length === 4 && detail.rootCause !== null,
    `get_issue 가 History 4줄과 rootCause 를 함께 준다`,
    `History 가 이어지지 않는다 (${detail.activities?.length})`,
  );

  const searched = body(
    await client.callTool({
      name: "search_issues",
      arguments: { status: "RESOLVED" },
    }),
    "search_issues",
  );
  check(
    searched.issues.some((i) => i.id === added.issueId),
    "search_issues 가 현재 저장소로 스스로 좁혀 찾았다",
    "search_issues 가 못 찾았다",
  );

  const knowledge = body(
    await client.callTool({ name: "get_repository_knowledge", arguments: {} }),
    "get_repository_knowledge",
  );
  check(
    knowledge.pastResolutions?.length >= 1,
    "🔴 과거 해결 기록이 Agent 에게 되돌아온다 — Knowledge 가 양방향이다",
    "과거 해결이 안 나온다",
  );

  // ── 6-b. 🔴 재검토에서 문제가 남아 있으면 닫힌 Issue 가 다시 열리는가 ────
  //    History 에만 적고 상태를 두면, 미해결 조회에서 그 회귀가 사라진다.
  body(
    await client.callTool({
      name: "review_again",
      arguments: {
        issueId: added.issueId,
        summary: "부하가 올라가자 다시 재현됐다",
        stillPresent: true,
        actor: "mcp-e2e-agent",
      },
    }),
    "review_again(stillPresent)",
  );

  const reopened = await psql(
    `select status || '|' || coalesce(resolved_at::text,'null') || '|' || coalesce(resolution_summary,'null')
     from review_issues where id='${added.issueId}'`,
  );
  check(
    reopened.startsWith("REOPENED|null|null"),
    "🔴 재검토에서 문제가 남아 있으면 Issue 가 다시 열리고 해결 흔적이 지워진다",
    `상태가 ${reopened} 다`,
  );

  // ── 7. 🔴 새 Review 를 열면 이전 Issue 를 잊는가 ─────────────────────────
  //    안 잊으면 issueId 를 생략한 resolve_issue 가 «이전 Review 의» Issue 를 닫는다.
  const secondReview = body(
    await client.callTool({
      name: "create_review",
      arguments: { summary: "두 번째 Review", reviewer: "mcp-e2e-agent" },
    }),
    "create_review(2)",
  );
  check(
    secondReview.reviewId !== review.reviewId,
    "새 Review 가 열렸다",
    "같은 Review 가 돌아왔다",
  );

  const strayFix = await client.callTool({
    name: "add_fix_attempt",
    arguments: {
      summary: "이 호출은 대상이 없어야 한다",
      actor: "mcp-e2e-agent",
    },
  });
  const strayText = strayFix.content?.[0]?.text ?? "";
  check(
    strayFix.isError === true && strayText.includes("대상 Issue 가 없다"),
    "🔴 새 Review 를 연 뒤에는 이전 Issue 가 기본값으로 남지 않는다",
    `이전 Review 의 Issue 가 그대로 남아 있다: ${strayText.slice(0, 60)}`,
  );

  const untouched = await psql(
    `select count(*) from issue_activities where review_issue_id='${added.issueId}' and description='이 호출은 대상이 없어야 한다'`,
  );
  check(
    untouched === "0",
    "🔴 엉뚱한 Issue 에 기록이 남지 않았다",
    "이전 Review 의 Issue 에 기록이 남았다",
  );

  // ── 8. 오류 UX (스펙 18) ─────────────────────────────────────────────────
  const missing = await client.callTool({
    name: "get_issue",
    arguments: { issueId: randomUUID() },
  });
  const text = missing.content?.[0]?.text ?? "";
  check(
    missing.isError === true && !/ at |Error:|select |node_modules/.test(text),
    `없는 Issue 는 Stack 없이 사람이 읽는 말로 온다: "${text.slice(0, 40)}…"`,
    "오류 결과에 내부 정보가 섞였다",
  );

  await client.close();
  console.log(`\n===== 결과: PASS=${pass} FAIL=${fail} =====`);
  return fail === 0 ? 0 : 1;
}

/** 잘못된 Key 로는 아예 뜨지 않는가(스펙 8). */
async function badKeyCheck() {
  const home = path.join(os.tmpdir(), `rt-mcp-${randomUUID()}`);
  fs.mkdirSync(home, { recursive: true });
  try {
    const { stderr } = await run(
      process.execPath,
      [path.join(process.cwd(), "mcp", "server.mjs")],
      {
        env: {
          ...process.env,
          REVIEWTRACE_API_KEY: "",
          HOME: home,
          USERPROFILE: home,
        },
        timeout: 10_000,
        windowsHide: true,
        encoding: "utf8",
      },
    ).catch((e) => e);
    check(
      /API Key 가 없다/.test(String(stderr)),
      "Key 없이 띄우면 사람이 읽는 안내와 함께 즉시 멈춘다",
      "Key 없이도 조용히 떠 있다",
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

let code = 1;
try {
  await badKeyCheck();
  code = await main();
} catch (error) {
  console.error("\nE2E 도중 실패:", error.message);
} finally {
  await cleanup();
}
process.exit(code);
