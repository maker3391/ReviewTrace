import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";
import { serverEnv } from "@/lib/env";

export type Database = NodePgDatabase<typeof schema>;

/**
 * # 🔴 전역 잠금 순서 — `workspaces` -> `users` -> 나머지
 *
 * 여러 표의 행을 한 Transaction 에서 잠그는 경로는 **반드시 이 순서**로 잡는다.
 *
 * ```
 * workspaces  ->  users  ->  workspace_members · workspace_invitations · …
 * ```
 *
 * ## 왜 이것이 필요한가 — 실제로 겪은 deadlock
 *
 * 계정 삭제는 존재 확인을 위해 `users` 를 먼저 잠갔고(`users -> workspaces`), 초대 수락은
 * Workspace 를 먼저 잠근 뒤 `accepted_by` 를 UPDATE 했다(`workspaces -> users` — FK 검사가
 * `users` 행에 lock 을 요구한다). 같은 사용자로 두 경로를 동시에 돌리면 **`40P01 deadlock
 * detected`** 가 났다. 잠그는 «대상»이 아니라 잠그는 «순서»가 문제였다.
 *
 * ## 🔴 지켜야 하는 두 가지
 *
 * 1. **`users` 를 잠근 채 `workspaces` 를 잠그러 가지 않는다.** 그 한 번이 고리를 만든다
 * 2. **FK 가 «몰래» 거는 잠금을 세어라.** `workspace_invitations.accepted_by = $user` 같은
 *    쓰기는 `users` 행에 `FOR KEY SHARE` 를 건다 — 문장에 `for update` 가 없어도 잠금이다.
 *    그런 쓰기보다 **먼저** `users` 를 명시적으로 잠가 순서를 눈에 보이게 만든다
 *    (`invitation-service.ts` 의 `lockAccountRow`)
 *
 * 같은 표 «안에서» 여러 행을 잡을 때는 `order by id` 로 방향을 고정한다.
 * `changeMemberRole` 처럼 **한 표만** 잠그는 경로는 이 순서와 무관하다 — 고리를 만들 상대가
 * 없기 때문이다.
 *
 * 🔴 **새 경로를 만들 때 이 순서를 확인해라.** 잠금은 문장에 적혀 있지 않은 것까지 걸리고,
 * 어긋난 순서는 시험이 아니라 운영에서 터진다.
 */

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
