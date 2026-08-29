#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { generateApiKey } from "../src/lib/api/api-key-token.ts";

/**
 * Code Evidence 의 GitHub 대조 E2E(스펙 15).
 *
 * 🔴 **다른 E2E 는 가짜 commit 을 쓴다** — 그것은 「확인 못 하면 UNAVAILABLE 로 남는가」만
 * 증명하고, **`VERIFIED` 에 실제로 도달하는지는 증명하지 않는다.** 이 스크립트가 그 자리다.
 *
 * 🔴 **네트워크가 필요하다.** GitHub 에 실제로 붙어 공개 저장소의 파일을 읽는다.
 * 그래서 기본 검증 흐름(`pnpm test`)에 넣지 않았다 — 오프라인에서 실패하는 시험은
 * 「기존 실패」로 취급되기 시작하고, 그 순간 시험이 아니게 된다.
 *
 * 쓰는 법
 *   1) docker compose up -d
 *   2) pnpm dev -p 3910          (다른 터미널)
 *   3) EVIDENCE_E2E_PORT=3910 node scripts/evidence-github-e2e.mjs
 */

const run = promisify(execFile);

const PORT = process.env.EVIDENCE_E2E_PORT ?? "3910";
const CONTAINER = process.env.E2E_PG_CONTAINER ?? "code-intelligence-postgres";
const PGUSER = process.env.E2E_PG_USER ?? "code_intelligence";
const PGDB = process.env.E2E_PG_DB ?? "code_intelligence";

/** 공개 저장소여야 한다 — private 은 정책상 읽지 않는다(`isPublicRepository`). */
const OWNER = process.env.EVIDENCE_E2E_OWNER ?? "maker3391";
const NAME = process.env.EVIDENCE_E2E_NAME ?? "ReviewTrace";
const FILE = process.env.EVIDENCE_E2E_FILE ?? "package.json";

const WORKSPACE_ID = "dddddddd-0000-4000-8000-000000000004";
const SLUG = "evidence-e2e";

let pass = 0;
let fail = 0;
const check = (cond, good, bad) => {
  if (cond) {
    pass += 1;
    console.log(`OK   ${good}`);
  } else {
    fail += 1;
    console.log(`FAIL ${bad}`);
  }
};

async function psql(sql) {
  const { stdout } = await run(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", PGUSER, "-d", PGDB, "-t", "-A", "-c", sql],
    { encoding: "utf8", windowsHide: true },
  );
  return stdout.trim();
}

const cleanup = () =>
  psql(`delete from workspaces where slug='${SLUG}'`).catch(() => {});

