import { z } from "zod";

/**
 * 서버 환경 변수 Schema.
 *
 * 환경 변수도 「외부 입력」이다(CLAUDE.md 9). 값이 없거나 형식이 틀리면
 * 화면이 반쯤 도는 상태가 아니라 **읽는 순간 실패**해야 한다.
 *
 * 이 파일은 순수 Schema 만 둔다 — `process.env` 를 읽지 않으므로 테스트에서 그대로 쓸 수 있다.
 * 실제 로딩은 `src/lib/env.ts`(server-only)가 한다.
 */
export const serverEnvSchema = z.object({
  /** PostgreSQL 접속 문자열. 기본값을 두지 않는다 — 없으면 기동 대신 실패한다. */
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL 이 비어 있다")
    .refine(
      (value) =>
        value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL 은 postgres:// 또는 postgresql:// 로 시작해야 한다",
    ),

  /** 애플리케이션 외부 URL. 절대 URL 로 둔다 — 콜백·링크 생성의 기준이다. */
  APP_URL: z.url("APP_URL 은 절대 URL 이어야 한다").default("http://localhost:3000"),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /**
   * 세션 쿠키 서명·암호화 키. 🔴 기본값을 두지 않는다.
   *
   * 이 값이 약하면 세션을 위조할 수 있으므로 「있기만 하면」으로 통과시키지 않는다.
   * `openssl rand -base64 32` 또는 `npx auth secret` 이 만드는 길이를 바닥으로 잡는다.
   */
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET 은 32자 이상이어야 한다 (openssl rand -base64 32)"),

  /** GitHub OAuth App 의 Client ID. Server-only — NEXT_PUBLIC_ 로 내보내지 않는다. */
  GITHUB_CLIENT_ID: z.string().min(1, "GITHUB_CLIENT_ID 가 비어 있다"),

  /** GitHub OAuth App 의 Client Secret. Server-only. */
  GITHUB_CLIENT_SECRET: z.string().min(1, "GITHUB_CLIENT_SECRET 이 비어 있다"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
