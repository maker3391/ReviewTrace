/**
 * Migration 이 «어느 문장에서» 깨졌는지 찾는다.
 *
 * 🔴 **drizzle-kit 은 실패한 SQL 도 PostgreSQL 오류도 보여 주지 않는다.** 스피너와
 * exit code 1 뿐이라, 로그만으로는 어느 파일의 어느 문장인지 알 수 없다.
 *
 * # 🔴 이 스크립트는 Database 를 바꾸지 않는다
 *
 * 재생은 **BEGIN 으로 열고 끝에서 반드시 ROLLBACK** 한다. 성공하든 실패하든 커밋하지
 * 않으므로, 돌린 뒤 Database 는 돌리기 전과 같다. Migration 이력(`drizzle` 스키마)도
 * **읽기만** 한다.
 *
 * # 무엇을 흉내 내는가
 *
 * drizzle 의 판정을 그대로 따른다(`drizzle-orm/pg-core/dialect.js`):
 *
 * - 이력표는 `drizzle.__drizzle_migrations` 다
 * - **마지막 한 행만** 본다 — `order by created_at desc limit 1`
 * - journal 의 `when` 이 그 `created_at` 보다 «큰» migration 만 적용 대상이다
 * - 파일은 `--> statement-breakpoint` 로 잘라 한 문장씩 보낸다
 *
 * 🔴 **비밀번호와 URL 전문을 찍지 않는다.**
 */
import fs from "node:fs";
import { Client } from "pg";

import { formatMigrationFailure } from "./migration-diagnostic-output.mjs";

const FOLDER = "src/db/migrations";
const raw = process.env.DATABASE_URL ?? "";

if (raw === "") {
  console.log(
    "DATABASE_URL 이 비어 있다 — Secret 이 등록되지 않았거나 이름이 다르다.",
  );
  process.exit(1);
}

const journal = JSON.parse(
  fs.readFileSync(`${FOLDER}/meta/_journal.json`, "utf8"),
);

/** 파일 하나를 drizzle 과 «같은 방식»으로 자른다. */
function statementsOf(tag) {
  const text = fs.readFileSync(`${FOLDER}/${tag}.sql`, "utf8");
  return text
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

const client = new Client({ connectionString: raw });
await client.connect();

try {
  // ── 1. 서버와 권한 ────────────────────────────────────────────────
  const info = await client.query(
    "select version() as version, current_user as who, current_database() as db, current_schema() as schema",
  );
  const row = info.rows[0];
  console.log("## 서버");
  console.log(`  version : ${row.version.split(",")[0]}`);
  console.log(`  user    : ${row.who}`);
  console.log(`  database: ${row.db}`);
  console.log(`  schema  : ${row.schema}`);

  // ── 2. public 스키마에 무엇이 있나 ────────────────────────────────
  const tables = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  console.log("");
  console.log(`## public 표 ${tables.rowCount}개`);
  console.log(
    tables.rowCount === 0
      ? "  (비어 있다)"
      : `  ${tables.rows.map((t) => t.table_name).join(", ")}`,
  );

  // ── 3. Migration 이력 ─────────────────────────────────────────────
  const historyExists = await client.query(
    "select to_regclass('drizzle.__drizzle_migrations') is not null as present",
  );
  console.log("");
  console.log("## Migration 이력");

  let lastAppliedAt = 0;
  if (!historyExists.rows[0].present) {
    console.log(
      "  drizzle.__drizzle_migrations 가 없다 — 아직 한 번도 적용되지 않았다.",
    );
  } else {
    const applied = await client.query(
      "select hash, created_at from drizzle.__drizzle_migrations order by created_at asc",
    );
    console.log(`  적용된 행 ${applied.rowCount}개`);
    for (const entry of applied.rows) {
      const known = journal.entries.find(
        (e) => String(e.when) === String(entry.created_at),
      );
      console.log(
        `    ${String(entry.created_at).padEnd(15)} ${String(entry.hash).slice(0, 12)}…  ${known ? known.tag : "(journal 에 없는 행)"}`,
      );
    }
    if (applied.rowCount > 0) {
      lastAppliedAt = Number(applied.rows[applied.rowCount - 1].created_at);
    }
  }

  // ── 4. 남은 것 ────────────────────────────────────────────────────
  const pending = journal.entries.filter(
    (entry) => Number(entry.when) > lastAppliedAt,
  );
  console.log("");
  console.log(`## 적용 대상 ${pending.length}개`);
  if (pending.length === 0) {
    console.log("  없다 — drizzle 기준으로는 최신이다.");
    process.exit(0);
  }
  console.log(`  ${pending.map((e) => e.tag).join(", ")}`);

  // ── 5. 되돌리는 재생 ──────────────────────────────────────────────
  console.log("");
  console.log("## 재생 (BEGIN → … → ROLLBACK · 아무것도 커밋하지 않는다)");
  await client.query("BEGIN");

  let failed = null;
  outer: for (const entry of pending) {
    const statements = statementsOf(entry.tag);
    for (const [index, statement] of statements.entries()) {
      try {
        await client.query(statement);
      } catch (error) {
        failed = {
          tag: entry.tag,
          index: index + 1,
          total: statements.length,
          statement,
          error,
        };
        break outer;
      }
    }
    console.log(`  OK   ${entry.tag}  (${statements.length} 문장)`);
  }

  await client.query("ROLLBACK");

  console.log("");
  if (failed === null) {
    console.log("🔴 재생은 «전부 통과»했다.");
    console.log(
      "   즉 SQL 자체는 이 Database 에서 돈다 — 실패는 drizzle 의 이력 기록이나",
    );
    console.log(
      "   문장 분리 등 다른 지점이다. 위의 이력·표 목록을 함께 보라.",
    );
  } else {
    for (const line of formatMigrationFailure(failed)) {
      console.log(line);
    }
  }
} finally {
  await client.end();
}
