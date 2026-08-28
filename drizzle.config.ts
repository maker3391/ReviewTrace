import { defineConfig } from "drizzle-kit";

// drizzle-kit 은 Next.js 밖에서 도는 별도 프로세스라 .env 를 스스로 읽지 않는다.
// Node 20+ 의 내장 로더를 쓴다 — 이것 하나 때문에 dotenv 를 더 넣지 않는다.
try {
  process.loadEnvFile(".env");
} catch {
  // .env 가 없으면 그대로 진행한다. 접속이 필요한 명령에서만 아래가 막는다.
}

const databaseUrl = process.env.DATABASE_URL ?? "";

// `generate` 는 Schema 파일만 읽어 SQL 을 만든다 — Database 없이 돈다.
// 접속이 필요한 명령에서만 실패시킨다. 그래야 DB 가 없는 PC 에서도 Migration 을 만들 수 있다.
const needsConnection = process.argv.some((arg) =>
  ["migrate", "push", "pull", "studio", "check", "up"].includes(arg),
);

if (needsConnection && databaseUrl === "") {
  throw new Error(
    "DATABASE_URL 이 없다. .env.example 을 복사해 .env 를 만들고 값을 채워라.",
  );
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
  // 생성된 SQL 을 사람이 읽고 리뷰한다. 스키마를 밀어 넣는 push 는 쓰지 않는다.
  strict: true,
  verbose: true,
});
