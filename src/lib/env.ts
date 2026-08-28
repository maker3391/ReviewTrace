import "server-only";

import type { z } from "zod";

import {
  authEnvSchema,
  serverEnvSchema,
  type AuthEnv,
  type ServerEnv,
} from "@/lib/env.schema";

/**
 * 검증된 서버 환경 변수를 돌려준다.
 *
 * 🔴 모듈 최상단에서 즉시 파싱하지 않는다. 즉시 파싱하면 `DATABASE_URL` 없이
 * `next build` 를 돌릴 수 없고, 이 모듈을 스치기만 하는 파일까지 함께 죽는다.
 * 실제로 값이 필요한 자리에서 부른다.
 */

/**
 * 🔴 실패 message 에 **값을 넣지 않는다.** 어떤 키가 잘못됐는지만 남긴다 —
 * 접속 문자열과 Secret 이 로그·오류 화면으로 새어 나간다(CLAUDE.md 19).
 */
function parseOrThrow<T extends z.ZodType>(schema: T): z.infer<T> {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const invalidKeys = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
    ].join(", ");
    throw new Error(`환경 변수가 올바르지 않다: ${invalidKeys}`);
  }

  return parsed.data;
}

let cachedServerEnv: ServerEnv | null = null;
let cachedAuthEnv: AuthEnv | null = null;

export function serverEnv(): ServerEnv {
  cachedServerEnv ??= parseOrThrow(serverEnvSchema);
  return cachedServerEnv;
}

/** 인증 경로에서만 부른다. Database 만 쓰는 코드가 OAuth Secret 을 요구하지 않게 한다. */
export function authEnv(): AuthEnv {
  cachedAuthEnv ??= parseOrThrow(authEnvSchema);
  return cachedAuthEnv;
}
