import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";
import { serverEnv } from "@/lib/env";

export type Database = NodePgDatabase<typeof schema>;

/**
 * Query 를 실행할 수 있는 것 — Database 자신이거나, 열려 있는 Transaction 이다.
 *
 * Transaction 안에서 도는 함수를 Transaction 밖에서도 그대로 쓰기 위한 타입이다.
 * 통합 테스트는 이 자리에 되돌릴 Transaction 을 넣어 실제 Database 를 더럽히지 않는다.
 */
export type DbExecutor =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * dev 는 파일이 바뀔 때마다 모듈을 다시 평가한다. 그때마다 Pool 을 새로 만들면
 * 연결이 쌓여 Postgres 의 `max_connections` 를 금방 먹는다.
 */
const globalForDb = globalThis as unknown as {
  __codeIntelligencePool?: Pool;
  __codeIntelligenceDb?: Database;
};

/**
 * Drizzle Client.
 *
 * 🔴 모듈 최상단에서 Pool 을 만들지 않는다. `next build` 는 DATABASE_URL 없이도 돌아야 하고,
 * 이 모듈을 import 만 하는 파일이 접속을 열 이유가 없다. 실제로 쓰는 자리에서 부른다.
 */
export function db(): Database {
  if (globalForDb.__codeIntelligenceDb !== undefined) {
    return globalForDb.__codeIntelligenceDb;
  }

  const pool =
    globalForDb.__codeIntelligencePool ??
    new Pool({ connectionString: serverEnv().DATABASE_URL });

  const database = drizzle(pool, { schema });

  globalForDb.__codeIntelligencePool = pool;
  globalForDb.__codeIntelligenceDb = database;

  return database;
}
