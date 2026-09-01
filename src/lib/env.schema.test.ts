import { describe, expect, it } from "vitest";

import { authEnvSchema, serverEnvSchema } from "@/lib/env.schema";

/**
 * 환경 변수도 「외부 입력」이다.
 *
 * 🔴 이 시험이 지키는 것은 **「없으면 반쯤 도는 대신 아예 뜨지 않는다」** 이다.
 * 값이 빠진 채로 뜨면 배포 시점에 알아채지 못하고, 로그인이 조용히 꺼진 상태로 남는다.
 */

/** 형식만 맞춘 자리표시자. 🔴 실제 값을 시험에 적지 않는다. */
const VALID = {
  DATABASE_URL: "postgresql://user:pw@localhost:5432/code_intelligence",
};

const AUTH_VALID: Record<string, string | undefined> = {
  AUTH_SECRET: "x".repeat(32),
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
};

describe("serverEnvSchema", () => {
  it("필수 값이 모두 있으면 통과한다", () => {
    const result = serverEnvSchema.safeParse(VALID);

    expect(result.success).toBe(true);
  });

  it("DATABASE_URL 이 없으면 실패한다", () => {
    const result = serverEnvSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(
      "DATABASE_URL",
    );
  });

  it("postgres 가 아닌 접속 문자열을 거부한다", () => {
    const result = serverEnvSchema.safeParse({
      ...VALID,
      DATABASE_URL: "mysql://localhost:3306/x",
    });

    expect(result.success).toBe(false);
  });

  it("APP_URL 을 비우면 기본값으로 채운다", () => {
    const result = serverEnvSchema.safeParse(VALID);

    expect(result.success).toBe(true);
    expect(result.data?.APP_URL).toBe("http://localhost:3000");
    expect(result.data?.NODE_ENV).toBe("development");
  });

  it("APP_URL 이 절대 URL 이 아니면 거부한다", () => {
    const result = serverEnvSchema.safeParse({
      ...VALID,
      APP_URL: "/dashboard",
    });

    expect(result.success).toBe(false);
  });

  it("인증 값은 여기서 요구하지 않는다 — Database 만 쓰는 코드가 OAuth Secret 을 요구하면 안 된다", () => {
    expect(serverEnvSchema.safeParse(VALID).success).toBe(true);
  });
});

describe("authEnvSchema", () => {
  it("인증 값이 모두 있으면 통과한다", () => {
    expect(authEnvSchema.safeParse(AUTH_VALID).success).toBe(true);
  });

  it("GitHub OAuth 값이 없으면 실패한다 — 로그인이 조용히 꺼지지 않는다", () => {
    for (const key of ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"] as const) {
      const rest = { ...AUTH_VALID };
      delete rest[key];
      const result = authEnvSchema.safeParse(rest);

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path[0])).toContain(key);
    }
  });

  it("AUTH_SECRET 이 없거나 짧으면 거부한다 — 짧으면 세션을 위조할 수 있다", () => {
    expect(
      authEnvSchema.safeParse({ ...AUTH_VALID, AUTH_SECRET: undefined })
        .success,
    ).toBe(false);
    expect(
      authEnvSchema.safeParse({ ...AUTH_VALID, AUTH_SECRET: "short" }).success,
    ).toBe(false);
    expect(
      authEnvSchema.safeParse({ ...AUTH_VALID, AUTH_SECRET: "y".repeat(31) })
        .success,
    ).toBe(false);
  });
});
