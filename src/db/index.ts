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
 * ## 🔴 지켜야 하는 세 가지 — 표 사이의 순서
 *
 * 1. **`users` 를 잠근 채 `workspaces` 를 잠그러 가지 않는다.** 그 한 번이 고리를 만든다
 * 2. **FK 가 «몰래» 거는 잠금을 세어라.** `workspace_invitations.accepted_by = $user` 같은
 *    쓰기는 `users` 행에 `FOR KEY SHARE` 를 건다 — 문장에 `for update` 가 없어도 잠금이다.
 *    그런 쓰기보다 **먼저** `users` 를 명시적으로 잠가 순서를 눈에 보이게 만든다
 *    (`invitation-service.ts` 의 `lockAccountRow`)
 *
 * ## 🔴 세 번째 — 같은 표 «안»의 행 순서도 순서다. 한 표만 잠가도 교착이 난다
 *
 * 🔴 **예전에 이 자리에는 「`changeMemberRole` 처럼 한 표만 잠그는 경로는 이 순서와
 * 무관하다 — 고리를 만들 상대가 없기 때문이다」고 적혀 있었다. 그 문장은 틀렸다.**
 * 독립 reviewer 가 실제 병렬 연결로 반례를 재현했다 — `changeMemberRole` 과
 * `removeMember` 는 **둘 다 `workspace_members` 한 표만** 잠그는데도
 * `40P01 deadlock detected` 가 났다:
 *
 * ```
 * removeMember     : 대상 T 를 잡고 -> 행위자 O 를 기다린다
 * changeMemberRole : OWNER O 를 잡고 -> 대상 T 를 기다린다      고리가 닫힌다
 * ```
 *
 * 표를 **몇 개** 잠그는지가 아니라 **어떤 순서로 행을 집는지**가 관건이다.
 * 그래서 규칙은 이렇다 — **한 표 안에서 여러 행을 잡는 경로는 전부 같은 키로 오름차순
 * 정렬해 잠근다.** `workspace_members` 는 PK 인 `(workspace_id, user_id)` 다.
 *
 * 🔴 **`ORDER BY` 를 «빼는 것»은 답이 아니다.** 순서를 적지 않으면 Planner 가 고른 scan
 * 순서가 곧 잠금 순서가 된다 — `workspace_members` 의 PK 가
 * `btree(workspace_id, user_id)` 라 행이 늘면 Planner 가 index scan 으로 갈아타고
 * **그때 scan 순서가 곧 `user_id` 순이 된다.** 지금 우연히 안전한 조합이 데이터가 커지면
 * 뒤집힌다. 우연이 아니라 **문장에 적힌 순서**로 안전해야 한다.
 *
 * 🔴 **두 걸음으로 나누어 잠그지 마라.** 「A 를 `FOR UPDATE` 한 뒤 B 를 UPDATE」는 두
 * 문장 사이에 순서가 없다 — 필요한 행을 **한 문장의 `ORDER BY`** 안에 모두 넣는다
 * (`changeMemberRole` 이 그렇게 고쳐졌다).
 *
 * 지금 `workspace_members` 의 여러 행을 잠그는 경로는 넷이고 **전부 이 순서를 쓴다**:
 * `removeMember` · `changeMemberRole` · `deleteWorkspace` · `deleteAccount`.
 * 다른 표에서 여러 행을 잡을 때도 같다 — `lockMyWorkspaces` 는 `order by id` 를 쓴다.
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
  Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

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
