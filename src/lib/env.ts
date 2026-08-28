import "server-only";

import { serverEnvSchema, type ServerEnv } from "@/lib/env.schema";

let cached: ServerEnv | null = null;

/**
 * 검증된 서버 환경 변수를 돌려준다.
 *
 * 🔴 모듈 최상단에서 즉시 파싱하지 않는다. 즉시 파싱하면 `DATABASE_URL` 없이
 * `next build` 를 돌릴 수 없고, 이 모듈을 스치기만 하는 파일까지 함께 죽는다.
 * 실제로 값이 필요한 자리에서 부른다.
 */
export function serverEnv(): ServerEnv {
  if (cached !== null) {
    return cached;
  }

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // 🔴 값 자체를 로그에 남기지 않는다. 어떤 키가 잘못됐는지만 남긴다.
    const invalidKeys = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
    ].join(", ");
    throw new Error(`환경 변수가 올바르지 않다: ${invalidKeys}`);
  }

  cached = parsed.data;
  return cached;
}
