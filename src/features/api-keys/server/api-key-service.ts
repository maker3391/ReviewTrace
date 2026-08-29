import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { db, type DbExecutor } from "@/db";
import { apiKeys } from "@/db/schema";
import { generateApiKey } from "@/lib/api/api-key-token";
import { AppError } from "@/lib/errors";

/**
 * API Key 발급·목록·폐기.
 *
 * ```
 * Plain Token 생성 -> Prefix 추출 -> Hash -> Hash 만 DB 저장 -> Plain Token 1회 표시
 * ```
 *
 * 🔴 **원문은 이 함수의 반환값에만 존재한다.** 부른 쪽이 화면에 한 번 보여 주고 버린다 —
 * 저장하지도, 다시 조회하지도 못한다(스펙 20).
 * 🔴 **목록은 `plainToken` 도 `keyHash` 도 돌려주지 않는다.**
 */

/** 목록·화면에 나가도 되는 표현. 🔴 `keyHash` 가 여기 없는 것이 요점이다. */
export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** 발급 결과. `plainToken` 은 **이 한 번**만 존재한다. */
export interface IssuedApiKey extends ApiKeySummary {
  plainToken: string;
}

const NAME_MAX_LENGTH = 100;

export async function issueApiKey(
  input: { workspaceId: string; name: string; expiresAt?: Date | null },
  executor: DbExecutor = db(),
): Promise<IssuedApiKey> {
  const name = input.name.trim();
  if (name === "" || name.length > NAME_MAX_LENGTH) {
    throw new AppError("API_KEY_NAME_INVALID");
  }

  const generated = generateApiKey();

  const rows = await executor
    .insert(apiKeys)
    .values({
      workspaceId: input.workspaceId,
      name,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    });

  const created = rows[0];
  if (created === undefined) {
    throw new AppError("UNEXPECTED");
  }

  return { ...created, plainToken: generated.plainToken };
}

/** 🔴 Workspace 로 좁힌다. 「전체 키 목록」을 돌려주는 경로를 만들지 않는다. */
export async function listApiKeys(
  workspaceId: string,
  executor: DbExecutor = db(),
): Promise<ApiKeySummary[]> {
  return executor
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.workspaceId, workspaceId))
    .orderBy(desc(apiKeys.createdAt));
}

/**
 * 폐기.
 *
 * 행을 지우지 않는다 — 지우면 「이 키가 언제까지 무엇을 했는가」가 함께 사라지고,
 * 같은 Hash 가 다시 발급될 여지가 생긴다. 이미 폐기된 키는 다시 폐기하지 않는다.
 *
 * 🔴 `workspaceId` 를 조건에 함께 건다. Key ID 를 안다는 것이 권한이 되지 않게 한다(스펙 15).
 */
export async function revokeApiKey(
  input: { workspaceId: string; apiKeyId: string },
  executor: DbExecutor = db(),
): Promise<void> {
  const revoked = await executor
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, input.apiKeyId),
        eq(apiKeys.workspaceId, input.workspaceId),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id });

  if (revoked.length === 0) {
    throw new AppError("RESOURCE_NOT_FOUND");
  }
}