async function main() {
  await cleanup();

  const commitSha = (
    await run("git", ["rev-parse", "origin/develop"], { encoding: "utf8" })
  ).stdout.trim();

  // 🔴 GitHub 에 실제로 있는 줄을 먼저 읽어 온다. 그것이 「정답」이다.
  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${NAME}/contents/${FILE}?ref=${commitSha}`,
    { headers: { Accept: "application/vnd.github.raw+json", "User-Agent": "ReviewTrace" } },
  );
  if (!response.ok) {
    console.log(
      `건너뜀: GitHub 에서 ${OWNER}/${NAME}@${commitSha.slice(0, 7)} 의 ${FILE} 을 읽지 못했다 ` +
        `(HTTP ${response.status}). commit 이 push 되어 있고 저장소가 공개인지 확인해라.`,
    );
    return 0;
  }
  const source = await response.text();
  const truth = source.split("\n").slice(1, 4).join("\n");

  /**
   * 🔴 **파일에 실제로 있는 빈 줄**을 찾는다.
   *
   * 잘라 낸 글자가 비었는지로 경계를 재면 그 줄이 「범위 밖」으로 찍힌다 — 멀쩡한 근거가
   * `UNAVAILABLE` 이 된다. 그래서 여기서 진짜 빈 줄 하나를 골라 확인한다.
   */
  /**
   * 🔴 **마지막 조각을 빈 줄로 착각하지 않는다.** 개행으로 끝나는 파일을 `split` 하면
   * 끝에 빈 조각이 하나 더 생기는데 그것은 줄이 아니다. 그것을 골라 시험하면
   * 「범위 밖을 VERIFIED 로 적는」 버그를 정상으로 못 박게 된다 — 실제로 그랬다.
   *
   * `package.json` 에는 빈 줄이 없으므로 빈 줄이 있는 파일을 따로 읽는다.
   */
  const blankSource = await fetch(
    `https://api.github.com/repos/${OWNER}/${NAME}/contents/README.md?ref=${commitSha}`,
    {
      headers: {
        Accept: "application/vnd.github.raw+json",
        "User-Agent": "ReviewTrace",
      },
    },
  ).then((r) => (r.ok ? r.text() : ""));
  const blankLine =
    blankSource
      .split("\n")
      .slice(0, -1)
      .findIndex((line) => line.trim() === "") + 1;

  const key = generateApiKey();
  await psql(
    `insert into workspaces (id, slug, name) values ('${WORKSPACE_ID}','${SLUG}','Evidence E2E');` +
      `insert into api_keys (workspace_id, name, key_prefix, key_hash) ` +
      `values ('${WORKSPACE_ID}','evidence','${key.keyPrefix}','${key.keyHash}');`,
  );

  const issue = (title, externalId, evidence) => ({
    severity: "LOW",
    category: "CLEAN_CODE",
    title,
    source: "evidence-e2e",
    externalId,
    evidence: [{ kind: "BEFORE", commitSha, filePath: FILE, ...evidence }],
  });

  const ingest = await fetch(`http://localhost:${PORT}/api/v1/reviews`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key.plainToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      repository: {
        provider: "GITHUB",
        owner: OWNER,
        name: NAME,
        fullName: `${OWNER}/${NAME}`,
        defaultBranch: "develop",
      },
      target: { type: "COMMIT", commitSha },
      reviewer: { type: "AGENT", name: "evidence-e2e" },
      issues: [
        issue("실제 줄 그대로", "E-1", { startLine: 2, endLine: 4, snapshot: truth }),
        issue("다른 내용", "E-2", {
          startLine: 2,
          endLine: 4,
          snapshot: "이 줄에는 이런 코드가 없다",
        }),
        issue("코드 없이", "E-3", { startLine: 2, endLine: 4 }),
        issue("파일 밖 줄", "E-4", { startLine: 99_999, endLine: 99_999 }),
        issue("없는 파일", "E-5", { startLine: 1, endLine: 2 }),
        issue("실제로 있는 빈 줄", "E-6", {
          filePath: "README.md",
          startLine: blankLine,
          endLine: blankLine,
        }),
        issue("비정규 경로", "E-7", { startLine: 2, endLine: 4 }),
        // 🔴 시작은 파일 안, 끝만 파일 밖. 시작 줄만 재면 VERIFIED 가 된다.
        issue("끝 줄만 파일 밖", "E-8", {
          startLine: 2,
          endLine: 99_999,
          snapshot: truth,
        }),
      ].map((entry) => {
        if (entry.externalId === "E-5") {
          return {
            ...entry,
            evidence: [{ ...entry.evidence[0], filePath: "이런파일은없다.txt" }],
          };
        }
        if (entry.externalId === "E-7") {
          // 걷어내면 `docs/agent-api.md` 가 되지만, 저장된 경로는 이대로다.
          return {
            ...entry,
            evidence: [
              { ...entry.evidence[0], filePath: "docs/../docs/agent-api.md" },
            ],
          };
        }
        return entry;
      }),
    }),
  });

  check(
    blankLine > 0,
    `README.md 의 ${blankLine}번째 줄이 실제 빈 줄이다`,
    "빈 줄을 못 찾았다 — 이 시험은 아무것도 지키지 못한다",
  );

  check(ingest.status === 201, "Evidence 8건을 저장했다", `ingest 가 ${ingest.status}`);
  if (ingest.status !== 201) {
    return 1;
  }

  // 🔴 확인은 응답 뒤(`after()`)에 돈다 — 남은 것이 없어질 때까지 기다린다.
  for (let i = 0; i < 25; i += 1) {
    const pending = await psql(
      `select count(*) from issue_code_evidences where workspace_id='${WORKSPACE_ID}' and verification='UNVERIFIED'`,
    );
    if (pending === "0") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const expected = {
    "E-1": "VERIFIED",
    "E-2": "MISMATCH",
    "E-3": "VERIFIED",
    "E-4": "UNAVAILABLE",
    "E-5": "UNAVAILABLE",
    // 🔴 실제로 있는 빈 줄은 범위 밖이 아니다.
    "E-6": "VERIFIED",
    // 🔴 `..` 을 걷어내고 다른 파일을 읽어 VERIFIED 로 적지 않는다.
    "E-7": "UNAVAILABLE",
    // 🔴 범위 일부가 파일 밖이면 그 주장을 확인한 것이 아니다.
    "E-8": "UNAVAILABLE",
  };

  const rows = await psql(
    `select i.external_id || '|' || e.verification || '|' || coalesce(length(e.snapshot)::text,'null')
     from issue_code_evidences e join review_issues i on i.id = e.review_issue_id
     where e.workspace_id='${WORKSPACE_ID}' order by i.external_id`,
  );

  const actual = new Map(
    rows
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [id, verification, length] = line.split("|");
        return [id, { verification, length }];
      }),
  );

  for (const [id, want] of Object.entries(expected)) {
    const got = actual.get(id);
    check(
      got?.verification === want,
      `${id} → ${want}`,
      `${id} 가 ${got?.verification ?? "없음"} 다 (기대 ${want})`,
    );
  }

  check(
    actual.get("E-3")?.length !== "null" && actual.get("E-3")?.length !== undefined,
    "🔴 코드를 안 보낸 근거는 GitHub 것으로 채워졌다 — 저장소가 사라져도 화면이 보여 줄 것이 남는다",
    "GitHub 에서 읽은 코드가 저장되지 않았다",
  );

  check(
    actual.get("E-6")?.verification === "VERIFIED",
    "🔴 파일에 실제로 있는 빈 줄이 범위 밖으로 오해되지 않는다",
    "빈 줄이 UNAVAILABLE 로 찍혔다",
  );

  check(
    actual.get("E-8")?.verification === "UNAVAILABLE",
    "🔴 끝 줄이 파일 밖이면 «없는 줄까지 확인했다»고 적지 않는다",
    "범위 일부가 파일 밖인데 확인된 것으로 남았다",
  );

  check(
    actual.get("E-7")?.verification === "UNAVAILABLE",
    "🔴 `..` 이 든 경로는 조용히 다른 파일로 바뀌지 않고 확인 실패로 남는다",
    "비정규 경로가 다른 파일과 맞대어져 확인됐다",
  );

  check(
    actual.get("E-4")?.length === "null",
    "🔴 파일 밖을 가리킨 근거는 VERIFIED 도 아니고 빈 코드도 저장되지 않았다",
    "존재하지 않는 위치가 확인된 것처럼 남았다",
  );

  console.log(`\n===== 결과: PASS=${pass} FAIL=${fail} =====`);
  return fail === 0 ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error("\nE2E 도중 실패:", error.message);
} finally {
  await cleanup();
}
process.exit(code);
