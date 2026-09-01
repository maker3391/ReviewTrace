/**
 * Migration 이 실패했을 때 «왜» 실패했는지 한 줄로 드러낸다.
 *
 * 🔴 **drizzle-kit 은 PostgreSQL 오류를 삼킨다.** 스피너("applying migrations...")와
 * exit code 1 만 남아, 비밀번호가 틀린 것인지 SQL 이 깨진 것인지 로그로 구분할 수 없다 —
 * 두 경우의 출력이 글자 단위로 같다.
 *
 * 🔴 **Database 를 바꾸지 않는다.** `select 1` 하나뿐이고 DDL 도 트랜잭션도 없다.
 * 🔴 **비밀번호와 URL 전문을 찍지 않는다.** host · port · user · database 와
 *    오류의 code · message 만 낸다 — 그 여섯이면 원인이 갈린다.
 *
 * 🔴 **`.mjs` 다.** 이 저장소의 ESLint 는 `require()` 를 금지한다
 *    (`@typescript-eslint/no-require-imports`) — `.cjs` 로 두었다가 CI 에서 걸렸다.
 *
 * 🔴 이 파일은 **워크플로 전용**이다. 애플리케이션이 부르지 않는다.
 */
import { Client } from "pg";

const raw = process.env.DATABASE_URL ?? "";

if (raw === "") {
  console.log(
    "DATABASE_URL 이 비어 있다 — Secret 이 등록되지 않았거나 이름이 다르다.",
  );
  process.exit(1);
}

/** 접속 대상만 뽑는다. 🔴 `password` 는 읽지도 않는다. */
function describeTarget(value) {
  try {
    const url = new URL(value);
    return {
      host: url.hostname,
      port: url.port === "" ? "5432" : url.port,
      user: decodeURIComponent(url.username),
      database: url.pathname.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}

const target = describeTarget(raw);

if (target === null) {
  // 🔴 값을 찍지 않는다. 「URL 이 아니다」라는 사실만 알린다.
  console.log("DATABASE_URL 을 URL 로 읽지 못했다 — 형식을 확인하라.");
  process.exit(1);
}

console.log(`host    : ${target.host}`);
console.log(`port    : ${target.port}`);
console.log(`user    : ${target.user}`);
console.log(`database: ${target.database}`);

const client = new Client({ connectionString: raw });

try {
  await client.connect();
  await client.query("select 1");
  await client.end();
  console.log("");
  console.log("연결은 된다 — 실패 원인은 연결이 아니라 SQL·권한 쪽이다.");
} catch (error) {
  console.log("");
  console.log("연결 실패");
  console.log(`  code   : ${error.code ?? "(없음)"}`);
  console.log(`  message: ${error.message}`);
  // 🔴 여기서 프로세스를 죽이지 않는다. 「job 을 실패로 만드는 일」은 마지막 step 의 몫이다.
}
