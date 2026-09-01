import { z } from "zod";

import { normalizeCredentialHttpBaseUrl } from "@/lib/security/credential-url";

/**
 * 서버 환경 변수 Schema.
 *
 * 환경 변수도 「외부 입력」이다. 값이 없거나 형식이 틀리면
 * 화면이 반쯤 도는 상태가 아니라 **읽는 순간 실패**해야 한다.
 *
 * 🔴 **Schema 를 용도별로 나눈다.** 하나로 묶으면 Database 만 쓰는 코드가 GitHub OAuth Secret
 * 까지 요구한다 — Tenant 격리 시험이나 Migration 도구처럼 인증과 무관한 자리가 그것 때문에
 * 멈춘다. 나눠도 「없으면 실패」는 그대로다. 각자가 자기 값을 처음 쓸 때 실패할 뿐이다.
 *
 * 이 파일은 순수 Schema 만 둔다 — `process.env` 를 읽지 않으므로 시험에서 그대로 쓸 수 있다.
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
  APP_URL: z
    .url("APP_URL 은 절대 URL 이어야 한다")
    .default("http://localhost:3000"),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * 인증에만 쓰는 값.
 *
 * 🔴 **기본값을 두지 않는다.** 없으면 로그인이 조용히 꺼지는 것이 아니라 실패해야 한다 —
 * 조용히 꺼지면 배포 시점에 알아채지 못한다.
 */
export const authEnvSchema = z.object({
  /**
   * 세션 쿠키 서명·암호화 키.
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

export type AuthEnv = z.infer<typeof authEnvSchema>;

/**
 * GitHub Evidence 확인에만 쓰는 값(스펙 15).
 *
 * 🔴 **전부 선택 항목이다.** 없어도 공개 Repository fallback 외 기능은 그대로 돈다.
 * Private Repository는 별도 `githubAppEnvSchema`의 installation credential을 쓴다.
 *
 * 🔴 **사용자의 GitHub OAuth Token 을 쓰지 않는다.** 로그인에 쓰는 Scope 는
 * `read:user`·`user:email` 뿐이고, 코드를 읽으려면 `repo` 를 더 받아야 한다 —
 * 그것은 **모든 사용자에게 모든 저장소의 읽기·쓰기 권한을 요구**하는 것이라
 * Evidence 확인 하나를 위해 치를 대가가 아니다.
 */
export const githubEnvSchema = z.object({
  /**
   * Evidence 확인에 쓰는 Server-only Token. 없으면 익명으로 호출한다
   * (Public 저장소만 보이고 시간당 60회).
   *
   * 🔴 NEXT_PUBLIC_ 이 아니다. 이 값은 Client 번들에 넘어가지 않는다.
   */
  GITHUB_API_TOKEN: z.string().min(1).optional(),

  /**
   * GitHub API 주소. GitHub Enterprise 의 HTTPS host와 `/api/v3` base path는 유지한다.
   * 원격 HTTP는 Token뿐 아니라 Evidence 무결성도 잃으므로, 명시적 loopback 개발만 예외다.
   */
  GITHUB_API_URL: z
    .url()
    .default("https://api.github.com")
    .transform((value, context) => {
      try {
        return normalizeCredentialHttpBaseUrl(value, { allowPath: true });
      } catch {
        context.addIssue({
          code: "custom",
          message:
            "GITHUB_API_URL 은 HTTPS 여야 한다 (localhost, 127.0.0.1, ::1 HTTP 제외)",
        });
        return z.NEVER;
      }
    }),
});

export type GithubEnv = z.infer<typeof githubEnvSchema>;

/** GitHub App installation 연동에 필요한 server-only credential. */
export const githubAppEnvSchema = z.object({
  GITHUB_APP_ID: z.string().regex(/^\d+$/, "GITHUB_APP_ID 는 숫자여야 한다"),
  GITHUB_APP_CLIENT_ID: z.string().min(1, "GITHUB_APP_CLIENT_ID 가 비어 있다"),
  GITHUB_APP_CLIENT_SECRET: z
    .string()
    .min(1, "GITHUB_APP_CLIENT_SECRET 이 비어 있다"),
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .min(1, "GITHUB_APP_PRIVATE_KEY 가 비어 있다"),
  GITHUB_APP_SLUG: z.string().regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  GITHUB_WEB_URL: z
    .url()
    .default("https://github.com")
    .transform((value, context) => {
      try {
        return normalizeCredentialHttpBaseUrl(value, { allowPath: false });
      } catch {
        context.addIssue({
          code: "custom",
          message: "GITHUB_WEB_URL 은 HTTPS 여야 한다",
        });
        return z.NEVER;
      }
    }),
  GITHUB_API_URL: githubEnvSchema.shape.GITHUB_API_URL,
});

export type GithubAppEnv = z.infer<typeof githubAppEnvSchema>;
