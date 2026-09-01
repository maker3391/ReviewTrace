import "server-only";

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { apiKeys } from "@/db/schema";
import { hashApiKey, readBearerToken } from "@/lib/api/api-key-token";
import { AppError } from "@/lib/errors";

/**
 * Agent 요청의 Tenant 판정.
 *
 * ```
 * Agent Request  API Key -> Key Lookup -> Workspace -> Authorized Workspace
 * ```
 *
 * 🔴 **Browser 처럼 `workspaceSlug` 를 권한 근거로 쓰지 않는다**(스펙 19).
 * Payload 에도 Query 에도 Workspace 자리가 없다 — **Key 가 곧 Tenant 다**.
 *
 * 🔴 거절 사유(형식 오류·없는 키·폐기·만료)를 구분해 알려주지 않는다. 전부 같은
 * `UNAUTHORIZED` 다 — 구분해 주면 그것만으로 「이 키는 존재한다」가 새어 나간다.
 */
export interface AgentContext {
  /** 이 요청이 읽고 쓸 수 있는 유일한 Tenant. */
  workspaceId: string;
  apiKeyId: string;
  /**
   * Key 의 이름(`codex-ci` 등).
   *
   * Agent Route 는 Payload 가 주장한 작성자 대신 이 값을 Review·Activity 의 작성자로
   * 강제한다 — Key 하나가 곧 한 Agent 라 「누구의 요청인가」는 Key 가 이미 말한다.
   */
  apiKeyName: string;
}

/**
 * `lastUsedAt` 을 다시 찍기까지의 간격.
 *
 * 요청마다 UPDATE 하면 바쁜 Key 하나에 쓰기가 몰려 같은 행을 두고 잠금이 줄을 선다.
 * 이 값은 「마지막으로 쓰인 때」를 보여 주기 위한 것이지 사용량 계측이 아니다.
 */
const LAST_USED_REFRESH = sql`interval '1 minute'`;

/**
 * `Authorization: Bearer ci_xxx` 를 Workspace 로 바꾼다.
 *
 * @throws AppError `UNAUTHORIZED`
 */
export async function authenticateAgent(
  request: Request,
  executor: DbExecutor = db(),
): Promise<AgentContext> {
  const token = readBearerToken(request.headers.get("authorization"));

  // 형식부터 걸러 Database 를 보지 않고 거절한다.
  if (token === null) {
    throw new AppError("AGENT_UNAUTHORIZED");
  }

  const keyHash = hashApiKey(token);

  const rows = await executor
    .select({
      id: apiKeys.id,
      workspaceId: apiKeys.workspaceId,
      name: apiKeys.name,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  const key = rows[0];
  if (key === undefined) {
    throw new AppError("AGENT_UNAUTHORIZED");
  }

  const now = new Date();
  if (key.revokedAt !== null) {
    throw new AppError("AGENT_UNAUTHORIZED");
  }
  if (key.expiresAt !== null && key.expiresAt.getTime() <= now.getTime()) {
    throw new AppError("AGENT_UNAUTHORIZED");
  }

  await executor
    .update(apiKeys)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(apiKeys.id, key.id),
        or(
          isNull(apiKeys.lastUsedAt),
          lt(apiKeys.lastUsedAt, sql`now() - ${LAST_USED_REFRESH}`),
        ),
      ),
    );

  return {
    workspaceId: key.workspaceId,
    apiKeyId: key.id,
    apiKeyName: key.name,
  };
}
