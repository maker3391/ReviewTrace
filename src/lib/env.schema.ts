import { z } from "zod";

/**
 * 서버 환경 변수 Schema.
 *
 * 환경 변수도 「외부 입력」이다(CLAUDE.md 9). 값이 없거나 형식이 틀리면
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
  APP_URL: z.url("APP_URL 은 절대 URL 이어야 한다").default("http://localhost:3000"),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
 * 🔴 **전부 선택 항목이다.** 없어도 ReviewTrace 는 그대로 돈다 — Evidence 가
 * `UNVERIFIED`/`UNAVAILABLE` 로 남을 뿐이다. 확인 수단이 없다고 기록 자체를 거절하면
 * Private 저장소를 쓰는 사용자는 이 제품을 아예 쓸 수 없다.
 *
 * 🔴 **사용자의 GitHub OAuth Token 을 쓰지 않는다.** 로그인에 쓰는 Scope 는
 * `read:user`·`user:email` 뿐이고, 코드를 읽으려면 `repo` 를 더 받아야 한다 —
 * 그것은 **모든 사용자에게 모든 저장소의 읽기·쓰기 권한을 요구**하는 것이라
 * Evidence 확인 하나를 위해 치를 대가가 아니다(CLAUDE.md 19).
 */
export const githubEnvSchema = z.object({
  /**
   * Evidence 확인에 쓰는 Server-only Token. 없으면 익명으로 호출한다
   * (Public 저장소만 보이고 시간당 60회).
   *
   * 🔴 NEXT_PUBLIC_ 이 아니다. 이 값은 Client 번들에 넘어가지 않는다.
   */
  GITHUB_API_TOKEN: z
    .string()
    .min(1)
    .optional(),

  /** GitHub API 주소. GitHub Enterprise 를 쓰는 자리를 막지 않기 위해 열어 둔다. */
  GITHUB_API_URL: z.url().default("https://api.github.com"),
});

export type GithubEnv = z.infer<typeof githubEnvSchema>;
